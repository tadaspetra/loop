const path = require('path');

const {
  fs,
  ensureDirectory,
  safeUnlink,
  readJsonFile,
  writeJsonFile,
  isDirectoryEmpty
} = require('../infra/file-system');
const {
  sanitizeProjectName,
  toProjectAbsolutePath,
  toProjectRelativePath,
  normalizeSections,
  createDefaultProject,
  normalizeProjectData
} = require('../../shared/domain/project');

const PROJECT_FILE_NAME = 'project.json';
const PROJECT_META_FILE_NAME = 'projects-meta.json';
const PROJECT_RECOVERY_FILE_NAME = '.pending-recording.json';
const MAX_RECENT_PROJECTS = 20;

function createProjectService({ app }) {
  function getProjectFilePath(projectFolder) {
    return path.join(projectFolder, PROJECT_FILE_NAME);
  }

  function getProjectRecoveryFilePath(projectFolder) {
    return path.join(projectFolder, PROJECT_RECOVERY_FILE_NAME);
  }

  function getProjectMetaFilePath() {
    return path.join(app.getPath('userData'), PROJECT_META_FILE_NAME);
  }

  function normalizeRecoveryTake(rawTake, projectFolder) {
    if (!rawTake || typeof rawTake !== 'object') return null;

    const screenPath = projectFolder
      ? toProjectAbsolutePath(projectFolder, rawTake.screenPath)
      : rawTake.screenPath || null;
    const cameraPath = projectFolder
      ? toProjectAbsolutePath(projectFolder, rawTake.cameraPath)
      : rawTake.cameraPath || null;
    const recordedDuration = Number(rawTake.recordedDuration);
    const sections = normalizeSections(rawTake.sections);
    const trimSegments = Array.isArray(rawTake.trimSegments)
      ? rawTake.trimSegments
          .map((segment) => {
            const start = Number(segment?.start);
            const end = Number(segment?.end);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
            return {
              start,
              end,
              text: typeof segment?.text === 'string' ? segment.text.trim() : ''
            };
          })
          .filter(Boolean)
      : [];

    if (!screenPath || !fs.existsSync(screenPath)) return null;
    if (cameraPath && !fs.existsSync(cameraPath)) return null;

    return {
      id: typeof rawTake.id === 'string' && rawTake.id ? rawTake.id : `recovery-${Date.now()}`,
      createdAt: typeof rawTake.createdAt === 'string' ? rawTake.createdAt : new Date().toISOString(),
      screenPath,
      cameraPath,
      recordedDuration: Number.isFinite(recordedDuration) ? recordedDuration : 0,
      sections,
      trimSegments
    };
  }

  function readRecoveryTake(projectFolder) {
    const filePath = getProjectRecoveryFilePath(projectFolder);
    const raw = readJsonFile(filePath, null);
    const normalized = normalizeRecoveryTake(raw, projectFolder);
    if (!raw) return null;
    if (normalized) return normalized;
    safeUnlink(filePath);
    return null;
  }

  function writeRecoveryTake(projectFolder, rawTake) {
    const normalized = normalizeRecoveryTake(rawTake, projectFolder);
    if (!normalized) throw new Error('Invalid recovery recording');

    const serializable = {
      ...normalized,
      screenPath: toProjectRelativePath(projectFolder, normalized.screenPath),
      cameraPath: toProjectRelativePath(projectFolder, normalized.cameraPath)
    };
    writeJsonFile(getProjectRecoveryFilePath(projectFolder), serializable);
    return normalized;
  }

  function clearRecoveryTake(projectFolder) {
    safeUnlink(getProjectRecoveryFilePath(projectFolder));
  }

  function completeRecoveryTake(projectFolder) {
    clearRecoveryTake(projectFolder);
  }

  function resolveAvailableProjectFolder(targetFolder) {
    const resolvedTarget = path.resolve(targetFolder);
    if (!fs.existsSync(resolvedTarget)) return resolvedTarget;

    if (!fs.statSync(resolvedTarget).isDirectory()) {
      throw new Error('Project location must be a folder');
    }

    if (isDirectoryEmpty(resolvedTarget) && !fs.existsSync(getProjectFilePath(resolvedTarget))) {
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

  function saveProjectToDisk(projectFolder, rawProject) {
    const normalized = normalizeProjectData(rawProject, projectFolder);
    normalized.updatedAt = new Date().toISOString();

    const serializable = JSON.parse(JSON.stringify(normalized));
    serializable.takes = serializable.takes.map((take) => ({
      ...take,
      screenPath: toProjectRelativePath(projectFolder, take.screenPath),
      cameraPath: toProjectRelativePath(projectFolder, take.cameraPath)
    }));

    writeJsonFile(getProjectFilePath(projectFolder), serializable);
    return normalized;
  }

  function loadProjectFromDisk(projectFolder) {
    const resolvedFolder = path.resolve(projectFolder);
    const rawProject = readJsonFile(getProjectFilePath(resolvedFolder), null);
    if (!rawProject) {
      throw new Error(`Project file missing at ${getProjectFilePath(resolvedFolder)}`);
    }
    return normalizeProjectData(rawProject, resolvedFolder);
  }

  function readProjectMeta() {
    const fallback = { lastProjectPath: null, recentProjectPaths: [] };
    const raw = readJsonFile(getProjectMetaFilePath(), fallback);
    const recentProjectPaths = Array.isArray(raw?.recentProjectPaths)
      ? raw.recentProjectPaths.filter((projectPath) => typeof projectPath === 'string' && projectPath.trim())
      : [];

    return {
      lastProjectPath: typeof raw?.lastProjectPath === 'string' ? raw.lastProjectPath : null,
      recentProjectPaths: [...new Set(recentProjectPaths)].slice(0, MAX_RECENT_PROJECTS)
    };
  }

  function writeProjectMeta(meta) {
    writeJsonFile(getProjectMetaFilePath(), meta);
  }

  function touchRecentProject(projectFolder) {
    const resolvedFolder = path.resolve(projectFolder);
    const meta = readProjectMeta();
    const remaining = meta.recentProjectPaths.filter(
      (projectPath) => projectPath !== resolvedFolder && fs.existsSync(getProjectFilePath(projectPath))
    );
    meta.recentProjectPaths = [resolvedFolder, ...remaining].slice(0, MAX_RECENT_PROJECTS);
    meta.lastProjectPath = resolvedFolder;
    writeProjectMeta(meta);
  }

  function listRecentProjects(limit = 10) {
    const meta = readProjectMeta();
    const projects = [];
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
          updatedAt: project.updatedAt
        });
        if (projects.length >= maxItems) break;
      } catch (error) {
        console.error(`Failed to read recent project at ${projectFolder}:`, error);
      }
    }

    const lastProjectPath =
      typeof meta.lastProjectPath === 'string' && fs.existsSync(getProjectFilePath(meta.lastProjectPath))
        ? meta.lastProjectPath
        : null;

    return { lastProjectPath, projects };
  }

  function createProject(opts = {}) {
    const baseName = sanitizeProjectName(opts.name || 'Untitled Project');
    const explicitProjectPath = typeof opts.projectPath === 'string' ? opts.projectPath.trim() : '';

    let targetFolder;
    if (explicitProjectPath) {
      targetFolder = path.resolve(explicitProjectPath);
      const parentFolder = path.dirname(targetFolder);
      ensureDirectory(parentFolder);
      targetFolder = resolveAvailableProjectFolder(targetFolder);
    } else {
      const parentFolder = typeof opts.parentFolder === 'string' ? opts.parentFolder : '';
      if (!parentFolder) throw new Error('Missing parent folder');
      const resolvedParent = path.resolve(parentFolder);
      ensureDirectory(resolvedParent);
      targetFolder = resolveAvailableProjectFolder(path.join(resolvedParent, baseName));
    }

    if (fs.existsSync(targetFolder) && !fs.statSync(targetFolder).isDirectory()) {
      throw new Error('Project location must be a folder');
    }

    ensureDirectory(targetFolder);
    const project = saveProjectToDisk(targetFolder, createDefaultProject(path.basename(targetFolder)));
    touchRecentProject(targetFolder);
    return { projectPath: targetFolder, project };
  }

  function openProject(projectFolder) {
    if (typeof projectFolder !== 'string' || !projectFolder.trim()) {
      throw new Error('Missing project folder');
    }

    const resolvedFolder = path.resolve(projectFolder);
    const project = loadProjectFromDisk(resolvedFolder);
    const recoveryTake = readRecoveryTake(resolvedFolder);
    touchRecentProject(resolvedFolder);
    return { projectPath: resolvedFolder, project, recoveryTake };
  }

  function saveProject(payload = {}) {
    const projectPath = typeof payload.projectPath === 'string' ? payload.projectPath : '';
    if (!projectPath) throw new Error('Missing project path');

    const resolvedFolder = path.resolve(projectPath);
    ensureDirectory(resolvedFolder);
    const project = saveProjectToDisk(resolvedFolder, payload.project || {});
    touchRecentProject(resolvedFolder);
    return { projectPath: resolvedFolder, project };
  }

  function setRecoveryTake(payload = {}) {
    const projectPath = typeof payload.projectPath === 'string' ? payload.projectPath : '';
    if (!projectPath) throw new Error('Missing project path');

    const resolvedFolder = path.resolve(projectPath);
    ensureDirectory(resolvedFolder);
    const recoveryTake = writeRecoveryTake(resolvedFolder, payload.take || {});
    touchRecentProject(resolvedFolder);
    return { projectPath: resolvedFolder, recoveryTake };
  }

  function clearRecoveryByProject(projectFolder) {
    if (typeof projectFolder !== 'string' || !projectFolder.trim()) return false;
    clearRecoveryTake(path.resolve(projectFolder));
    return true;
  }

  function completeRecoveryByProject(projectFolder) {
    if (typeof projectFolder !== 'string' || !projectFolder.trim()) return false;
    completeRecoveryTake(path.resolve(projectFolder));
    return true;
  }

  function loadLastProject() {
    const meta = readProjectMeta();
    const projectFolder = meta.lastProjectPath;
    if (!projectFolder || !fs.existsSync(getProjectFilePath(projectFolder))) return null;

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

  function setLastProject(projectFolder) {
    if (typeof projectFolder !== 'string' || !projectFolder.trim()) return false;
    touchRecentProject(path.resolve(projectFolder));
    return true;
  }

  function stageTakeFiles(projectPath, filePaths) {
    const resolvedProject = path.resolve(projectPath);
    const deletedDir = path.join(resolvedProject, '.deleted');
    ensureDirectory(deletedDir);
    for (const filePath of filePaths) {
      if (!filePath) continue;
      const resolved = path.isAbsolute(filePath) ? filePath : path.join(resolvedProject, filePath);
      if (!fs.existsSync(resolved)) continue;
      const dest = path.join(deletedDir, path.basename(resolved));
      fs.renameSync(resolved, dest);
    }
  }

  function unstageTakeFiles(projectPath, fileNames) {
    const resolvedProject = path.resolve(projectPath);
    const deletedDir = path.join(resolvedProject, '.deleted');
    if (!fs.existsSync(deletedDir)) return;
    for (const fileName of fileNames) {
      if (!fileName) continue;
      const src = path.join(deletedDir, fileName);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(resolvedProject, fileName);
      fs.renameSync(src, dest);
    }
  }

  function cleanupDeletedFolder(projectPath) {
    const resolvedProject = path.resolve(projectPath);
    const deletedDir = path.join(resolvedProject, '.deleted');
    if (!fs.existsSync(deletedDir)) return;
    fs.rmSync(deletedDir, { recursive: true, force: true });
  }

  function cleanupUnusedTakes(projectPath) {
    const resolvedProject = path.resolve(projectPath);
    const project = loadProjectFromDisk(resolvedProject);
    const rawTimeline = project.timeline || {};
    const sections = Array.isArray(rawTimeline.sections) ? rawTimeline.sections : [];
    const savedSections = Array.isArray(rawTimeline.savedSections) ? rawTimeline.savedSections : [];

    const referencedTakeIds = new Set();
    for (const s of sections) { if (s.takeId) referencedTakeIds.add(s.takeId); }
    for (const s of savedSections) { if (s.takeId) referencedTakeIds.add(s.takeId); }

    const keptTakes = [];
    let removedCount = 0;
    for (const take of project.takes) {
      if (referencedTakeIds.has(take.id)) {
        keptTakes.push(take);
      } else {
        if (take.screenPath) safeUnlink(take.screenPath);
        if (take.cameraPath) safeUnlink(take.cameraPath);
        removedCount += 1;
      }
    }

    if (removedCount > 0) {
      project.takes = keptTakes;
      saveProjectToDisk(resolvedProject, project);
    }

    cleanupDeletedFolder(resolvedProject);
    return { removedCount };
  }

  function saveVideo(buffer, folder, suffix) {
    const filename = `recording-${Date.now()}${suffix ? `-${suffix}` : ''}.webm`;
    ensureDirectory(folder);
    const filePath = path.join(folder, filename);
    fs.writeFileSync(filePath, Buffer.from(buffer));
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
    stageTakeFiles,
    unstageTakeFiles,
    cleanupDeletedFolder,
    cleanupUnusedTakes
  };
}

module.exports = {
  PROJECT_FILE_NAME,
  PROJECT_META_FILE_NAME,
  PROJECT_RECOVERY_FILE_NAME,
  MAX_RECENT_PROJECTS,
  createProjectService
};
