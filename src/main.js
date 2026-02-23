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

  // Camera: crop center square, scale to pip size, apply rounded corner alpha mask with fade
  const alphaExpr = buildAlphaExpr(keyframes)
  const roundCorner = `lte(pow(max(0,max(${r}-X,X-${maxCoord})),2)+pow(max(0,max(${r}-Y,Y-${maxCoord})),2),${rSq})`
  const camFilter = `[1:v]setpts=PTS-STARTPTS,crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(iw,ih))/2',scale=${actualPipSize}:${actualPipSize},format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*${roundCorner}*(${alphaExpr})'[cam]`

  const xExpr = buildPosExpr(scaledKeyframes, 'pipX')
  const yExpr = buildPosExpr(scaledKeyframes, 'pipY')

  return `${screenFilter};${camFilter};[screen][cam]overlay=x='${xExpr}':y='${yExpr}':format=auto[out]`
}

const TRANSITION_DURATION = 0.3

function buildPosExpr(keyframes, prop) {
  if (keyframes.length === 1) return String(Math.round(keyframes[0][prop]))
  let expr = String(Math.round(keyframes[0][prop]))
  for (let i = 1; i < keyframes.length; i++) {
    const prevVal = Math.round(keyframes[i - 1][prop])
    const currVal = Math.round(keyframes[i][prop])
    const t = keyframes[i].time
    const tStart = Math.max(keyframes[i - 1].time, t - TRANSITION_DURATION)
    const dur = t - tStart

    if (prevVal !== currVal && dur > 0) {
      const diff = currVal - prevVal
      expr = `if(gte(t,${t.toFixed(3)}),${currVal},if(gte(t,${tStart.toFixed(3)}),${prevVal}+${diff}*(t-${tStart.toFixed(3)})/${dur.toFixed(3)},${expr}))`
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

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
