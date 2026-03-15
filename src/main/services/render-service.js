const path = require('path');
const { execFile } = require('child_process');

const { fs, ensureDirectory } = require('../infra/file-system');
const {
  normalizeBackgroundZoom,
  normalizeBackgroundPan,
  normalizeExportAudioPreset,
  normalizeCameraSyncOffsetMs,
  EXPORT_AUDIO_PRESET_COMPRESSED
} = require('../../shared/domain/project');
const { chooseRenderFps, probeVideoFpsWithFfmpeg } = require('./fps-service');
const { buildFilterComplex, buildScreenFilter } = require('./render-filter-service');

function normalizeSectionInput(rawSections) {
  const sections = Array.isArray(rawSections) ? rawSections : [];
  return sections
    .map((section) => {
      const sourceStart = Number(section.sourceStart);
      const sourceEnd = Number(section.sourceEnd);
      if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) return null;
      return {
        takeId: section.takeId,
        sourceStart,
        sourceEnd,
        backgroundZoom: normalizeBackgroundZoom(section.backgroundZoom),
        backgroundPanX: normalizeBackgroundPan(section.backgroundPanX),
        backgroundPanY: normalizeBackgroundPan(section.backgroundPanY)
      };
    })
    .filter(Boolean);
}

function assertFilePath(filePath, label) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error(`Missing ${label} path`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file not found: ${filePath}`);
  }
}

function buildExportAudioLabel(exportAudioPreset) {
  if (exportAudioPreset !== EXPORT_AUDIO_PRESET_COMPRESSED) {
    return 'audio_out';
  }

  // Keep the first preset conservative so dialog remains natural while peaks get leveled.
  return 'audio_final';
}

function buildCameraTrimFilter(cameraIdx, section, targetFps, index, cameraSyncOffsetMs) {
  const start = Number(section.sourceStart);
  const end = Number(section.sourceEnd);
  const duration = end - start;
  const offsetSec = normalizeCameraSyncOffsetMs(cameraSyncOffsetMs) / 1000;
  const label = `[cv${index}]`;

  if (!Number.isFinite(offsetSec) || Math.abs(offsetSec) < 0.0005) {
    return `[${cameraIdx}:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,fps=fps=${targetFps}${label}`;
  }

  const sampleStart = Math.max(0, start + offsetSec);
  const unclampedSampleEnd = Math.max(0, end + offsetSec);
  const sampleEnd = Math.max(sampleStart + 0.001, unclampedSampleEnd);
  const startPad = Math.max(0, -offsetSec);
  const stopPad = Math.max(0, offsetSec);

  return `[${cameraIdx}:v]trim=start=${sampleStart.toFixed(3)}:end=${sampleEnd.toFixed(3)},setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=${startPad.toFixed(3)}:stop_mode=clone:stop_duration=${stopPad.toFixed(3)},trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,fps=fps=${targetFps}${label}`;
}

async function renderComposite(opts = {}, deps = {}) {
  const takes = Array.isArray(opts.takes) ? opts.takes : [];
  const sections = normalizeSectionInput(opts.sections);
  const keyframes = Array.isArray(opts.keyframes) ? opts.keyframes : [];
  const pipSize = Number.isFinite(Number(opts.pipSize)) ? Number(opts.pipSize) : 422;
  const screenFitMode = opts.screenFitMode === 'fit' ? 'fit' : 'fill';
  const exportAudioPreset = normalizeExportAudioPreset(opts.exportAudioPreset);
  const cameraSyncOffsetMs = normalizeCameraSyncOffsetMs(opts.cameraSyncOffsetMs);
  const sourceWidth = Number.isFinite(Number(opts.sourceWidth)) ? Number(opts.sourceWidth) : 1920;
  const sourceHeight = Number.isFinite(Number(opts.sourceHeight)) ? Number(opts.sourceHeight) : 1080;
  const outputFolder = typeof opts.outputFolder === 'string' ? opts.outputFolder : '';

  const exec = deps.execFile || execFile;
  const probeFps = deps.probeVideoFpsWithFfmpeg || probeVideoFpsWithFfmpeg;
  const ffmpegPath = deps.ffmpegPath || require('ffmpeg-static');
  const now = typeof deps.now === 'function' ? deps.now : Date.now;

  if (!outputFolder) throw new Error('Missing output folder');
  if (sections.length === 0) throw new Error('No sections to render');

  ensureDirectory(outputFolder);

  if (!ffmpegPath) throw new Error('ffmpeg-static is unavailable on this platform');

  const outputPath = path.join(outputFolder, `recording-${now()}-edited.mp4`);
  const canvasW = 1920;
  const canvasH = 1080;

  const takeMap = new Map();
  for (const take of takes) {
    if (!take || typeof take.id !== 'string' || !take.id) continue;
    takeMap.set(take.id, { screenPath: take.screenPath, cameraPath: take.cameraPath });
  }

  const hasCamera = keyframes.some((keyframe) => keyframe.pipVisible || keyframe.cameraFullscreen);
  const fpsProbePaths = new Set();
  const sectionInputs = [];
  const args = [];
  let inputIndex = 0;

  for (const section of sections) {
    const take = takeMap.get(section.takeId);
    if (!take) throw new Error(`Take ${section.takeId} not found`);

    assertFilePath(take.screenPath, 'Screen');
    args.push('-i', take.screenPath);
    fpsProbePaths.add(take.screenPath);

    const screenIdx = inputIndex++;
    let cameraIdx = -1;
    if (hasCamera && take.cameraPath) {
      assertFilePath(take.cameraPath, 'Camera');
      args.push('-i', take.cameraPath);
      fpsProbePaths.add(take.cameraPath);
      cameraIdx = inputIndex++;
    }

    sectionInputs.push({ screenIdx, cameraIdx });
  }

  const fpsProbeResults = await Promise.all(
    Array.from(fpsProbePaths).map(async (filePath) => ({
      filePath,
      fps: await probeFps(ffmpegPath, filePath)
    }))
  );

  const targetFps = chooseRenderFps(
    fpsProbeResults.map((result) => result.fps),
    hasCamera
  );

  console.log(
    '[render-composite] FPS selection:',
    fpsProbeResults.map((result) => ({
      file: path.basename(result.filePath),
      fps: result.fps ? Number(result.fps.toFixed(3)) : null
    })),
    'targetFps=',
    targetFps
  );

  const filterParts = [];
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    const { screenIdx } = sectionInputs[i];
    const start = section.sourceStart.toFixed(3);
    const end = section.sourceEnd.toFixed(3);
    filterParts.push(
      `[${screenIdx}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,fps=fps=${targetFps},setsar=1[sv${i}]`
    );
    filterParts.push(`[${screenIdx}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[sa${i}]`);
  }

  const screenLabels = sections.map((_, index) => `[sv${index}][sa${index}]`).join('');
  filterParts.push(`${screenLabels}concat=n=${sections.length}:v=1:a=1[screen_raw][audio_out]`);
  const exportAudioLabel = buildExportAudioLabel(exportAudioPreset);
  if (exportAudioLabel === 'audio_final') {
    filterParts.push(
      '[audio_out]acompressor=threshold=0.125:ratio=3:attack=20:release=250:makeup=1.5[audio_final]'
    );
  }

  if (hasCamera) {
    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i];
      const { cameraIdx } = sectionInputs[i];
      const duration = (section.sourceEnd - section.sourceStart).toFixed(3);
      if (cameraIdx >= 0) {
        filterParts.push(buildCameraTrimFilter(cameraIdx, section, targetFps, i, cameraSyncOffsetMs));
      } else {
        filterParts.push(`color=black:s=1920x1080:d=${duration}[cv${i}]`);
      }
    }

    const cameraLabels = sections.map((_, index) => `[cv${index}]`).join('');
    filterParts.push(`${cameraLabels}concat=n=${sections.length}:v=1:a=0[camera_raw]`);
    const overlayFilter = buildFilterComplex(
      keyframes,
      pipSize,
      screenFitMode,
      sourceWidth,
      sourceHeight,
      canvasW,
      canvasH,
      true,
      targetFps
    );
    const adaptedOverlay = overlayFilter
      .replace(/\[0:v\]/g, '[screen_raw]')
      .replace(/\[1:v\]/g, '[camera_raw]');
    filterParts.push(adaptedOverlay);
  } else {
    const screenOnlyFilter = buildScreenFilter(
      keyframes,
      screenFitMode,
      sourceWidth,
      sourceHeight,
      canvasW,
      canvasH,
      '[out]',
      true,
      targetFps
    ).replace(/\[0:v\]/g, '[screen_raw]');
    filterParts.push(screenOnlyFilter);
  }

  filterParts.push(`[out]fps=fps=${targetFps}:round=near[out_cfr]`);
  args.push('-filter_complex', filterParts.join(';'), '-map', '[out_cfr]', '-map', `[${exportAudioLabel}]`);
  args.push(
    '-r',
    String(targetFps),
    '-fps_mode',
    'cfr',
    '-c:v',
    'libx264',
    '-crf',
    '12',
    '-preset',
    'slow',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-y',
    outputPath
  );

  console.log('ffmpeg args:', args.join(' '));

  return new Promise((resolve, reject) => {
    exec(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        console.error('ffmpeg stderr:', stderr);
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(outputPath);
    });
  });
}

module.exports = {
  renderComposite,
  normalizeSectionInput,
  assertFilePath,
  buildCameraTrimFilter
};
