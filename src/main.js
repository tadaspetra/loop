require('dotenv').config()
require('electron-reload')(__dirname)
const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')

let win = null
const PROJECT_FILE_NAME = 'project.json'
const PROJECT_META_FILE_NAME = 'projects-meta.json'
const MAX_RECENT_PROJECTS = 20

function createProjectId() {
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeProjectName(name) {
  const fallback = 'Untitled Project'
  if (typeof name !== 'string') return fallback
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
  return cleaned || fallback
}

function ensureDirectory(folderPath) {
  fs.mkdirSync(folderPath, { recursive: true })
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    console.error(`Failed to read JSON file at ${filePath}:`, error)
    return fallback
  }
}

function writeJsonFile(filePath, data) {
  ensureDirectory(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function toProjectAbsolutePath(projectFolder, value) {
  if (typeof value !== 'string' || !value.trim()) return null
  return path.isAbsolute(value) ? value : path.join(projectFolder, value)
}

function toProjectRelativePath(projectFolder, value) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (!path.isAbsolute(value)) return value
  const relative = path.relative(projectFolder, value)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return value
  return relative
}

function normalizeSections(rawSections = []) {
  if (!Array.isArray(rawSections)) return []
  return rawSections
    .map((section, index) => {
      const start = Number(section.start)
      const end = Number(section.end)
      const sourceStart = Number.isFinite(Number(section.sourceStart)) ? Number(section.sourceStart) : start
      const sourceEnd = Number.isFinite(Number(section.sourceEnd)) ? Number(section.sourceEnd) : end
      const transcript = String(
        typeof section.transcript === 'string'
          ? section.transcript
          : (typeof section.text === 'string' ? section.text : '')
      ).replace(/\s+/g, ' ').trim()
      return {
        id: typeof section.id === 'string' && section.id ? section.id : `section-${index + 1}`,
        index: Number.isFinite(Number(section.index)) ? Number(section.index) : index,
        label: typeof section.label === 'string' ? section.label : `Section ${index + 1}`,
        start: Number.isFinite(start) ? start : 0,
        end: Number.isFinite(end) ? end : 0,
        duration: Number.isFinite(Number(section.duration)) ? Number(section.duration) : Math.max(0, (Number.isFinite(end) ? end : 0) - (Number.isFinite(start) ? start : 0)),
        sourceStart: Number.isFinite(sourceStart) ? sourceStart : 0,
        sourceEnd: Number.isFinite(sourceEnd) ? sourceEnd : 0,
        transcript
      }
    })
    .filter(section => section.end - section.start > 0.0001)
    .sort((a, b) => a.start - b.start)
}

function normalizeKeyframes(rawKeyframes = []) {
  if (!Array.isArray(rawKeyframes)) return []
  return rawKeyframes
    .map((kf) => ({
      time: Number.isFinite(Number(kf.time)) ? Number(kf.time) : 0,
      pipX: Number.isFinite(Number(kf.pipX)) ? Number(kf.pipX) : 0,
      pipY: Number.isFinite(Number(kf.pipY)) ? Number(kf.pipY) : 0,
      pipVisible: kf.pipVisible !== false,
      cameraFullscreen: !!kf.cameraFullscreen,
      sectionId: typeof kf.sectionId === 'string' ? kf.sectionId : null,
      autoSection: !!kf.autoSection
    }))
    .sort((a, b) => a.time - b.time)
}

function createDefaultProject(name = 'Untitled Project') {
  const now = new Date().toISOString()
  return {
    id: createProjectId(),
    name: sanitizeProjectName(name),
    createdAt: now,
    updatedAt: now,
    settings: {
      screenFitMode: 'fill',
      hideFromRecording: true
    },
    takes: [],
    timeline: {
      duration: 0,
      sections: [],
      keyframes: [],
      selectedSectionId: null,
      screenPath: null,
      cameraPath: null,
      hasCamera: false,
      sourceWidth: null,
      sourceHeight: null
    }
  }
}

function normalizeProjectData(rawProject, projectFolder) {
  const base = createDefaultProject(rawProject?.name)
  const project = rawProject && typeof rawProject === 'object' ? rawProject : {}
  const rawSettings = project.settings && typeof project.settings === 'object' ? project.settings : {}
  const rawTimeline = project.timeline && typeof project.timeline === 'object' ? project.timeline : {}
  const rawTakes = Array.isArray(project.takes) ? project.takes : []
  const now = new Date().toISOString()

  const normalized = {
    id: typeof project.id === 'string' && project.id ? project.id : base.id,
    name: typeof project.name === 'string' && project.name.trim() ? sanitizeProjectName(project.name) : base.name,
    createdAt: typeof project.createdAt === 'string' ? project.createdAt : now,
    updatedAt: typeof project.updatedAt === 'string' ? project.updatedAt : now,
    settings: {
      screenFitMode: rawSettings.screenFitMode === 'fit' ? 'fit' : 'fill',
      hideFromRecording: rawSettings.hideFromRecording !== false
    },
    takes: rawTakes.map((take, index) => ({
      id: typeof take?.id === 'string' && take.id ? take.id : `take-${index + 1}-${Date.now()}`,
      createdAt: typeof take?.createdAt === 'string' ? take.createdAt : now,
      duration: Number.isFinite(Number(take?.duration)) ? Number(take.duration) : 0,
      screenPath: projectFolder ? toProjectAbsolutePath(projectFolder, take?.screenPath) : (take?.screenPath || null),
      cameraPath: projectFolder ? toProjectAbsolutePath(projectFolder, take?.cameraPath) : (take?.cameraPath || null),
      sections: normalizeSections(take?.sections)
    })),
    timeline: {
      duration: Number.isFinite(Number(rawTimeline.duration)) ? Number(rawTimeline.duration) : 0,
      sections: normalizeSections(rawTimeline.sections),
      keyframes: normalizeKeyframes(rawTimeline.keyframes),
      selectedSectionId: typeof rawTimeline.selectedSectionId === 'string' ? rawTimeline.selectedSectionId : null,
      screenPath: projectFolder ? toProjectAbsolutePath(projectFolder, rawTimeline.screenPath) : (rawTimeline.screenPath || null),
      cameraPath: projectFolder ? toProjectAbsolutePath(projectFolder, rawTimeline.cameraPath) : (rawTimeline.cameraPath || null),
      hasCamera: !!rawTimeline.hasCamera,
      sourceWidth: Number.isFinite(Number(rawTimeline.sourceWidth)) ? Number(rawTimeline.sourceWidth) : null,
      sourceHeight: Number.isFinite(Number(rawTimeline.sourceHeight)) ? Number(rawTimeline.sourceHeight) : null
    }
  }

  return normalized
}

function getProjectFilePath(projectFolder) {
  return path.join(projectFolder, PROJECT_FILE_NAME)
}

function saveProjectToDisk(projectFolder, rawProject) {
  const normalized = normalizeProjectData(rawProject, projectFolder)
  normalized.updatedAt = new Date().toISOString()

  const serializable = JSON.parse(JSON.stringify(normalized))
  serializable.takes = serializable.takes.map((take) => ({
    ...take,
    screenPath: toProjectRelativePath(projectFolder, take.screenPath),
    cameraPath: toProjectRelativePath(projectFolder, take.cameraPath)
  }))
  serializable.timeline.screenPath = toProjectRelativePath(projectFolder, serializable.timeline.screenPath)
  serializable.timeline.cameraPath = toProjectRelativePath(projectFolder, serializable.timeline.cameraPath)

  writeJsonFile(getProjectFilePath(projectFolder), serializable)
  return normalized
}

function loadProjectFromDisk(projectFolder) {
  const resolvedFolder = path.resolve(projectFolder)
  const rawProject = readJsonFile(getProjectFilePath(resolvedFolder), null)
  if (!rawProject) throw new Error(`Project file missing at ${getProjectFilePath(resolvedFolder)}`)
  return normalizeProjectData(rawProject, resolvedFolder)
}

function getProjectMetaFilePath() {
  return path.join(app.getPath('userData'), PROJECT_META_FILE_NAME)
}

function readProjectMeta() {
  const fallback = { lastProjectPath: null, recentProjectPaths: [] }
  const raw = readJsonFile(getProjectMetaFilePath(), fallback)
  const recentProjectPaths = Array.isArray(raw?.recentProjectPaths)
    ? raw.recentProjectPaths.filter(p => typeof p === 'string' && p.trim())
    : []
  return {
    lastProjectPath: typeof raw?.lastProjectPath === 'string' ? raw.lastProjectPath : null,
    recentProjectPaths: [...new Set(recentProjectPaths)].slice(0, MAX_RECENT_PROJECTS)
  }
}

function writeProjectMeta(meta) {
  writeJsonFile(getProjectMetaFilePath(), meta)
}

function touchRecentProject(projectFolder) {
  const resolvedFolder = path.resolve(projectFolder)
  const meta = readProjectMeta()
  const remaining = meta.recentProjectPaths.filter(p => p !== resolvedFolder && fs.existsSync(getProjectFilePath(p)))
  meta.recentProjectPaths = [resolvedFolder, ...remaining].slice(0, MAX_RECENT_PROJECTS)
  meta.lastProjectPath = resolvedFolder
  writeProjectMeta(meta)
}

function listRecentProjects(limit = 10) {
  const meta = readProjectMeta()
  const projects = []
  const maxItems = Math.max(1, Number(limit) || 10)
  for (const projectFolder of meta.recentProjectPaths) {
    try {
      if (!fs.existsSync(getProjectFilePath(projectFolder))) continue
      const project = loadProjectFromDisk(projectFolder)
      projects.push({
        projectPath: projectFolder,
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt
      })
      if (projects.length >= maxItems) break
    } catch (error) {
      console.error(`Failed to read recent project at ${projectFolder}:`, error)
    }
  }
  const lastProjectPath = typeof meta.lastProjectPath === 'string' && fs.existsSync(getProjectFilePath(meta.lastProjectPath))
    ? meta.lastProjectPath
    : null
  return { lastProjectPath, projects }
}

function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.setContentProtection(true)
  win.loadFile(path.join(__dirname, 'index.html'))
}

