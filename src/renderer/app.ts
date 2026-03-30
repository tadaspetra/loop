// @ts-nocheck
import {
  normalizeTranscriptText,
  stripNonSpeechAnnotations,
  extractSpokenWordTokens
} from './features/transcript/transcript-utils';
import {
  getScribeStatusFromCloseEvent,
  getScribeStatusFromMessage
} from './features/transcript/scribe-status';
import {
  roundMs,
  buildRemappedSectionsFromSegments,
  normalizeSections,
  buildDefaultSectionsForDuration,
  normalizeTakeSections,
  attachSectionTranscripts
} from './features/timeline/section-utils';
import {
  generateSectionId,
  reindexSections,
  buildSplitAnchorKeyframe,
  moveSectionToIndex,
  moveSectionsToIndex
} from './features/timeline/keyframe-ops';
import {
  computePlaybackSeekPlan,
  computeCameraPlaybackDrift,
  normalizeCameraSyncOffsetMs,
  resolveCameraPlaybackTargetTime
} from './features/timeline/camera-sync';
import {
  finalizeRecordingChunks,
  getRecorderFinalizeTimeoutMs,
  getRecorderOptions,
  getRecorderTimesliceMs,
  shouldRenderPreviewFrame,
  createCameraRecordingStream
} from './features/recording/recorder-utils';
import { drawMirroredImage, getCenteredSquareCropRect } from './features/camera/camera-render';
import { cleanupAllMedia } from './features/media-cleanup';

const projectHomeView = document.getElementById('projectHomeView');
const workspaceHeader = document.getElementById('workspaceHeader');
const newProjectNameInput = document.getElementById('newProjectName');
const createProjectBtn = document.getElementById('createProjectBtn');
const openProjectBtn = document.getElementById('openProjectBtn');
const projectHomeMessage = document.getElementById('projectHomeMessage');
const lastProjectRow = document.getElementById('lastProjectRow');
const lastProjectName = document.getElementById('lastProjectName');
const lastProjectPath = document.getElementById('lastProjectPath');
const resumeLastBtn = document.getElementById('resumeLastBtn');
const recentProjectsList = document.getElementById('recentProjectsList');
const activeProjectNameEl = document.getElementById('activeProjectName');
const activeProjectPathEl = document.getElementById('activeProjectPath');
const goRecordingBtn = document.getElementById('goRecordingBtn');
const goTimelineBtn = document.getElementById('goTimelineBtn');
const switchProjectBtn = document.getElementById('switchProjectBtn');
const exportAudioPresetControl = document.getElementById('exportAudioPresetControl');
const exportAudioPresetSelect = document.getElementById('exportAudioPreset');
const exportVideoPresetControl = document.getElementById('exportVideoPresetControl');
const exportVideoPresetSelect = document.getElementById('exportVideoPreset');
const cameraSyncOffsetControl = document.getElementById('cameraSyncOffsetControl');
const cameraSyncOffsetInput = document.getElementById('cameraSyncOffsetMs');

const screenSelect = document.getElementById('screenSource');
const screenFitSelect = document.getElementById('screenFit');
const cameraSelect = document.getElementById('cameraSource');
const audioSelect = document.getElementById('audioSource');
const canvas = document.getElementById('compositeCanvas');
const ctx = canvas.getContext('2d');
const screenVideo = document.getElementById('screenVideo');
const cameraVideo = document.getElementById('cameraVideo');
const noPreview = document.getElementById('noPreview');
const audioMeter = document.getElementById('audioMeter');
const recordBtn = document.getElementById('recordBtn');
const timerEl = document.getElementById('timer');
const folderPathEl = document.getElementById('folderPath');
const openFolderBtn = document.getElementById('openFolderBtn');
const pickFolderBtn = document.getElementById('pickFolderBtn');
const contentProtectionToggle = document.getElementById('contentProtectionToggle');
const recordingView = document.getElementById('recordingView');
const transcriptPanel = document.getElementById('transcriptPanel');
const transcriptContent = document.getElementById('transcriptContent');
const transcriptStatus = document.getElementById('transcriptStatus');
const segmentBadge = document.getElementById('segmentBadge');
const processingView = document.getElementById('processingView');
const processingTitle = document.getElementById('processingTitle');
const processingStatus = document.getElementById('processingStatus');
const processingBar = document.getElementById('processingBar');

// Editor DOM refs
const editorView = document.getElementById('editorView');
const editorCanvas = document.getElementById('editorCanvas');
const editorCtx = editorCanvas.getContext('2d');
const editorRenderBtn = document.getElementById('editorRenderBtn');
const editorUndoBtn = document.getElementById('editorUndoBtn');
const editorRedoBtn = document.getElementById('editorRedoBtn');
const editorPlayBtn = document.getElementById('editorPlayBtn');
const editorSplitBtn = document.getElementById('editorSplitBtn');
const editorToggleCamBtn = document.getElementById('editorToggleCamBtn');
const editorCamFullBtn = document.getElementById('editorCamFullBtn');
const editorBgZoomInput = document.getElementById('editorBgZoomInput');
const editorBgZoomValue = document.getElementById('editorBgZoomValue');
const editorApplyFutureBtn = document.getElementById('editorApplyFutureBtn');
const editorTimeEl = document.getElementById('editorTime');
const editorTimelineWrapper = document.getElementById('editorTimelineWrapper');
const editorTimeline = document.getElementById('editorTimeline');
const editorSectionMarkers = document.getElementById('editorSectionMarkers');
const editorScrubber = document.getElementById('editorScrubber');
const editorCameraTrack = document.getElementById('editorCameraTrack');
const editorCameraMarkers = document.getElementById('editorCameraMarkers');
const cameraTrackLabel = document.getElementById('cameraTrackLabel');
const editorSectionTranscriptList = document.getElementById('editorSectionTranscriptList');
let editorRenderTimeout = null;
const editorWaveformCanvas = document.getElementById('editorWaveformCanvas');

let screenStream = null;
let cameraStream = null;
let audioStream = null;
let recorders = [];
let recording = false;
let screenRecInterval = null;
let trackEndedCleanups = [];
let timerInterval = null;
let startTime = 0;
let audioContext = null;
let analyser = null;
let meterRAF = null;
let drawRAF = null;
let lastCompositeDrawAt = 0;
let saveFolder = '';
let hideFromRecording = 'true';
let activeProjectPath = '';
let activeProject = null;
let activeProjectSession = 0;
let activeWorkspaceView = 'home';
let saveDebounceTimer = null;
let persistQueue = Promise.resolve();
let mediaInitialized = false;
let mediaIdleTimer = null;
let scribeWs = null;
let scribeWorkletNode = null;
let speechSegments = [];
let audioChunkBuffer = [];
let audioSendInterval = null;
let scribeLastFailureReason = null;
let scribeManualClose = false;
let micSourceNode = null;
const MEDIA_IDLE_TIMEOUT_MS = 30000;

function clearMediaIdleTimer() {
  if (!mediaIdleTimer) return;
  clearTimeout(mediaIdleTimer);
  mediaIdleTimer = null;
}

function resetMediaRefsAfterCleanup() {
  recording = false;
  screenStream = null;
  cameraStream = null;
  audioStream = null;
  recorders = [];
  screenRecInterval = null;
  timerInterval = null;
  audioContext = null;
  analyser = null;
  meterRAF = null;
  drawRAF = null;
  lastCompositeDrawAt = 0;
  scribeWs = null;
  scribeWorkletNode = null;
  audioChunkBuffer = [];
  audioSendInterval = null;
  micSourceNode = null;
  mediaInitialized = false;
  screenVideo.srcObject = null;
  cameraVideo.srcObject = null;
}

function cleanupRendererMediaResources() {
  cleanupAllMedia({
    recording,
    screenStream,
    cameraStream,
    audioStream,
    recorders,
    screenRecInterval,
    audioSendInterval,
    timerInterval,
    audioContext,
    scribeWorkletNode,
    scribeWs,
    drawRAF,
    meterRAF,
    cancelEditorDrawLoop,
    stopAudioMeter
  });
  resetMediaRefsAfterCleanup();
}

function hasActiveRecorders() {
  return recorders.some((recorder) => recorder?.state && recorder.state !== 'inactive');
}

function handleRenderProgress(update) {
  if (!editorState || !editorState.rendering) return;

  const percent = Number.isFinite(Number(update?.percent))
    ? Math.max(0, Math.min(1, Number(update.percent)))
    : null;
  editorState.renderProgress = percent ?? 0;

  processingTitle.textContent = 'Rendering export...';
  processingStatus.textContent =
    typeof update?.status === 'string' && update.status ? update.status : 'Rendering...';
  setProcessingProgress(percent);

  if (percent === null) {
    setRenderBtnState(processingStatus.textContent, 'busy');
    return;
  }

  setRenderBtnState(`Rendering ${Math.round(percent * 100)}%`, 'busy');
}

if (typeof window.electronAPI.onRenderProgress === 'function') {
  window.electronAPI.onRenderProgress((update) => {
    handleRenderProgress(update);
  });
}

if (typeof window.electronAPI.onProxyProgress === 'function') {
  window.electronAPI.onProxyProgress((payload) => {
    if (!payload || !payload.takeId) return;
    if (payload.status === 'progress') {
      const current = proxyStatus.get(payload.takeId);
      if (current && current.status === 'pending') {
        current.percent = payload.percent || 0;
        updateProxyProgressBars(payload.takeId, current.percent);
      }
    } else if (payload.status === 'done' && payload.proxyPath) {
      proxyStatus.set(payload.takeId, { status: 'done', percent: 1 });
      const take = activeProject?.takes?.find((t) => t.id === payload.takeId);
      if (take) {
        take.proxyPath = payload.proxyPath;
        persistProjectNow().catch((err) =>
          console.warn('[Proxy] Failed to persist proxyPath:', err)
        );
      }
      // Hot-swap the cached video element to use the proxy
      const cached = takeVideoPool.get(payload.takeId);
      if (cached) {
        const wasPlaying = !cached.screen.paused;
        const currentTime = cached.screen.currentTime;
        const rate = cached.screen.playbackRate;
        cached.screen.src = pathToFileUrl(payload.proxyPath);
        cached.screen.addEventListener(
          'loadedmetadata',
          () => {
            cached.screen.currentTime = currentTime;
            if (wasPlaying) {
              cached.screen.playbackRate = rate;
              cached.screen.play().catch(() => {});
              if (!hasPendingEditorDraw()) scheduleEditorDrawLoop();
            }
          },
          { once: true }
        );
      }
      renderSectionMarkers();
    } else if (payload.status === 'error') {
      proxyStatus.set(payload.takeId, { status: 'error', percent: 0 });
      console.warn('[Proxy] Generation failed for take', payload.takeId, payload.error);
      renderSectionMarkers();
    }
  });
}
let scribeAudioOffset = 0; // seconds between recording start and first audio sent to Scribe
let workletRegistered = null; // tracks which AudioContext has the worklet registered

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const PIP_FRACTION = 0.22;
const PIP_MARGIN = 20;
const PIP_SIZE = Math.round(CANVAS_W * PIP_FRACTION);
const MIN_SECTION_ZOOM = 1;
const MAX_SECTION_ZOOM = 3;
const DEFAULT_SECTION_ZOOM = 1;
const MIN_SECTION_PAN = -1;
const MAX_SECTION_PAN = 1;
const EXPORT_AUDIO_PRESET_OFF = 'off';
const EXPORT_AUDIO_PRESET_COMPRESSED = 'compressed';
const EXPORT_VIDEO_PRESET_FAST = 'fast';
const EXPORT_VIDEO_PRESET_QUALITY = 'quality';

function snapToNearestCorner(cursorX, cursorY) {
  const midX = CANVAS_W / 2;
  const midY = CANVAS_H / 2;
  return {
    x: cursorX < midX ? PIP_MARGIN : CANVAS_W - PIP_SIZE - PIP_MARGIN,
    y: cursorY < midY ? PIP_MARGIN : CANVAS_H - PIP_SIZE - PIP_MARGIN
  };
}

function clampSectionZoom(value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return DEFAULT_SECTION_ZOOM;
  return Math.max(MIN_SECTION_ZOOM, Math.min(MAX_SECTION_ZOOM, zoom));
}

function formatSectionZoom(value) {
  return `${clampSectionZoom(value).toFixed(2)}x`;
}

function clampSectionPan(value) {
  const pan = Number(value);
  if (!Number.isFinite(pan)) return 0;
  return Math.max(MIN_SECTION_PAN, Math.min(MAX_SECTION_PAN, pan));
}

function normalizeExportAudioPreset(value) {
  return value === EXPORT_AUDIO_PRESET_OFF
    ? EXPORT_AUDIO_PRESET_OFF
    : EXPORT_AUDIO_PRESET_COMPRESSED;
}

function normalizeExportVideoPreset(value) {
  return value === EXPORT_VIDEO_PRESET_FAST
    ? EXPORT_VIDEO_PRESET_FAST
    : EXPORT_VIDEO_PRESET_QUALITY;
}

function getZoomCropBounds(zoom) {
  const clampedZoom = clampSectionZoom(zoom);
  const sourceW = CANVAS_W / clampedZoom;
  const sourceH = CANVAS_H / clampedZoom;
  return {
    sourceW,
    sourceH,
    maxOffsetX: Math.max(0, (CANVAS_W - sourceW) / 2),
    maxOffsetY: Math.max(0, (CANVAS_H - sourceH) / 2)
  };
}

function resolveZoomCrop(zoom, panX = 0, panY = 0) {
  const { sourceW, sourceH, maxOffsetX, maxOffsetY } = getZoomCropBounds(zoom);
  return {
    sourceW,
    sourceH,
    sourceX: maxOffsetX + clampSectionPan(panX) * maxOffsetX,
    sourceY: maxOffsetY + clampSectionPan(panY) * maxOffsetY,
    maxOffsetX,
    maxOffsetY
  };
}

function panToFocusCoord(zoom, pan, defaultCoord = 0.5) {
  const normalizedZoom = clampSectionZoom(zoom);
  if (normalizedZoom <= 1.0001) return defaultCoord;
  const cropFraction = 1 / normalizedZoom;
  return cropFraction / 2 + ((clampSectionPan(pan) + 1) / 2) * (1 - cropFraction);
}

function focusToPanCoord(zoom, focus, defaultPan = 0) {
  const normalizedZoom = clampSectionZoom(zoom);
  if (normalizedZoom <= 1.0001) return defaultPan;
  const cropFraction = 1 / normalizedZoom;
  const availableFraction = 1 - cropFraction;
  if (availableFraction <= 0.000001) return defaultPan;
  return clampSectionPan(((focus - cropFraction / 2) / availableFraction) * 2 - 1);
}

const TRANSITION_DURATION = 0.3;
const CAMERA_DRIFT_SOFT_THRESHOLD = 0.015;
const CAMERA_DRIFT_HARD_THRESHOLD = 0.18;
const CAMERA_DRIFT_LOG_THRESHOLD = 0.08;
const CAMERA_DRIFT_LOG_INTERVAL_MS = 1000;
const CAMERA_RESYNC_COOLDOWN_MS = 500;

canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
editorCanvas.width = CANVAS_W;
editorCanvas.height = CANVAS_H;

// ===== Editor State =====
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;
let editorState = null;
let editorDrawRAF = null;
let editorPausedDrawTimer = null;
let editorVideoFrameCallbackId = null;
let editorVideoFrameHost = null;
let editorVideoFrameSafetyTimer = null;
let draggingPip = false;
let pipDragMoved = false;
let waveformPeaks = null;
let timelineZoom = 1;
let trimDragState = null;
let sectionDragState = null;
let sectionZoomDragActive = false;
let draggingBackground = false;
let backgroundDragMoved = false;
let backgroundDragState = null;
let takeAudioBufferCache = new Map(); // takeId -> AudioBuffer
let takeVideoPool = new Map(); // takeId -> { screen: HTMLVideoElement, camera: HTMLVideoElement|null }
const proxyStatus = new Map(); // takeId -> { status: 'pending'|'done'|'error', percent: number }
let activeTakeId = null;
let activePlaybackSection = null;
let cameraResyncCooldownUntil = 0;
let lastCameraDriftLogAt = 0;
const editorZoomBuffer = document.createElement('canvas');
editorZoomBuffer.width = CANVAS_W;
editorZoomBuffer.height = CANVAS_H;
const editorZoomBufferCtx = editorZoomBuffer.getContext('2d');

const sectionImageCache = new Map();

function loadSectionImage(imagePath) {
  if (!imagePath) return Promise.resolve(null);
  if (sectionImageCache.has(imagePath)) return Promise.resolve(sectionImageCache.get(imagePath));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      sectionImageCache.set(imagePath, img);
      resolve(img);
    };
    img.onerror = () => {
      console.warn('Failed to load section image:', imagePath);
      resolve(null);
    };
    img.src = pathToFileUrl(imagePath);
  });
}

function preloadSectionImages() {
  if (!editorState?.sections) return;
  for (const section of editorState.sections) {
    if (section.imagePath) loadSectionImage(section.imagePath);
  }
}

function getOrCreateTakeVideos(takeId) {
  if (takeVideoPool.has(takeId)) return takeVideoPool.get(takeId);
  const take = activeProject?.takes?.find((t) => t.id === takeId);
  if (!take) return null;
  const screen = document.createElement('video');
  screen.playsInline = true;
  screen.preload = 'auto';
  screen.src = pathToFileUrl(take.proxyPath || take.screenPath);
  let camera = null;
  if (take.cameraPath) {
    camera = document.createElement('video');
    camera.playsInline = true;
    camera.muted = true;
    camera.preload = 'auto';
    camera.src = pathToFileUrl(take.cameraPath);
  }
  const entry = { screen, camera };
  takeVideoPool.set(takeId, entry);
  return entry;
}

function cleanupVideoPool() {
  for (const [, videos] of takeVideoPool) {
    videos.screen.pause();
    videos.screen.src = '';
    if (videos.camera) {
      videos.camera.pause();
      videos.camera.src = '';
    }
  }
  takeVideoPool.clear();
  takeAudioBufferCache.clear();
  activeTakeId = null;
  activePlaybackSection = null;
}

function resolveTimeToSource(timelineTime) {
  const section = findSectionForTime(timelineTime);
  if (!section) return null;
  const sourceTime = section.sourceStart + (timelineTime - section.start);
  return { takeId: section.takeId, sourceTime, section };
}

function recalculateTimelinePositions() {
  if (!editorState || !editorState.sections) return;
  let cursor = 0;
  for (const section of editorState.sections) {
    const duration = section.sourceEnd - section.sourceStart;
    section.start = roundMs(cursor);
    section.end = roundMs(cursor + duration);
    section.duration = roundMs(duration);
    cursor += duration;
  }
  editorState.duration = cursor;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function getActiveProjectSession() {
  return {
    id: activeProjectSession,
    projectPath: activeProjectPath
  };
}

function matchesActiveProjectSession(session) {
  return (
    !!session && session.id === activeProjectSession && session.projectPath === activeProjectPath
  );
}

function pathToFileUrl(filePath) {
  if (!filePath) return '';
  return window.electronAPI.pathToFileUrl(filePath);
}

function formatProjectDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString();
}

