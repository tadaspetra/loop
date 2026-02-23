require('electron-reload')(__dirname)
const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, shell } = require('electron')
const path = require('path')
const fs = require('fs')

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 700,
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

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
