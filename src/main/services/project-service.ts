import path from 'node:path';

import type { App } from 'electron';

import {
  atomicWriteFileSync,
  ensureDirectory,
  fs,
  isDirectoryEmpty,
  readJsonFile,
  safeUnlink,
  writeJsonFile,
} from '../infra/file-system';
import {
  createDefaultProject,
  normalizeProjectData,
  normalizeSections,
  sanitizeProjectName,
  toProjectAbsolutePath,
  toProjectRelativePath,
  type ProjectData,
  type RecoveryTake,
  type RecoveryTrimSegment,
} from '../../shared/domain/project';

export const PROJECT_FILE_NAME = 'project.json';
export const PROJECT_META_FILE_NAME = 'projects-meta.json';
export const PROJECT_RECOVERY_FILE_NAME = '.pending-recording.json';
export const MAX_RECENT_PROJECTS = 20;

interface ProjectMeta {
  lastProjectPath: string | null;
  recentProjectPaths: string[];
}

interface CreateProjectOptions {
  name?: string;
  parentFolder?: string;
  projectPath?: string;
}

interface ProjectPayload {
  projectPath?: string;
  project?: unknown;
}

interface RecoveryPayload {
  projectPath?: string;
  take?: unknown;
}

type RecoveryTakeInput = Omit<Partial<RecoveryTake>, 'trimSegments'> & {
  trimSegments?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createProjectService({ app }: { app: Pick<App, 'getPath'> }) {
  function getProjectFilePath(projectFolder: string): string {
    return path.join(projectFolder, PROJECT_FILE_NAME);
  }

  function getProjectRecoveryFilePath(projectFolder: string): string {
    return path.join(projectFolder, PROJECT_RECOVERY_FILE_NAME);
  }

  function getProjectMetaFilePath(): string {
    return path.join(app.getPath('userData'), PROJECT_META_FILE_NAME);
  }

  function normalizeRecoveryTake(
    rawTake: unknown,
    projectFolder: string,
  ): RecoveryTake | null {
    if (!isRecord(rawTake)) return null;

    const take = rawTake as RecoveryTakeInput;
    const screenPath = projectFolder
      ? toProjectAbsolutePath(projectFolder, take.screenPath)
      : typeof take.screenPath === 'string'
        ? take.screenPath
        : null;
    const cameraPath = projectFolder
      ? toProjectAbsolutePath(projectFolder, take.cameraPath)
      : typeof take.cameraPath === 'string'
        ? take.cameraPath
        : null;
    const recordedDuration = Number(take.recordedDuration);
    const sections = normalizeSections(take.sections);
    const trimSegments: RecoveryTrimSegment[] = Array.isArray(take.trimSegments)
      ? take.trimSegments
          .map((rawSegment) => {
            if (!isRecord(rawSegment)) return null;
            const start = Number(rawSegment.start);
            const end = Number(rawSegment.end);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
              return null;
            }

            return {
              start,
              end,
              text:
                typeof rawSegment.text === 'string'
                  ? rawSegment.text.trim()
                  : '',
            };
          })
          .filter((segment): segment is RecoveryTrimSegment => Boolean(segment))
      : [];

    if (!screenPath || !fs.existsSync(screenPath)) return null;
    if (cameraPath && !fs.existsSync(cameraPath)) return null;

    return {
      id:
        typeof take.id === 'string' && take.id
          ? take.id
          : `recovery-${Date.now()}`,
      createdAt:
        typeof take.createdAt === 'string'
          ? take.createdAt
          : new Date().toISOString(),
      screenPath,
      cameraPath,
      recordedDuration: Number.isFinite(recordedDuration) ? recordedDuration : 0,
      sections,
      trimSegments,
    };
  }

  function readRecoveryTake(projectFolder: string): RecoveryTake | null {
    const filePath = getProjectRecoveryFilePath(projectFolder);
    const raw = readJsonFile<unknown | null>(filePath, null);
    const normalized = normalizeRecoveryTake(raw, projectFolder);
    if (!raw) return null;
    if (normalized) return normalized;
    safeUnlink(filePath);
    return null;
  }

  function writeRecoveryTake(
    projectFolder: string,
    rawTake: unknown,
  ): RecoveryTake {
    const normalized = normalizeRecoveryTake(rawTake, projectFolder);
    if (!normalized) throw new Error('Invalid recovery recording');

    const serializable = {
      ...normalized,
      screenPath: toProjectRelativePath(projectFolder, normalized.screenPath),
      cameraPath: toProjectRelativePath(projectFolder, normalized.cameraPath),
    };
    writeJsonFile(getProjectRecoveryFilePath(projectFolder), serializable);
    return normalized;
  }

  function clearRecoveryTake(projectFolder: string): void {
    safeUnlink(getProjectRecoveryFilePath(projectFolder));
  }

  function completeRecoveryTake(projectFolder: string): void {
    clearRecoveryTake(projectFolder);
  }

  function resolveAvailableProjectFolder(targetFolder: string): string {
    const resolvedTarget = path.resolve(targetFolder);
    if (!fs.existsSync(resolvedTarget)) return resolvedTarget;

    if (!fs.statSync(resolvedTarget).isDirectory()) {
      throw new Error('Project location must be a folder');
    }

    if (
      isDirectoryEmpty(resolvedTarget) &&
      !fs.existsSync(getProjectFilePath(resolvedTarget))
    ) {
      return resolvedTarget;
    }

    const parentFolder = path.dirname(resolvedTarget);
    const baseName = path.basename(resolvedTarget);
    let candidate = resolvedTarget;
    let suffix = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(parentFolder, `${baseName} ${suffix}`);
      suffix += 1;
    }
    return candidate;
  }

  function saveProjectToDisk(
    projectFolder: string,
    rawProject: unknown,
  ): ProjectData {
    const normalized = normalizeProjectData(rawProject, projectFolder);
    normalized.updatedAt = new Date().toISOString();

    const serializable = JSON.parse(JSON.stringify(normalized)) as ProjectData;
    serializable.takes = serializable.takes.map((take) => ({
      ...take,
      screenPath: toProjectRelativePath(projectFolder, take.screenPath),
      cameraPath: toProjectRelativePath(projectFolder, take.cameraPath),
      proxyPath: toProjectRelativePath(projectFolder, take.proxyPath),
    }));
    serializable.timeline.sections = serializable.timeline.sections.map((section) => ({
      ...section,
      imagePath: toProjectRelativePath(projectFolder, section.imagePath),
    }));

    writeJsonFile(getProjectFilePath(projectFolder), serializable);
    return normalized;
  }

  function loadProjectFromDisk(projectFolder: string): ProjectData {
    const resolvedFolder = path.resolve(projectFolder);
    const rawProject = readJsonFile<unknown | null>(
      getProjectFilePath(resolvedFolder),
      null,
    );
    if (!rawProject) {
      throw new Error(`Project file missing at ${getProjectFilePath(resolvedFolder)}`);
    }
    return normalizeProjectData(rawProject, resolvedFolder);
  }

  function readProjectMeta(): ProjectMeta {
    const fallback: ProjectMeta = { lastProjectPath: null, recentProjectPaths: [] };
    const raw = readJsonFile<ProjectMeta | null>(getProjectMetaFilePath(), fallback);
    const recentProjectPaths = Array.isArray(raw?.recentProjectPaths)
      ? raw.recentProjectPaths.filter(
          (projectPath): projectPath is string =>
            typeof projectPath === 'string' && projectPath.trim().length > 0,
        )
      : [];

    return {
      lastProjectPath:
        typeof raw?.lastProjectPath === 'string' ? raw.lastProjectPath : null,
      recentProjectPaths: [...new Set(recentProjectPaths)].slice(
        0,
        MAX_RECENT_PROJECTS,
      ),
    };
  }

  function writeProjectMeta(meta: ProjectMeta): void {
    writeJsonFile(getProjectMetaFilePath(), meta);
  }

  function touchRecentProject(projectFolder: string): void {
    const resolvedFolder = path.resolve(projectFolder);
    const meta = readProjectMeta();
    const remaining = meta.recentProjectPaths.filter(
      (savedProjectPath) =>
        savedProjectPath !== resolvedFolder &&
        fs.existsSync(getProjectFilePath(savedProjectPath)),
    );
    meta.recentProjectPaths = [resolvedFolder, ...remaining].slice(
      0,
      MAX_RECENT_PROJECTS,
    );
    meta.lastProjectPath = resolvedFolder;
    writeProjectMeta(meta);
  }

  function listRecentProjects(limit = 10) {
    const meta = readProjectMeta();
    const projects: Array<{
      projectPath: string;
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
    }> = [];
    const maxItems = Math.max(1, Number(limit) || 10);

    for (const projectFolder of meta.recentProjectPaths) {
      try {
        if (!fs.existsSync(getProjectFilePath(projectFolder))) continue;
        const project = loadProjectFromDisk(projectFolder);
        projects.push({
          projectPath: projectFolder,
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        });
        if (projects.length >= maxItems) break;
      } catch (error) {
        console.error(`Failed to read recent project at ${projectFolder}:`, error);
      }
    }

    const lastProjectPath =
      typeof meta.lastProjectPath === 'string' &&
      fs.existsSync(getProjectFilePath(meta.lastProjectPath))
        ? meta.lastProjectPath
        : null;

    return { lastProjectPath, projects };
  }

  function createProject(opts: CreateProjectOptions = {}) {
    const baseName = sanitizeProjectName(opts.name || 'Untitled Project');
    const explicitProjectPath =
      typeof opts.projectPath === 'string' ? opts.projectPath.trim() : '';

    let targetFolder: string;
    if (explicitProjectPath) {
      targetFolder = path.resolve(explicitProjectPath);
      const parentFolder = path.dirname(targetFolder);
      ensureDirectory(parentFolder);
      targetFolder = resolveAvailableProjectFolder(targetFolder);
    } else {
      const parentFolder =
        typeof opts.parentFolder === 'string' ? opts.parentFolder : '';
      if (!parentFolder) throw new Error('Missing parent folder');
      const resolvedParent = path.resolve(parentFolder);
      ensureDirectory(resolvedParent);
      targetFolder = resolveAvailableProjectFolder(
        path.join(resolvedParent, baseName),
      );
    }

    if (fs.existsSync(targetFolder) && !fs.statSync(targetFolder).isDirectory()) {
      throw new Error('Project location must be a folder');
    }

    ensureDirectory(targetFolder);
    const project = saveProjectToDisk(
      targetFolder,
      createDefaultProject(path.basename(targetFolder)),
    );
    touchRecentProject(targetFolder);
    return { projectPath: targetFolder, project };
  }

  function openProject(projectFolder: string) {
    if (typeof projectFolder !== 'string' || !projectFolder.trim()) {
      throw new Error('Missing project folder');
    }

    const resolvedFolder = path.resolve(projectFolder);
    const project = loadProjectFromDisk(resolvedFolder);
    const recoveryTake = readRecoveryTake(resolvedFolder);
    touchRecentProject(resolvedFolder);
    return { projectPath: resolvedFolder, project, recoveryTake };
  }

  function saveProject(payload: ProjectPayload = {}) {
    const projectPath =
      typeof payload.projectPath === 'string' ? payload.projectPath : '';
    if (!projectPath) throw new Error('Missing project path');

    const resolvedFolder = path.resolve(projectPath);
    ensureDirectory(resolvedFolder);
    const project = saveProjectToDisk(resolvedFolder, payload.project || {});
    touchRecentProject(resolvedFolder);
    return { projectPath: resolvedFolder, project };
  }

  function setRecoveryTake(payload: RecoveryPayload = {}) {
    const projectPath =
      typeof payload.projectPath === 'string' ? payload.projectPath : '';
    if (!projectPath) throw new Error('Missing project path');

    const resolvedFolder = path.resolve(projectPath);
    ensureDirectory(resolvedFolder);
    const recoveryTake = writeRecoveryTake(resolvedFolder, payload.take || {});
    touchRecentProject(resolvedFolder);
    return { projectPath: resolvedFolder, recoveryTake };
  }

  function clearRecoveryByProject(projectFolder: string): boolean {
    if (typeof projectFolder !== 'string' || !projectFolder.trim()) return false;
    clearRecoveryTake(path.resolve(projectFolder));
    return true;
  }

  function completeRecoveryByProject(projectFolder: string): boolean {
    if (typeof projectFolder !== 'string' || !projectFolder.trim()) return false;
    completeRecoveryTake(path.resolve(projectFolder));
    return true;
  }

  function loadLastProject() {
    const meta = readProjectMeta();
    const projectFolder = meta.lastProjectPath;
    if (!projectFolder || !fs.existsSync(getProjectFilePath(projectFolder))) {
      return null;
    }

    try {
      const project = loadProjectFromDisk(projectFolder);
      const recoveryTake = readRecoveryTake(projectFolder);
      touchRecentProject(projectFolder);
      return { projectPath: projectFolder, project, recoveryTake };
    } catch (error) {
      console.error(`Failed to load last project at ${projectFolder}:`, error);
      return null;
    }
  }

  function setLastProject(projectFolder: string): boolean {
    if (typeof projectFolder !== 'string' || !projectFolder.trim()) return false;
    touchRecentProject(path.resolve(projectFolder));
    return true;
  }

  function saveVideo(
    buffer: ArrayBuffer | Uint8Array,
    folder: string,
    suffix?: string,
  ): string {
    const filename = `recording-${Date.now()}${suffix ? `-${suffix}` : ''}.webm`;
    ensureDirectory(folder);
    const filePath = path.join(folder, filename);
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const data = Buffer.from(bytes);

    // Atomic write: temp file → rename to prevent partial files on crash
    atomicWriteFileSync(filePath, data);

    // Verify written file matches expected size
    const stat = fs.statSync(filePath);
    if (stat.size !== data.length) {
      throw new Error(
        `Recording file verification failed: expected ${data.length} bytes, got ${stat.size}`,
      );
    }

    return filePath;
  }

  return {
    sanitizeProjectName,
    getProjectFilePath,
    getProjectRecoveryFilePath,
    getProjectMetaFilePath,
    normalizeRecoveryTake,
    readRecoveryTake,
    writeRecoveryTake,
    clearRecoveryTake,
    completeRecoveryTake,
    resolveAvailableProjectFolder,
    saveProjectToDisk,
    loadProjectFromDisk,
    readProjectMeta,
    writeProjectMeta,
    touchRecentProject,
    listRecentProjects,
    createProject,
    openProject,
    saveProject,
    setRecoveryTake,
    clearRecoveryByProject,
    completeRecoveryByProject,
    loadLastProject,
    setLastProject,
    saveVideo,
  };
}