ipcMain.handle('set-content-protection', async (event, enabled) => {
  if (!win || win.isDestroyed()) return false
  win.setContentProtection(Boolean(enabled))
  return true
})

ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 }
    })
    return sources.map(s => ({ id: s.id, name: s.name }))
  } catch (e) {
    console.error('desktopCapturer error:', e)
    return []
  }
})

ipcMain.handle('pick-folder', async (event, opts = {}) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: typeof opts.title === 'string' && opts.title ? opts.title : 'Choose Folder',
    buttonLabel: typeof opts.buttonLabel === 'string' && opts.buttonLabel ? opts.buttonLabel : 'Use Folder',
    defaultPath: app.getPath('documents') || app.getPath('home'),
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled || !filePaths.length) return null
  return filePaths[0]
})

ipcMain.handle('pick-project-location', async (event, opts = {}) => {
  const projectName = sanitizeProjectName(opts.name || 'Untitled Project')
  const defaultBasePath = app.getPath('documents') || app.getPath('home')

  if (process.platform === 'win32') {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Create Project',
      buttonLabel: 'Create Project',
      defaultPath: path.join(defaultBasePath, projectName)
    })
    if (canceled || !filePath) return null
    return filePath
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: `Choose where to create "${projectName}"`,
    buttonLabel: 'Create Project Here',
    defaultPath: defaultBasePath,
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled || !filePaths.length) return null
  return path.join(filePaths[0], projectName)
})