function setToggleButtonState(button, active, disabled) {
  button.disabled = !!disabled;
  button.className = `px-3 py-1.5 rounded-md text-sm transition-colors ${active ? 'bg-white text-neutral-950 font-medium' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'} disabled:opacity-40 disabled:cursor-not-allowed`;
}

function updateWorkspaceHeader() {
  const hasProject = !!activeProjectPath;
  const showTimelineTools = hasProject && activeWorkspaceView === 'timeline';
  activeProjectNameEl.textContent = activeProject?.name || 'Project';
  activeProjectPathEl.textContent = activeProjectPath || '';
  workspaceHeader.classList.toggle('hidden', !hasProject || activeWorkspaceView === 'home');
  setToggleButtonState(
    goRecordingBtn,
    activeWorkspaceView === 'recording',
    !hasProject || activeWorkspaceView === 'processing'
  );
  setToggleButtonState(
    goTimelineBtn,
    activeWorkspaceView === 'timeline',
    !hasProject || !editorState || activeWorkspaceView === 'processing' || recording
  );
  recordBtn.classList.toggle('hidden', activeWorkspaceView !== 'recording');
  timerEl.classList.toggle('hidden', activeWorkspaceView !== 'recording');
  cameraSyncOffsetControl.classList.toggle('hidden', !showTimelineTools);
  cameraSyncOffsetControl.classList.toggle('flex', showTimelineTools);
  exportAudioPresetControl.classList.toggle('hidden', !showTimelineTools);
  exportAudioPresetControl.classList.toggle('flex', showTimelineTools);
  exportVideoPresetControl.classList.toggle('hidden', !showTimelineTools);
  exportVideoPresetControl.classList.toggle('flex', showTimelineTools);
  editorRenderBtn.classList.toggle('hidden', !showTimelineTools);
}

function hasPendingEditorDraw() {
  return !!editorDrawRAF || !!editorPausedDrawTimer || editorVideoFrameCallbackId !== null;
}

function cancelEditorDrawLoop() {
  if (editorDrawRAF) {
    cancelAnimationFrame(editorDrawRAF);
    editorDrawRAF = null;
  }
  if (editorPausedDrawTimer) {
    clearTimeout(editorPausedDrawTimer);
    editorPausedDrawTimer = null;
  }
  if (
    editorVideoFrameHost &&
    editorVideoFrameCallbackId !== null &&
    typeof editorVideoFrameHost.cancelVideoFrameCallback === 'function'
  ) {
    try {
      editorVideoFrameHost.cancelVideoFrameCallback(editorVideoFrameCallbackId);
    } catch (_error) {
      // Ignore cancellation races while switching active takes.
    }
  }
  editorVideoFrameCallbackId = null;
  editorVideoFrameHost = null;
  if (editorVideoFrameSafetyTimer) {
    clearTimeout(editorVideoFrameSafetyTimer);
    editorVideoFrameSafetyTimer = null;
  }
}

function scheduleEditorDrawLoop() {
  if (!editorState || activeWorkspaceView !== 'timeline') return;

  if (editorState.playing && activeTakeId) {
    const videos = getOrCreateTakeVideos(activeTakeId);
    const screen = videos?.screen;
    if (screen && typeof screen.requestVideoFrameCallback === 'function') {
      editorVideoFrameHost = screen;
      editorVideoFrameCallbackId = screen.requestVideoFrameCallback(() => {
        if (editorVideoFrameSafetyTimer) {
          clearTimeout(editorVideoFrameSafetyTimer);
          editorVideoFrameSafetyTimer = null;
        }
        editorVideoFrameCallbackId = null;
        editorVideoFrameHost = null;
        editorDrawLoop();
      });
      // Safety fallback: if the video frame callback doesn't fire within
      // 200 ms (e.g. src was swapped or video stalled), fall back to rAF
      editorVideoFrameSafetyTimer = setTimeout(() => {
        editorVideoFrameSafetyTimer = null;
        if (editorVideoFrameCallbackId !== null && editorState?.playing) {
          cancelEditorDrawLoop();
          editorDrawRAF = requestAnimationFrame(() => {
            editorDrawRAF = null;
            editorDrawLoop();
          });
        }
      }, 200);
      return;
    }
  }

  if (editorState.playing) {
    editorDrawRAF = requestAnimationFrame(() => {
      editorDrawRAF = null;
      editorDrawLoop();
    });
    return;
  }

  editorPausedDrawTimer = setTimeout(
    () => {
      editorPausedDrawTimer = null;
      editorDrawRAF = requestAnimationFrame(() => {
        editorDrawRAF = null;
        editorDrawLoop();
      });
    },
    Math.round(1000 / 24)
  );
}

function setWorkspaceView(nextView) {
  activeWorkspaceView = nextView;
  const showHome = nextView === 'home';
  const showRecording = nextView === 'recording';
  const showTimeline = nextView === 'timeline' && !!editorState;
  const showProcessing = nextView === 'processing';

  projectHomeView.classList.toggle('hidden', !showHome);
  recordingView.classList.toggle('hidden', !showRecording);
  editorView.classList.toggle('hidden', !showTimeline);
  processingView.classList.toggle('hidden', !showProcessing);

  if (showRecording) {
    clearMediaIdleTimer();
    if (!mediaInitialized) void ensureMediaInitialized();
    updatePreview();
  } else if (drawRAF) {
    cancelAnimationFrame(drawRAF);
    drawRAF = null;
    lastCompositeDrawAt = 0;
  }

  if (!showRecording && mediaInitialized && !recording && !mediaIdleTimer) {
    mediaIdleTimer = setTimeout(() => {
      mediaIdleTimer = null;
      if (hasActiveRecorders()) return;
      cleanupRendererMediaResources();
    }, MEDIA_IDLE_TIMEOUT_MS);
  }

  if (showTimeline && editorState && !hasPendingEditorDraw()) {
    editorDrawLoop();
  } else if (!showTimeline && hasPendingEditorDraw()) {
    cancelEditorDrawLoop();
    if (editorState?.playing) editorPause();
  }

  updateWorkspaceHeader();
}

function getProjectTimelineSnapshot() {
  if (!editorState) {
    return (
      activeProject?.timeline || {
        duration: 0,
        sections: [],
        keyframes: [],
        selectedSectionId: null,
        hasCamera: false,
        sourceWidth: null,
        sourceHeight: null
      }
    );
  }

  return {
    duration: Number(editorState.duration) || 0,
    sections: Array.isArray(editorState.sections)
      ? editorState.sections.map((section) => ({ ...section }))
      : [],
    keyframes: Array.isArray(editorState.keyframes)
      ? editorState.keyframes.map((kf) => ({
          ...kf,
          backgroundZoom: clampSectionZoom(kf.backgroundZoom),
          backgroundPanX: clampSectionPan(kf.backgroundPanX),
          backgroundPanY: clampSectionPan(kf.backgroundPanY)
        }))
      : [],
    selectedSectionId: editorState.selectedSectionId || null,
    hasCamera: !!editorState.hasCamera,
    sourceWidth: editorState.sourceWidth || null,
    sourceHeight: editorState.sourceHeight || null
  };
}

function buildProjectSavePayload() {
  if (!activeProject) return null;
  return {
    ...activeProject,
    settings: {
      screenFitMode: screenFitSelect.value || 'fill',
      hideFromRecording: hideFromRecording === 'true',
      exportAudioPreset: normalizeExportAudioPreset(exportAudioPresetSelect.value),
      exportVideoPreset: normalizeExportVideoPreset(exportVideoPresetSelect.value),
      cameraSyncOffsetMs: normalizeCameraSyncOffsetMs(cameraSyncOffsetInput.value)
    },
    timeline: getProjectTimelineSnapshot()
  };
}

async function persistProjectNow() {
  if (!activeProjectPath || !activeProject) return;
  const expectedProjectPath = activeProjectPath;
  const payload = buildProjectSavePayload();
  if (!payload) return;

  persistQueue = persistQueue
    .then(async () => {
      const result = await window.electronAPI.projectSave({
        projectPath: expectedProjectPath,
        project: payload
      });
      if (result?.projectPath && result?.project && activeProjectPath === expectedProjectPath) {
        activeProjectPath = result.projectPath;
        activeProject = result.project;
        saveFolder = activeProjectPath;
        folderPathEl.textContent = activeProjectPath;
        openFolderBtn.classList.toggle('hidden', !activeProjectPath);
        updateWorkspaceHeader();
        await window.electronAPI.projectSetLast(expectedProjectPath);
      }
    })
    .catch((error) => {
      console.error('Failed to persist project:', error);
    });

  await persistQueue;
}

async function saveRecoveryTake(take) {
  if (!activeProjectPath || !take?.screenPath) return;
  try {
    await window.electronAPI.projectSetRecoveryTake({
      projectPath: activeProjectPath,
      take
    });
  } catch (error) {
    console.error('Failed to save recovery take:', error);
  }
}

async function _clearRecoveryTake(projectPath = activeProjectPath) {
  if (!projectPath) return;
  try {
    await window.electronAPI.projectClearRecoveryTake(projectPath);
  } catch (error) {
    console.error('Failed to clear recovery take:', error);
  }
}

async function completeRecoveryTake(projectPath = activeProjectPath) {
  if (!projectPath) return;
  try {
    await window.electronAPI.projectCompleteRecoveryTake(projectPath);
  } catch (error) {
    console.error('Failed to finalize recovery take:', error);
  }
}

function scheduleProjectSave() {
  if (!activeProjectPath || !activeProject) return;
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    persistProjectNow().catch((error) => {
      console.error('Failed to save project:', error);
    });
  }, 250);
}

async function flushScheduledProjectSave() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  await persistProjectNow();
}

function clearEditorState() {
  editorPause();
  cancelEditorDrawLoop();

  cleanupVideoPool();
  editorState = null;
  proxyStatus.clear();
  undoStack.length = 0;
  redoStack.length = 0;
  waveformPeaks = null;
  renderWaveform();
  renderSectionMarkers();
  updateSectionZoomControls();
  updateWorkspaceHeader();
  updateUndoRedoButtons();
}

function snapshotTimeline() {
  return {
    sections: editorState.sections.map((s) => ({ ...s })),
    keyframes: editorState.keyframes.map((kf) => ({ ...kf })),
    selectedSectionId: editorState.selectedSectionId,
    selectedSectionIds: new Set(editorState.selectedSectionIds || []),
    duration: editorState.duration
  };
}

function restoreSnapshot(snapshot) {
  editorState.sections = snapshot.sections;
  editorState.keyframes = snapshot.keyframes;
  editorState.selectedSectionId = snapshot.selectedSectionId;
  editorState.selectedSectionIds =
    snapshot.selectedSectionIds || new Set([snapshot.selectedSectionId].filter(Boolean));
  editorState.duration = snapshot.duration;
  recalculateTimelinePositions();
  syncSectionAnchorKeyframes();
  renderSectionMarkers();
  updateSectionZoomControls();
  refreshWaveform();
  editorSeek(Math.min(editorState.currentTime, editorState.duration));
  updateUndoRedoButtons();
  scheduleProjectSave();
}

function pushUndo() {
  if (!editorState) return;
  undoStack.push(snapshotTimeline());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  updateUndoRedoButtons();
}

function editorUndo() {
  if (!editorState || editorState.rendering || undoStack.length === 0) return;
  redoStack.push(snapshotTimeline());
  restoreSnapshot(undoStack.pop());
}

function editorRedo() {
  if (!editorState || editorState.rendering || redoStack.length === 0) return;
  undoStack.push(snapshotTimeline());
  restoreSnapshot(redoStack.pop());
}

function updateUndoRedoButtons() {
  editorUndoBtn.disabled = undoStack.length === 0;
  editorRedoBtn.disabled = redoStack.length === 0;
}

function renderRecentProjects(meta) {
  const projects = Array.isArray(meta?.projects) ? meta.projects : [];
  const lastPath = meta?.lastProjectPath || '';

  recentProjectsList.innerHTML = '';
  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'text-sm text-neutral-600 py-2';
    empty.textContent = 'No recent projects yet.';
    recentProjectsList.appendChild(empty);
  } else {
    for (const project of projects) {
      const btn = document.createElement('button');
      btn.className =
        'w-full text-left bg-neutral-900 border border-neutral-800 rounded-lg px-3.5 py-2.5 hover:bg-neutral-800 hover:border-neutral-700 transition-all';
      btn.type = 'button';
      btn.dataset.projectPath = project.projectPath;

      const title = document.createElement('div');
      title.className = 'text-sm text-neutral-100 truncate font-medium';
      title.textContent = project.name || 'Untitled Project';
      const subtitle = document.createElement('div');
      subtitle.className = 'text-xs text-neutral-500 truncate mt-0.5';
      subtitle.textContent = `${project.projectPath} • ${formatProjectDate(project.updatedAt)}`;
      btn.appendChild(title);
      btn.appendChild(subtitle);
      recentProjectsList.appendChild(btn);
    }
  }

  const last = projects.find((project) => project.projectPath === lastPath) || projects[0];
  if (last) {
    lastProjectName.textContent = last.name || 'Untitled Project';
    lastProjectPath.textContent = last.projectPath;
    resumeLastBtn.dataset.projectPath = last.projectPath;
    lastProjectRow.classList.remove('hidden');
  } else {
    lastProjectRow.classList.add('hidden');
    resumeLastBtn.dataset.projectPath = '';
  }
}

function clearProjectHomeMessage() {
  projectHomeMessage.textContent = '';
  projectHomeMessage.className = 'hidden rounded border px-3 py-2 text-sm';
}

function showProjectHomeMessage(message, tone = 'error') {
  if (!message) {
    clearProjectHomeMessage();
    return;
  }

  const toneClass =
    tone === 'info'
      ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
      : 'border-red-500/40 bg-red-500/10 text-red-200';

  projectHomeMessage.textContent = message;
  projectHomeMessage.className = `rounded border px-3 py-2 text-sm ${toneClass}`;
}

async function refreshRecentProjects() {
  try {
    const recent = await window.electronAPI.projectListRecent(8);
    renderRecentProjects(recent || {});
  } catch (error) {
    console.error('Failed to list recent projects:', error);
    renderRecentProjects({ projects: [], lastProjectPath: null });
  }
}

async function activateProject(projectPath, project, preferredView = 'recording') {
  if (!projectPath || !project) return;

  await flushScheduledProjectSave();
  clearEditorState();
  activeProjectSession += 1;

  activeProjectPath = projectPath;
  activeProject = project;
  saveFolder = projectPath;
  folderPathEl.textContent = projectPath;
  openFolderBtn.classList.remove('hidden');
  screenFitSelect.value = project.settings?.screenFitMode === 'fit' ? 'fit' : 'fill';
  hideFromRecording = project.settings?.hideFromRecording === false ? 'false' : 'true';
  exportAudioPresetSelect.value = normalizeExportAudioPreset(project.settings?.exportAudioPreset);
  exportVideoPresetSelect.value = normalizeExportVideoPreset(project.settings?.exportVideoPreset);
  cameraSyncOffsetInput.value = String(
    normalizeCameraSyncOffsetMs(project.settings?.cameraSyncOffsetMs)
  );
  await syncContentProtection();

  if (
    project.timeline &&
    Array.isArray(project.timeline.sections) &&
    project.timeline.sections.length > 0
  ) {
    enterEditor(project.timeline.sections, {
      duration: project.timeline.duration || 0,
      keyframes: project.timeline.keyframes || [],
      selectedSectionId: project.timeline.selectedSectionId || null,
      hasCamera: !!project.timeline.hasCamera,
      sourceWidth: project.timeline.sourceWidth || null,
      sourceHeight: project.timeline.sourceHeight || null,
      cameraSyncOffsetMs: project.settings?.cameraSyncOffsetMs,
      initialView: preferredView === 'recording' ? 'recording' : 'timeline'
    });
  } else {
    setWorkspaceView('recording');
  }

  await window.electronAPI.projectSetLast(projectPath);
  updateWorkspaceHeader();

  // Queue background proxy generation for any takes missing a proxy
  if (Array.isArray(project.takes)) {
    let needsMarkerUpdate = false;
    for (const take of project.takes) {
      if (!take.proxyPath && take.screenPath) {
        proxyStatus.set(take.id, { status: 'pending', percent: 0 });
        needsMarkerUpdate = true;
        window.electronAPI
          .generateProxy({
            takeId: take.id,
            screenPath: take.screenPath,
            projectFolder: projectPath,
            durationSec: take.duration || 0
          })
          .catch((err) => console.warn('[Proxy] Failed to start proxy generation:', err));
      }
    }
    if (needsMarkerUpdate) renderSectionMarkers();
  }
}

async function ensureMediaInitialized() {
  if (mediaInitialized) return;
  mediaInitialized = true;
  await enumerateDevices();
  try {
    await updateScreenStream();
  } catch (error) {
    console.warn('Screen source init failed:', error);
  }
  try {
    await updateCameraStream();
  } catch (error) {
    console.warn('Camera source init failed:', error);
  }
  try {
    await updateAudioStream();
  } catch (error) {
    console.warn('Audio source init failed:', error);
  }
  if (activeWorkspaceView === 'recording') updatePreview();
}

async function syncContentProtection() {
  const enabled = hideFromRecording === 'true';
  contentProtectionToggle.checked = enabled;

  try {
    await window.electronAPI.setContentProtection(enabled);
  } catch (error) {
    console.error('Failed to update content protection:', error);
  }
}

function findSectionForTime(time) {
  if (!editorState || !editorState.sections || editorState.sections.length === 0) return null;
  const sections = editorState.sections;
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const isLast = i === sections.length - 1;
    if (time >= section.start && (time < section.end || (isLast && time <= section.end + 0.001))) {
      return section;
    }
  }
  if (time < sections[0].start) return sections[0];
  return sections[sections.length - 1];
}

function getSelectedSection() {
  if (!editorState || !editorState.sections || editorState.sections.length === 0) return null;
  return (
    editorState.sections.find((section) => section.id === editorState.selectedSectionId) ||
    editorState.sections[0]
  );
}

function getSectionBackgroundZoom(sectionId) {
  if (!editorState || !sectionId) return DEFAULT_SECTION_ZOOM;
  const anchor = editorState.keyframes.find((kf) => kf.sectionId === sectionId);
  return clampSectionZoom(anchor?.backgroundZoom);
}

function getSectionBackgroundPan(sectionId) {
  if (!editorState || !sectionId) return { x: 0, y: 0 };
  const anchor = editorState.keyframes.find((kf) => kf.sectionId === sectionId);
  return {
    x: clampSectionPan(anchor?.backgroundPanX),
    y: clampSectionPan(anchor?.backgroundPanY)
  };
}

