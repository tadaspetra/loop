import path from 'node:path';

export const MIN_BACKGROUND_ZOOM = 1;
export const MAX_BACKGROUND_ZOOM = 3;
export const MIN_BACKGROUND_PAN = -1;
export const MAX_BACKGROUND_PAN = 1;
export const MIN_CAMERA_SYNC_OFFSET_MS = -2000;
export const MAX_CAMERA_SYNC_OFFSET_MS = 2000;
export const EXPORT_AUDIO_PRESET_OFF = 'off';
export const EXPORT_AUDIO_PRESET_COMPRESSED = 'compressed';

export type ScreenFitMode = 'fill' | 'fit';
export type ExportAudioPreset =
  | typeof EXPORT_AUDIO_PRESET_OFF
  | typeof EXPORT_AUDIO_PRESET_COMPRESSED;

export interface Section {
  id: string;
  index: number;
  label: string;
  start: number;
  end: number;
  duration: number;
  sourceStart: number;
  sourceEnd: number;
  takeId: string | null;
  transcript: string;
  imagePath: string | null;
}

export interface Keyframe {
  time: number;
  pipX: number;
  pipY: number;
  pipVisible: boolean;
  cameraFullscreen: boolean;
  backgroundZoom: number;
  backgroundPanX: number;
  backgroundPanY: number;
  sectionId: string | null;
  autoSection: boolean;
}

export interface ProjectSettings {
  screenFitMode: ScreenFitMode;
  hideFromRecording: boolean;
  exportAudioPreset: ExportAudioPreset;
  cameraSyncOffsetMs: number;
}

export interface Take {
  id: string;
  createdAt: string;
  duration: number;
  screenPath: string | null;
  cameraPath: string | null;
  sections: Section[];
}

export interface Timeline {
  duration: number;
  sections: Section[];
  keyframes: Keyframe[];
  selectedSectionId: string | null;
  hasCamera: boolean;
  sourceWidth: number | null;
  sourceHeight: number | null;
}

export interface ProjectData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  takes: Take[];
  timeline: Timeline;
}

export interface RecoveryTrimSegment {
  start: number;
  end: number;
  text: string;
}

export interface RecoveryTake {
  id: string;
  createdAt: string;
  screenPath: string;
  cameraPath: string | null;
  recordedDuration: number;
  sections: Section[];
  trimSegments: RecoveryTrimSegment[];
}

type UnknownRecord = Record<string, unknown>;
type PartialSectionInput = Partial<Section> & { text?: unknown };
type PartialKeyframeInput = Partial<Keyframe>;
type PartialTakeInput = Partial<Take> & { sections?: unknown };
type PartialSettingsInput = Partial<ProjectSettings>;
type PartialTimelineInput = Partial<Timeline>;
type PartialProjectInput = Partial<ProjectData> & {
  settings?: PartialSettingsInput;
  timeline?: PartialTimelineInput;
  takes?: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

export function createProjectId(): string {
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeProjectName(name: unknown): string {
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

export function toProjectAbsolutePath(
  projectFolder: string,
  value: unknown,
): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return path.isAbsolute(value) ? value : path.join(projectFolder, value);
}

export function toProjectRelativePath(
  projectFolder: string,
  value: unknown,
): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (!path.isAbsolute(value)) return value;

  const relative = path.relative(projectFolder, value);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return value;
  }

  return relative;
}

export function normalizeSections(rawSections: unknown = []): Section[] {
  if (!Array.isArray(rawSections)) return [];
  return rawSections
    .map((rawSection, index) => {
      const section = isRecord(rawSection)
        ? (rawSection as PartialSectionInput)
        : ({} as PartialSectionInput);
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
            : '',
      )
        .replace(/\s+/g, ' ')
        .trim();

      return {
        id:
          typeof section.id === 'string' && section.id
            ? section.id
            : `section-${index + 1}`,
        index: Number.isFinite(Number(section.index))
          ? Number(section.index)
          : index,
        label:
          typeof section.label === 'string'
            ? section.label
            : `Section ${index + 1}`,
        start: Number.isFinite(start) ? start : 0,
        end: Number.isFinite(end) ? end : 0,
        duration: Number.isFinite(Number(section.duration))
          ? Number(section.duration)
          : Math.max(
              0,
              (Number.isFinite(end) ? end : 0) -
                (Number.isFinite(start) ? start : 0),
            ),
        sourceStart: Number.isFinite(sourceStart) ? sourceStart : 0,
        sourceEnd: Number.isFinite(sourceEnd) ? sourceEnd : 0,
        takeId:
          typeof section.takeId === 'string' && section.takeId
            ? section.takeId
            : null,
        transcript,
        imagePath:
          typeof section.imagePath === 'string' && section.imagePath
            ? section.imagePath
            : null,
      };
    })
    .filter((section) => section.end - section.start > 0.0001)
    .sort((left, right) => left.start - right.start);
}

export function normalizeBackgroundZoom(value: unknown): number {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return MIN_BACKGROUND_ZOOM;
  return Math.max(MIN_BACKGROUND_ZOOM, Math.min(MAX_BACKGROUND_ZOOM, zoom));
}

export function normalizeBackgroundPan(value: unknown): number {
  const pan = Number(value);
  if (!Number.isFinite(pan)) return 0;
  return Math.max(MIN_BACKGROUND_PAN, Math.min(MAX_BACKGROUND_PAN, pan));
}