ipcMain.handle('open-folder', async (event, folder) => {
  shell.openPath(folder)
})

ipcMain.handle('project-create', async (event, opts = {}) => {
  const baseName = sanitizeProjectName(opts.name || 'Untitled Project')
  const explicitProjectPath = typeof opts.projectPath === 'string' ? opts.projectPath.trim() : ''

  let targetFolder = ''
  if (explicitProjectPath) {
    targetFolder = path.resolve(explicitProjectPath)
    const parentFolder = path.dirname(targetFolder)
    ensureDirectory(parentFolder)
  } else {
    const parentFolder = typeof opts.parentFolder === 'string' ? opts.parentFolder : ''
    if (!parentFolder) throw new Error('Missing parent folder')
    const resolvedParent = path.resolve(parentFolder)
    ensureDirectory(resolvedParent)

    targetFolder = path.join(resolvedParent, baseName)
    let suffix = 2
    while (fs.existsSync(targetFolder)) {
      targetFolder = path.join(resolvedParent, `${baseName} ${suffix}`)
      suffix += 1
    }
  }

  if (fs.existsSync(targetFolder) && !fs.statSync(targetFolder).isDirectory()) {
    throw new Error('Project location must be a folder')
  }

  ensureDirectory(targetFolder)
  const project = saveProjectToDisk(targetFolder, createDefaultProject(path.basename(targetFolder)))
  touchRecentProject(targetFolder)
  return { projectPath: targetFolder, project }
})