function updateSectionZoomControls() {
  if (!editorBgZoomInput || !editorBgZoomValue) return;
  const selectedSection = getSelectedSection();
  const disabled = !editorState || editorState.rendering || !selectedSection;
  const zoom = selectedSection
    ? getSectionBackgroundZoom(selectedSection.id)
    : DEFAULT_SECTION_ZOOM;
  editorBgZoomInput.disabled = disabled;
  editorBgZoomInput.value = String(zoom);
  editorBgZoomValue.textContent = formatSectionZoom(zoom);
}

function getSectionAnchorKeyframe(sectionId, createIfMissing) {
  if (!editorState || !sectionId) return null;

  let anchor = editorState.keyframes.find((kf) => kf.sectionId === sectionId);
  if (anchor || !createIfMissing) return anchor || null;

  const section = editorState.sections.find((s) => s.id === sectionId);
  if (!section) return null;

  const fallback = getStateAtTime(section.start);
  anchor = {
    time: section.start,
    pipX: fallback.pipX,
    pipY: fallback.pipY,
    pipVisible: fallback.pipVisible,
    cameraFullscreen: fallback.cameraFullscreen || false,
    backgroundZoom: clampSectionZoom(fallback.backgroundZoom),
    backgroundPanX: clampSectionPan(fallback.backgroundPanX),
    backgroundPanY: clampSectionPan(fallback.backgroundPanY),
    sectionId: section.id,
    autoSection: true
  };
  editorState.keyframes.push(anchor);
  editorState.keyframes.sort((a, b) => a.time - b.time);
  return anchor;
}

function syncSectionAnchorKeyframes() {
  if (!editorState || !editorState.sections || editorState.sections.length === 0) return;

  const manual = editorState.keyframes
    .filter((kf) => !kf.sectionId)
    .map((kf) => ({
      ...kf,
      backgroundZoom: clampSectionZoom(kf.backgroundZoom),
      backgroundPanX: clampSectionPan(kf.backgroundPanX),
      backgroundPanY: clampSectionPan(kf.backgroundPanY)
    }));
  const sectionAnchors = editorState.sections.map((section) => {
    const existing = editorState.keyframes.find((kf) => kf.sectionId === section.id);
    return {
      time: section.start,
      pipX: existing ? existing.pipX : editorState.defaultPipX,
      pipY: existing ? existing.pipY : editorState.defaultPipY,
      pipVisible: existing ? existing.pipVisible : true,
      cameraFullscreen: existing ? !!existing.cameraFullscreen : false,
      backgroundZoom: existing ? clampSectionZoom(existing.backgroundZoom) : DEFAULT_SECTION_ZOOM,
      backgroundPanX: existing ? clampSectionPan(existing.backgroundPanX) : 0,
      backgroundPanY: existing ? clampSectionPan(existing.backgroundPanY) : 0,
      sectionId: section.id,
      autoSection: true
    };
  });

  editorState.keyframes = [...sectionAnchors, ...manual].sort((a, b) => a.time - b.time);

  if (!editorState.sections.some((section) => section.id === editorState.selectedSectionId)) {
    editorState.selectedSectionId = editorState.sections[0].id;
  }
}

function selectEditorSection(sectionId, shiftKey) {
  if (!editorState || !editorState.sections || editorState.sections.length === 0) return;
  if (!editorState.sections.some((section) => section.id === sectionId)) return;
  commitSectionZoomChange();

  if (shiftKey && editorState.selectedSectionId) {
    const anchorIndex = editorState.sections.findIndex(
      (s) => s.id === editorState.selectedSectionId
    );
    const targetIndex = editorState.sections.findIndex((s) => s.id === sectionId);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const lo = Math.min(anchorIndex, targetIndex);
      const hi = Math.max(anchorIndex, targetIndex);
      editorState.selectedSectionIds = new Set(
        editorState.sections.slice(lo, hi + 1).map((s) => s.id)
      );
    }
  } else {
    editorState.selectedSectionId = sectionId;
    editorState.selectedSectionIds = new Set([sectionId]);
  }

  renderSectionMarkers();
  updateSectionZoomControls();
  updateEditorTimeDisplay();
  scheduleProjectSave();
}

function applyStyleToFutureSections() {
  if (!editorState || !editorState.sections || editorState.sections.length === 0) return;

  const currentSection = getSelectedSection();
  if (!currentSection) return;

  const currentAnchor = getSectionAnchorKeyframe(currentSection.id, true);
  if (!currentAnchor) return;

  const currentIndex = editorState.sections.findIndex((s) => s.id === currentSection.id);
  const futureSections = editorState.sections.slice(currentIndex + 1);
  if (futureSections.length === 0) return;

  pushUndo();

  for (const section of futureSections) {
    const anchor = getSectionAnchorKeyframe(section.id, true);
    if (!anchor) continue;
    anchor.pipX = currentAnchor.pipX;
    anchor.pipY = currentAnchor.pipY;
    anchor.pipVisible = currentAnchor.pipVisible;
    anchor.cameraFullscreen = currentAnchor.cameraFullscreen;
    anchor.backgroundZoom = clampSectionZoom(currentAnchor.backgroundZoom);
    anchor.backgroundPanX = clampSectionPan(currentAnchor.backgroundPanX);
    anchor.backgroundPanY = clampSectionPan(currentAnchor.backgroundPanY);
  }

  renderSectionMarkers();
  updateSectionZoomControls();
  editorSeek(editorState.currentTime);
  updateEditorTimeDisplay();
  scheduleProjectSave();
}

function _deleteNearestKeyframe() {
  if (!editorState || !Array.isArray(editorState.keyframes)) return;

  const manualKeyframes = editorState.keyframes.filter((kf) => !kf.sectionId);
  if (manualKeyframes.length === 0) return;

  const currentTime = Number(editorState.currentTime) || 0;
  let nearest = manualKeyframes[0];
  let nearestDistance = Math.abs((Number(nearest.time) || 0) - currentTime);

  for (let i = 1; i < manualKeyframes.length; i++) {
    const candidate = manualKeyframes[i];
    const distance = Math.abs((Number(candidate.time) || 0) - currentTime);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  const nearestTime = Number(nearest.time) || 0;
  editorState.keyframes = editorState.keyframes.filter((kf) => {
    if (kf.sectionId) return true;
    const time = Number(kf.time) || 0;
    return time !== nearestTime;
  });

  renderSectionMarkers();
  editorSeek(currentTime);
  updateEditorTimeDisplay();
  scheduleProjectSave();
}

function renderSectionTranscriptList() {
  if (!editorState || !editorState.sections || editorState.sections.length === 0) {
    editorSectionTranscriptList.innerHTML =
      '<div class="text-xs text-neutral-500 px-1">No sections available.</div>';
    return;
  }

  editorSectionTranscriptList.innerHTML = '';
  for (const section of editorState.sections) {
    const inSelection = editorState.selectedSectionIds?.has(section.id);
    const selected = inSelection || section.id === editorState.selectedSectionId;
    const transcript = normalizeTranscriptText(section.transcript);

    const row = document.createElement('button');
    row.type = 'button';
    row.dataset.sectionId = section.id;
    row.className = `w-full text-left rounded-lg px-3 py-2 transition-all ${selected ? 'bg-neutral-800' : 'hover:bg-neutral-900'}`;

    const meta = document.createElement('div');
    meta.className = 'text-xs text-neutral-500 font-mono tabular-nums';
    meta.textContent = `${section.label} (${formatTime(section.start)} - ${formatTime(section.end)})`;

    const text = document.createElement('div');
    text.className = `mt-1 text-sm leading-snug ${transcript ? 'text-neutral-300' : 'text-neutral-600 italic'}`;
    text.textContent = transcript || 'No transcript captured for this section.';

    row.appendChild(meta);
    row.appendChild(text);
    row.addEventListener('click', () => {
      selectEditorSection(section.id);
    });

    editorSectionTranscriptList.appendChild(row);
  }
}

function computeWaveformPeaksFromCache(numBuckets = 800) {
  if (!editorState || !editorState.sections || editorState.sections.length === 0) return null;
  const totalDuration = editorState.duration;
  if (totalDuration <= 0) return null;

  const peaks = new Float32Array(numBuckets);
  for (let bucket = 0; bucket < numBuckets; bucket++) {
    const bucketStart = (bucket / numBuckets) * totalDuration;
    const bucketEnd = ((bucket + 1) / numBuckets) * totalDuration;
    let maxPeak = 0;

    for (const section of editorState.sections) {
      if (bucketEnd <= section.start || bucketStart >= section.end) continue;
      const overlapStart = Math.max(bucketStart, section.start);
      const overlapEnd = Math.min(bucketEnd, section.end);
      const sourceStart = section.sourceStart + (overlapStart - section.start);
      const sourceEnd = section.sourceStart + (overlapEnd - section.start);

      const audioBuffer = takeAudioBufferCache.get(section.takeId);
      if (!audioBuffer) continue;
      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(sourceStart * sampleRate);
      const endSample = Math.min(Math.ceil(sourceEnd * sampleRate), channelData.length);

      for (let j = startSample; j < endSample; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > maxPeak) maxPeak = abs;
      }
    }
    peaks[bucket] = maxPeak;
  }
  return peaks;
}

function refreshWaveform() {
  if (!editorState) return;
  waveformPeaks = computeWaveformPeaksFromCache(Math.round(800 * timelineZoom));
  renderWaveform();
}

async function extractWaveformPeaks(numBuckets = 800) {
  if (!editorState || !editorState.sections || editorState.sections.length === 0) return null;

  try {
    // Decode and cache audio for each referenced take
    for (const section of editorState.sections) {
      if (!section.takeId || takeAudioBufferCache.has(section.takeId)) continue;
      const take = activeProject?.takes?.find((t) => t.id === section.takeId);
      if (!take) continue;
      try {
        const url = pathToFileUrl(take.screenPath);
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const offlineCtx = new OfflineAudioContext(1, 1, 44100);
        const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
        takeAudioBufferCache.set(section.takeId, audioBuffer);
      } catch (err) {
        console.warn(`Failed to decode audio for take ${section.takeId}:`, err);
      }
    }

    return computeWaveformPeaksFromCache(numBuckets);
  } catch (err) {
    console.warn('Failed to extract waveform:', err);
    return null;
  }
}

function renderWaveform() {
  const canvas = editorWaveformCanvas;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = Math.round(rect.width * devicePixelRatio);
  canvas.height = Math.round(rect.height * devicePixelRatio);
  const wCtx = canvas.getContext('2d');
  wCtx.clearRect(0, 0, canvas.width, canvas.height);
  if (!waveformPeaks || waveformPeaks.length === 0) return;

  const w = canvas.width;
  const h = canvas.height;
  const midY = h / 2;
  const barWidth = w / waveformPeaks.length;

  wCtx.fillStyle = 'rgba(163, 163, 163, 0.5)';
  for (let i = 0; i < waveformPeaks.length; i++) {
    const barHeight = waveformPeaks[i] * midY * 0.9;
    const x = i * barWidth;
    wCtx.fillRect(x, midY - barHeight, Math.max(1, barWidth - 0.5), barHeight * 2);
  }
}

function renderSectionMarkers() {
  if (
    !editorState ||
    !editorState.duration ||
    !editorState.sections ||
    editorState.sections.length === 0
  ) {
    editorSectionMarkers.innerHTML = '';
    renderSectionTranscriptList();
    return;
  }

  editorSectionMarkers.innerHTML = '';
  for (const section of editorState.sections) {
    const sectionStart = (section.start / editorState.duration) * 100;
    const sectionWidth = Math.max(
      0.35,
      ((section.end - section.start) / editorState.duration) * 100
    );
    const inSelection = editorState.selectedSectionIds?.has(section.id);
    const selected = inSelection || section.id === editorState.selectedSectionId;
    const hasImage = !!section.imagePath;
    const baseColor = hasImage
      ? section.index % 2 === 0
        ? 'rgba(76,29,149,0.45)'
        : 'rgba(88,28,135,0.4)'
      : section.index % 2 === 0
        ? 'rgba(23,23,23,0.72)'
        : 'rgba(38,38,38,0.68)';

    const band = document.createElement('div');
    band.className = 'absolute top-0 bottom-0';
    band.dataset.sectionId = section.id;
    band.style.left = sectionStart + '%';
    band.style.width = sectionWidth + '%';
    band.style.backgroundColor = selected
      ? hasImage
        ? 'rgba(139,92,246,0.25)'
        : 'rgba(255,255,255,0.12)'
      : baseColor;
    band.style.borderLeft = section.index === 0 ? 'none' : '1px solid rgba(10,10,10,0.9)';
    if (selected) {
      band.style.boxShadow = 'inset 0 0 0 2px rgba(255,255,255,0.3)';
    }
    const transcriptPreview = normalizeTranscriptText(section.transcript);
    band.title = transcriptPreview
      ? `${section.label}: ${formatTime(section.start)} - ${formatTime(section.end)}\n${transcriptPreview}`
      : `${section.label}: ${formatTime(section.start)} - ${formatTime(section.end)}`;
    const label = document.createElement('div');
    label.className = 'absolute text-[10px] font-medium pointer-events-none';
    label.style.left = '6px';
    label.style.top = '50%';
    label.style.transform = 'translateY(-50%)';
    label.style.color = selected ? 'rgba(255,255,255,0.9)' : 'rgba(163,163,163,0.8)';
    label.textContent = hasImage ? `${section.index + 1} IMG` : String(section.index + 1);
    band.appendChild(label);
    if (selected) {
      const leftHandle = document.createElement('div');
      leftHandle.dataset.trimEdge = 'left';
      leftHandle.dataset.sectionId = section.id;
      leftHandle.style.cssText =
        'position:absolute;top:0;bottom:0;left:0;width:6px;cursor:col-resize;z-index:30;border-left:3px solid rgba(255,255,255,0.5);';
      band.appendChild(leftHandle);
      const rightHandle = document.createElement('div');
      rightHandle.dataset.trimEdge = 'right';
      rightHandle.dataset.sectionId = section.id;
      rightHandle.style.cssText =
        'position:absolute;top:0;bottom:0;right:0;width:6px;cursor:col-resize;z-index:30;border-right:3px solid rgba(255,255,255,0.5);';
      band.appendChild(rightHandle);
    }
    const takeProxy = proxyStatus.get(section.takeId);
    if (takeProxy && takeProxy.status === 'pending') {
      const pct = Math.round((takeProxy.percent || 0) * 100);
      const proxyBar = document.createElement('div');
      proxyBar.className = 'absolute bottom-0 left-0 pointer-events-none';
      proxyBar.dataset.proxyBar = section.takeId;
      proxyBar.style.cssText = `height:3px;width:${pct}%;background:rgba(251,191,36,0.85);z-index:10;transition:width 0.3s ease;`;
      proxyBar.title = `Optimizing for editing\u2026 ${pct}%`;
      band.appendChild(proxyBar);
    }

    editorSectionMarkers.appendChild(band);

    if (section.index < editorState.sections.length - 1) {
      const cut = document.createElement('div');
      cut.className = 'absolute top-0 bottom-0 pointer-events-none';
      cut.style.left = `${(section.end / editorState.duration) * 100}%`;
      cut.style.width = '3px';
      cut.style.transform = 'translateX(-1.5px)';
      cut.style.backgroundColor = 'rgba(255,255,255,0.25)';
      editorSectionMarkers.appendChild(cut);
    }
  }
  renderSectionTranscriptList();
  renderCameraMarkers();
}

function updateProxyProgressBars(takeId, percent) {
  const pct = Math.round(percent * 100);
  const bars = editorSectionMarkers.querySelectorAll(`[data-proxy-bar="${takeId}"]`);
  for (const bar of bars) {
    bar.style.width = `${pct}%`;
    bar.title = `Optimizing for editing\u2026 ${pct}%`;
  }
}

function renderCameraMarkers() {
  if (!editorCameraMarkers) return;
  editorCameraMarkers.innerHTML = '';

  const showCameraTrack = editorState && editorState.hasCamera;
  if (editorCameraTrack) editorCameraTrack.style.display = showCameraTrack ? '' : 'none';
  if (cameraTrackLabel) cameraTrackLabel.style.display = showCameraTrack ? '' : 'none';

  if (
    !showCameraTrack ||
    !editorState.duration ||
    !editorState.sections ||
    editorState.sections.length === 0
  )
    return;

  for (const section of editorState.sections) {
    const anchor = editorState.keyframes.find((kf) => kf.sectionId === section.id);
    const pipVisible = anchor ? anchor.pipVisible : true;
    const cameraFullscreen = anchor ? !!anchor.cameraFullscreen : false;

    const sectionStart = (section.start / editorState.duration) * 100;
    const sectionWidth = Math.max(
      0.35,
      ((section.end - section.start) / editorState.duration) * 100
    );
    const inSelection = editorState.selectedSectionIds?.has(section.id);
    const selected = inSelection || section.id === editorState.selectedSectionId;

    const band = document.createElement('div');
    band.className = 'absolute top-0 bottom-0';
    band.dataset.sectionId = section.id;
    band.style.left = sectionStart + '%';
    band.style.width = sectionWidth + '%';

    if (cameraFullscreen) {
      band.style.backgroundColor = selected ? 'rgba(59,130,246,0.35)' : 'rgba(59,130,246,0.2)';
    } else if (pipVisible) {
      band.style.backgroundColor = selected ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.12)';
    } else {
      band.style.backgroundColor = selected ? 'rgba(255,255,255,0.08)' : 'rgba(23,23,23,0.5)';
    }

    band.style.borderLeft = section.index === 0 ? 'none' : '1px solid rgba(10,10,10,0.7)';

    const label = document.createElement('div');
    label.className = 'absolute text-[8px] font-medium pointer-events-none truncate';
    label.style.cssText = 'left:4px;top:50%;transform:translateY(-50%);right:4px;';
    label.style.color = pipVisible ? 'rgba(147,197,253,0.7)' : 'rgba(100,100,100,0.5)';
    label.textContent = cameraFullscreen ? 'Full' : pipVisible ? 'PiP' : 'Off';
    band.appendChild(label);

    editorCameraMarkers.appendChild(band);
  }
}

