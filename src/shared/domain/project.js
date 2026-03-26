const path = require('path');

const MIN_BACKGROUND_ZOOM = 1;
const MIN_REEL_BACKGROUND_ZOOM = 0.5;
const MAX_BACKGROUND_ZOOM = 3;
const MIN_BACKGROUND_PAN = -1;
const MAX_BACKGROUND_PAN = 1;
const MIN_CAMERA_SYNC_OFFSET_MS = -2000;
const MAX_CAMERA_SYNC_OFFSET_MS = 2000;
const EXPORT_AUDIO_PRESET_OFF = 'off';
const EXPORT_AUDIO_PRESET_COMPRESSED = 'compressed';
const OUTPUT_MODE_LANDSCAPE = 'landscape';
const OUTPUT_MODE_REEL = 'reel';
const MIN_REEL_CROP_X = -1;
const MAX_REEL_CROP_X = 1;
const MIN_PIP_SCALE = 0.15;
const MAX_PIP_SCALE = 0.50;
const DEFAULT_PIP_SCALE = 0.22;
const VALID_PIP_SNAP_POINTS = ['tl', 'tc', 'tr', 'ml', 'center', 'mr', 'bl', 'bc', 'br'];
const DEFAULT_PIP_SNAP_POINT = 'br';
const VALID_OVERLAY_MEDIA_TYPES = ['image', 'video'];
const OVERLAY_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const OVERLAY_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];
const DEFAULT_OVERLAY_POSITION = { x: 0, y: 0, width: 400, height: 300 };
const MAX_OVERLAY_TRACKS = 2;

let overlayIdCounter = 0;