ipcMain.handle('project-open', async (event, projectFolder) => {
  if (typeof projectFolder !== 'string' || !projectFolder.trim()) throw new Error('Missing project folder')
  const resolvedFolder = path.resolve(projectFolder)
  const project = loadProjectFromDisk(resolvedFolder)
  touchRecentProject(resolvedFolder)
  return { projectPath: resolvedFolder, project }
})

ipcMain.handle('project-save', async (event, payload = {}) => {
  const projectPath = typeof payload.projectPath === 'string' ? payload.projectPath : ''
  if (!projectPath) throw new Error('Missing project path')
  const resolvedFolder = path.resolve(projectPath)
  ensureDirectory(resolvedFolder)
  const project = saveProjectToDisk(resolvedFolder, payload.project || {})
  touchRecentProject(resolvedFolder)
  return { projectPath: resolvedFolder, project }
})

ipcMain.handle('project-list-recent', async (event, limit = 10) => {
  return listRecentProjects(limit)
})

ipcMain.handle('project-load-last', async () => {
  const meta = readProjectMeta()
  const projectFolder = meta.lastProjectPath
  if (!projectFolder || !fs.existsSync(getProjectFilePath(projectFolder))) return null
  try {
    const project = loadProjectFromDisk(projectFolder)
    touchRecentProject(projectFolder)
    return { projectPath: projectFolder, project }
  } catch (error) {
    console.error(`Failed to load last project at ${projectFolder}:`, error)
    return null
  }
})

ipcMain.handle('project-set-last', async (event, projectFolder) => {
  if (typeof projectFolder !== 'string' || !projectFolder.trim()) return false
  const resolvedFolder = path.resolve(projectFolder)
  touchRecentProject(resolvedFolder)
  return true
})

ipcMain.handle('save-video', async (event, buffer, folder, suffix) => {
  const filename = `recording-${Date.now()}${suffix ? '-' + suffix : ''}.webm`
  ensureDirectory(folder)
  const filePath = path.join(folder, filename)
  fs.writeFileSync(filePath, Buffer.from(buffer))
  return filePath
})

ipcMain.handle('concat-videos', async (event, opts = {}) => {
  const inputPaths = Array.isArray(opts.inputPaths) ? opts.inputPaths.filter(Boolean) : []
  if (inputPaths.length === 0) return { outputPath: null }
  if (inputPaths.length === 1) return { outputPath: inputPaths[0] }

  const outputFolder = typeof opts.outputFolder === 'string' && opts.outputFolder
    ? opts.outputFolder
    : path.dirname(inputPaths[0])
  ensureDirectory(outputFolder)

  const ffmpegPath = require('ffmpeg-static')
  const suffix = typeof opts.suffix === 'string' && opts.suffix ? opts.suffix : 'concat'
  const ext = path.extname(inputPaths[0]) || '.webm'
  const outputPath = path.join(outputFolder, `recording-${Date.now()}-${suffix}${ext}`)
  const listFilePath = path.join(outputFolder, `.concat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)

  const escapedList = inputPaths
    .map((filePath) => `file '${String(filePath).replace(/'/g, "'\\''")}'`)
    .join('\n')
  fs.writeFileSync(listFilePath, escapedList, 'utf8')

  function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
      execFile(ffmpegPath, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(stderr || error.message)
        else resolve()
      })
    })
  }

  const copyArgs = [
    '-f', 'concat',
    '-safe', '0',
    '-i', listFilePath,
    '-c', 'copy',
    '-y', outputPath
  ]

  const reencodeArgs = [
    '-f', 'concat',
    '-safe', '0',
    '-i', listFilePath,
    '-c:v', 'libvpx-vp9',
    '-crf', '30',
    '-b:v', '0',
    '-c:a', 'libopus',
    '-y', outputPath
  ]

  try {
    await runFfmpeg(copyArgs)
  } catch (copyErr) {
    console.warn('Concat with stream copy failed, retrying with re-encode:', copyErr)
    await runFfmpeg(reencodeArgs)
  } finally {
    try {
      fs.unlinkSync(listFilePath)
    } catch (cleanupError) {
      console.warn('Failed to clean concat temp list:', cleanupError)
    }
  }

  return { outputPath }
})

