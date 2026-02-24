import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { SystemInfo } from '../shared/types';

// 定义我们要暴露给前端的 API 对象
const electronAPI = {
  // 调用主进程的方法，并返回 Promise
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
    ipcRenderer.on('window-status-changed', (_event, state) => {
      callback(state);
    });
  },
  getFileInfo: (filePath: string) => ipcRenderer.invoke('get-file-info', filePath),
  readFileChunk: (filePath: string, offset: number, chunkSize: number) => ipcRenderer.invoke('read-file-chunk', filePath, offset, chunkSize),
  startReceiveFile: (fileName: string, fileSize: number, savePath?: string) => ipcRenderer.invoke('start-receive-file', fileName, fileSize, savePath),
  receiveFileChunk: (chunk: ArrayBuffer) => ipcRenderer.invoke('receive-file-chunk', chunk),
  finishReceiveFile: () => ipcRenderer.invoke('finish-receive-file'),
  openDownloadsFolder: (path?: string) => ipcRenderer.invoke('open-downloads-folder', path),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
};

declare global {
  interface Window {
    myElectronAPI: typeof electronAPI;
  }
}

// 将 API 暴露到全局的 window.myElectronAPI 上
contextBridge.exposeInMainWorld('myElectronAPI', electronAPI);