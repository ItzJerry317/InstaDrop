import { contextBridge, ipcRenderer } from 'electron';
import { SystemInfo } from '../shared/types';

// 定义我们要暴露给前端的 API 对象
const electronAPI = {
  // 调用主进程的方法，并返回 Promise
  getSystemInfo: (): Promise<SystemInfo> => ipcRenderer.invoke('get-system-info'),
  ping: () => ipcRenderer.send('ping'),
  closeWindow: () => ipcRenderer.send('close-window')
};

declare global {
  interface Window {
    myElectronAPI: typeof electronAPI;
  }
}

// 将 API 暴露到全局的 window.myElectronAPI 上
contextBridge.exposeInMainWorld('myElectronAPI', electronAPI);