ipcMain.handle('render-composite', async (event, opts) => {
  const { screenPath, cameraPath, keyframes, pipSize, screenFitMode, sourceWidth, sourceHeight, outputFolder } = opts
  const ffmpegPath = require('ffmpeg-static')
  const outputPath = path.join(outputFolder, `recording-${Date.now()}-edited.mp4`)

  // Canvas coordinates are 1920x1080; scale to source video resolution
  const canvasW = 1920
  const canvasH = 1080

  let args = ['-i', screenPath]

  if (cameraPath && keyframes && keyframes.some(kf => kf.pipVisible || kf.cameraFullscreen)) {
    args.push('-i', cameraPath)
    const filterComplex = buildFilterComplex(keyframes, pipSize, screenFitMode, sourceWidth, sourceHeight, canvasW, canvasH)
    args.push('-filter_complex', filterComplex, '-map', '[out]', '-map', '0:a?')
  } else {
    args.push('-map', '0:v', '-map', '0:a?')
  }

  args.push(
    '-c:v', 'libx264', '-crf', '12', '-preset', 'slow',
    '-c:a', 'aac', '-b:a', '192k',
    '-y', outputPath
  )

  console.log('ffmpeg args:', args.join(' '))

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error('ffmpeg stderr:', stderr)
        reject(stderr || error.message)
      } else {
        resolve(outputPath)
      }
    })
  })
})

function buildFilterComplex(keyframes, pipSize, screenFitMode, sourceWidth, sourceHeight, canvasW, canvasH) {
  // Output at 16:9 based on source width, matching the canvas aspect ratio
  let outW = sourceWidth % 2 === 0 ? sourceWidth : sourceWidth - 1
  let outH = Math.round(outW * 9 / 16)
  if (outH % 2 !== 0) outH--

  // Scale from canvas coords (1920x1080) to output resolution (both 16:9, so uniform scale)
  const scale = outW / canvasW
  const actualPipSize = Math.round(pipSize * scale)
  const r = Math.round(12 * scale)
  const maxCoord = actualPipSize - 1 - r
  const rSq = r * r

  // Scale keyframe positions
  const scaledKeyframes = keyframes.map(kf => ({
    ...kf,
    pipX: Math.round(kf.pipX * scale),
    pipY: Math.round(kf.pipY * scale)
  }))

  // Screen: fit or fill into 16:9 output frame
  let screenFilter
  if (screenFitMode === 'fill') {
    screenFilter = `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}[screen]`
  } else {
    screenFilter = `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:'(ow-iw)/2':'(oh-ih)/2':color=black[screen]`
  }

  const hasPip = keyframes.some(kf => kf.pipVisible)
  const hasCamFull = keyframes.some(kf => kf.cameraFullscreen)

  if (hasPip && hasCamFull) {
    // Both PiP and fullscreen: split camera input
    const alphaExpr = buildAlphaExpr(keyframes)
    const roundCorner = `lte(pow(max(0,max(${r}-X,X-${maxCoord})),2)+pow(max(0,max(${r}-Y,Y-${maxCoord})),2),${rSq})`
    const camPipFilter = `[cam1]setpts=PTS-STARTPTS,crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=${actualPipSize}:${actualPipSize},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*${roundCorner}*(${alphaExpr})'[cam]`

    const camFullAlpha = buildCamFullAlphaExpr(keyframes)
    const camFullFilter = `[cam2]setpts=PTS-STARTPTS,scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*(${camFullAlpha})'[camfull]`

    const xExpr = buildPosExpr(scaledKeyframes, 'pipX')
    const yExpr = buildPosExpr(scaledKeyframes, 'pipY')

    return `${screenFilter};[1:v]split[cam1][cam2];${camPipFilter};${camFullFilter};[screen][cam]overlay=x='${xExpr}':y='${yExpr}':format=auto[with_pip];[with_pip][camfull]overlay=0:0:format=auto[out]`
  } else if (hasCamFull) {
    // Only fullscreen camera
    const camFullAlpha = buildCamFullAlphaExpr(keyframes)
    const camFullFilter = `[1:v]setpts=PTS-STARTPTS,scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*(${camFullAlpha})'[camfull]`

    return `${screenFilter};${camFullFilter};[screen][camfull]overlay=0:0:format=auto[out]`
  } else {
    // Only PiP (existing behavior)
    const alphaExpr = buildAlphaExpr(keyframes)
    const roundCorner = `lte(pow(max(0,max(${r}-X,X-${maxCoord})),2)+pow(max(0,max(${r}-Y,Y-${maxCoord})),2),${rSq})`
    const camFilter = `[1:v]setpts=PTS-STARTPTS,crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=${actualPipSize}:${actualPipSize},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*${roundCorner}*(${alphaExpr})'[cam]`

    const xExpr = buildPosExpr(scaledKeyframes, 'pipX')
    const yExpr = buildPosExpr(scaledKeyframes, 'pipY')

    return `${screenFilter};${camFilter};[screen][cam]overlay=x='${xExpr}':y='${yExpr}':format=auto[out]`
  }
}