function createProjectId() {
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateOverlayId() {
  overlayIdCounter += 1;
  return `overlay-${Date.now()}-${overlayIdCounter}`;
}

function sanitizeProjectName(name) {
  const fallback = 'Untitled Project';
  if (typeof name !== 'string') return fallback;

  const stripped = name
    .trim()
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  const cleaned = Array.from(stripped)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
  return cleaned || fallback;
}

function toProjectAbsolutePath(projectFolder, value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return path.isAbsolute(value) ? value : path.join(projectFolder, value);
}

function toProjectRelativePath(projectFolder, value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (!path.isAbsolute(value)) return value;

  const relative = path.relative(projectFolder, value);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return value;
  return relative;
}

function normalizeSections(rawSections = []) {
  if (!Array.isArray(rawSections)) return [];
  return rawSections
    .map((section, index) => {
      const start = Number(section.start);
      const end = Number(section.end);
      const sourceStart = Number.isFinite(Number(section.sourceStart))
        ? Number(section.sourceStart)
        : start;
      const sourceEnd = Number.isFinite(Number(section.sourceEnd))
        ? Number(section.sourceEnd)
        : end;
      const transcript = String(
        typeof section.transcript === 'string'
          ? section.transcript
          : typeof section.text === 'string'
            ? section.text
            : ''
      )
        .replace(/\s+/g, ' ')
        .trim();

      return {
        id: typeof section.id === 'string' && section.id ? section.id : `section-${index + 1}`,
        index: Number.isFinite(Number(section.index)) ? Number(section.index) : index,
        label: typeof section.label === 'string' ? section.label : `Section ${index + 1}`,
        start: Number.isFinite(start) ? start : 0,
        end: Number.isFinite(end) ? end : 0,
        duration: Number.isFinite(Number(section.duration))
          ? Number(section.duration)
          : Math.max(0, (Number.isFinite(end) ? end : 0) - (Number.isFinite(start) ? start : 0)),
        sourceStart: Number.isFinite(sourceStart) ? sourceStart : 0,
        sourceEnd: Number.isFinite(sourceEnd) ? sourceEnd : 0,
        takeId: typeof section.takeId === 'string' && section.takeId ? section.takeId : null,
        transcript,
        saved: !!section.saved
      };
    })
    .filter((section) => section.end - section.start > 0.0001)
    .sort((a, b) => a.start - b.start);
}

function normalizeSavedSections(rawSavedSections = []) {
  if (!Array.isArray(rawSavedSections)) return [];
  return normalizeSections(rawSavedSections).map(section => ({
    ...section,
    saved: true
  }));
}

function normalizeBackgroundZoom(value, outputMode) {
  const minZoom = outputMode === OUTPUT_MODE_REEL ? MIN_REEL_BACKGROUND_ZOOM : MIN_BACKGROUND_ZOOM;
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return minZoom;
  return Math.max(minZoom, Math.min(MAX_BACKGROUND_ZOOM, zoom));
}

function normalizeBackgroundPan(value) {
  const pan = Number(value);
  if (!Number.isFinite(pan)) return 0;
  return Math.max(MIN_BACKGROUND_PAN, Math.min(MAX_BACKGROUND_PAN, pan));
}

function normalizeKeyframes(rawKeyframes = []) {
  if (!Array.isArray(rawKeyframes)) return [];
  return rawKeyframes
    .map((keyframe) => ({
      time: Number.isFinite(Number(keyframe.time)) ? Number(keyframe.time) : 0,
      pipX: Number.isFinite(Number(keyframe.pipX)) ? Number(keyframe.pipX) : 0,
      pipY: Number.isFinite(Number(keyframe.pipY)) ? Number(keyframe.pipY) : 0,
      pipVisible: keyframe.pipVisible !== false,
      cameraFullscreen: !!keyframe.cameraFullscreen,
      backgroundZoom: normalizeBackgroundZoom(keyframe.backgroundZoom, OUTPUT_MODE_REEL),
      backgroundPanX: normalizeBackgroundPan(keyframe.backgroundPanX),
      backgroundPanY: normalizeBackgroundPan(keyframe.backgroundPanY),
      reelCropX: normalizeReelCropX(keyframe.reelCropX),
      pipScale: normalizePipScale(keyframe.pipScale),
      pipSnapPoint: normalizePipSnapPoint(keyframe.pipSnapPoint),
      autoTrack: !!keyframe.autoTrack,
      autoTrackSmoothing: Number.isFinite(Number(keyframe.autoTrackSmoothing))
        ? Math.max(0.01, Math.min(1.0, Number(keyframe.autoTrackSmoothing)))
        : 0.15,
      sectionId: typeof keyframe.sectionId === 'string' ? keyframe.sectionId : null,
      autoSection: !!keyframe.autoSection,
      savedLandscape: keyframe.savedLandscape && typeof keyframe.savedLandscape === 'object'
        ? { ...keyframe.savedLandscape }
        : null,
      savedReel: keyframe.savedReel && typeof keyframe.savedReel === 'object'
        ? { ...keyframe.savedReel }
        : null
    }))
    .sort((a, b) => a.time - b.time);
}

function normalizeExportAudioPreset(value) {
  return value === EXPORT_AUDIO_PRESET_OFF
    ? EXPORT_AUDIO_PRESET_OFF
    : EXPORT_AUDIO_PRESET_COMPRESSED;
}

function normalizeCameraSyncOffsetMs(value) {
  const offset = Math.round(Number(value));
  if (!Number.isFinite(offset)) return 0;
  return Math.max(MIN_CAMERA_SYNC_OFFSET_MS, Math.min(MAX_CAMERA_SYNC_OFFSET_MS, offset));
}

function normalizePipSnapPoint(value) {
  return VALID_PIP_SNAP_POINTS.includes(value) ? value : DEFAULT_PIP_SNAP_POINT;
}

function normalizeOverlayPosition(pos) {
  if (!pos || typeof pos !== 'object') return { ...DEFAULT_OVERLAY_POSITION };
  return {
    x: Number.isFinite(Number(pos.x)) ? Number(pos.x) : 0,
    y: Number.isFinite(Number(pos.y)) ? Number(pos.y) : 0,
    width: Number.isFinite(Number(pos.width)) && Number(pos.width) > 0 ? Number(pos.width) : DEFAULT_OVERLAY_POSITION.width,
    height: Number.isFinite(Number(pos.height)) && Number(pos.height) > 0 ? Number(pos.height) : DEFAULT_OVERLAY_POSITION.height
  };
}

function normalizeOverlays(rawOverlays) {
  if (!Array.isArray(rawOverlays)) return [];
  const valid = rawOverlays
    .filter((overlay) => {
      if (!overlay || typeof overlay !== 'object') return false;
      if (typeof overlay.id !== 'string' || !overlay.id) return false;
      if (typeof overlay.mediaPath !== 'string' || !overlay.mediaPath) return false;
      if (!VALID_OVERLAY_MEDIA_TYPES.includes(overlay.mediaType)) return false;
      const start = Number(overlay.startTime);
      const end = Number(overlay.endTime);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      if (end <= start) return false;
      return true;
    })
    .map((overlay) => {
      const startTime = Math.max(0, Number(overlay.startTime));
      const endTime = Math.max(startTime + 0.001, Number(overlay.endTime));
      const duration = endTime - startTime;
      const isVideo = overlay.mediaType === 'video';
      let sourceStart = isVideo && Number.isFinite(Number(overlay.sourceStart)) ? Math.max(0, Number(overlay.sourceStart)) : 0;
      let sourceEnd = isVideo && Number.isFinite(Number(overlay.sourceEnd)) && Number(overlay.sourceEnd) > sourceStart
        ? Number(overlay.sourceEnd)
        : sourceStart + duration;
      if (!isVideo) {
        sourceStart = 0;
        sourceEnd = duration;
      }
      const rawTrack = Number(overlay.trackIndex);
      const trackIndex = Number.isFinite(rawTrack) && rawTrack >= 0
        ? Math.min(Math.floor(rawTrack), MAX_OVERLAY_TRACKS - 1)
        : 0;
      return {
        id: overlay.id,
        trackIndex,
        mediaPath: overlay.mediaPath,
        mediaType: overlay.mediaType,
        startTime,
        endTime,
        sourceStart,
        sourceEnd,
        landscape: normalizeOverlayPosition(overlay.landscape),
        reel: normalizeOverlayPosition(overlay.reel),
        saved: !!overlay.saved
      };
    });

  // Group by trackIndex, enforce no-overlap within each track
  const tracks = {};
  for (const o of valid) {
    if (!tracks[o.trackIndex]) tracks[o.trackIndex] = [];
    tracks[o.trackIndex].push(o);
  }
  const result = [];
  for (const trackIdx of Object.keys(tracks).sort((a, b) => Number(a) - Number(b))) {
    const group = tracks[trackIdx].sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < group.length; i += 1) {
      const prev = group[i - 1];
      if (group[i].startTime < prev.endTime) {
        const shift = prev.endTime - group[i].startTime;
        group[i].startTime = prev.endTime;
        if (group[i].mediaType === 'video') {
          group[i].sourceStart += shift;
        }
      }
      if (group[i].endTime <= group[i].startTime) {
        group.splice(i, 1);
        i -= 1;
      }
    }
    result.push(...group);
  }

  return result;
}