function startTrimDrag(e, sectionId, edge) {
  const section = editorState.sections.find((s) => s.id === sectionId);
  if (!section) return;
  pushUndo();
  editorPause();
  e.preventDefault();
  const rect = editorTimeline.getBoundingClientRect();
  trimDragState = {
    sectionId,
    edge,
    originalSourceStart: section.sourceStart,
    originalSourceEnd: section.sourceEnd,
    originalStart: section.start,
    originalEnd: section.end,
    startMouseX: e.clientX,
    pixelsPerSecond: rect.width / editorState.duration
  };
  document.body.style.cursor = 'col-resize';
  const onMove = (e2) => {
    e2.preventDefault();
    updateTrimDrag(e2);
  };
  const onUp = () => {
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    finishTrimDrag();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function updateTrimDrag(e) {
  if (!trimDragState || !editorState) return;
  const section = editorState.sections.find((s) => s.id === trimDragState.sectionId);
  if (!section) return;
  const MIN_DURATION = 0.1;
  const deltaPixels = e.clientX - trimDragState.startMouseX;
  const deltaTime = deltaPixels / trimDragState.pixelsPerSecond;

  if (trimDragState.edge === 'left') {
    section.sourceStart = roundMs(
      Math.max(
        0,
        Math.min(
          trimDragState.originalSourceEnd - MIN_DURATION,
          trimDragState.originalSourceStart + deltaTime
        )
      )
    );
    // Keep right edge fixed, move left edge only
    const newDuration = section.sourceEnd - section.sourceStart;
    section.end = trimDragState.originalEnd;
    section.start = roundMs(section.end - newDuration);
    section.duration = roundMs(newDuration);
  } else {
    section.sourceEnd = roundMs(
      Math.max(section.sourceStart + MIN_DURATION, trimDragState.originalSourceEnd + deltaTime)
    );
    // Keep left edge fixed, move right edge only
    const newDuration = section.sourceEnd - section.sourceStart;
    section.start = trimDragState.originalStart;
    section.end = roundMs(section.start + newDuration);
    section.duration = roundMs(newDuration);
  }

  renderSectionMarkers();
}

function finishTrimDrag() {
  if (!trimDragState || !editorState) {
    trimDragState = null;
    return;
  }
  const section = editorState.sections.find((s) => s.id === trimDragState.sectionId);
  if (!section) {
    trimDragState = null;
    return;
  }
  const sourceStartChanged =
    Math.abs(section.sourceStart - trimDragState.originalSourceStart) > 0.01;
  const sourceEndChanged = Math.abs(section.sourceEnd - trimDragState.originalSourceEnd) > 0.01;
  trimDragState = null;
  if (!sourceStartChanged && !sourceEndChanged) {
    undoStack.pop();
    updateUndoRedoButtons();
    return;
  }
  // Now reflow the full timeline
  recalculateTimelinePositions();
  syncSectionAnchorKeyframes();
  renderSectionMarkers();
  refreshWaveform();
  editorSeek(section.start);
  scheduleProjectSave();
}

function getRenderKeyframes() {
  if (!editorState) return [];

  if (editorState.sections && editorState.sections.length > 0) {
    syncSectionAnchorKeyframes();
  }

  const sorted = [...editorState.keyframes].sort((a, b) => a.time - b.time);
  const minimal = sorted.map((kf) => ({
    time: kf.time,
    pipX: kf.pipX,
    pipY: kf.pipY,
    pipVisible: kf.pipVisible,
    cameraFullscreen: !!kf.cameraFullscreen,
    backgroundZoom: clampSectionZoom(kf.backgroundZoom),
    backgroundPanX: clampSectionPan(kf.backgroundPanX),
    backgroundPanY: clampSectionPan(kf.backgroundPanY)
  }));

  if (minimal.length === 0 || minimal[0].time > 0.0001) {
    minimal.unshift({
      time: 0,
      pipX: editorState.defaultPipX,
      pipY: editorState.defaultPipY,
      pipVisible: true,
      cameraFullscreen: false,
      backgroundZoom: DEFAULT_SECTION_ZOOM,
      backgroundPanX: 0,
      backgroundPanY: 0
    });
  }

  return minimal;
}

function getRenderSections() {
  if (!editorState) return [];
  if (editorState.sections && editorState.sections.length > 0) {
    syncSectionAnchorKeyframes();
  }
  return editorState.sections.map((section) => {
    const anchor = getSectionAnchorKeyframe(section.id, true);
    return {
      takeId: section.takeId,
      sourceStart: section.sourceStart,
      sourceEnd: section.sourceEnd,
      backgroundZoom: clampSectionZoom(anchor?.backgroundZoom),
      backgroundPanX: clampSectionPan(anchor?.backgroundPanX),
      backgroundPanY: clampSectionPan(anchor?.backgroundPanY),
      imagePath: section.imagePath || null
    };
  });
}

// ===== Shared drawPip function =====
function drawPip(targetCtx, video, pipX, pipY, pipW, pipH) {
  const r = 12;
  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.moveTo(pipX + r, pipY);
  targetCtx.lineTo(pipX + pipW - r, pipY);
  targetCtx.quadraticCurveTo(pipX + pipW, pipY, pipX + pipW, pipY + r);
  targetCtx.lineTo(pipX + pipW, pipY + pipH - r);
  targetCtx.quadraticCurveTo(pipX + pipW, pipY + pipH, pipX + pipW - r, pipY + pipH);
  targetCtx.lineTo(pipX + r, pipY + pipH);
  targetCtx.quadraticCurveTo(pipX, pipY + pipH, pipX, pipY + pipH - r);
  targetCtx.lineTo(pipX, pipY + r);
  targetCtx.quadraticCurveTo(pipX, pipY, pipX + r, pipY);
  targetCtx.closePath();
  targetCtx.clip();
  const camW = video.videoWidth;
  const camH = video.videoHeight;
  const crop = getCenteredSquareCropRect(camW, camH);
  if (!crop) {
    targetCtx.restore();
    return;
  }
  drawMirroredImage(
    targetCtx,
    video,
    crop.sourceX,
    crop.sourceY,
    crop.size,
    crop.size,
    pipX,
    pipY,
    pipW,
    pipH
  );
  targetCtx.restore();
}

function drawCameraRect(targetCtx, video, x, y, w, h, r) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  targetCtx.save();
  targetCtx.beginPath();
  if (r > 0.5) {
    targetCtx.moveTo(x + r, y);
    targetCtx.lineTo(x + w - r, y);
    targetCtx.quadraticCurveTo(x + w, y, x + w, y + r);
    targetCtx.lineTo(x + w, y + h - r);
    targetCtx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    targetCtx.lineTo(x + r, y + h);
    targetCtx.quadraticCurveTo(x, y + h, x, y + h - r);
    targetCtx.lineTo(x, y + r);
    targetCtx.quadraticCurveTo(x, y, x + r, y);
  } else {
    targetCtx.rect(x, y, w, h);
  }
  targetCtx.closePath();
  targetCtx.clip();
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  drawMirroredImage(targetCtx, video, 0, 0, vw, vh, dx, dy, dw, dh);
  targetCtx.restore();
}

// Populate device lists
async function enumerateDevices() {
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    tempStream.getTracks().forEach((t) => t.stop());
  } catch (_e) {
    // Intentionally ignore - we only need to stop tracks to refresh device list
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const sources = await window.electronAPI.getSources();

  screenSelect.innerHTML = '<option value="">None</option>';
  cameraSelect.innerHTML = '<option value="">None</option>';
  audioSelect.innerHTML = '<option value="">None</option>';

  sources.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    screenSelect.appendChild(opt);
  });

  const videoInputs = devices.filter((d) => d.kind === 'videoinput');

  if (videoInputs.length > 0) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '── Capture Devices ──';
    screenSelect.appendChild(sep);
    videoInputs.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = 'device:' + d.deviceId;
      opt.textContent = d.label || `Camera ${i + 1}`;
      screenSelect.appendChild(opt);
    });
  }

  videoInputs.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i + 1}`;
    cameraSelect.appendChild(opt);
  });

  devices
    .filter((d) => d.kind === 'audioinput')
    .forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${i + 1}`;
      audioSelect.appendChild(opt);
    });

  // Default to first screen source (Entire Screen)
  const screenIdx = sources.findIndex((s) => s.id.startsWith('screen:'));
  if (screenIdx !== -1)
    screenSelect.selectedIndex = screenIdx + 1; // +1 for "None"
  else if (screenSelect.options.length > 1) screenSelect.selectedIndex = 1;
  if (cameraSelect.options.length > 1) cameraSelect.selectedIndex = 1;
  if (audioSelect.options.length > 1) audioSelect.selectedIndex = 1;
}

async function updateScreenStream() {
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    screenVideo.srcObject = null;
  }

  const sourceId = screenSelect.value;
  if (!sourceId) return;

  if (sourceId.startsWith('device:')) {
    const deviceId = sourceId.slice('device:'.length);
    screenStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
  } else {
    screenStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxFrameRate: 30
        }
      }
    });
  }
  screenVideo.srcObject = screenStream;
}

async function updateCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
    cameraVideo.srcObject = null;
  }

  const deviceId = cameraSelect.value;
  if (!deviceId) return;

  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 30, max: 30 },
      aspectRatio: { ideal: 16 / 9 }
    },
    audio: false
  });
  const [cameraTrack] = cameraStream.getVideoTracks();
  if (cameraTrack && 'contentHint' in cameraTrack) {
    cameraTrack.contentHint = 'detail';
    console.log(`Camera track settings: ${JSON.stringify(cameraTrack.getSettings?.() || {})}`);
  }
  cameraVideo.srcObject = cameraStream;
}

async function updateAudioStream() {
  stopAudioMeter();
  if (audioStream) {
    audioStream.getTracks().forEach((t) => t.stop());
    audioStream = null;
  }

  const deviceId = audioSelect.value;
  if (!deviceId) return;

  audioStream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: deviceId } },
    video: false
  });
  startAudioMeter(audioStream);
}

function updatePreview() {
  const hasAny = screenStream || cameraStream;
  noPreview.classList.toggle('hidden', !!hasAny);
  recordBtn.disabled = !hasAny || !saveFolder;

  if (drawRAF) cancelAnimationFrame(drawRAF);
  lastCompositeDrawAt = 0;
  if (hasAny) drawComposite();
}

function drawComposite(now = performance.now()) {
  if (!shouldRenderPreviewFrame(now, lastCompositeDrawAt, recording)) {
    drawRAF = requestAnimationFrame(drawComposite);
    return;
  }

  lastCompositeDrawAt = now;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const hasScreen = screenStream && screenVideo.videoWidth;
  const hasCamera = cameraStream && cameraVideo.videoWidth;

  const drawScreen = screenFitSelect.value === 'fill' ? drawFill : drawFit;

  if (hasScreen && hasCamera) {
    drawScreen(ctx, screenVideo, 0, 0, CANVAS_W, CANVAS_H);
    const pipW = PIP_SIZE;
    const pipH = pipW;
    const pipX = CANVAS_W - pipW - PIP_MARGIN;
    const pipY = CANVAS_H - pipH - PIP_MARGIN;
    drawPip(ctx, cameraVideo, pipX, pipY, pipW, pipH);
  } else if (hasScreen) {
    drawScreen(ctx, screenVideo, 0, 0, CANVAS_W, CANVAS_H);
  } else if (hasCamera) {
    drawFit(ctx, cameraVideo, 0, 0, CANVAS_W, CANVAS_H);
  }

  drawRAF = requestAnimationFrame(drawComposite);
}

function getSourceWidth(source) {
  return source.videoWidth || source.naturalWidth || source.width || 0;
}

function getSourceHeight(source) {
  return source.videoHeight || source.naturalHeight || source.height || 0;
}

function drawFit(targetCtx, video, x, y, w, h) {
  const vw = getSourceWidth(video);
  const vh = getSourceHeight(video);
  if (!vw || !vh) return;
  const scale = Math.min(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  targetCtx.drawImage(video, dx, dy, dw, dh);
}

function drawFill(targetCtx, video, x, y, w, h) {
  const vw = getSourceWidth(video);
  const vh = getSourceHeight(video);
  if (!vw || !vh) return;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(x, y, w, h);
  targetCtx.clip();
  targetCtx.drawImage(video, dx, dy, dw, dh);
  targetCtx.restore();
}

function drawEditorScreenWithZoom(
  targetCtx,
  video,
  fitMode,
  backgroundZoom,
  backgroundPanX = 0,
  backgroundPanY = 0,
  backgroundFocusX = null,
  backgroundFocusY = null
) {
  if (!editorZoomBufferCtx) return;
  const zoom = clampSectionZoom(backgroundZoom);
  const drawBase = fitMode === 'fill' ? drawFill : drawFit;

  if (zoom <= 1.0001) {
    drawBase(targetCtx, video, 0, 0, CANVAS_W, CANVAS_H);
    return;
  }

  editorZoomBufferCtx.fillStyle = '#000';
  editorZoomBufferCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawBase(editorZoomBufferCtx, video, 0, 0, CANVAS_W, CANVAS_H);

  const { sourceW, sourceH } = resolveZoomCrop(zoom, backgroundPanX, backgroundPanY);
  const focusX = backgroundFocusX ?? panToFocusCoord(zoom, backgroundPanX, 0.5);
  const focusY = backgroundFocusY ?? panToFocusCoord(zoom, backgroundPanY, 0.5);
  const sourceX = Math.max(0, Math.min(CANVAS_W - sourceW, focusX * CANVAS_W - sourceW / 2));
  const sourceY = Math.max(0, Math.min(CANVAS_H - sourceH, focusY * CANVAS_H - sourceH / 2));
  targetCtx.drawImage(
    editorZoomBuffer,
    sourceX,
    sourceY,
    sourceW,
    sourceH,
    0,
    0,
    CANVAS_W,
    CANVAS_H
  );
}

// Audio level meter
function startAudioMeter(stream) {
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  micSourceNode = audioContext.createMediaStreamSource(stream);
  micSourceNode.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);

  function updateMeter() {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const pct = Math.min(100, (avg / 128) * 100);
    audioMeter.style.width = pct + '%';
    audioMeter.className = `h-full rounded-full transition-all duration-75 ${pct > 70 ? 'bg-red-500' : pct > 40 ? 'bg-amber-500' : 'bg-emerald-500'}`;
    meterRAF = requestAnimationFrame(updateMeter);
  }
  updateMeter();
}

function stopAudioMeter() {
  if (meterRAF) cancelAnimationFrame(meterRAF);
  meterRAF = null;
  micSourceNode = null;
  if (audioContext) {
    if (workletRegistered === audioContext) workletRegistered = null;
    audioContext.close();
    audioContext = null;
  }
  audioMeter.style.width = '0%';
}

// Recording
function toggleRecording() {
  if (!recording) startRecording();
  else stopRecording();
}

function createRecorder(stream, suffix) {
  const chunks = [];
  let recorderError = null;
  const recorderOptions = getRecorderOptions({
    suffix,
    hasAudio: typeof stream?.getAudioTracks === 'function' && stream.getAudioTracks().length > 0
  });
  const recorder = new MediaRecorder(stream, recorderOptions);
  console.log(`[Recorder] ${suffix} configured`, {
    mimeType: recorder.mimeType || recorderOptions.mimeType || 'default',
    videoTracks: typeof stream?.getVideoTracks === 'function' ? stream.getVideoTracks().length : 0,
    audioTracks: typeof stream?.getAudioTracks === 'function' ? stream.getAudioTracks().length : 0,
    videoBitsPerSecond: recorderOptions.videoBitsPerSecond || null,
    audioBitsPerSecond: recorderOptions.audioBitsPerSecond || null
  });

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onerror = (event) => {
    recorderError = event?.error?.message || `${suffix} recorder failed`;
    console.error(`[Recorder] ${suffix} error`, event?.error || event);
  };

  // blobPromise resolves with { blob, path } when recording stops
  recorder.blobPromise = new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    recorder.onstop = async () => {
      const result = await finalizeRecordingChunks({
        chunks,
        saveFolder,
        saveVideo: window.electronAPI.saveVideo,
        suffix
      });

      const error = result.path
        ? null
        : result.error || recorderError || `${suffix} recording failed`;
      if (result.path) {
        console.log('Saved:', result.path);
      } else {
        console.error(`[Recorder] ${suffix} finalize failed`, error);
      }

      settle({
        ...result,
        error
      });
    };
  });

  recorder.suffix = suffix;
  return recorder;
}

function addAudioToStream(stream) {
  if (!audioStream) return stream;
  const combined = new MediaStream([...stream.getVideoTracks(), ...audioStream.getAudioTracks()]);
  return combined;
}

function mergeInt16Arrays(arrays) {
  let totalLength = 0;
  for (const arr of arrays) totalLength += arr.length;
  const merged = new Int16Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    merged.set(arr, offset);
    offset += arr.length;
  }
  return merged;
}

function setTranscriptStatus(text, tone = 'neutral') {
  if (!transcriptStatus) return;

  const toneClasses = {
    neutral: 'text-neutral-500',
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    error: 'text-red-400'
  };
  const resolvedTone = toneClasses[tone] || toneClasses.neutral;
  const hasText = typeof text === 'string' && text.trim().length > 0;

  transcriptStatus.className = `px-1 pb-1 text-[11px] ${resolvedTone}`;
  transcriptStatus.classList.toggle('hidden', !hasText);
  transcriptStatus.textContent = hasText ? text : '';
}

function applyScribeStatus(status) {
  if (!status) return;

  if (status.failureReason) {
    scribeLastFailureReason = status.failureReason;
  } else if (status.tone === 'success') {
    scribeLastFailureReason = null;
  }

  setTranscriptStatus(status.text, status.tone);
}