const TRANSITION_DURATION = 0.3

function buildPosExpr(keyframes, prop) {
  if (keyframes.length === 1) return String(Math.round(keyframes[0][prop]))
  let expr = String(Math.round(keyframes[0][prop]))
  for (let i = 1; i < keyframes.length; i++) {
    const prev = keyframes[i - 1]
    const curr = keyframes[i]
    const prevVal = Math.round(prev[prop])
    const currVal = Math.round(curr[prop])
    const t = curr.time
    const prevFull = prev.cameraFullscreen || false
    const currFull = curr.cameraFullscreen || false

    // Position transition only between two PiP states (skip if fullscreen involved)
    if (prevVal !== currVal && !prevFull && !currFull) {
      const tEnd = t + TRANSITION_DURATION
      const diff = currVal - prevVal
      expr = `if(gte(t,${tEnd.toFixed(3)}),${currVal},if(gte(t,${t.toFixed(3)}),${prevVal}+${diff}*(t-${t.toFixed(3)})/${TRANSITION_DURATION.toFixed(3)},${expr}))`
    } else {
      expr = `if(gte(t,${t.toFixed(3)}),${currVal},${expr})`
    }
  }
  return expr
}

function buildAlphaExpr(keyframes) {
  if (keyframes.length === 1) return keyframes[0].pipVisible ? '1' : '0'
  let expr = keyframes[0].pipVisible ? '1' : '0'
  for (let i = 1; i < keyframes.length; i++) {
    const prev = keyframes[i - 1]
    const curr = keyframes[i]
    const t = curr.time
    const tEnd = t + TRANSITION_DURATION

    if (prev.pipVisible !== curr.pipVisible) {
      if (curr.pipVisible) {
        // Fade in: 0 -> 1
        expr = `if(gte(T,${tEnd.toFixed(3)}),1,if(gte(T,${t.toFixed(3)}),(T-${t.toFixed(3)})/${TRANSITION_DURATION.toFixed(3)},${expr}))`
      } else {
        // Fade out: 1 -> 0
        expr = `if(gte(T,${tEnd.toFixed(3)}),0,if(gte(T,${t.toFixed(3)}),(${tEnd.toFixed(3)}-T)/${TRANSITION_DURATION.toFixed(3)},${expr}))`
      }
    } else {
      expr = `if(gte(T,${t.toFixed(3)}),${curr.pipVisible ? '1' : '0'},${expr})`
    }
  }
  return expr
}

function buildCamFullAlphaExpr(keyframes) {
  if (keyframes.length === 1) return keyframes[0].cameraFullscreen ? '1' : '0'
  let expr = keyframes[0].cameraFullscreen ? '1' : '0'
  for (let i = 1; i < keyframes.length; i++) {
    const prev = keyframes[i - 1]
    const curr = keyframes[i]
    const t = curr.time
    const tEnd = t + TRANSITION_DURATION
    const prevFull = prev.cameraFullscreen || false
    const currFull = curr.cameraFullscreen || false

    if (prevFull !== currFull) {
      if (currFull) {
        // Fade in: 0 -> 1
        expr = `if(gte(T,${tEnd.toFixed(3)}),1,if(gte(T,${t.toFixed(3)}),(T-${t.toFixed(3)})/${TRANSITION_DURATION.toFixed(3)},${expr}))`
      } else {
        // Fade out: 1 -> 0
        expr = `if(gte(T,${tEnd.toFixed(3)}),0,if(gte(T,${t.toFixed(3)}),(${tEnd.toFixed(3)}-T)/${TRANSITION_DURATION.toFixed(3)},${expr}))`
      }
    } else {
      expr = `if(gte(T,${t.toFixed(3)}),${currFull ? '1' : '0'},${expr})`
    }
  }
  return expr
}

