import path from 'node:path';

import ffmpegStatic from 'ffmpeg-static';

import { atomicWriteFileSync, ensureDirectory, fs } from '../infra/file-system';
import { normalizeCameraSyncOffsetMs, type Keyframe } from '../../shared/domain/project';
import type { RenderProgressUpdate } from '../../shared/electron-api';
import {
  chooseRenderFps,
  probeVideoDimensionsWithFfmpeg,
  probeVideoFpsWithFfmpeg,
  type VideoDimensions
} from './fps-service';
import { runFfmpeg, type FfmpegProgress } from './ffmpeg-runner';
import {
  buildPremiereXml,
  type PremiereSection,
  type PremiereTake
} from './premiere-xml-service';

export interface PremiereExportTakeInput {
  id: string;
  screenPath: string;
  cameraPath: string | null;
  duration: number;
}

export interface PremiereExportSectionInput {
  takeId: string;
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
}

export interface PremiereExportOptions {
  outputFolder: string;
  projectName: string;
  pipSize: number;
  sourceWidth: number;
  sourceHeight: number;
  cameraSyncOffsetMs: number;
  takes: PremiereExportTakeInput[];
  sections: PremiereExportSectionInput[];
  keyframes: Keyframe[];
}

export interface PremiereExportResult {
  outputFolder: string;
  xmlPath: string;
  mediaFolder: string;
}

export interface PremiereExportDeps {
  probeVideoFpsWithFfmpeg?: typeof probeVideoFpsWithFfmpeg;
  probeVideoDimensionsWithFfmpeg?: typeof probeVideoDimensionsWithFfmpeg;
  runFfmpeg?: typeof runFfmpeg;
  ffmpegPath?: string | null;
  signal?: AbortSignal;
  onProgress?: (update: RenderProgressUpdate) => void;
}

interface TranscodeJob {
  kind: 'screen' | 'camera';
  takeId: string;
  inputPath: string;
  outputPath: string;
  sourceDurationSec: number;
}

function sanitizeTakeIdForFileName(takeId: string): string {
  return takeId.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'take';
}

function screenOutputName(takeId: string): string {
  return `screen-${sanitizeTakeIdForFileName(takeId)}.mov`;
}

function cameraOutputName(takeId: string): string {
  return `camera-${sanitizeTakeIdForFileName(takeId)}.mov`;
}

