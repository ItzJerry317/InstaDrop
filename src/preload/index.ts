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
  }
};

declare global {
  interface Window {
    myElectronAPI: typeof electronAPI;
  }
}

// 将 API 暴露到全局的 window.myElectronAPI 上
contextBridge.exposeInMainWorld('myElectronAPI', electronAPI);