function normalizeReelCropX(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  return Math.max(MIN_REEL_CROP_X, Math.min(MAX_REEL_CROP_X, v));
}

function normalizeOutputMode(value) {
  return value === OUTPUT_MODE_REEL ? OUTPUT_MODE_REEL : OUTPUT_MODE_LANDSCAPE;
}

function normalizePipScale(value) {
  if (value === null || value === undefined) return DEFAULT_PIP_SCALE;
  const v = Number(value);
  if (!Number.isFinite(v)) return DEFAULT_PIP_SCALE;
  return Math.max(MIN_PIP_SCALE, Math.min(MAX_PIP_SCALE, v));
}

function createDefaultProject(name = 'Untitled Project') {
  const now = new Date().toISOString();
  return {
    id: createProjectId(),
    name: sanitizeProjectName(name),
    createdAt: now,
    updatedAt: now,
    settings: {
      screenFitMode: 'fill',
      hideFromRecording: true,
      exportAudioPreset: EXPORT_AUDIO_PRESET_COMPRESSED,
      cameraSyncOffsetMs: 0,
      outputMode: OUTPUT_MODE_LANDSCAPE,
      pipScale: DEFAULT_PIP_SCALE
    },
    takes: [],
    timeline: {
      duration: 0,
      sections: [],
      keyframes: [],
      selectedSectionId: null,
      hasCamera: false,
      sourceWidth: null,
      sourceHeight: null,
      overlays: [],
      savedOverlays: []
    }
  };
}