function roundDownToEven(value: number): number {
  const rounded = Math.floor(value);
  if (rounded <= 2) return 2;
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function buildScreenTranscodeArgs(inputPath: string, outputPath: string): string[] {
  // Preserve native resolution and framerate; only re-encode to ProRes so Premiere
  // imports natively. No scaling or cropping: user keeps full source pixels.
  return [
    '-progress',
    'pipe:1',
    '-nostats',
    '-fflags',
    '+genpts',
    '-i',
    inputPath,
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-c:v',
    'prores_ks',
    '-profile:v',
    '1',
    '-vendor',
    'apl0',
    '-pix_fmt',
    'yuv422p10le',
    '-c:a',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-y',
    outputPath
  ];
}

function buildCameraTranscodeArgs(
  inputPath: string,
  outputPath: string,
  cameraSyncOffsetMs: number
): string[] {
  // Mirror horizontally only; preserve native dimensions so the user can
  // expand / re-crop the full camera frame in Premiere.
  const offsetSec = normalizeCameraSyncOffsetMs(cameraSyncOffsetMs) / 1000;
  const args = [
    '-progress',
    'pipe:1',
    '-nostats',
    '-fflags',
    '+genpts'
  ];
  if (Math.abs(offsetSec) > 0.0005) {
    args.push('-itsoffset', (-offsetSec).toFixed(3));
  }
  args.push(
    '-i',
    inputPath,
    '-map',
    '0:v:0?',
    '-vf',
    'hflip,setsar=1',
    '-an',
    '-c:v',
    'prores_ks',
    '-profile:v',
    '1',
    '-vendor',
    'apl0',
    '-pix_fmt',
    'yuv422p10le',
    '-y',
    outputPath
  );
  return args;
}

export async function exportPremiereProject(
  opts: PremiereExportOptions,
  deps: PremiereExportDeps = {}
): Promise<PremiereExportResult> {
  const outputFolder = opts?.outputFolder?.trim();
  if (!outputFolder) throw new Error('Missing output folder');
  if (!Array.isArray(opts.sections) || opts.sections.length === 0) {
    throw new Error('No sections to export');
  }
  if (!Array.isArray(opts.takes) || opts.takes.length === 0) {
    throw new Error('No takes to export');
  }

  const probeFps = deps.probeVideoFpsWithFfmpeg || probeVideoFpsWithFfmpeg;
  const probeDims = deps.probeVideoDimensionsWithFfmpeg || probeVideoDimensionsWithFfmpeg;
  const runFfmpegProcess = deps.runFfmpeg || runFfmpeg;
  const ffmpegPath = deps.ffmpegPath ?? ffmpegStatic;
  const onProgress = typeof deps.onProgress === 'function' ? deps.onProgress : null;

  if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable on this platform');

  const mediaFolder = path.join(outputFolder, 'media');
  ensureDirectory(mediaFolder);

  const takeMap = new Map<string, PremiereExportTakeInput>();
  for (const take of opts.takes) {
    if (take && take.id) takeMap.set(take.id, take);
  }

  const referencedTakeIds = new Set<string>();
  for (const section of opts.sections) {
    if (section?.takeId) referencedTakeIds.add(section.takeId);
  }

  const hasCamera = opts.keyframes?.some((kf) => kf.pipVisible || kf.cameraFullscreen) ?? false;

  const jobs: TranscodeJob[] = [];
  for (const takeId of referencedTakeIds) {
    const take = takeMap.get(takeId);
    if (!take) throw new Error(`Take ${takeId} not found`);
    if (!take.screenPath || !fs.existsSync(take.screenPath)) {
      throw new Error(`Screen file not found for take ${takeId}`);
    }
    jobs.push({
      kind: 'screen',
      takeId,
      inputPath: take.screenPath,
      outputPath: path.join(mediaFolder, screenOutputName(takeId)),
      sourceDurationSec: Number.isFinite(take.duration) ? take.duration : 0
    });
    if (hasCamera && take.cameraPath && fs.existsSync(take.cameraPath)) {
      jobs.push({
        kind: 'camera',
        takeId,
        inputPath: take.cameraPath,
        outputPath: path.join(mediaFolder, cameraOutputName(takeId)),
        sourceDurationSec: Number.isFinite(take.duration) ? take.duration : 0
      });
    }
  }

  // Probe FPS + dimensions across all unique inputs.
  const uniquePaths = Array.from(new Set(jobs.map((job) => job.inputPath)));
  const probeResults = await Promise.all(
    uniquePaths.map(async (filePath) => ({
      filePath,
      fps: await probeFps(ffmpegPath, filePath),
      dims: await probeDims(ffmpegPath, filePath)
    }))
  );
  const dimsByPath = new Map<string, VideoDimensions | null>();
  for (const result of probeResults) {
    dimsByPath.set(result.filePath, result.dims);
  }

  const targetFps = chooseRenderFps(
    probeResults.map((result) => result.fps),
    hasCamera
  );

  // Sequence dimensions = native screen resolution (preserves full quality; user
  // can downscale later if desired). Caller-supplied source dims are a fallback
  // when probing fails.
  let canvasW = Math.max(2, Math.round(Number(opts.sourceWidth) || 0));
  let canvasH = Math.max(2, Math.round(Number(opts.sourceHeight) || 0));
  if (referencedTakeIds.size > 0) {
    const firstTakeId = Array.from(referencedTakeIds)[0];
    const firstTake = takeMap.get(firstTakeId);
    if (firstTake) {
      const screenDims = dimsByPath.get(firstTake.screenPath) ?? null;
      if (screenDims && screenDims.width > 0 && screenDims.height > 0) {
        canvasW = roundDownToEven(screenDims.width);
        canvasH = roundDownToEven(screenDims.height);
      }
    }
  }
  canvasW = Math.max(2, canvasW);
  canvasH = Math.max(2, canvasH);

  onProgress?.({
    phase: 'starting',
    percent: 0,
    status: 'Preparing Premiere export...',
    durationSec: jobs.reduce((total, j) => total + Math.max(0, j.sourceDurationSec), 0)
  });

  let completedJobs = 0;
  const totalJobs = jobs.length;

  for (const job of jobs) {
    if (deps.signal?.aborted) throw new Error('Premiere export aborted');

    const args =
      job.kind === 'screen'
        ? buildScreenTranscodeArgs(job.inputPath, job.outputPath)
        : buildCameraTranscodeArgs(job.inputPath, job.outputPath, opts.cameraSyncOffsetMs);

    const jobDuration = Math.max(0.001, job.sourceDurationSec || 0);
    await runFfmpegProcess({
      ffmpegPath,
      args,
      signal: deps.signal,
      onProgress: (progress: FfmpegProgress) => {
        if (!onProgress) return;
        const outTimeSec =
          Number.isFinite(progress.outTimeSec) && progress.outTimeSec !== null
            ? progress.outTimeSec
            : null;
        const localPercent =
          outTimeSec !== null && jobDuration > 0
            ? Math.max(0, Math.min(1, outTimeSec / jobDuration))
            : 0;
        const overallPercent = Math.max(
          0,
          Math.min(1, (completedJobs + localPercent) / Math.max(1, totalJobs))
        );
        onProgress({
          phase: 'transcoding',
          percent: overallPercent,
          status: `Transcoding ${job.kind} (${completedJobs + 1}/${totalJobs})`,
          outTimeSec: outTimeSec,
          durationSec: jobDuration,
          frame: progress.frame ?? null,
          speed: progress.speed ?? null
        });
      }
    });
    completedJobs += 1;
  }

  const exportTakes: PremiereTake[] = Array.from(referencedTakeIds).map((takeId) => {
    const take = takeMap.get(takeId);
    if (!take) throw new Error(`Take ${takeId} not found`);
    const hasCam = hasCamera && !!take.cameraPath;
    const durationSec = Number.isFinite(take.duration) ? take.duration : 0;

    const screenDims = dimsByPath.get(take.screenPath) ?? null;
    const cameraDims = take.cameraPath ? (dimsByPath.get(take.cameraPath) ?? null) : null;

    return {
      id: takeId,
      screenPath: path.join(mediaFolder, screenOutputName(takeId)),
      cameraPath: hasCam ? path.join(mediaFolder, cameraOutputName(takeId)) : null,
      screenDurationSec: durationSec,
      cameraDurationSec: hasCam ? durationSec : 0,
      screenWidth: screenDims?.width ?? canvasW,
      screenHeight: screenDims?.height ?? canvasH,
      cameraWidth: hasCam ? (cameraDims?.width ?? null) : null,
      cameraHeight: hasCam ? (cameraDims?.height ?? null) : null
    };
  });

  const sectionsForXml: PremiereSection[] = opts.sections
    .filter((section) => section && section.takeId && referencedTakeIds.has(section.takeId))
    .map((section) => ({
      takeId: section.takeId,
      timelineStart: Math.max(0, Number(section.timelineStart) || 0),
      timelineEnd: Math.max(0, Number(section.timelineEnd) || 0),
      sourceStart: Math.max(0, Number(section.sourceStart) || 0),
      sourceEnd: Math.max(0, Number(section.sourceEnd) || 0)
    }));

  const xml = buildPremiereXml({
    projectName: opts.projectName || 'Loop Project',
    canvasW,
    canvasH,
    fps: targetFps,
    pipSize: opts.pipSize,
    takes: exportTakes,
    sections: sectionsForXml,
    keyframes: Array.isArray(opts.keyframes) ? opts.keyframes : [],
    hasCamera
  });

  const xmlPath = path.join(outputFolder, `${opts.projectName || 'Loop Project'}.xml`);
  atomicWriteFileSync(xmlPath, xml, 'utf8');

  onProgress?.({
    phase: 'finalizing',
    percent: 1,
    status: 'Premiere export complete',
    durationSec: 0
  });

  return {
    outputFolder,
    xmlPath,
    mediaFolder
  };
}