async function startRecording() {
  if (!activeProjectPath) return;
  recorders = [];
  speechSegments = [];
  audioChunkBuffer = [];
  scribeLastFailureReason = null;
  scribeManualClose = false;

  // Individual screen (with audio)
  // Route through a canvas at constant 30fps to prevent keyframe flicker
  // from variable frame rate desktop capture input
  if (screenStream) {
    const srcTrack = screenStream.getVideoTracks()[0];
    const settings = srcTrack.getSettings();
    const recCanvas = document.createElement('canvas');
    recCanvas.width = settings.width || 1920;
    recCanvas.height = settings.height || 1080;
    const recCtx = recCanvas.getContext('2d', { alpha: false });
    recCtx.drawImage(screenVideo, 0, 0, recCanvas.width, recCanvas.height);
    screenRecInterval = setInterval(() => {
      recCtx.drawImage(screenVideo, 0, 0, recCanvas.width, recCanvas.height);
    }, 1000 / 30);
    const screenOnly = addAudioToStream(recCanvas.captureStream(30));
    recorders.push(createRecorder(screenOnly, 'screen'));
  }

  // Individual camera (video only; export uses screen audio)
  if (cameraStream) {
    const cameraOnly = createCameraRecordingStream(cameraStream);
    if (cameraOnly) {
      const [cameraTrack] = cameraOnly.getVideoTracks();
      console.log(
        '[Recorder] camera recording track settings:',
        cameraTrack?.getSettings?.() || {}
      );
      recorders.push(createRecorder(cameraOnly, 'camera'));
    }
  }

  // Monitor source tracks for unexpected disconnection during recording.
  // If a critical track (screen, audio) ends, auto-stop to preserve what we have.
  trackEndedCleanups = [];
  const monitorTrack = (track, label, critical) => {
    const handler = () => {
      if (!recording) return;
      console.warn(`[Recorder] ${label} track ended unexpectedly`);
      if (critical) {
        console.error(`[Recorder] Critical track lost (${label}), auto-stopping to save recording`);
        stopRecording();
      }
    };
    track.addEventListener('ended', handler);
    trackEndedCleanups.push(() => track.removeEventListener('ended', handler));
  };
  if (screenStream) {
    for (const t of screenStream.getTracks()) monitorTrack(t, 'screen', true);
  }
  if (cameraStream) {
    for (const t of cameraStream.getTracks()) monitorTrack(t, 'camera', false);
  }
  if (audioStream) {
    for (const t of audioStream.getTracks()) monitorTrack(t, 'audio', true);
  }

  const recorderTimesliceMs = getRecorderTimesliceMs();
  recorders.forEach((r) => r.start(recorderTimesliceMs));
  recording = true;
  updateWorkspaceHeader();
  recordBtn.textContent = 'Stop';
  recordBtn.classList.replace('bg-red-600', 'bg-neutral-700');
  recordBtn.classList.replace('hover:bg-red-700', 'hover:bg-neutral-600');
  screenSelect.disabled = true;
  cameraSelect.disabled = true;
  audioSelect.disabled = true;

  startTime = Date.now();
  timerInterval = setInterval(updateTimer, 200);

  // Show transcript panel and clear previous content
  transcriptPanel.classList.remove('hidden');
  transcriptContent.innerHTML = '';
  segmentBadge.textContent = '0 segments';
  setTranscriptStatus('Transcription connecting...', 'neutral');

  // Set up Scribe via direct WebSocket
  if (audioContext && audioStream && micSourceNode) {
    try {
      const token = await window.electronAPI.getScribeToken();
      const sampleRate = audioContext.sampleRate;

      // Map sample rate to ElevenLabs audio_format parameter
      const formatMap = {
        8000: 'pcm_8000',
        16000: 'pcm_16000',
        22050: 'pcm_22050',
        24000: 'pcm_24000',
        44100: 'pcm_44100',
        48000: 'pcm_48000'
      };
      const audioFormat = formatMap[sampleRate] || 'pcm_16000';

      const wsUrl =
        `wss://api.elevenlabs.io/v1/speech-to-text/realtime` +
        `?model_id=scribe_v2_realtime` +
        `&token=${token}` +
        `&audio_format=${audioFormat}` +
        `&commit_strategy=vad` +
        `&include_timestamps=true` +
        `&vad_silence_threshold_secs=1.5` +
        `&vad_threshold=0.8` +
        `&min_speech_duration_ms=200` +
        `&language_code=eng`;

      scribeWs = new WebSocket(wsUrl);

      scribeWs.onopen = () => {
        setTranscriptStatus('Transcription connecting...', 'neutral');
      };

      scribeWs.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (error) {
          console.warn('Failed to parse Scribe message:', error);
          return;
        }

        applyScribeStatus(getScribeStatusFromMessage(msg));

        if (msg.message_type === 'partial_transcript') {
          updatePartialTranscript(msg.text || '');
        } else if (msg.message_type === 'committed_transcript_with_timestamps') {
          commitTranscript(msg);
        }
      };

      scribeWs.onerror = (err) => {
        console.error('Scribe WebSocket error:', err);
        if (!scribeManualClose) {
          setTranscriptStatus('Transcription connection error', 'error');
        }
      };

      scribeWs.onclose = (event) => {
        console.warn('Scribe WebSocket closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          lastFailureReason: scribeLastFailureReason,
          manualClose: scribeManualClose
        });
        if (!scribeManualClose) {
          applyScribeStatus(getScribeStatusFromCloseEvent(event, scribeLastFailureReason));
        }
      };

      // Set up AudioWorklet for PCM capture (only register module once per AudioContext)
      if (workletRegistered !== audioContext) {
        await audioContext.audioWorklet.addModule(
          new URL('./audio-processor.js', window.location.href).toString()
        );
        workletRegistered = audioContext;
      }
      scribeWorkletNode = new AudioWorkletNode(audioContext, 'audio-capture');
      micSourceNode.connect(scribeWorkletNode);

      scribeWorkletNode.port.onmessage = (e) => {
        if (e.data.pcm) {
          audioChunkBuffer.push(new Int16Array(e.data.pcm));
        }
      };

      // Record the offset: time between recording start and first audio send
      scribeAudioOffset = (Date.now() - startTime) / 1000;

      // Send accumulated audio every ~100ms
      audioSendInterval = setInterval(() => {
        if (audioChunkBuffer.length === 0 || !scribeWs || scribeWs.readyState !== WebSocket.OPEN)
          return;
        const merged = mergeInt16Arrays(audioChunkBuffer);
        audioChunkBuffer = [];
        const bytes = new Uint8Array(merged.buffer);
        const CHUNK = 8192;
        let binary = '';
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        const base64 = btoa(binary);
        scribeWs.send(
          JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: base64,
            sample_rate: sampleRate,
            commit: false
          })
        );
      }, 100);
    } catch (err) {
      console.warn('Scribe setup failed:', err);
      const reason = err instanceof Error ? err.message : 'setup failed';
      setTranscriptStatus(`Transcription unavailable: ${reason}`, 'error');
    }
  } else {
    setTranscriptStatus('Transcription unavailable: microphone not ready', 'warning');
  }
}

function updatePartialTranscript(text) {
  let partial = document.getElementById('partialText');
  if (!partial) {
    partial = document.createElement('div');
    partial.id = 'partialText';
    partial.className = 'text-neutral-600 italic';
    transcriptContent.prepend(partial);
  }
  partial.textContent = stripNonSpeechAnnotations(text);
  transcriptContent.scrollTop = 0;
}

function commitTranscript(data) {
  // Remove partial display
  const partial = document.getElementById('partialText');
  if (partial) partial.remove();

  const spokenWords = extractSpokenWordTokens(data.words);
  if (spokenWords.length === 0) return;

  // Build clean text from spoken words only, excluding non-speech annotations.
  const cleanText = stripNonSpeechAnnotations(spokenWords.map((w) => w.text).join(' '));
  if (!cleanText) return;

  // Shift timestamps by the offset between recording start and first audio sent
  speechSegments.push({
    start: spokenWords[0].start + scribeAudioOffset,
    end: spokenWords[spokenWords.length - 1].end + scribeAudioOffset,
    text: cleanText
  });

  // Add committed text
  const div = document.createElement('div');
  div.className =
    'mb-2 text-neutral-300 cursor-pointer rounded-md px-1.5 py-0.5 -mx-1 hover:bg-neutral-800/60 transition-colors';
  div.dataset.segmentIndex = speechSegments.length - 1;
  div.textContent = cleanText;
  div.addEventListener('click', () => {
    const idx = parseInt(div.dataset.segmentIndex, 10);
    selectSegment(selectedSegmentIndex === idx ? -1 : idx);
  });
  transcriptContent.prepend(div);
  transcriptContent.scrollTop = 0;

  updateSegmentBadge();
}

async function recoverPendingTake(recoveryTake) {
  if (!recoveryTake?.screenPath) return;

  const projectSession = getActiveProjectSession();
  const existingTake = Array.isArray(activeProject?.takes)
    ? activeProject.takes.find((take) => take.id === recoveryTake.id)
    : null;
  if (existingTake) {
    await completeRecoveryTake(projectSession.projectPath);
    return;
  }

  const takeId = recoveryTake.id || `take-${Date.now()}`;
  const screenPath = recoveryTake.screenPath;
  const cameraPath = recoveryTake.cameraPath || null;
  let recoverySections = normalizeTakeSections(
    recoveryTake.sections,
    recoveryTake.recordedDuration
  );
  const recoverySegments = Array.isArray(recoveryTake.trimSegments)
    ? recoveryTake.trimSegments
    : [];
  const fallbackSections = buildRemappedSectionsFromSegments(recoverySegments);

  try {
    if (recoverySegments.length > 0) {
      const computed = await window.electronAPI.computeSections({
        segments: recoverySegments
      });
      if (!matchesActiveProjectSession(projectSession)) return;
      recoverySections =
        Array.isArray(computed?.sections) && computed.sections.length > 0
          ? attachSectionTranscripts(computed.sections, fallbackSections)
          : fallbackSections.length > 0
            ? fallbackSections
            : recoverySections;
    }

    // Set takeId on all sections
    recoverySections = recoverySections.map((s) => ({ ...s, takeId }));

    // Add take to project before entering editor (video pool needs it)
    if (activeProject) {
      if (!Array.isArray(activeProject.takes)) activeProject.takes = [];
      activeProject.takes.push({
        id: takeId,
        createdAt: recoveryTake.createdAt || new Date().toISOString(),
        duration: recoveryTake.recordedDuration,
        screenPath,
        cameraPath,
        sections: recoverySections
      });
    }

    const appendResult = appendTakeToTimeline({
      takeId,
      screenPath,
      cameraPath,
      recordedDuration: recoveryTake.recordedDuration,
      trimSections: recoverySections,
      projectSession
    });
    if (!appendResult || !matchesActiveProjectSession(projectSession)) return;

    if (activeProject && appendResult) {
      // Update the take's sections with the final result
      const take = activeProject.takes.find((t) => t.id === takeId);
      if (take) {
        take.duration = appendResult.takeDuration;
        take.sections = appendResult.takeSections;
      }
      await persistProjectNow();
    }

    await completeRecoveryTake(projectSession.projectPath);
  } catch (error) {
    console.error('Failed to recover pending take:', error);
    if (matchesActiveProjectSession(projectSession)) {
      setWorkspaceView(editorState ? 'timeline' : 'recording');
    }
  }
}

function setProcessingProgress(progress = null) {
  if (!processingBar) return;
  const isDeterminate = Number.isFinite(Number(progress));
  if (!isDeterminate) {
    processingBar.classList.add('animate-pulse');
    processingBar.style.width = '100%';
    return;
  }

  const clamped = Math.max(0, Math.min(1, Number(progress)));
  processingBar.classList.remove('animate-pulse');
  processingBar.style.width = `${Math.max(2, Math.round(clamped * 100))}%`;
}

function _showProcessingState(title, status, progress = null) {
  processingTitle.textContent = title || 'Processing...';
  processingStatus.textContent = status || '';
  setProcessingProgress(progress);
  setWorkspaceView('processing');
}

function _buildSectionAnchorSnapshot(keyframes) {
  const anchors = new Map();
  for (const keyframe of Array.isArray(keyframes) ? keyframes : []) {
    if (!keyframe.sectionId) continue;
    anchors.set(keyframe.sectionId, {
      pipX: keyframe.pipX,
      pipY: keyframe.pipY,
      pipVisible: keyframe.pipVisible !== false,
      cameraFullscreen: !!keyframe.cameraFullscreen,
      backgroundZoom: clampSectionZoom(keyframe.backgroundZoom),
      backgroundPanX: clampSectionPan(keyframe.backgroundPanX),
      backgroundPanY: clampSectionPan(keyframe.backgroundPanY)
    });
  }
  return anchors;
}

function remapManualKeyframesAfterSectionDelete(keyframes, removedSection) {
  const epsilon = 0.001;
  const removedDuration = Math.max(0, Number(removedSection?.end) - Number(removedSection?.start));

  return (Array.isArray(keyframes) ? keyframes : [])
    .filter((keyframe) => !keyframe.sectionId)
    .map((keyframe) => {
      const time = Number(keyframe.time) || 0;
      if (time >= removedSection.start - epsilon && time < removedSection.end - epsilon) {
        return null;
      }

      const nextTime =
        time >= removedSection.end - epsilon ? roundMs(time - removedDuration) : roundMs(time);

      return {
        ...keyframe,
        time: Math.max(0, nextTime)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

function deleteSelectedSection() {
  if (!editorState || editorState.rendering) return;
  const selectedSection = getSelectedSection();
  if (!selectedSection) return;

  const selectedIndex = editorState.sections.findIndex(
    (section) => section.id === selectedSection.id
  );
  if (selectedIndex < 0) return;

  pushUndo();

  // Remove the section
  editorState.sections = editorState.sections.filter(
    (section) => section.id !== selectedSection.id
  );

  if (editorState.sections.length === 0) {
    const savedSourceWidth = editorState.sourceWidth || null;
    const savedSourceHeight = editorState.sourceHeight || null;
    clearEditorState();
    if (activeProject) {
      activeProject = {
        ...activeProject,
        timeline: {
          duration: 0,
          sections: [],
          keyframes: [],
          selectedSectionId: null,
          hasCamera: false,
          sourceWidth: savedSourceWidth,
          sourceHeight: savedSourceHeight
        }
      };
    }
    persistProjectNow();
    setWorkspaceView('recording');
    return;
  }

  // Remove deleted section's anchor, keep remaining anchors, remap manual keyframes
  const remainingAnchors = editorState.keyframes.filter(
    (kf) => kf.sectionId && kf.sectionId !== selectedSection.id
  );
  const remappedManual = remapManualKeyframesAfterSectionDelete(
    editorState.keyframes,
    selectedSection
  );
  editorState.keyframes = [...remainingAnchors, ...remappedManual];

  // Update indices and labels only — keep existing IDs stable
  reindexSections(editorState.sections);

  recalculateTimelinePositions();
  syncSectionAnchorKeyframes();

  const nextSelected =
    editorState.sections[Math.min(selectedIndex, editorState.sections.length - 1)] ||
    editorState.sections[0];
  editorState.selectedSectionId = nextSelected?.id || null;

  renderSectionMarkers();
  refreshWaveform();
  editorSeek(nextSelected?.start || 0);
  scheduleProjectSave();
}

function splitSectionAtPlayhead() {
  if (!editorState || editorState.rendering) return;

  const time = editorState.currentTime;
  const section = findSectionForTime(time);
  if (!section) return;

  const MIN_DURATION = 0.1;
  const offsetInSection = time - section.start;
  const sourceTime = roundMs(section.sourceStart + offsetInSection);

  if (
    sourceTime - section.sourceStart < MIN_DURATION ||
    section.sourceEnd - sourceTime < MIN_DURATION
  )
    return;

  pushUndo();

  const sectionIndex = editorState.sections.findIndex((s) => s.id === section.id);
  if (sectionIndex < 0) return;

  // Split: modify original in place (becomes left half), insert new right half
  const newSectionId = generateSectionId();
  const rightSection = {
    id: newSectionId,
    index: 0,
    label: 'temp',
    start: 0,
    end: 0,
    duration: 0,
    sourceStart: sourceTime,
    sourceEnd: section.sourceEnd,
    takeId: section.takeId,
    transcript: ''
  };

  section.sourceEnd = sourceTime;
  editorState.sections.splice(sectionIndex + 1, 0, rightSection);

  // Update indices and labels only — keep existing IDs stable
  reindexSections(editorState.sections);

  recalculateTimelinePositions();

  // Add one anchor keyframe for the new right-half section (inherits from parent)
  const newAnchor = buildSplitAnchorKeyframe(
    editorState.keyframes,
    section.id,
    newSectionId,
    rightSection.start,
    { pipX: editorState.defaultPipX, pipY: editorState.defaultPipY }
  );
  editorState.keyframes.push(newAnchor);
  editorState.keyframes.sort((a, b) => a.time - b.time);

  editorState.selectedSectionId = newSectionId;

  renderSectionMarkers();
  refreshWaveform();
  editorSeek(editorState.currentTime);
  scheduleProjectSave();
}

function appendTakeToTimeline({
  takeId,
  screenPath: _screenPath,
  cameraPath,
  recordedDuration,
  trimSections,
  projectSession
}) {
  const takeSections = normalizeTakeSections(trimSections, recordedDuration);
  // Ensure all sections carry the takeId
  for (const section of takeSections) {
    section.takeId = takeId;
  }
  const takeDuration =
    takeSections.length > 0
      ? takeSections[takeSections.length - 1].end
      : Math.max(0, Number(recordedDuration) || 0);

  if (!matchesActiveProjectSession(projectSession)) return null;

  const hasCamera = !!cameraPath;

  if (!editorState) {
    enterEditor(takeSections, {
      hasCamera,
      initialView: 'timeline'
    });

    return {
      takeSections,
      takeDuration,
      appendedSections: takeSections
    };
  }

  pushUndo();

  const baseDuration = Math.max(0, Number(editorState.duration) || 0);
  const existingSections = editorState.sections.map((s) => ({ ...s }));
  const existingKeyframes = Array.isArray(editorState.keyframes)
    ? editorState.keyframes.map((kf) => ({ ...kf }))
    : [];

  const hadCameraBefore = !!editorState.hasCamera;
  const keepCamera = hadCameraBefore || hasCamera;

  const startIndex = existingSections.length;
  const appendedSections = takeSections.map((section, idx) => {
    const sectionNumber = startIndex + idx + 1;
    return {
      ...section,
      id: `section-${sectionNumber}`,
      index: sectionNumber - 1,
      label: `Section ${sectionNumber}`,
      start: roundMs(section.start + baseDuration),
      end: roundMs(section.end + baseDuration),
      duration: roundMs(section.end - section.start),
      takeId
    };
  });

  const timelineSections = [...existingSections, ...appendedSections];

  const carryState = getStateAtTime(Math.max(0, baseDuration - 0.001));
  const newAnchors = appendedSections.map((section) => ({
    time: section.start,
    pipX: carryState.pipX,
    pipY: carryState.pipY,
    pipVisible: carryState.pipVisible,
    cameraFullscreen: !!carryState.cameraFullscreen,
    backgroundZoom: clampSectionZoom(carryState.backgroundZoom),
    backgroundPanX: clampSectionPan(carryState.backgroundPanX),
    backgroundPanY: clampSectionPan(carryState.backgroundPanY),
    sectionId: section.id,
    autoSection: true
  }));

  const withoutConflictingAnchors = existingKeyframes.filter(
    (kf) => !kf.sectionId || !newAnchors.some((anchor) => anchor.sectionId === kf.sectionId)
  );

  enterEditor(timelineSections, {
    keyframes: [...withoutConflictingAnchors, ...newAnchors].sort((a, b) => a.time - b.time),
    selectedSectionId: appendedSections[0]?.id || editorState?.selectedSectionId,
    hasCamera: keepCamera,
    screenFitMode: editorState?.screenFitMode,
    sourceWidth: editorState?.sourceWidth,
    sourceHeight: editorState?.sourceHeight,
    initialView: 'timeline'
  });

  return {
    takeSections,
    takeDuration,
    appendedSections
  };
}

async function stopRecording() {
  const projectSession = getActiveProjectSession();
  const recordedDuration = (Date.now() - startTime) / 1000;
  clearInterval(timerInterval);

  // Remove track-ended listeners (no longer needed once we're stopping)
  for (const cleanup of trackEndedCleanups) cleanup();
  trackEndedCleanups = [];

  // Stop audio send interval
  if (audioSendInterval) {
    clearInterval(audioSendInterval);
    audioSendInterval = null;
  }

  // Disconnect worklet (must sever micSourceNode→worklet input, not just worklet outputs)
  if (scribeWorkletNode) {
    scribeWorkletNode.port.onmessage = null;
    if (micSourceNode) micSourceNode.disconnect(scribeWorkletNode);
    scribeWorkletNode.disconnect();
    scribeWorkletNode = null;
  }

  // Send final commit and close WebSocket.
  // Detach onmessage first so late-arriving transcripts cannot mutate
  // speechSegments after we snapshot them for section computation.
  const hadScribe = !!scribeWs;
  scribeManualClose = true;
  if (scribeWs) {
    scribeWs.onmessage = null;
    if (scribeWs.readyState === WebSocket.OPEN) {
      scribeWs.send(JSON.stringify({ message_type: 'commit' }));
      await new Promise((r) => setTimeout(r, 1000));
      scribeWs.close();
    }
  }
  scribeWs = null;
  scribeLastFailureReason = null;
  audioChunkBuffer = [];

  if (screenRecInterval) {
    clearInterval(screenRecInterval);
    screenRecInterval = null;
  }

  const recorderFinalizeTimeoutMs = getRecorderFinalizeTimeoutMs();
  recorders.forEach((r) => {
    if (r.state === 'inactive') return;
    if (typeof r.requestData === 'function') {
      try {
        r.requestData();
      } catch (error) {
        console.warn(`[Recorder] ${r.suffix} requestData failed`, error);
      }
    }
    r.stop();
  });

  // Await each recorder independently so one finalize failure cannot wedge the whole stop flow.
  const results = {};
  const finalizeErrors = [];
  for (const r of recorders) {
    const result = await Promise.race([
      r.blobPromise,
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            blob: new Blob([], { type: 'video/webm' }),
            error: `${r.suffix} recording did not finish saving in time`,
            path: null,
            suffix: r.suffix
          });
        }, recorderFinalizeTimeoutMs);
      })
    ]);
    results[r.suffix] = result;
    if (result?.error) finalizeErrors.push(result.error);
  }

  recorders = [];
  recording = false;
  updateWorkspaceHeader();
  recordBtn.textContent = 'Record';
  recordBtn.classList.replace('bg-neutral-700', 'bg-red-600');
  recordBtn.classList.replace('hover:bg-neutral-600', 'hover:bg-red-700');
  screenSelect.disabled = false;
  cameraSelect.disabled = false;
  audioSelect.disabled = false;
  timerEl.textContent = '00:00';

  // Hide transcript panel
  transcriptPanel.classList.add('hidden');
  setTranscriptStatus('', 'neutral');

  // Enter editor if we have at least a screen recording
  if (results.screen?.path) {
    if (finalizeErrors.length > 0) {
      console.warn('Recording finalized with partial failures:', finalizeErrors);
    }
    const takeId = `take-${Date.now()}`;
    const takeCreatedAt = new Date().toISOString();
    const screenPath = results.screen.path;
    const cameraPath = results.camera?.path || null;
    let sectionsForTimeline = buildDefaultSectionsForDuration(recordedDuration);

    // Compute sections from speech segments (instant, no FFmpeg)
    const activeSegments = speechSegments.filter((s) => !s.deleted);
    const fallbackSections = buildRemappedSectionsFromSegments(activeSegments);
    await saveRecoveryTake({
      id: takeId,
      createdAt: takeCreatedAt,
      screenPath,
      cameraPath,
      recordedDuration,
      sections: sectionsForTimeline,
      trimSegments: activeSegments
    });
    if (activeSegments.length > 0) {
      try {
        const computed = await window.electronAPI.computeSections({
          segments: activeSegments
        });
        sectionsForTimeline =
          Array.isArray(computed?.sections) && computed.sections.length > 0
            ? attachSectionTranscripts(computed.sections, fallbackSections)
            : fallbackSections.length > 0
              ? fallbackSections
              : sectionsForTimeline;
        if (!matchesActiveProjectSession(projectSession)) return;
      } catch (err) {
        console.warn('Section computation failed, using fallback sections:', err);
        if (fallbackSections.length > 0) sectionsForTimeline = fallbackSections;
      }
    } else if (hadScribe) {
      console.warn('No speech detected, using full recording');
    }

    // Set takeId on all sections
    sectionsForTimeline = sectionsForTimeline.map((s) => ({ ...s, takeId }));

    // Add take to project before entering editor (video pool needs it)
    if (activeProject) {
      if (!Array.isArray(activeProject.takes)) activeProject.takes = [];
      activeProject.takes.push({
        id: takeId,
        createdAt: takeCreatedAt,
        duration: recordedDuration,
        screenPath,
        cameraPath,
        proxyPath: null,
        sections: sectionsForTimeline
      });
    }

    try {
      const appendResult = appendTakeToTimeline({
        takeId,
        screenPath,
        cameraPath,
        recordedDuration,
        trimSections: sectionsForTimeline,
        projectSession
      });
      if (!appendResult || !matchesActiveProjectSession(projectSession)) return;

      if (activeProject && appendResult) {
        const take = activeProject.takes.find((t) => t.id === takeId);
        if (take) {
          take.duration = appendResult.takeDuration;
          take.sections = appendResult.takeSections;
        }
        await persistProjectNow();
        // Trigger background proxy generation for the new take
        if (activeProjectPath && screenPath) {
          proxyStatus.set(takeId, { status: 'pending', percent: 0 });
          renderSectionMarkers();
          window.electronAPI
            .generateProxy({
              takeId,
              screenPath,
              projectFolder: activeProjectPath,
              durationSec: recordedDuration
            })
            .catch((err) => console.warn('[Proxy] Failed to start proxy generation:', err));
        }
      }
      await completeRecoveryTake();
    } catch (error) {
      console.error('Failed to append recording to project timeline:', error);
      setWorkspaceView('recording');
    }
  } else if (finalizeErrors.length > 0) {
    console.error('Recording finalize failed:', finalizeErrors);
    showProjectHomeMessage(finalizeErrors.join(' '));
  }
  updateWorkspaceHeader();
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  timerEl.textContent = `${m}:${s}`;
}