export function normalizeKeyframes(rawKeyframes: unknown = []): Keyframe[] {
  if (!Array.isArray(rawKeyframes)) return [];
  return rawKeyframes
    .map((rawKeyframe) => {
      const keyframe = isRecord(rawKeyframe)
        ? (rawKeyframe as PartialKeyframeInput)
        : ({} as PartialKeyframeInput);

      return {
        time: Number.isFinite(Number(keyframe.time)) ? Number(keyframe.time) : 0,
        pipX: Number.isFinite(Number(keyframe.pipX))
          ? Number(keyframe.pipX)
          : 0,
        pipY: Number.isFinite(Number(keyframe.pipY))
          ? Number(keyframe.pipY)
          : 0,
        pipVisible: keyframe.pipVisible !== false,
        cameraFullscreen: Boolean(keyframe.cameraFullscreen),
        backgroundZoom: normalizeBackgroundZoom(keyframe.backgroundZoom),
        backgroundPanX: normalizeBackgroundPan(keyframe.backgroundPanX),
        backgroundPanY: normalizeBackgroundPan(keyframe.backgroundPanY),
        sectionId:
          typeof keyframe.sectionId === 'string' ? keyframe.sectionId : null,
        autoSection: Boolean(keyframe.autoSection),
      };
    })
    .sort((left, right) => left.time - right.time);
}

export function normalizeExportAudioPreset(value: unknown): ExportAudioPreset {
  return value === EXPORT_AUDIO_PRESET_OFF
    ? EXPORT_AUDIO_PRESET_OFF
    : EXPORT_AUDIO_PRESET_COMPRESSED;
}

export function normalizeCameraSyncOffsetMs(value: unknown): number {
  const offset = Math.round(Number(value));
  if (!Number.isFinite(offset)) return 0;
  return Math.max(
    MIN_CAMERA_SYNC_OFFSET_MS,
    Math.min(MAX_CAMERA_SYNC_OFFSET_MS, offset),
  );
}

export function createDefaultProject(name: unknown = 'Untitled Project'): ProjectData {
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
    },
  };
}

export function normalizeProjectData(
  rawProject: unknown,
  projectFolder?: string,
): ProjectData {
  const project = isRecord(rawProject)
    ? (rawProject as PartialProjectInput)
    : ({} as PartialProjectInput);
  const base = createDefaultProject(project.name);
  const rawSettings = isRecord(project.settings)
    ? (project.settings as PartialSettingsInput)
    : ({} as PartialSettingsInput);
  const rawTimeline = isRecord(project.timeline)
    ? (project.timeline as PartialTimelineInput)
    : ({} as PartialTimelineInput);
  const rawTakes = Array.isArray(project.takes) ? project.takes : [];
  const now = new Date().toISOString();

  return {
    id: typeof project.id === 'string' && project.id ? project.id : base.id,
    name:
      typeof project.name === 'string' && project.name.trim()
        ? sanitizeProjectName(project.name)
        : base.name,
    createdAt:
      typeof project.createdAt === 'string' ? project.createdAt : now,
    updatedAt:
      typeof project.updatedAt === 'string' ? project.updatedAt : now,
    settings: {
      screenFitMode: rawSettings.screenFitMode === 'fit' ? 'fit' : 'fill',
      hideFromRecording: rawSettings.hideFromRecording !== false,
      exportAudioPreset: normalizeExportAudioPreset(
        rawSettings.exportAudioPreset,
      ),
      cameraSyncOffsetMs: normalizeCameraSyncOffsetMs(
        rawSettings.cameraSyncOffsetMs,
      ),
    },
    takes: rawTakes.map((rawTake, index) => {
      const take = isRecord(rawTake)
        ? (rawTake as PartialTakeInput)
        : ({} as PartialTakeInput);

      return {
        id:
          typeof take.id === 'string' && take.id
            ? take.id
            : `take-${index + 1}-${Date.now()}`,
        createdAt:
          typeof take.createdAt === 'string' ? take.createdAt : now,
        duration: Number.isFinite(Number(take.duration))
          ? Number(take.duration)
          : 0,
        screenPath: projectFolder
          ? toProjectAbsolutePath(projectFolder, take.screenPath)
          : typeof take.screenPath === 'string'
            ? take.screenPath
            : null,
        cameraPath: projectFolder
          ? toProjectAbsolutePath(projectFolder, take.cameraPath)
          : typeof take.cameraPath === 'string'
            ? take.cameraPath
            : null,
        sections: normalizeSections(take.sections),
      };
    }),
    timeline: {
      duration: Number.isFinite(Number(rawTimeline.duration))
        ? Number(rawTimeline.duration)
        : 0,
      sections: normalizeSections(rawTimeline.sections).map((section) => ({
        ...section,
        imagePath: projectFolder
          ? toProjectAbsolutePath(projectFolder, section.imagePath)
          : section.imagePath,
      })),
      keyframes: normalizeKeyframes(rawTimeline.keyframes),
      selectedSectionId:
        typeof rawTimeline.selectedSectionId === 'string'
          ? rawTimeline.selectedSectionId
          : null,
      hasCamera: Boolean(rawTimeline.hasCamera),
      sourceWidth: Number.isFinite(Number(rawTimeline.sourceWidth))
        ? Number(rawTimeline.sourceWidth)
        : null,
      sourceHeight: Number.isFinite(Number(rawTimeline.sourceHeight))
        ? Number(rawTimeline.sourceHeight)
        : null,
    },
  };
}
