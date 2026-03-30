import type { ProjectData, RecoveryTake } from './domain/project';

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
  computeSections: (opts: {
    segments?: Array<{ start: number; end: number }>;
    paddingSeconds?: number;
  }) => Promise<{ sections: ProjectData['timeline']['sections']; trimmedDuration: number }>;
  renderComposite: (opts: Record<string, unknown>) => Promise<string>;
  onRenderProgress: (listener: (payload: RenderProgressUpdate) => void) => () => void;
  importFile: (sourcePath: string, projectFolder: string) => Promise<string>;
  pickImageFile: () => Promise<string | null>;
  getScribeToken: () => Promise<string>;
  generateProxy: (opts: GenerateProxyOpts) => Promise<string | null>;
  onProxyProgress: (listener: (payload: ProxyProgressUpdate) => void) => () => void;
}
