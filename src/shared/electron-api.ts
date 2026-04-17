import type { ProjectData, RecoveryTake } from './domain/project';

export interface PremiereExportResult {
  outputFolder: string;
  xmlPath: string;
  mediaFolder: string;
}

export interface RenderProgressUpdate {
  phase?: string;
  percent?: number | null;
  status?: string;
  outTimeSec?: number | null;
  durationSec?: number;
  frame?: number | null;
  speed?: number | null;
}

export interface ProxyProgressUpdate {
  takeId: string;
  status: 'started' | 'progress' | 'done' | 'error';
  percent?: number;
  proxyPath?: string;
  error?: string;
}

export interface GenerateProxyOpts {
  takeId: string;
  screenPath: string;
  projectFolder: string;
  durationSec?: number;
}

export interface RecordingBeginOpts {
  takeId: string;
  suffix: string;
  folder: string;
  extension?: string;
}

export interface RecordingBeginResult {
  tempPath: string;
  finalPath: string;
}

export interface RecordingAppendOpts {
  takeId: string;
  suffix: string;
  data: ArrayBuffer | Uint8Array;
}

export interface RecordingAppendResult {
  bytesWritten: number;
}

export interface RecordingFinalizeOpts {
  takeId: string;
  suffix: string;
}

export interface RecordingFinalizeResult {
  path: string;
  bytesWritten: number;
}

export interface RecordingCancelResult {
  cancelled: boolean;
}

export interface OrphanRecordingCandidate {
  takeId: string;
  createdAt: string;
  screen: { partPath: string; bytes: number } | null;
  camera: { partPath: string; bytes: number } | null;
  audio: { partPath: string; bytes: number } | null;
}

export interface RecoveredOrphanRecording {
  takeId: string;
  createdAt: string;
  screenPath: string | null;
  cameraPath: string | null;
  audioPath: string | null;
  audioSource: 'screen' | 'camera' | 'external' | null;
}

export interface ProjectEnvelope {
  projectPath: string;
  project: ProjectData;
}

export interface OpenProjectEnvelope extends ProjectEnvelope {
  recoveryTake: RecoveryTake | null;
}

export interface RecentProjectEntry {
  projectPath: string;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecentProjectsEnvelope {
  lastProjectPath: string | null;
  projects: RecentProjectEntry[];
}

export interface ElectronApi {
  saveVideo: (buffer: ArrayBuffer, folder: string, suffix?: string) => Promise<string>;
  pickFolder: (opts?: { title?: string; buttonLabel?: string }) => Promise<string | null>;
  pickProjectLocation: (opts?: { name?: string }) => Promise<string | null>;
  pathToFileUrl: (filePath: string) => string;
  openFolder: (folder: string) => Promise<void>;
  projectCreate: (opts?: {
    name?: string;
    parentFolder?: string;
    projectPath?: string;
  }) => Promise<ProjectEnvelope>;
  projectOpen: (projectFolder: string) => Promise<OpenProjectEnvelope>;
  projectSave: (payload: { projectPath: string; project: ProjectData }) => Promise<ProjectEnvelope>;
  projectSetRecoveryTake: (payload: {
    projectPath: string;
    take: RecoveryTake;
  }) => Promise<{ projectPath: string; recoveryTake: RecoveryTake }>;
  projectClearRecoveryTake: (projectFolder: string) => Promise<boolean>;
  projectCompleteRecoveryTake: (projectFolder: string) => Promise<boolean>;
  projectListRecent: (limit?: number) => Promise<RecentProjectsEnvelope>;
  projectLoadLast: () => Promise<OpenProjectEnvelope | null>;
  projectSetLast: (projectFolder: string) => Promise<boolean>;
  setContentProtection: (enabled: boolean) => Promise<boolean>;
  getSources: () => Promise<Array<{ id: string; name: string }>>;
  prepareDisplayMedia: (opts: { sourceId: string | null }) => Promise<boolean>;
  computeSections: (opts: {
    segments?: Array<{ start: number; end: number }>;
    paddingSeconds?: number;
  }) => Promise<{ sections: ProjectData['timeline']['sections']; trimmedDuration: number }>;
  renderComposite: (opts: Record<string, unknown>) => Promise<string>;
  onRenderProgress: (listener: (payload: RenderProgressUpdate) => void) => () => void;
  generatePreview: (
    opts: Record<string, unknown>
  ) => Promise<{ path: string; hash: string; cached: boolean }>;
  exportPremiereProject: (opts: Record<string, unknown>) => Promise<PremiereExportResult>;
  onExportPremiereProgress: (listener: (payload: RenderProgressUpdate) => void) => () => void;
  importFile: (sourcePath: string, projectFolder: string) => Promise<string>;
  pickImageFile: () => Promise<string | null>;
  getScribeToken: () => Promise<string>;
  generateProxy: (opts: GenerateProxyOpts) => Promise<string | null>;
  onProxyProgress: (listener: (payload: ProxyProgressUpdate) => void) => () => void;
  getPathForFile: (file: File) => string;
  recordingBegin: (opts: RecordingBeginOpts) => Promise<RecordingBeginResult>;
  recordingAppend: (opts: RecordingAppendOpts) => Promise<RecordingAppendResult>;
  recordingFinalize: (opts: RecordingFinalizeOpts) => Promise<RecordingFinalizeResult>;
  recordingCancel: (opts: RecordingFinalizeOpts) => Promise<RecordingCancelResult>;
  recordingListOrphans: (folder: string) => Promise<string[]>;
  recordingScanOrphans: (folder: string) => Promise<OrphanRecordingCandidate[]>;
  recordingRecoverOrphan: (opts: {
    folder: string;
    takeId: string;
  }) => Promise<RecoveredOrphanRecording | null>;
  recordingDiscardOrphan: (opts: {
    folder: string;
    takeId: string;
  }) => Promise<{ discarded: number }>;
}