// ===== Editor =====

function enterEditor(rawSections, opts = {}) {
  // Stop live preview while timeline is active.
  if (drawRAF) {
    cancelAnimationFrame(drawRAF);
    drawRAF = null;
  }
  lastCompositeDrawAt = 0;
  cancelEditorDrawLoop();

  // Reset timeline zoom
  timelineZoom = 1;
  editorTimeline.style.minWidth = '100%';
  editorTimelineWrapper.scrollLeft = 0;

  // Clean up previous video pool
  cleanupVideoPool();

  const defaultPipX = CANVAS_W - PIP_SIZE - PIP_MARGIN;
  const defaultPipY = CANVAS_H - PIP_SIZE - PIP_MARGIN;
  const sections = normalizeSections(rawSections, opts.duration || 0);

  // Calculate duration from sections
  const duration = sections.length > 0 ? sections[sections.length - 1].end : opts.duration || 0;

  const sectionKeyframes = sections.map((section) => ({
    time: section.start,
    pipX: defaultPipX,
    pipY: defaultPipY,
    pipVisible: true,
    cameraFullscreen: false,
    backgroundZoom: DEFAULT_SECTION_ZOOM,
    backgroundPanX: 0,
    backgroundPanY: 0,
    sectionId: section.id,
    autoSection: true
  }));

  const providedKeyframes =
    Array.isArray(opts.keyframes) && opts.keyframes.length > 0
      ? opts.keyframes.map((kf) => ({
          ...kf,
          backgroundZoom: clampSectionZoom(kf.backgroundZoom),
          backgroundPanX: clampSectionPan(kf.backgroundPanX),
          backgroundPanY: clampSectionPan(kf.backgroundPanY)
        }))
      : null;
  const keyframes = (providedKeyframes || sectionKeyframes).sort((a, b) => a.time - b.time);

  editorState = {
    duration,
    currentTime: 0,
    playing: false,
    pipSize: PIP_SIZE,
    defaultPipX,
    defaultPipY,
    keyframes,
    sections,
    selectedSectionId: opts.selectedSectionId || sections[0]?.id || null,
    selectedSectionIds: new Set(
      [opts.selectedSectionId || sections[0]?.id || null].filter(Boolean)
    ),
    screenFitMode: opts.screenFitMode || screenFitSelect.value,
    rendering: false,
    renderProgress: 0,
    playbackSpeed: 1,
    cameraSyncOffsetMs: normalizeCameraSyncOffsetMs(opts.cameraSyncOffsetMs),
    hasCamera: typeof opts.hasCamera === 'boolean' ? opts.hasCamera : false,
    sourceWidth: opts.sourceWidth || null,
    sourceHeight: opts.sourceHeight || null
  };
  screenFitSelect.value = editorState.screenFitMode === 'fit' ? 'fit' : 'fill';
  cameraSyncOffsetInput.value = String(editorState.cameraSyncOffsetMs);
  updateSectionZoomControls();

  // Pre-create video elements for all referenced takes
  const referencedTakeIds = new Set(sections.map((s) => s.takeId).filter(Boolean));
  for (const takeId of referencedTakeIds) {
    getOrCreateTakeVideos(takeId);
  }

  // Set up initial active take from first section
  if (sections.length > 0) {
    const firstSection = sections[0];
    activeTakeId = firstSection.takeId;
    activePlaybackSection = firstSection;
    const videos = getOrCreateTakeVideos(firstSection.takeId);
    if (videos) {
      videos.screen.currentTime = firstSection.sourceStart;
      if (videos.camera) {
        videos.camera.currentTime = resolveCameraPlaybackTargetTime(
          firstSection.sourceStart,
          editorState.cameraSyncOffsetMs
        );
      }
    }
  }

  // Wait for metadata to get source resolution.
  // When a proxy is used for playback, probe the ORIGINAL source for true
  // dimensions so exports render at full resolution (not the 960x540 proxy).
  if (referencedTakeIds.size > 0) {
    const firstTakeId = sections[0]?.takeId;
    const firstTake = firstTakeId ? activeProject?.takes?.find((t) => t.id === firstTakeId) : null;
    const videos = firstTakeId ? getOrCreateTakeVideos(firstTakeId) : null;
    if (videos) {
      const applySourceResolution = (w, h) => {
        if (!editorState) return;
        if (w && h) {
          editorState.sourceWidth = w;
          editorState.sourceHeight = h;
        }
        syncSectionAnchorKeyframes();
        renderSectionMarkers();
        updateEditorTimeDisplay();
        scheduleProjectSave();
        extractWaveformPeaks().then((peaks) => {
          if (!editorState) return;
          waveformPeaks = peaks;
          renderWaveform();
        });
      };

      if (firstTake?.proxyPath && firstTake?.screenPath) {
        // Proxy is used for playback — probe original for true dimensions
        const sourceProbe = document.createElement('video');
        sourceProbe.preload = 'metadata';
        sourceProbe.src = pathToFileUrl(firstTake.screenPath);
        sourceProbe.addEventListener(
          'loadedmetadata',
          () => {
            applySourceResolution(sourceProbe.videoWidth, sourceProbe.videoHeight);
            sourceProbe.src = '';
          },
          { once: true }
        );
      } else {
        // No proxy — read dimensions from the pool video directly
        const onMeta = () =>
          applySourceResolution(videos.screen.videoWidth, videos.screen.videoHeight);
        if (videos.screen.readyState >= 1) onMeta();
        else videos.screen.addEventListener('loadedmetadata', onMeta, { once: true });
      }
    }
  }

  updateEditorTimeDisplay();
  renderSectionMarkers();
  preloadSectionImages();
  const initialView = opts.initialView === 'recording' ? 'recording' : 'timeline';
  setWorkspaceView(initialView);
}

function _exitEditor() {
  setWorkspaceView('recording');
}

function getStateAtTime(time) {
  const defaultKf = {
    time: 0,
    pipX: editorState.defaultPipX,
    pipY: editorState.defaultPipY,
    pipVisible: true,
    cameraFullscreen: false,
    backgroundZoom: DEFAULT_SECTION_ZOOM,
    backgroundPanX: 0,
    backgroundPanY: 0
  };
  const userKfs = editorState.keyframes;
  const kfs = userKfs.length > 0 && userKfs[0].time === 0 ? userKfs : [defaultKf, ...userKfs];

  // Find active keyframe (last one at or before time)
  let activeIdx = 0;
  for (let i = 1; i < kfs.length; i++) {
    if (kfs[i].time <= time) activeIdx = i;
    else break;
  }

  const active = kfs[activeIdx];
  const next = activeIdx < kfs.length - 1 ? kfs[activeIdx + 1] : null;

  let pipX = active.pipX;
  let pipY = active.pipY;
  let opacity = active.pipVisible ? 1 : 0;
  let cameraFullscreen = active.cameraFullscreen || false;
  let camTransition = cameraFullscreen ? 1 : 0;
  let backgroundZoom = clampSectionZoom(active.backgroundZoom);
  let backgroundPanX = clampSectionPan(active.backgroundPanX);
  let backgroundPanY = clampSectionPan(active.backgroundPanY);
  let backgroundFocusX = panToFocusCoord(backgroundZoom, backgroundPanX, 0.5);
  let backgroundFocusY = panToFocusCoord(backgroundZoom, backgroundPanY, 0.5);

  // Transition toward next keyframe at end of current section
  if (next) {
    const remaining = next.time - time;
    if (remaining > 0 && remaining < TRANSITION_DURATION) {
      const t = 1 - remaining / TRANSITION_DURATION;
      const nextVisible = next.pipVisible !== undefined ? next.pipVisible : true;
      const nextFullscreen = next.cameraFullscreen || false;

      if (active.pipVisible !== nextVisible) {
        // Visibility transition: fade in/out toward next state
        if (nextVisible) {
          // Fading in: use next position (where camera will appear)
          opacity = t;
          pipX = next.pipX;
          pipY = next.pipY;
          cameraFullscreen = nextFullscreen;
          camTransition = nextFullscreen ? 1 : 0;
        } else {
          // Fading out: keep current position
          opacity = 1 - t;
          camTransition = cameraFullscreen ? 1 : 0;
        }
      } else {
        // No visibility change - handle position and fullscreen transitions
        if (cameraFullscreen !== nextFullscreen) {
          camTransition = nextFullscreen ? t : 1 - t;
          if (!nextFullscreen) {
            // Shrinking from fullscreen: use next pip position as destination
            pipX = next.pipX;
            pipY = next.pipY;
          }
        }

        if (
          !cameraFullscreen &&
          !nextFullscreen &&
          (active.pipX !== next.pipX || active.pipY !== next.pipY)
        ) {
          pipX = active.pipX + (next.pipX - active.pipX) * t;
          pipY = active.pipY + (next.pipY - active.pipY) * t;
        }
      }

      if (Math.abs(backgroundZoom - clampSectionZoom(next.backgroundZoom)) > 0.0001) {
        backgroundZoom =
          backgroundZoom + (clampSectionZoom(next.backgroundZoom) - backgroundZoom) * t;
      }
      const nextFocusX = panToFocusCoord(next.backgroundZoom, next.backgroundPanX, 0.5);
      const nextFocusY = panToFocusCoord(next.backgroundZoom, next.backgroundPanY, 0.5);
      backgroundFocusX = backgroundFocusX + (nextFocusX - backgroundFocusX) * t;
      backgroundFocusY = backgroundFocusY + (nextFocusY - backgroundFocusY) * t;
      backgroundPanX = focusToPanCoord(backgroundZoom, backgroundFocusX, backgroundPanX);
      backgroundPanY = focusToPanCoord(backgroundZoom, backgroundFocusY, backgroundPanY);
    }
  }

  return {
    pipX,
    pipY,
    pipVisible: opacity > 0,
    opacity,
    cameraFullscreen,
    camTransition,
    backgroundZoom,
    backgroundPanX,
    backgroundPanY,
    backgroundFocusX,
    backgroundFocusY
  };
}

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

function updateEditorTimeDisplay() {
  if (!editorState) return;
  const selectedSection = getSelectedSection();
  const sectionText = selectedSection ? ` | ${selectedSection.label}` : '';
  const speedText = editorState.playbackSpeed !== 1 ? ` [${editorState.playbackSpeed}x]` : '';
  editorTimeEl.textContent = `${formatTime(editorState.currentTime)} / ${formatTime(editorState.duration)}${speedText}${sectionText}`;
}

function switchPlaybackSection(nextSection, opts = {}) {
  if (!editorState || !nextSection) return false;
  const previousTakeId = activeTakeId;
  const sameTake = previousTakeId === nextSection.takeId;
  const nextVideos = getOrCreateTakeVideos(nextSection.takeId);
  if (!nextVideos) return false;

  const targetSourceTime = Number.isFinite(Number(opts.sourceTime))
    ? Number(opts.sourceTime)
    : nextSection.sourceStart;
  const seekPlan = computePlaybackSeekPlan(
    nextVideos.screen.currentTime,
    nextVideos.camera?.currentTime,
    targetSourceTime,
    editorState.cameraSyncOffsetMs
  );

  if (!sameTake && previousTakeId) {
    const previousVideos = getOrCreateTakeVideos(previousTakeId);
    if (previousVideos) {
      previousVideos.screen.pause();
      if (previousVideos.camera) {
        previousVideos.camera.pause();
        previousVideos.camera.playbackRate = 1;
      }
    }
  }

  if (seekPlan.screenNeedsSeek) nextVideos.screen.currentTime = seekPlan.targetSourceTime;
  if (nextVideos.camera && seekPlan.cameraNeedsSeek)
    nextVideos.camera.currentTime = seekPlan.targetCameraTime;

  activeTakeId = nextSection.takeId;
  activePlaybackSection = nextSection;

  if (opts.logSwitch) {
    console.debug('[Editor] Section switch', {
      from: opts.fromSectionId || null,
      to: nextSection.id,
      sameTake,
      seek: seekPlan.needsSeek,
      reason: opts.reason || 'unknown'
    });
  }

  if (opts.resumePlayback) {
    const speed = editorState.playbackSpeed || 1;
    nextVideos.screen.playbackRate = speed;
    if (nextVideos.screen.paused) nextVideos.screen.play().catch(() => {});
    if (editorState.hasCamera && nextVideos.camera && nextVideos.camera.paused) {
      nextVideos.camera.playbackRate = speed;
      nextVideos.camera.play().catch(() => {});
    }
  }

  return true;
}

function syncCameraPlayback(videos) {
  if (!editorState?.hasCamera || !videos?.camera) return;

  const baseRate = editorState.playbackSpeed || 1;
  const drift = computeCameraPlaybackDrift(
    videos.screen.currentTime,
    videos.camera.currentTime,
    editorState.cameraSyncOffsetMs
  );
  const absDrift = Math.abs(drift);
  const now = performance.now();

  if (absDrift >= CAMERA_DRIFT_HARD_THRESHOLD && now >= cameraResyncCooldownUntil) {
    videos.camera.currentTime = resolveCameraPlaybackTargetTime(
      videos.screen.currentTime,
      editorState.cameraSyncOffsetMs
    );
    videos.camera.playbackRate = baseRate;
    cameraResyncCooldownUntil = now + CAMERA_RESYNC_COOLDOWN_MS;
    console.debug('[Editor] Camera hard resync', {
      drift: Number(drift.toFixed(3)),
      threshold: CAMERA_DRIFT_HARD_THRESHOLD
    });
    return;
  }

  if (absDrift >= CAMERA_DRIFT_SOFT_THRESHOLD) {
    const correction = Math.min(0.06, absDrift * 0.5);
    const targetRate = drift > 0 ? baseRate + correction : baseRate - correction;
    const clampedRate = Math.max(baseRate - 0.08, Math.min(baseRate + 0.08, targetRate));
    if (Math.abs(videos.camera.playbackRate - clampedRate) > 0.004) {
      videos.camera.playbackRate = clampedRate;
    }
    if (
      absDrift >= CAMERA_DRIFT_LOG_THRESHOLD &&
      now - lastCameraDriftLogAt >= CAMERA_DRIFT_LOG_INTERVAL_MS
    ) {
      console.debug('[Editor] Camera drift', {
        drift: Number(drift.toFixed(3)),
        playbackRate: Number(clampedRate.toFixed(3))
      });
      lastCameraDriftLogAt = now;
    }
  } else if (Math.abs(videos.camera.playbackRate - baseRate) > 0.001) {
    videos.camera.playbackRate = baseRate;
  }
}

