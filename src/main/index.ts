import { app, shell, BrowserWindow, ipcMain, nativeTheme, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { SystemInfo } from '../shared/types';
import chalk from 'chalk';
import fs from 'fs'
import path from 'path'
import http from 'http'
import os from 'os'
import url from 'url'
import https from 'https'
//声明chalk等级
chalk.level = 2;
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns')

let currentWriteStream: fs.WriteStream | null = null
let currentReceivedPath: string = ''

let receiveServer: http.Server | null = null
let receiveServerUrl: string | null = null

const sendToRenderer = (channel: string, ...args: any[]) => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  if (win) win.webContents.send(channel, ...args)
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 670,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    },
    title: 'InstaDrop'
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-status-changed', 'maximized')
    console.log(chalk.blue('窗口已最大化'))
  })

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-status-changed', 'unmaximized')
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('get-auto-start-status', () => {
    const settings = app.getLoginItemSettings()
    return settings.openAtLogin
  })

  // 设置开机自启状态
  ipcMain.handle('set-auto-start', (_event, enable: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enable,
      path: app.getPath('exe') // 明确指定当前执行程序的路径 (Windows 强依赖此项)
    })
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('select-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      title: '选择保存位置'
    })
    if (canceled) {
      return null
    } else {
      return filePaths[0]
    }
  })


  // IPC test
  ipcMain.handle('ping', () => {
    return 'pong'
  });

  ipcMain.handle('get-system-info', async (): Promise<SystemInfo> => {
    return {
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
      electronVersion: process.versions.electron,
      isDarkMode: nativeTheme.shouldUseDarkColors
    };
  });

  // 获取文件基本信息 (名字、大小)
  ipcMain.handle('get-file-info', async (_event, filePath: string) => {
    const stats = await fs.promises.stat(filePath)
    return {
      name: path.basename(filePath),
      size: stats.size
    }
  })

  // 核心：读取文件的指定“切片” (比如从第 1024 字节开始，读取 64KB 数据)
  ipcMain.handle('read-file-chunk', async (_event, filePath: string, offset: number, chunkSize: number) => {
    const fileHandle = await fs.promises.open(filePath, 'r')
    const buffer = Buffer.alloc(chunkSize)
    // 读取数据填入 buffer
    const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, offset)
    await fileHandle.close()

    // 返回实际读到的字节 (Electron 会自动把它转成前端可用的 Uint8Array)
    return buffer.slice(0, bytesRead)
  })

  ipcMain.on('close-window', () => {
    const currentWindow = BrowserWindow.getFocusedWindow();
    console.log(chalk.yellow('收到关闭窗口请求'))
    if (currentWindow) {
      console.log(chalk.yellow('正在关闭窗口...'));
      currentWindow.hide()
      setTimeout(() => {
        try {
          currentWindow.webContents.session.flushStorageData();
        } catch (e) {
          console.log("保存localStorage出现错误：", e);
        } finally {
          currentWindow.close();
        }
      }, 50)
    }
  });

  ipcMain.on('minimize-window', () => {
    const currentWindow = BrowserWindow.getFocusedWindow();
    if (currentWindow) {
      currentWindow.minimize();
    }
  });

  ipcMain.handle('get-window-status', () => {
    const currentWindow = BrowserWindow.getFocusedWindow();
    if (currentWindow) {
      return currentWindow.isMaximized() ? 'mdi-window-restore' : 'mdi-window-maximize';
    }
    return 'mdi-window-maximize';
  });

  ipcMain.on('toggle-window-status', () => {
    const currentWindow = BrowserWindow.getFocusedWindow();
    if (currentWindow) {
      if (currentWindow.isMaximized()) {
        currentWindow.unmaximize();
      } else {
        currentWindow.maximize();
      }
    }
  });

  // ==========================================
  //  文件接收 API (Receive Logic)
  // ==========================================

  // 新增：启动本地 HTTP 接收服务器（返回一个可在局域网访问的 URL）
  ipcMain.handle('start-receive-server', async (_event, saveDir?: string) => {
    if (receiveServer) {
      return { success: true, url: receiveServerUrl }
    }

    // 确定保存目录
    let targetFolder = ''
    if (saveDir && fs.existsSync(saveDir)) {
      targetFolder = saveDir
    } else {
      const downloadsPath = app.getPath('downloads')
      targetFolder = path.join(downloadsPath, 'Instadrop')
    }
    if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true })

    receiveServer = http.createServer((req, res) => {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'x-filename,content-type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (req.url !== '/upload' || req.method !== 'POST') {
        res.statusCode = 404
        res.end('Not Found')
        return
      }

      const rawName = (req.headers['x-filename'] as string) || `unknown-${Date.now()}`
      let fileName = ''
      try { fileName = decodeURIComponent(rawName) } catch { fileName = rawName }

      // 防重名
      const ext = path.extname(fileName)
      const name = path.basename(fileName, ext)
      let finalFileName = fileName
      let counter = 1
      let fullPath = path.join(targetFolder, finalFileName)
      while (fs.existsSync(fullPath)) {
        finalFileName = `${name} (${counter})${ext}`
        fullPath = path.join(targetFolder, finalFileName)
        counter++
      }

      const writeStream = fs.createWriteStream(fullPath)

      req.on('data', (chunk: Buffer) => {
        // forward incremental progress to renderer
        sendToRenderer('receive-progress', chunk.length)
      })

      req.pipe(writeStream)

      writeStream.on('finish', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
        sendToRenderer('receive-done', fullPath)
      })

      writeStream.on('error', (err) => {
        console.error('写入错误', err)
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: String((err && (err as any).message) || err) }))
        } catch (e) {
          // ignore
        }
      })

      req.on('aborted', () => {
        writeStream.destroy()
      })
    })

    await new Promise<void>((resolve, reject) => {
      receiveServer!.listen(0, '0.0.0.0', () => resolve())
      receiveServer!.once('error', reject)
    })

    const addr = receiveServer!.address() as any
    const port = addr.port

    // pick a LAN IPv4 address
    const nets = os.networkInterfaces()
    let ip = '127.0.0.1'
    for (const name of Object.keys(nets)) {
      for (const ni of nets[name]!) {
        if (ni.family === 'IPv4' && !ni.internal) {
          ip = ni.address
          break
        }
      }
      if (ip !== '127.0.0.1') break
    }

    receiveServerUrl = `http://${ip}:${port}`
    return { success: true, url: receiveServerUrl }
  })

  ipcMain.handle('stop-receive-server', async () => {
    if (!receiveServer) return { success: true }
    return new Promise((resolve) => {
      receiveServer!.close(() => {
        receiveServer = null
        receiveServerUrl = null
        resolve({ success: true })
      })
    })
  })

  // Electron helper: upload local file to remote HTTP endpoint
  ipcMain.handle('upload-file-to-url', async (_event, filePath: string, targetUrl: string) => {
    return new Promise<void>((resolve, reject) => {
      if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.trim() === '') {
        const err = new Error('Invalid target URL: empty')
        console.error('upload-file-to-url called with empty targetUrl', { filePath, targetUrl })
        return reject(err)
      }

      let parsed: url.URL
      try {
        parsed = new url.URL(targetUrl)
      } catch (e: any) {
        console.error('upload-file-to-url: invalid URL', targetUrl, e)
        return reject(new Error('Invalid target URL: ' + String((e && (e as any).message) || String(e))))
      }

      try {
        const isHttps = parsed.protocol === 'https:'
        const mod = isHttps ? https : http
        const filename = encodeURIComponent(path.basename(filePath))
        const options: any = {
          method: 'POST',
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: (parsed.pathname || '/') + (parsed.search || '') + '/upload',
          headers: {
            'x-filename': filename,
            'Content-Type': 'application/octet-stream'
          }
        }
        console.log('upload-file-to-url: uploading', { filePath, to: targetUrl, options })
        const req = mod.request(options, (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve()
          } else {
            const err = new Error('Upload failed: ' + res.statusCode)
            console.error('upload-file-to-url failed', { status: res.statusCode })
            reject(err)
          }
        })
        req.on('error', (err) => {
          console.error('upload-file-to-url request error', err)
          reject(err)
        })
        const rs = fs.createReadStream(filePath)
        rs.on('error', (err) => {
          console.error('upload-file-to-url readStream error', err)
          reject(err)
        })
        rs.pipe(req)
      } catch (e) {
        console.error('upload-file-to-url unexpected error', e)
        reject(e)
      }
    })
  })


  // 1. 开始接收：创建文件流
  ipcMain.handle('start-receive-file', async (_event, fileName: string, _fileSize: number, saveDirectory?: string) => {
    try {
      let targetFolder = ''

      if (saveDirectory && fs.existsSync(saveDirectory)) {
        targetFolder = saveDirectory
      } else {
        const downloadsPath = app.getPath('downloads')
        targetFolder = path.join(downloadsPath, 'Instadrop')
      }

      // 确保 Instadrop 文件夹存在
      if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true })
      }

      // 处理文件名冲突 (自动重命名: file.txt -> file (1).txt)
      let finalFileName = fileName
      let counter = 1
      let fullPath = path.join(targetFolder, finalFileName)
      const ext = path.extname(fileName)
      const name = path.basename(fileName, ext)

      while (fs.existsSync(fullPath)) {
        finalFileName = `${name} (${counter})${ext}`
        fullPath = path.join(targetFolder, finalFileName)
        counter++
      }

      currentReceivedPath = fullPath
      // 创建写入流
      currentWriteStream = fs.createWriteStream(fullPath)
      console.log('开始写入文件:', fullPath)
      return { success: true, path: fullPath }
    } catch (error) {
      console.error('创建文件失败:', error)
      throw error
    }
  })

  // 2. 接收切片：写入流
  ipcMain.handle('receive-file-chunk', async (_event, chunk: ArrayBuffer) => {
    if (!currentWriteStream) {
      throw new Error('没有活动的文件写入流')
    }

    // 将 ArrayBuffer 转为 Node.js Buffer
    const buffer = Buffer.from(chunk)

    // 处理背压 (Backpressure)：如果缓冲区满了，等待 'drain' 事件再继续
    // 这对于大文件传输至关重要，防止内存泄漏
    return new Promise<void>((resolve, reject) => {
      const canContinue = currentWriteStream?.write(buffer)
      if (canContinue) {
        resolve()
      } else {
        currentWriteStream?.once('drain', resolve)
        currentWriteStream?.once('error', reject)
      }
    })
  })

  // 3. 接收完成：关闭流
  ipcMain.handle('finish-receive-file', async () => {
    return new Promise<void>((resolve) => {
      if (currentWriteStream) {
        currentWriteStream.end(() => {
          console.log('文件写入完成:', currentReceivedPath)
          currentWriteStream = null
          resolve()
        })
      } else {
        resolve()
      }
    })
  })

  // 4. 打开下载文件夹
  ipcMain.handle('open-downloads-folder', (_event, customPath?: string) => {
    // 情况 A: 刚刚接收完文件，且文件存在 -> 优先在文件夹里选中该文件
    if (currentReceivedPath && fs.existsSync(currentReceivedPath)) {
      shell.showItemInFolder(currentReceivedPath)
      return
    }

    // 情况 B: 用户设置了自定义路径，且路径存在 -> 打开该文件夹
    if (customPath && fs.existsSync(customPath)) {
      shell.openPath(customPath)
      return
    }

    // 情况 C: 兜底 -> 打开默认的 下载/Instadrop 文件夹
    const defaultInstadropPath = path.join(app.getPath('downloads'), 'Instadrop')
    if (fs.existsSync(defaultInstadropPath)) {
      shell.openPath(defaultInstadropPath)
    } else {
      shell.openPath(app.getPath('downloads'))
    }
  })

  createWindow()
  console.log(chalk.green('主进程已启动'))

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// 注册 IPC 处理器，注意这里的返回类型我们声明为 Promise<SystemInfo>