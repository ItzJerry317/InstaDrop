import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { SystemInfo } from '../shared/types';

// 定义我们要暴露给前端的 API 对象
const electronAPI = {
  getSystemInfo: (): Promise<SystemInfo> => ipcRenderer.invoke('get-system-info'),
  ping: async (): Promise<number> => {
    const startTime = Date.now();
    const result = await ipcRenderer.invoke('ping')
    const endTime = Date.now();
    const latency = endTime - startTime;
    console.log(`%c${result} received! Latency: ${latency}ms`, 'color: #00BFFF; font-weight: bold;');
    return latency;
  },
  closeWindow: () => ipcRenderer.send('close-window'),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  getWindowStatus: () => ipcRenderer.invoke('get-window-status'),
  toggleWindowStatus: () => ipcRenderer.send('toggle-window-status'),
  onWindowStateChanged: (callback: (state: string) => void) => {
    const listener = (_event: any, state: string) => callback(state)
    ipcRenderer.on('window-status-changed', listener);
    return () => ipcRenderer.removeListener('window-status-changed', listener)
  },
  getFileInfo: (filePath: string) => ipcRenderer.invoke('get-file-info', filePath),
  readFileChunk: (filePath: string, offset: number, chunkSize: number) => ipcRenderer.invoke('read-file-chunk', filePath, offset, chunkSize),
  startReceiveFile: (fileName: string, fileSize: number, savePath?: string) => ipcRenderer.invoke('start-receive-file', fileName, fileSize, savePath),
  receiveFileChunk: (chunk: ArrayBuffer) => ipcRenderer.invoke('receive-file-chunk', chunk),
  finishReceiveFile: () => ipcRenderer.invoke('finish-receive-file'),
  openDownloadsFolder: (path?: string) => ipcRenderer.invoke('open-downloads-folder', path),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getAutoStartStatus: () => ipcRenderer.invoke('get-auto-start-status'),
  setAutoStart: (enable: boolean) => ipcRenderer.invoke('set-auto-start', enable),

  // NEW: start/stop HTTP receive server
  startReceiveServer: (saveDir?: string) => ipcRenderer.invoke('start-receive-server', saveDir),
  stopReceiveServer: () => ipcRenderer.invoke('stop-receive-server'),
  uploadFileToUrl: (filePath: string, url: string) => ipcRenderer.invoke('upload-file-to-url', filePath, url),

  // NEW: receive progress / done with unsubscribe
  onReceiveProgress: (callback: (chunkLength: number) => void) => {
    const listener = (_: any, length: number) => callback(length)
    ipcRenderer.on('receive-progress', listener)
    return () => ipcRenderer.removeListener('receive-progress', listener)
  },
  onReceiveDone: (callback: (filePath: string) => void) => {
    const listener = (_: any, path: string) => callback(path)
    ipcRenderer.on('receive-done', listener)
    return () => ipcRenderer.removeListener('receive-done', listener)
  },

  onUploadProgress: (callback: (sentBytes: number) => void) => {
    const listener = (_: any, bytes: number) => callback(bytes)
    ipcRenderer.on('upload-progress', listener)
    return () => ipcRenderer.removeListener('upload-progress', listener)
  }
};

declare global {
  interface Window {
    myElectronAPI: typeof electronAPI;
  }
}

contextBridge.exposeInMainWorld('myElectronAPI', electronAPI);