function editorPlay() {
  if (!editorState || editorState.rendering) return;
  editorState.playing = true;
  const speed = editorState.playbackSpeed || 1;
  if (activeTakeId) {
    const videos = getOrCreateTakeVideos(activeTakeId);
    if (videos) {
      videos.screen.playbackRate = speed;
      videos.screen.play().catch(() => {});
      if (editorState.hasCamera && videos.camera) {
        videos.camera.playbackRate = speed;
        videos.camera.play().catch(() => {});
      }
    }
  }
  editorPlayBtn.textContent = 'Pause';
}

function editorPause() {
  if (!editorState) return;
  editorState.playing = false;
  for (const [, videos] of takeVideoPool) {
    videos.screen.pause();
    videos.screen.playbackRate = 1;
    if (videos.camera) {
      videos.camera.pause();
      videos.camera.playbackRate = 1;
    }
  }
  editorPlayBtn.textContent = 'Play';
}

function editorTogglePlay() {
  if (!editorState) return;
  if (editorState.playing) editorPause();
  else editorPlay();
}

function cyclePlaybackSpeed() {
  if (!editorState) return;
  const speeds = [1, 1.5, 2];
  const idx = speeds.indexOf(editorState.playbackSpeed);
  editorState.playbackSpeed = speeds[(idx + 1) % speeds.length];
  if (editorState.playing && activeTakeId) {
    const videos = getOrCreateTakeVideos(activeTakeId);
    if (videos) {
      videos.screen.playbackRate = editorState.playbackSpeed;
      if (editorState.hasCamera && videos.camera) {
        videos.camera.playbackRate = editorState.playbackSpeed;
      }
    }
  }
  updateEditorTimeDisplay();
}

function editorSeek(time) {
  if (!editorState) return;
  time = Math.max(0, Math.min(time, editorState.duration));
  editorState.currentTime = time;

  const resolved = resolveTimeToSource(time);
  if (resolved) {
    switchPlaybackSection(resolved.section, {
      sourceTime: resolved.sourceTime,
      resumePlayback: editorState.playing,
      reason: 'seek',
      fromSectionId: activePlaybackSection?.id
    });
  }
  updateEditorTimeDisplay();
  updateScrubberPosition();
}

function updateScrubberPosition() {
  if (!editorState || editorState.duration <= 0) return;
  const pct = (editorState.currentTime / editorState.duration) * 100;
  editorScrubber.style.left = pct + '%';
  if (editorState.playing) scrollTimelineToPlayhead();
}

function editorDrawLoop() {
  if (!editorState) return;

  if (editorState.playing && activeTakeId && activePlaybackSection) {
    const videos = getOrCreateTakeVideos(activeTakeId);
    if (videos) {
      const sourceTime = videos.screen.currentTime;
      const timelineTime =
        activePlaybackSection.start + (sourceTime - activePlaybackSection.sourceStart);
      editorState.currentTime = timelineTime;

      // Check if we've passed the current section's end
      if (sourceTime >= activePlaybackSection.sourceEnd - 0.01) {
        const currentIdx = editorState.sections.indexOf(activePlaybackSection);
        const nextSection = editorState.sections[currentIdx + 1];

        if (nextSection) {
          const fromSectionId = activePlaybackSection?.id;
          const sameTake = activeTakeId === nextSection.takeId;
          const contiguousSource =
            sameTake && Math.abs(sourceTime - nextSection.sourceStart) <= 0.05;
          switchPlaybackSection(nextSection, {
            sourceTime: contiguousSource ? sourceTime : nextSection.sourceStart,
            resumePlayback: true,
            logSwitch: true,
            reason: 'boundary',
            fromSectionId
          });
        } else {
          // End of timeline
          editorPause();
        }
      }

      syncCameraPlayback(videos);
    }

    updateEditorTimeDisplay();
    updateScrubberPosition();
  }

  // Draw composite frame
  editorCtx.fillStyle = '#000';
  editorCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const activeVideos = activeTakeId ? getOrCreateTakeVideos(activeTakeId) : null;
  const hasScreen = activeVideos && activeVideos.screen.videoWidth > 0;
  const hasCamera =
    editorState.hasCamera && activeVideos?.camera && activeVideos.camera.videoWidth > 0;
  const state = getStateAtTime(editorState.currentTime);

  const currentSection = findSectionForTime(editorState.currentTime);
  const sectionImage = currentSection?.imagePath
    ? sectionImageCache.get(currentSection.imagePath)
    : null;

  if (sectionImage) {
    drawEditorScreenWithZoom(
      editorCtx,
      sectionImage,
      editorState.screenFitMode,
      state.backgroundZoom,
      state.backgroundPanX,
      state.backgroundPanY,
      state.backgroundFocusX,
      state.backgroundFocusY
    );
  } else if (hasScreen) {
    drawEditorScreenWithZoom(
      editorCtx,
      activeVideos.screen,
      editorState.screenFitMode,
      state.backgroundZoom,
      state.backgroundPanX,
      state.backgroundPanY,
      state.backgroundFocusX,
      state.backgroundFocusY
    );
  }

  if (hasCamera) {
    if (state.camTransition > 0 && state.opacity > 0) {
      editorCtx.save();
      if (state.opacity < 1) editorCtx.globalAlpha = state.opacity;
      const t = easeInOut(state.camTransition);
      const camX = state.pipX * (1 - t);
      const camY = state.pipY * (1 - t);
      const camW = editorState.pipSize + (CANVAS_W - editorState.pipSize) * t;
      const camH = editorState.pipSize + (CANVAS_H - editorState.pipSize) * t;
      const camR = 12 * (1 - t);
      drawCameraRect(editorCtx, activeVideos.camera, camX, camY, camW, camH, camR);
      editorCtx.restore();
    } else if (state.opacity > 0) {
      editorCtx.save();
      editorCtx.globalAlpha = state.opacity;
      drawPip(
        editorCtx,
        activeVideos.camera,
        state.pipX,
        state.pipY,
        editorState.pipSize,
        editorState.pipSize
      );
      editorCtx.restore();
    }
  }

  scheduleEditorDrawLoop();
}

// ===== Keyframe management =====

function getMutableCameraKeyframe() {
  if (!editorState) return null;

  const selectedSection = getSelectedSection();
  if (selectedSection) {
    return getSectionAnchorKeyframe(selectedSection.id, true);
  }

  const section = findSectionForTime(editorState.currentTime);
  if (section) {
    return getSectionAnchorKeyframe(section.id, true);
  }

  return null;
}

function toggleCameraVisibility() {
  if (!editorState || editorState.rendering) return;
  const target = getMutableCameraKeyframe();
  if (!target) return;
  pushUndo();
  target.pipVisible = !target.pipVisible;
  scheduleProjectSave();
}

function toggleCameraFullscreen() {
  if (!editorState || editorState.rendering) return;
  const target = getMutableCameraKeyframe();
  if (!target) return;
  pushUndo();
  target.cameraFullscreen = !(target.cameraFullscreen || false);
  scheduleProjectSave();
}

function setSelectedSectionBackgroundZoom(nextZoom, opts = {}) {
  if (!editorState || editorState.rendering) return false;
  const pushHistory = opts.pushHistory === true;
  const selectedSection = getSelectedSection();
  if (!selectedSection) return false;
  const anchor = getSectionAnchorKeyframe(selectedSection.id, true);
  if (!anchor) return false;
  const normalizedZoom = clampSectionZoom(nextZoom);
  const currentZoom = clampSectionZoom(anchor.backgroundZoom);
  if (Math.abs(normalizedZoom - currentZoom) < 0.0001) {
    updateSectionZoomControls();
    return false;
  }
  if (pushHistory) pushUndo();
  anchor.backgroundZoom = normalizedZoom;
  updateSectionZoomControls();
  return true;
}

function setSectionBackgroundPan(sectionId, nextPanX, nextPanY) {
  if (!editorState || editorState.rendering || !sectionId) return false;
  const anchor = getSectionAnchorKeyframe(sectionId, true);
  if (!anchor) return false;
  const normalizedPanX = clampSectionPan(nextPanX);
  const normalizedPanY = clampSectionPan(nextPanY);
  const currentPanX = clampSectionPan(anchor.backgroundPanX);
  const currentPanY = clampSectionPan(anchor.backgroundPanY);
  if (
    Math.abs(normalizedPanX - currentPanX) < 0.0001 &&
    Math.abs(normalizedPanY - currentPanY) < 0.0001
  ) {
    return false;
  }
  anchor.backgroundPanX = normalizedPanX;
  anchor.backgroundPanY = normalizedPanY;
  return true;
}

function commitSectionZoomChange() {
  if (!sectionZoomDragActive) return;
  sectionZoomDragActive = false;
  scheduleProjectSave();
}

// ===== PiP drag-to-reposition =====