function normalizeProjectData(rawProject, projectFolder) {
  const base = createDefaultProject(rawProject?.name);
  const project = rawProject && typeof rawProject === 'object' ? rawProject : {};
  const rawSettings = project.settings && typeof project.settings === 'object' ? project.settings : {};
  const rawTimeline = project.timeline && typeof project.timeline === 'object' ? project.timeline : {};
  const rawTakes = Array.isArray(project.takes) ? project.takes : [];
  const now = new Date().toISOString();

  return {
    id: typeof project.id === 'string' && project.id ? project.id : base.id,
    name:
      typeof project.name === 'string' && project.name.trim()
        ? sanitizeProjectName(project.name)
        : base.name,
    createdAt: typeof project.createdAt === 'string' ? project.createdAt : now,
    updatedAt: typeof project.updatedAt === 'string' ? project.updatedAt : now,
    settings: {
      screenFitMode: rawSettings.screenFitMode === 'fit' ? 'fit' : 'fill',
      hideFromRecording: rawSettings.hideFromRecording !== false,
      exportAudioPreset: normalizeExportAudioPreset(rawSettings.exportAudioPreset),
      cameraSyncOffsetMs: normalizeCameraSyncOffsetMs(rawSettings.cameraSyncOffsetMs),
      outputMode: normalizeOutputMode(rawSettings.outputMode),
      pipScale: normalizePipScale(rawSettings.pipScale)
    },
    takes: rawTakes.map((take, index) => ({
      id: typeof take?.id === 'string' && take.id ? take.id : `take-${index + 1}-${Date.now()}`,
      createdAt: typeof take?.createdAt === 'string' ? take.createdAt : now,
      duration: Number.isFinite(Number(take?.duration)) ? Number(take.duration) : 0,
      screenPath: projectFolder
        ? toProjectAbsolutePath(projectFolder, take?.screenPath)
        : take?.screenPath || null,
      cameraPath: projectFolder
        ? toProjectAbsolutePath(projectFolder, take?.cameraPath)
        : take?.cameraPath || null,
      mousePath: projectFolder
        ? toProjectAbsolutePath(projectFolder, take?.mousePath)
        : take?.mousePath || null,
      proxyPath: projectFolder
        ? toProjectAbsolutePath(projectFolder, take?.proxyPath)
        : take?.proxyPath || null,
      sections: normalizeSections(take?.sections)
    })),
    timeline: {
      duration: Number.isFinite(Number(rawTimeline.duration)) ? Number(rawTimeline.duration) : 0,
      sections: normalizeSections(rawTimeline.sections),
      savedSections: normalizeSavedSections(rawTimeline.savedSections),
      keyframes: normalizeKeyframes(rawTimeline.keyframes),
      selectedSectionId:
        typeof rawTimeline.selectedSectionId === 'string' ? rawTimeline.selectedSectionId : null,
      hasCamera: !!rawTimeline.hasCamera,
      sourceWidth: Number.isFinite(Number(rawTimeline.sourceWidth))
        ? Number(rawTimeline.sourceWidth)
        : null,
      sourceHeight: Number.isFinite(Number(rawTimeline.sourceHeight))
        ? Number(rawTimeline.sourceHeight)
        : null,
      overlays: normalizeOverlays(rawTimeline.overlays),
      savedOverlays: normalizeOverlays(rawTimeline.savedOverlays)
    }
  };
}

module.exports = {
  createProjectId,
  sanitizeProjectName,
  toProjectAbsolutePath,
  toProjectRelativePath,
  normalizeSections,
  normalizeSavedSections,
  normalizeBackgroundZoom,
  normalizeBackgroundPan,
  normalizeKeyframes,
  normalizeExportAudioPreset,
  normalizeCameraSyncOffsetMs,
  normalizeReelCropX,
  normalizeOutputMode,
  normalizePipScale,
  createDefaultProject,
  normalizeProjectData,
  MIN_CAMERA_SYNC_OFFSET_MS,
  MAX_CAMERA_SYNC_OFFSET_MS,
  EXPORT_AUDIO_PRESET_OFF,
  EXPORT_AUDIO_PRESET_COMPRESSED,
  OUTPUT_MODE_LANDSCAPE,
  OUTPUT_MODE_REEL,
  MIN_REEL_CROP_X,
  MAX_REEL_CROP_X,
  MIN_PIP_SCALE,
  MAX_PIP_SCALE,
  DEFAULT_PIP_SCALE,
  MIN_REEL_BACKGROUND_ZOOM,
  VALID_PIP_SNAP_POINTS,
  DEFAULT_PIP_SNAP_POINT,
  normalizePipSnapPoint,
  generateOverlayId,
  normalizeOverlayPosition,
  normalizeOverlays,
  VALID_OVERLAY_MEDIA_TYPES,
  OVERLAY_IMAGE_EXTENSIONS,
  OVERLAY_VIDEO_EXTENSIONS,
  DEFAULT_OVERLAY_POSITION,
  MAX_OVERLAY_TRACKS
};
