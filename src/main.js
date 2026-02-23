require('electron-reload')(__dirname)
const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')

let win = null

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

ipcMain.handle('pick-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled || !filePaths.length) return null
  return filePaths[0]
})

ipcMain.handle('open-folder', async (event, folder) => {
  shell.openPath(folder)
})

ipcMain.handle('save-video', async (event, buffer, folder, suffix) => {
  const filename = `recording-${Date.now()}${suffix ? '-' + suffix : ''}.webm`
  const filePath = path.join(folder, filename)
  fs.writeFileSync(filePath, Buffer.from(buffer))
  return filePath
})

ipcMain.handle('render-composite', async (event, opts) => {
  const { screenPath, cameraPath, keyframes, pipSize, screenFitMode, sourceWidth, sourceHeight, outputFolder } = opts
  const ffmpegPath = require('ffmpeg-static')
  const outputPath = path.join(outputFolder, `recording-${Date.now()}-edited.mp4`)

  // Canvas coordinates are 1920x1080; scale to source video resolution
  const canvasW = 1920
  const canvasH = 1080

  let args = ['-i', screenPath]

  if (cameraPath && keyframes && keyframes.some(kf => kf.pipVisible)) {
    args.push('-i', cameraPath)
    const filterComplex = buildFilterComplex(keyframes, pipSize, sourceWidth, sourceHeight, canvasW, canvasH)
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

function buildFilterComplex(keyframes, pipSize, sourceWidth, sourceHeight, canvasW, canvasH) {
  // Scale everything from canvas coords (1920x1080) to source video resolution
  const scaleX = sourceWidth / canvasW
  const scaleY = sourceHeight / canvasH
  const actualPipSize = Math.round(pipSize * scaleX)
  const r = Math.round(12 * scaleX)
  const maxCoord = actualPipSize - 1 - r
  const rSq = r * r

  // Scale keyframe positions to source resolution
  const scaledKeyframes = keyframes.map(kf => ({
    ...kf,
    pipX: Math.round(kf.pipX * scaleX),
    pipY: Math.round(kf.pipY * scaleY)
  }))

  // Camera: crop center square, scale to pip size, apply rounded corner alpha mask
  const camFilter = `[1:v]crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=${actualPipSize}:${actualPipSize},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*lte(pow(max(0,max(${r}-X,X-${maxCoord})),2)+pow(max(0,max(${r}-Y,Y-${maxCoord})),2),${rSq})'[cam]`

  const xExpr = buildPosExpr(scaledKeyframes, 'pipX')
  const yExpr = buildPosExpr(scaledKeyframes, 'pipY')
  const enableExpr = buildVisExpr(keyframes)

  // Overlay camera directly on source video — no screen scaling
  return `${camFilter};[0:v][cam]overlay=x='${xExpr}':y='${yExpr}':enable='${enableExpr}':format=auto[out]`
}

function buildPosExpr(keyframes, prop) {
  if (keyframes.length === 1) return String(Math.round(keyframes[0][prop]))
  let expr = String(Math.round(keyframes[0][prop]))
  for (let i = 1; i < keyframes.length; i++) {
    expr = `if(gte(t,${keyframes[i].time.toFixed(3)}),${Math.round(keyframes[i][prop])},${expr})`
  }
  return expr
}

function buildVisExpr(keyframes) {
  if (keyframes.length === 1) return keyframes[0].pipVisible ? '1' : '0'
  let expr = keyframes[0].pipVisible ? '1' : '0'
  for (let i = 1; i < keyframes.length; i++) {
    expr = `if(gte(t,${keyframes[i].time.toFixed(3)}),${keyframes[i].pipVisible ? '1' : '0'},${expr})`
  }
  return expr
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