function canvasToEditorCoords(clientX, clientY) {
  const rect = editorCanvas.getBoundingClientRect();
  const scaleX = CANVAS_W / rect.width;
  const scaleY = CANVAS_H / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

editorCanvas.addEventListener('mousedown', (e) => {
  if (!editorState || editorState.rendering) return;
  const activeSection = findSectionForTime(editorState.currentTime);
  if (activeSection) selectEditorSection(activeSection.id);
  const { x, y } = canvasToEditorCoords(e.clientX, e.clientY);
  const kf = getStateAtTime(editorState.currentTime);
  if (editorState.hasCamera && kf.pipVisible && kf.camTransition <= 0) {
    const pipW = editorState.pipSize;
    const pipH = editorState.pipSize;
    if (x >= kf.pipX && x <= kf.pipX + pipW && y >= kf.pipY && y <= kf.pipY + pipH) {
      pipDragMoved = false;
      pushUndo();
      draggingPip = true;
      e.preventDefault();
      return;
    }
  }

  if (!activeSection || kf.backgroundZoom <= 1.0001 || (kf.cameraFullscreen && kf.opacity > 0))
    return;
  const initialPan = getSectionBackgroundPan(activeSection.id);
  pushUndo();
  backgroundDragMoved = false;
  draggingBackground = true;
  backgroundDragState = {
    sectionId: activeSection.id,
    startMouseX: x,
    startMouseY: y,
    startPanX: initialPan.x,
    startPanY: initialPan.y,
    zoom: kf.backgroundZoom
  };
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (draggingBackground && editorState && backgroundDragState) {
    const { x, y } = canvasToEditorCoords(e.clientX, e.clientY);
    const deltaX = x - backgroundDragState.startMouseX;
    const deltaY = y - backgroundDragState.startMouseY;
    const { maxOffsetX, maxOffsetY } = getZoomCropBounds(backgroundDragState.zoom);
    const nextPanX = maxOffsetX > 0 ? backgroundDragState.startPanX - deltaX / maxOffsetX : 0;
    const nextPanY = maxOffsetY > 0 ? backgroundDragState.startPanY - deltaY / maxOffsetY : 0;
    backgroundDragMoved =
      setSectionBackgroundPan(backgroundDragState.sectionId, nextPanX, nextPanY) ||
      backgroundDragMoved;
    return;
  }

  if (!draggingPip || !editorState) return;
  pipDragMoved = true;
  const { x, y } = canvasToEditorCoords(e.clientX, e.clientY);
  const snapped = snapToNearestCorner(x, y);

  const selectedSection = getSelectedSection();
  const section = selectedSection || findSectionForTime(editorState.currentTime);
  if (section) {
    const anchor = getSectionAnchorKeyframe(section.id, true);
    if (anchor) {
      anchor.pipX = snapped.x;
      anchor.pipY = snapped.y;
    }
  }
});

window.addEventListener('mouseup', () => {
  const wasDraggingBackground = draggingBackground;
  draggingBackground = false;
  backgroundDragState = null;
  if (wasDraggingBackground) {
    if (backgroundDragMoved) {
      scheduleProjectSave();
    } else {
      undoStack.pop();
      updateUndoRedoButtons();
    }
    backgroundDragMoved = false;
  }

  const wasDragging = draggingPip;
  draggingPip = false;
  if (wasDragging) {
    if (pipDragMoved) {
      scheduleProjectSave();
    } else {
      undoStack.pop();
      updateUndoRedoButtons();
    }
    pipDragMoved = false;
  }
});

// ===== Timeline scrubber =====

editorTimeline.addEventListener('mousedown', (e) => {
  if (!editorState || editorState.rendering) return;

  const isSelected = (id) =>
    editorState.selectedSectionIds?.has(id) || id === editorState.selectedSectionId;

  // Trim handles only work on already-selected sections
  const trimEdge = e.target?.dataset?.trimEdge;
  if (trimEdge) {
    const trimSectionId = e.target.dataset.sectionId;
    if (trimSectionId && isSelected(trimSectionId)) {
      startTrimDrag(e, trimSectionId, trimEdge);
      return;
    }
    // Clicked trim handle on unselected section — just select it
    if (trimSectionId) {
      selectEditorSection(trimSectionId);
      return;
    }
  }

  const bandEl = e.target?.closest?.('[data-section-id]');
  const sectionId = bandEl?.dataset?.sectionId || null;

  if (sectionId) {
    // Shift-click: range select, no drag
    if (e.shiftKey) {
      selectEditorSection(sectionId, true);
      return;
    }

    // Click on section: select if needed, then set up potential drag
    if (!isSelected(sectionId)) {
      selectEditorSection(sectionId);
    }

    if (editorState.sections.length > 1) {
      sectionDragState = {
        sectionId,
        startX: e.clientX,
        started: false,
        dropIndicator: null
      };
      const onMove = (e2) => updateSectionDrag(e2);
      const onUp = (e2) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        finishSectionDrag(e2);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    return;
  }

  // Background click: seek
  seekFromTimeline(e);
  const onMove = (e2) => seekFromTimeline(e2);
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});

function seekFromTimeline(e) {
  const rect = editorTimeline.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  editorSeek(pct * editorState.duration);
}

const SECTION_DRAG_THRESHOLD = 5;

function getDragSelectedIds() {
  if (!editorState) return new Set();
  const ids = editorState.selectedSectionIds;
  if (ids && ids.size > 0) return ids;
  if (editorState.selectedSectionId) return new Set([editorState.selectedSectionId]);
  return new Set();
}

function computeDropTarget(clientX) {
  const dragIds = getDragSelectedIds();
  const remaining = editorState.sections.filter((s) => !dragIds.has(s.id));
  const bands = Array.from(editorSectionMarkers.querySelectorAll('[data-section-id]'));

  let slotIndex = 0;
  for (const section of remaining) {
    const band = bands.find((b) => b.dataset.sectionId === section.id);
    if (!band) {
      slotIndex++;
      continue;
    }
    const rect = band.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return { insertIndex: slotIndex, section };
    }
    slotIndex++;
  }
  return { insertIndex: remaining.length, section: null };
}

function showDropIndicator(target) {
  removeDropIndicator();
  if (!editorState || editorState.sections.length === 0) return;
  const indicator = document.createElement('div');
  indicator.className = 'section-drop-indicator';
  indicator.style.cssText =
    'position:absolute;top:0;bottom:0;width:3px;background:rgba(59,130,246,0.9);z-index:40;pointer-events:none;border-radius:1px;box-shadow:0 0 6px rgba(59,130,246,0.5);';

  if (target.section) {
    const pct = (target.section.start / editorState.duration) * 100;
    indicator.style.left = pct + '%';
  } else {
    // After all remaining sections — show at the end
    indicator.style.right = '0';
  }
  indicator.style.transform = 'translateX(-1.5px)';
  editorSectionMarkers.appendChild(indicator);
  if (sectionDragState) sectionDragState.dropIndicator = indicator;
}

function removeDropIndicator() {
  if (sectionDragState?.dropIndicator) {
    sectionDragState.dropIndicator.remove();
    sectionDragState.dropIndicator = null;
  }
  editorSectionMarkers.querySelectorAll('.section-drop-indicator').forEach((el) => el.remove());
}

function updateSectionDrag(e) {
  if (!sectionDragState || !editorState) return;
  const dx = Math.abs(e.clientX - sectionDragState.startX);
  if (!sectionDragState.started && dx < SECTION_DRAG_THRESHOLD) return;
  if (!sectionDragState.started) {
    sectionDragState.started = true;
    document.body.style.cursor = 'grabbing';
  }
  e.preventDefault();
  showDropIndicator(computeDropTarget(e.clientX));
}

function finishSectionDrag(e) {
  if (!sectionDragState || !editorState) {
    sectionDragState = null;
    return;
  }
  const wasDrag = sectionDragState.started;
  removeDropIndicator();
  document.body.style.cursor = '';
  if (!wasDrag) {
    seekFromTimeline(e);
    sectionDragState = null;
    return;
  }
  const { insertIndex } = computeDropTarget(e.clientX);
  const dragIds = getDragSelectedIds();
  sectionDragState = null;

  pushUndo();
  const moved =
    dragIds.size > 1
      ? moveSectionsToIndex(editorState.sections, dragIds, insertIndex)
      : moveSectionToIndex(
          editorState.sections,
          editorState.sections.findIndex((s) => dragIds.has(s.id)),
          insertIndex >= editorState.sections.length ? editorState.sections.length - 1 : insertIndex
        );
  if (!moved) {
    undoStack.pop();
    updateUndoRedoButtons();
    return;
  }
  recalculateTimelinePositions();
  syncSectionAnchorKeyframes();
  renderSectionMarkers();
  refreshWaveform();
  // Seek to the start of the first moved section
  const firstMoved = editorState.sections.find((s) => dragIds.has(s.id));
  editorSeek(firstMoved?.start || 0);
  scheduleProjectSave();
}

function applyTimelineZoom(newZoom, pivotClientX) {
  const wrapper = editorTimelineWrapper;
  const oldZoom = timelineZoom;
  newZoom = Math.max(1, Math.min(50, newZoom));
  if (newZoom === oldZoom) return;

  // Compute pivot position as fraction of content
  const rect = wrapper.getBoundingClientRect();
  const pivotX = pivotClientX !== undefined ? pivotClientX : rect.left + rect.width / 2;
  const pivotFraction = (pivotX - rect.left + wrapper.scrollLeft) / (rect.width * oldZoom);

  timelineZoom = newZoom;
  editorTimeline.style.minWidth = newZoom * 100 + '%';

  // Recompute waveform with more detail
  waveformPeaks = computeWaveformPeaksFromCache(Math.round(800 * newZoom));
  renderWaveform();

  // Adjust scroll so the pivot point stays under the cursor
  const newContentWidth = rect.width * newZoom;
  wrapper.scrollLeft = pivotFraction * newContentWidth - (pivotX - rect.left);
}

function scrollTimelineToPlayhead() {
  if (!editorState || editorState.duration <= 0 || timelineZoom <= 1) return;
  const wrapper = editorTimelineWrapper;
  const wrapperWidth = wrapper.clientWidth;
  const contentWidth = wrapperWidth * timelineZoom;
  const playheadX = (editorState.currentTime / editorState.duration) * contentWidth;
  const margin = wrapperWidth * 0.2;
  if (playheadX < wrapper.scrollLeft + margin) {
    wrapper.scrollLeft = playheadX - margin;
  } else if (playheadX > wrapper.scrollLeft + wrapperWidth - margin) {
    wrapper.scrollLeft = playheadX - wrapperWidth + margin;
  }
}

// ===== Screen track drag-and-drop for images =====

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
const editorScreenTrack = document.getElementById('editorScreenTrack');

function isImageFile(fileName) {
  const ext = '.' + fileName.split('.').pop().toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

async function importImageToSection(sourcePath, section) {
  if (!section || !activeProjectPath) return;
  try {
    const copiedPath = await window.electronAPI.importFile(sourcePath, activeProjectPath);
    pushUndo();
    section.imagePath = copiedPath;
    await loadSectionImage(copiedPath);
    renderSectionMarkers();
    scheduleProjectSave();
  } catch (err) {
    console.error('Failed to import image:', err);
  }
}

editorScreenTrack.addEventListener('dragover', (e) => {
  if (!editorState || editorState.rendering) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const bandEl = e.target.closest?.('[data-section-id]');
  // Clear previous highlights and highlight current target
  editorScreenTrack.querySelectorAll('[data-section-id]').forEach((el) => (el.style.outline = ''));
  if (bandEl) bandEl.style.outline = '2px solid rgba(59,130,246,0.6)';
});

editorScreenTrack.addEventListener('dragleave', (e) => {
  // Only clear if leaving the track entirely
  if (!editorScreenTrack.contains(e.relatedTarget)) {
    editorScreenTrack
      .querySelectorAll('[data-section-id]')
      .forEach((el) => (el.style.outline = ''));
  }
});

editorScreenTrack.addEventListener('drop', async (e) => {
  e.preventDefault();
  editorScreenTrack.querySelectorAll('[data-section-id]').forEach((el) => (el.style.outline = ''));

  if (!editorState || editorState.rendering || !activeProjectPath) return;
  const file = e.dataTransfer?.files?.[0];
  if (!file || !file.path || !isImageFile(file.name)) return;

  const bandEl = e.target.closest?.('[data-section-id]');
  const sectionId = bandEl?.dataset?.sectionId;
  const section = sectionId ? editorState.sections.find((s) => s.id === sectionId) : null;
  if (!section) return;

  await importImageToSection(file.path, section);
});

// ===== Image picker button =====
const editorImageBtn = document.getElementById('editorImageBtn');
editorImageBtn.addEventListener('click', async () => {
  if (!editorState || editorState.rendering || !activeProjectPath) return;
  const section = getSelectedSection();
  if (!section) return;

  const filePath = await window.electronAPI.pickImageFile();
  if (!filePath) return;

  await importImageToSection(filePath, section);
});

// ===== Editor button handlers =====

new ResizeObserver(() => renderWaveform()).observe(editorTimelineWrapper);

editorTimelineWrapper.addEventListener(
  'wheel',
  (e) => {
    if (!editorState) return;
    // Pinch-to-zoom (trackpad) sends ctrlKey with deltaY
    // Also support Ctrl+scroll wheel
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = 1 - e.deltaY * 0.01;
      applyTimelineZoom(timelineZoom * factor, e.clientX);
    }
  },
  { passive: false }
);

// Back button removed; user navigates via header tabs
editorUndoBtn.addEventListener('click', editorUndo);
editorRedoBtn.addEventListener('click', editorRedo);
editorPlayBtn.addEventListener('click', editorTogglePlay);
editorSplitBtn.addEventListener('click', splitSectionAtPlayhead);
editorToggleCamBtn.addEventListener('click', toggleCameraVisibility);
editorCamFullBtn.addEventListener('click', toggleCameraFullscreen);
editorApplyFutureBtn.addEventListener('click', applyStyleToFutureSections);
editorBgZoomInput.addEventListener('input', () => {
  if (!editorState || editorState.rendering) return;
  const changed = setSelectedSectionBackgroundZoom(editorBgZoomInput.value, {
    pushHistory: !sectionZoomDragActive
  });
  if (changed) sectionZoomDragActive = true;
});
editorBgZoomInput.addEventListener('change', commitSectionZoomChange);
editorBgZoomInput.addEventListener('pointerup', commitSectionZoomChange);
editorBgZoomInput.addEventListener('blur', commitSectionZoomChange);
updateSectionZoomControls();

// ===== Render pipeline =====

editorRenderBtn.addEventListener('click', async () => {
  if (!editorState || editorState.rendering) return;
  await renderVideo();
});

function setRenderBtnState(text, style = 'idle') {
  clearTimeout(editorRenderTimeout);
  editorRenderBtn.textContent = text;
  if (style === 'busy') {
    editorRenderBtn.className =
      'px-4 py-1.5 bg-neutral-700 text-neutral-300 rounded-lg text-sm font-medium transition-colors min-w-[80px] text-center cursor-wait';
  } else if (style === 'done') {
    editorRenderBtn.className =
      'px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors min-w-[80px] text-center';
  } else if (style === 'error') {
    editorRenderBtn.className =
      'px-4 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium transition-colors min-w-[80px] text-center';
  } else {
    editorRenderBtn.className =
      'px-4 py-1.5 bg-white text-neutral-950 hover:bg-neutral-200 rounded-lg text-sm font-medium transition-colors min-w-[80px] text-center';
  }
}

async function renderVideo() {
  commitSectionZoomChange();
  editorState.rendering = true;
  editorState.renderProgress = 0;
  setRenderBtnState('Rendering...', 'busy');
  processingTitle.textContent = 'Rendering export...';
  processingStatus.textContent = 'Preparing render...';
  setProcessingProgress(0);
  editorPause();

  // Disable controls
  editorUndoBtn.disabled = true;
  editorRedoBtn.disabled = true;
  editorPlayBtn.disabled = true;
  editorSplitBtn.disabled = true;
  editorToggleCamBtn.disabled = true;
  editorCamFullBtn.disabled = true;
  editorRenderBtn.disabled = true;
  updateSectionZoomControls();

  try {
    const renderKeyframes = getRenderKeyframes();
    const renderSections = getRenderSections();

    // Collect takes referenced by sections
    const referencedTakeIds = new Set(editorState.sections.map((s) => s.takeId).filter(Boolean));
    const takes = [];
    for (const takeId of referencedTakeIds) {
      const take = activeProject?.takes?.find((t) => t.id === takeId);
      if (take) {
        takes.push({ id: take.id, screenPath: take.screenPath, cameraPath: take.cameraPath });
      }
    }

    const mp4Path = await window.electronAPI.renderComposite({
      takes,
      sections: renderSections,
      keyframes: renderKeyframes,
      pipSize: editorState.pipSize,
      screenFitMode: editorState.screenFitMode,
      exportAudioPreset: normalizeExportAudioPreset(exportAudioPresetSelect.value),
      exportVideoPreset: normalizeExportVideoPreset(exportVideoPresetSelect.value),
      cameraSyncOffsetMs: editorState.cameraSyncOffsetMs,
      sourceWidth: editorState.sourceWidth || CANVAS_W,
      sourceHeight: editorState.sourceHeight || CANVAS_H,
      outputFolder: saveFolder
    });

    editorState.rendering = false;
    editorState.renderProgress = 1;
    setProcessingProgress(1);
    setRenderBtnState('Done!', 'done');
    console.log('Rendered:', mp4Path);
    await persistProjectNow();
  } catch (err) {
    editorState.rendering = false;
    editorState.renderProgress = 0;
    setProcessingProgress(null);
    console.error('Render error:', err);
    setRenderBtnState('Failed', 'error');
  }

  // Re-enable controls
  updateUndoRedoButtons();
  editorPlayBtn.disabled = false;
  editorSplitBtn.disabled = false;
  editorToggleCamBtn.disabled = false;
  editorCamFullBtn.disabled = false;
  editorRenderBtn.disabled = false;
  updateSectionZoomControls();

  editorRenderTimeout = setTimeout(() => setRenderBtnState('Render', 'idle'), 3000);
  editorSeek(0);
}

// ===== Segment selection =====

transcriptContent.addEventListener('click', (e) => {
  if (!e.target.closest('[data-segment-index]')) selectSegment(-1);
});

let selectedSegmentIndex = -1;
const recordingUndoStack = [];

function selectSegment(index) {
  // Deselect previous
  if (selectedSegmentIndex >= 0) {
    const prev = transcriptContent.querySelector(`[data-segment-index="${selectedSegmentIndex}"]`);
    if (prev) prev.style.outline = '';
  }
  selectedSegmentIndex = index;
  if (index >= 0) {
    const el = transcriptContent.querySelector(`[data-segment-index="${index}"]`);
    if (el) el.style.outline = '2px solid rgba(255, 255, 255, 0.3)';
  }
}

function applySegmentDeletedStyle(el, deleted) {
  el.style.textDecoration = deleted ? 'line-through' : '';
  el.style.opacity = deleted ? '0.4' : '';
}

// ===== Keyboard shortcuts =====

function updateSegmentBadge() {
  const total = speechSegments.length;
  const removed = speechSegments.filter((s) => s.deleted).length;
  const active = total - removed;
  if (removed > 0) {
    segmentBadge.textContent = `${active} segment${active !== 1 ? 's' : ''} (${removed} removed)`;
  } else {
    segmentBadge.textContent = `${total} segment${total !== 1 ? 's' : ''}`;
  }
}

document.addEventListener('keydown', (e) => {
  // Backspace during recording: toggle delete on selected segment, or remove last non-deleted
  if (recording && e.code === 'Backspace') {
    e.preventDefault();
    if (selectedSegmentIndex >= 0 && selectedSegmentIndex < speechSegments.length) {
      // Toggle delete on selected segment
      const seg = speechSegments[selectedSegmentIndex];
      recordingUndoStack.push({ segmentIndex: selectedSegmentIndex, wasDeleted: seg.deleted });
      seg.deleted = !seg.deleted;
      const el = transcriptContent.querySelector(`[data-segment-index="${selectedSegmentIndex}"]`);
      if (el) applySegmentDeletedStyle(el, seg.deleted);
      updateSegmentBadge();
    } else {
      // No selection: delete last non-deleted segment
      for (let i = speechSegments.length - 1; i >= 0; i--) {
        if (!speechSegments[i].deleted) {
          recordingUndoStack.push({ segmentIndex: i, wasDeleted: false });
          speechSegments[i].deleted = true;
          const el = transcriptContent.querySelector(`[data-segment-index="${i}"]`);
          if (el) applySegmentDeletedStyle(el, true);
          updateSegmentBadge();
          break;
        }
      }
    }
    return;
  }

  // Ctrl+Z during recording: undo last delete/undelete action
  if (recording && e.code === 'KeyZ' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
    e.preventDefault();
    const action = recordingUndoStack.pop();
    if (action) {
      speechSegments[action.segmentIndex].deleted = action.wasDeleted;
      const el = transcriptContent.querySelector(`[data-segment-index="${action.segmentIndex}"]`);
      if (el) applySegmentDeletedStyle(el, action.wasDeleted);
      updateSegmentBadge();
    }
    return;
  }

  // Escape during recording: deselect segment
  if (recording && e.code === 'Escape') {
    selectSegment(-1);
    return;
  }

  if (!editorState || editorState.rendering || activeWorkspaceView !== 'timeline') return;
  // Don't capture if focus is in an input
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;

  if (e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    if (e.shiftKey) {
      editorRedo();
    } else {
      editorUndo();
    }
    return;
  }

  if (e.code === 'Space') {
    e.preventDefault();
    editorTogglePlay();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    editorSeek(editorState.currentTime - 1 / 30);
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    editorSeek(editorState.currentTime + 1 / 30);
  } else if (e.code === 'Backspace' || e.code === 'Delete') {
    e.preventDefault();
    deleteSelectedSection();
  } else if (e.code === 'KeyS') {
    e.preventDefault();
    splitSectionAtPlayhead();
  } else if (e.code === 'KeyC') {
    e.preventDefault();
    toggleCameraVisibility();
  } else if (e.code === 'KeyF') {
    e.preventDefault();
    toggleCameraFullscreen();
  } else if (e.code === 'KeyL') {
    e.preventDefault();
    cyclePlaybackSpeed();
  } else if (e.code === 'KeyI') {
    e.preventDefault();
    editorImageBtn.click();
  }
});

// Settings
// Settings panel is always visible in the left sidebar

openFolderBtn.addEventListener('click', () => {
  if (activeProjectPath) window.electronAPI.openFolder(activeProjectPath);
});

activeProjectPathEl.addEventListener('click', () => {
  if (activeProjectPath) window.electronAPI.openFolder(activeProjectPath);
});

pickFolderBtn.addEventListener('click', () => {
  setWorkspaceView('home');
});

contentProtectionToggle.addEventListener('change', async () => {
  hideFromRecording = contentProtectionToggle.checked ? 'true' : 'false';
  await syncContentProtection();
  scheduleProjectSave();
});

exportAudioPresetSelect.addEventListener('change', () => {
  exportAudioPresetSelect.value = normalizeExportAudioPreset(exportAudioPresetSelect.value);
  if (activeProject?.settings) {
    activeProject.settings.exportAudioPreset = exportAudioPresetSelect.value;
  }
  scheduleProjectSave();
});

exportVideoPresetSelect.addEventListener('change', () => {
  exportVideoPresetSelect.value = normalizeExportVideoPreset(exportVideoPresetSelect.value);
  if (activeProject?.settings) {
    activeProject.settings.exportVideoPreset = exportVideoPresetSelect.value;
  }
  scheduleProjectSave();
});

cameraSyncOffsetInput.addEventListener('change', () => {
  const normalized = normalizeCameraSyncOffsetMs(cameraSyncOffsetInput.value);
  cameraSyncOffsetInput.value = String(normalized);
  if (activeProject?.settings) {
    activeProject.settings.cameraSyncOffsetMs = normalized;
  }
  if (editorState) {
    editorState.cameraSyncOffsetMs = normalized;
    editorSeek(editorState.currentTime);
  }
  scheduleProjectSave();
});

// Source change handlers
screenFitSelect.addEventListener('change', () => {
  if (editorState) editorState.screenFitMode = screenFitSelect.value;
  updatePreview();
  scheduleProjectSave();
});

screenSelect.addEventListener('change', async () => {
  try {
    await updateScreenStream();
  } catch (e) {
    console.error(e);
  }
  updatePreview();
});

cameraSelect.addEventListener('change', async () => {
  try {
    await updateCameraStream();
  } catch (e) {
    console.error(e);
  }
  updatePreview();
});

audioSelect.addEventListener('change', async () => {
  try {
    await updateAudioStream();
  } catch (e) {
    console.error(e);
  }
});

recordBtn.addEventListener('click', toggleRecording);

// Workspace navigation
goRecordingBtn.addEventListener('click', () => {
  if (!activeProjectPath) return;
  setWorkspaceView('recording');
});

goTimelineBtn.addEventListener('click', () => {
  if (!activeProjectPath || !editorState) return;
  setWorkspaceView('timeline');
});

switchProjectBtn.addEventListener('click', async () => {
  if (recording) return;
  await flushScheduledProjectSave();
  setWorkspaceView('home');
  await refreshRecentProjects();
});

// Project home actions
async function openProjectByPath(projectPath, preferredView = 'timeline') {
  if (!projectPath) return;
  clearProjectHomeMessage();
  try {
    const opened = await window.electronAPI.projectOpen(projectPath);
    if (!opened?.projectPath || !opened?.project) return;
    await activateProject(opened.projectPath, opened.project, preferredView);
    if (opened?.recoveryTake) {
      await recoverPendingTake(opened.recoveryTake);
    }
    await refreshRecentProjects();
  } catch (error) {
    console.error('Failed to open project:', error);
    showProjectHomeMessage(error?.message || 'Failed to open project folder.');
  }
}

projectHomeView.addEventListener(
  'click',
  (event) => {
    const target = event.target?.id || event.target?.tagName || 'unknown';
    console.log('project-home-click', target);
  },
  true
);

createProjectBtn.addEventListener('click', async () => {
  const name = (newProjectNameInput.value || '').trim() || 'Untitled Project';
  showProjectHomeMessage('Opening folder picker...', 'info');
  try {
    const projectPath = await window.electronAPI.pickProjectLocation({ name });
    if (!projectPath) return;
    const created = await window.electronAPI.projectCreate({ projectPath, name });
    if (!created?.projectPath || !created?.project) return;
    newProjectNameInput.value = '';
    clearProjectHomeMessage();
    await activateProject(created.projectPath, created.project, 'recording');
    await refreshRecentProjects();
  } catch (error) {
    console.error('Failed to create project:', error);
    showProjectHomeMessage(error?.message || 'Failed to create project.');
  }
});

openProjectBtn.addEventListener('click', async () => {
  showProjectHomeMessage('Opening folder picker...', 'info');
  try {
    const folder = await window.electronAPI.pickFolder({
      title: 'Open Project Folder',
      buttonLabel: 'Open Project'
    });
    if (!folder) return;
    await openProjectByPath(folder, 'timeline');
  } catch (error) {
    console.error('Failed to choose project folder:', error);
    showProjectHomeMessage(error?.message || 'Failed to choose project folder.');
  }
});

resumeLastBtn.addEventListener('click', async () => {
  const projectPath = resumeLastBtn.dataset.projectPath;
  if (!projectPath) return;
  await openProjectByPath(projectPath, 'timeline');
});

recentProjectsList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-project-path]');
  if (!button) return;
  await openProjectByPath(button.dataset.projectPath, 'timeline');
});

newProjectNameInput.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  createProjectBtn.click();
});

// Init
setWorkspaceView('home');
syncContentProtection();
updateWorkspaceHeader();
refreshRecentProjects();

window.addEventListener('beforeunload', () => {
  clearMediaIdleTimer();
  if (!recording && !hasActiveRecorders()) {
    cleanupRendererMediaResources();
  }
  flushScheduledProjectSave().catch((error) => {
    console.warn('Failed to flush project save on exit:', error);
  });
});
