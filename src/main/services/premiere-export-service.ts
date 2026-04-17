import path from 'node:path';

import ffmpegStatic from 'ffmpeg-static';

import { atomicWriteFileSync, ensureDirectory, fs } from '../infra/file-system';
import {
  normalizeAudioSource,
  normalizeCameraSyncOffsetMs,
  type AudioSource,
  type Keyframe
} from '../../shared/domain/project';
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
  audioPath?: string | null;
  audioSource?: AudioSource | null;
  hasSystemAudio?: boolean;
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
  kind: 'screen' | 'camera' | 'audio';
  takeId: string;
  inputPath: string;
  outputPath: string;
  sourceDurationSec: number;
  // Whether to keep the source audio track when transcoding camera video.
  // True when the camera file owns the mic (audioSource === 'camera').
  includeCameraAudio?: boolean;
}

function sanitizeTakeIdForFileName(takeId: string): string {
  return takeId.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'take';
}

function screenOutputName(takeId: string): string {
  return `screen-${sanitizeTakeIdForFileName(takeId)}.mp4`;
}

function cameraOutputName(takeId: string): string {
  return `camera-${sanitizeTakeIdForFileName(takeId)}.mp4`;
}

function audioOutputName(takeId: string): string {
  return `audio-${sanitizeTakeIdForFileName(takeId)}.wav`;
}

function roundDownToEven(value: number): number {
  const rounded = Math.floor(value);
  if (rounded <= 2) return 2;
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

// High-quality (visually lossless) H.264 MP4 is used as the Premiere
// intermediate: Premiere imports it natively, scrubbing is smooth enough for
// editing, and file sizes stay ~10-30x smaller than ProRes 422 LT. Every
// transcode force-normalizes VFR WebM input to CFR (fps filter + -fps_mode)
// so MediaRecorder's variable timestamps don't expand the camera file's
// duration (e.g. 15 min becoming 48 min at 150+ GB) or make playback speed
// fluctuate between "fast" and "slow-mo" regions.
function buildScreenTranscodeArgs(
  inputPath: string,
  outputPath: string,
  targetFps: number
): string[] {
  const gop = String(Math.max(2, Math.round(targetFps * 2)));
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
    '-vf',
    `fps=${targetFps},setsar=1`,
    '-fps_mode',
    'cfr',
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-g',
    gop,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-y',
    outputPath
  ];
}

function buildCameraTranscodeArgs(
  inputPath: string,
  outputPath: string,
  cameraSyncOffsetMs: number,
  includeAudio: boolean,
  targetFps: number
): string[] {
  // Mirror horizontally + force CFR. Preserves native dimensions so the user
  // can expand / re-crop the full camera frame in Premiere.
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
    `hflip,fps=${targetFps},setsar=1`,
    '-fps_mode',
    'cfr'
  );
  if (includeAudio) {
    // Camera file owns the mic for this take; preserve it so Premiere can
    // import the PiP clip with its built-in audio track.
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
  } else {
    args.push('-an');
  }
  const gop = String(Math.max(2, Math.round(targetFps * 2)));
  args.push(
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-g',
    gop,
    '-movflags',
    '+faststart',
    '-y',
    outputPath
  );
  return args;
}

function buildAudioTranscodeArgs(inputPath: string, outputPath: string): string[] {
  // Audio-only takes are written as 48kHz stereo PCM wav so Premiere imports
  // them without needing to decode WebM/Opus on the editor's Import path.
  return [
    '-progress',
    'pipe:1',
    '-nostats',
    '-fflags',
    '+genpts',
    '-i',
    inputPath,
    '-vn',
    '-map',
    '0:a:0?',
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
    const takeAudioSource = normalizeAudioSource(take.audioSource) ?? 'screen';
    const cameraOwnsAudio = takeAudioSource === 'camera';
    // Transcode the camera file whenever its video is visible OR when it
    // owns the mic; otherwise skip (matches legacy behavior for hidden camera).
    const needsCameraJob =
      (hasCamera || cameraOwnsAudio) && !!take.cameraPath && fs.existsSync(take.cameraPath);
    jobs.push({
      kind: 'screen',
      takeId,
      inputPath: take.screenPath,
      outputPath: path.join(mediaFolder, screenOutputName(takeId)),
      sourceDurationSec: Number.isFinite(take.duration) ? take.duration : 0
    });
    if (needsCameraJob) {
      jobs.push({
        kind: 'camera',
        takeId,
        inputPath: take.cameraPath as string,
        outputPath: path.join(mediaFolder, cameraOutputName(takeId)),
        sourceDurationSec: Number.isFinite(take.duration) ? take.duration : 0,
        includeCameraAudio: cameraOwnsAudio
      });
    }
    if (
      takeAudioSource === 'external' &&
      take.audioPath &&
      fs.existsSync(take.audioPath)
    ) {
      jobs.push({
        kind: 'audio',
        takeId,
        inputPath: take.audioPath,
        outputPath: path.join(mediaFolder, audioOutputName(takeId)),
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

    let args: string[];
    if (job.kind === 'screen') {
      args = buildScreenTranscodeArgs(job.inputPath, job.outputPath, targetFps);
    } else if (job.kind === 'camera') {
      args = buildCameraTranscodeArgs(
        job.inputPath,
        job.outputPath,
        opts.cameraSyncOffsetMs,
        job.includeCameraAudio === true,
        targetFps
      );
    } else {
      args = buildAudioTranscodeArgs(job.inputPath, job.outputPath);
    }

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

  onProgress?.({
    phase: 'finalizing',
    percent: 0.99,
    status: 'Writing Premiere XML...',
    durationSec: 0
  });

  const exportTakes: PremiereTake[] = Array.from(referencedTakeIds).map((takeId) => {
    const take = takeMap.get(takeId);
    if (!take) throw new Error(`Take ${takeId} not found`);
    const takeAudioSource = normalizeAudioSource(take.audioSource) ?? 'screen';
    const cameraOwnsAudio = takeAudioSource === 'camera';
    // Camera appears in the XML whenever its ProRes output was produced — so
    // video-only camera takes (hasCamera) and audio-routing camera takes both
    // show up; silent camera takes with no hasCamera stay omitted.
    const hasCam =
      (hasCamera || cameraOwnsAudio) && !!take.cameraPath && fs.existsSync(take.cameraPath);
    const durationSec = Number.isFinite(take.duration) ? take.duration : 0;

    const screenDims = dimsByPath.get(take.screenPath) ?? null;
    const cameraDims = take.cameraPath ? (dimsByPath.get(take.cameraPath) ?? null) : null;

    const resolvedAudioSource: AudioSource | null = (() => {
      if (takeAudioSource === 'camera' && hasCam) return 'camera';
      if (takeAudioSource === 'external' && take.audioPath) return 'external';
      if (takeAudioSource === 'screen') return 'screen';
      return null;
    })();

    const audioPath =
      takeAudioSource === 'external' && take.audioPath
        ? path.join(mediaFolder, audioOutputName(takeId))
        : null;

    return {
      id: takeId,
      screenPath: path.join(mediaFolder, screenOutputName(takeId)),
      cameraPath: hasCam ? path.join(mediaFolder, cameraOutputName(takeId)) : null,
      audioPath,
      audioSource: resolvedAudioSource,
      // Screen transcode keeps the source audio track (`-map 0:a:0?`), so if
      // the take advertised system audio it survives the ProRes pass.
      hasSystemAudio: take.hasSystemAudio === true,
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
