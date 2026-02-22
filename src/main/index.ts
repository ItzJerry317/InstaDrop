import { app, shell, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { SystemInfo } from '../shared/types';
import chalk from 'chalk';
//声明chalk等级
chalk.level = 2;

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
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