// ===== Scribe Token Generation =====

ipcMain.handle('get-scribe-token', async () => {
  try {
    const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js')
    const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY })
    const response = await client.tokens.singleUse.create('realtime_scribe')
    return response.token
  } catch (err) {
    console.error('Failed to get Scribe token:', err)
    throw err
  }
})

// ===== Trim Silence =====

ipcMain.handle('trim-silence', async (event, opts) => {
  const { screenPath, cameraPath, segments, outputFolder } = opts
  const ffmpegPath = require('ffmpeg-static')
  const paddingSeconds = Number.isFinite(Number(opts?.paddingSeconds))
    ? Math.max(0, Number(opts.paddingSeconds))
    : 0.15

  // Add padding and merge overlapping segments
  const safeSegments = Array.isArray(segments) ? segments : []
  if (safeSegments.length === 0) {
    return {
      sections: [],
      trimmedDuration: 0,
      screenPath: null,
      cameraPath: null
    }
  }

  let padded = safeSegments.map(s => ({
    start: Math.max(0, s.start - paddingSeconds),
    end: s.end + paddingSeconds
  }))

  // Sort by start time
  padded.sort((a, b) => a.start - b.start)

  // Merge overlapping/adjacent segments
  const merged = [padded[0]]
  for (let i = 1; i < padded.length; i++) {
    const last = merged[merged.length - 1]
    if (padded[i].start < last.end) {
      last.end = Math.max(last.end, padded[i].end)
    } else {
      merged.push(padded[i])
    }
  }

  function buildRemappedSections(segmentsToMap) {
    const remapped = []
    let timelineCursor = 0

    for (let i = 0; i < segmentsToMap.length; i++) {
      const seg = segmentsToMap[i]
      const sourceStart = Number(seg.start.toFixed(3))
      const sourceEnd = Number(seg.end.toFixed(3))
      const sectionDuration = Math.max(0, sourceEnd - sourceStart)
      const start = Number(timelineCursor.toFixed(3))
      const end = Number((timelineCursor + sectionDuration).toFixed(3))

      remapped.push({
        id: `section-${i + 1}`,
        index: i,
        sourceStart,
        sourceEnd,
        start,
        end,
        duration: Number(sectionDuration.toFixed(3))
      })

      timelineCursor += sectionDuration
    }

    return remapped
  }

  function buildTrimFilter(merged) {
    const parts = []
    const labels = []

    for (let i = 0; i < merged.length; i++) {
      const s = merged[i].start.toFixed(3)
      const e = merged[i].end.toFixed(3)
      parts.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`)
      parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`)
      labels.push(`[v${i}][a${i}]`)
    }

    parts.push(`${labels.join('')}concat=n=${merged.length}:v=1:a=1[outv][outa]`)
    return parts.join(';')
  }

  function trimFile(inputPath) {
    const ext = path.extname(inputPath)
    const base = path.basename(inputPath, ext)
    const outputPath = path.join(outputFolder, `${base}-trimmed${ext}`)
    const filter = buildTrimFilter(merged)

    const args = [
      '-i', inputPath,
      '-filter_complex', filter,
      '-map', '[outv]', '-map', '[outa]',
      '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
      '-c:a', 'libopus',
      '-y', outputPath
    ]

    return new Promise((resolve, reject) => {
      execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          console.error('FFmpeg trim stderr:', stderr)
          reject(stderr || error.message)
        } else {
          resolve(outputPath)
        }
      })
    })
  }

  const results = {}
  const remappedSections = buildRemappedSections(merged)
  results.sections = remappedSections
  results.trimmedDuration = remappedSections.length > 0
    ? remappedSections[remappedSections.length - 1].end
    : 0

  // Run in parallel for screen and camera
  const promises = []
  if (screenPath) {
    promises.push(trimFile(screenPath).then(p => { results.screenPath = p }))
  }
  if (cameraPath) {
    promises.push(trimFile(cameraPath).then(p => { results.cameraPath = p }))
  }

  await Promise.all(promises)
  return results
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
