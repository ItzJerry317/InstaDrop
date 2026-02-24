import { app, shell, BrowserWindow, ipcMain, nativeTheme} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { SystemInfo } from '../shared/types';
import chalk from 'chalk';
import fs from 'fs'
import path from 'path'
//声明chalk等级
chalk.level = 2;
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns')

let currentWriteStream: fs.WriteStream | null = null
let currentReceivedPath: string = ''

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
      console.log(chalk.yellow('正在关闭窗口...\n正在存储LocalStorage数据...'));
      currentWindow.webContents.session.flushStorageData();
      currentWindow.close();
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
  // 📁 文件接收 API (Receive Logic)
  // ==========================================

  // 1. 开始接收：创建文件流
  ipcMain.handle('start-receive-file', async (_event, fileName: string, fileSize: number) => {
    try {
      const downloadsPath = app.getPath('downloads')
      const instadropPath = path.join(downloadsPath, 'Instadrop')

      // 确保 Instadrop 文件夹存在
      if (!fs.existsSync(instadropPath)) {
        console.log('Instadrop 文件夹不存在，正在创建...')
        fs.mkdirSync(instadropPath, { recursive: true })
      }

      // 处理文件名冲突 (自动重命名: file.txt -> file (1).txt)
      let finalFileName = fileName
      let counter = 1
      let fullPath = path.join(instadropPath, finalFileName)
      const ext = path.extname(fileName)
      const name = path.basename(fileName, ext)

      while (fs.existsSync(fullPath)) {
        finalFileName = `${name} (${counter})${ext}`
        fullPath = path.join(instadropPath, finalFileName)
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
  ipcMain.handle('open-downloads-folder', () => {
    // 如果有刚接收的文件，直接定位选中它；否则只打开文件夹
    if (currentReceivedPath && fs.existsSync(currentReceivedPath)) {
      shell.showItemInFolder(currentReceivedPath)
    } else {
      const folder = path.join(app.getPath('downloads'), 'Instadrop')
      if (fs.existsSync(folder)) {
        shell.openPath(folder)
      } else {
        shell.openPath(app.getPath('downloads'))
      }
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