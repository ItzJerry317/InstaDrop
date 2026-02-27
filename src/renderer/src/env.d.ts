/// <reference types="vite/client" />
// 引入你在 shared 里定义的类型
import { SystemInfo } from '../../shared/types';

declare global {
  interface Window {
    myElectronAPI: {
      getSystemInfo: () => Promise<SystemInfo>;
      ping: () => Promise<number>;
      closeWindow: () => void;
      getFilePath: (file: File) => string;
      minimizeWindow: () => void;
      getWindowStatus: () => Promise<string>;
      toggleWindowStatus: () => void;
      onWindowStateChanged: (callback: (state: string) => void) => void;
      getFileInfo: (filePath: string) => Promise<{name: string, size: number}>;
      readFileChunk: (filePath: string, offset: number, chunkSize: number) => Promise<Uint8Array>;
      startReceiveFile: (fileName: string, fileSize: number, savePath?: string) => Promise<void>
      receiveFileChunk: (chunk: ArrayBuffer) => Promise<void>
      finishReceiveFile: () => Promise<void>
      openDownloadsFolder: (path?: string) => Promise<void>
      selectFolder: () => Promise<string | null>
      getAutoStartStatus: () => Promise<boolean>
      setAutoStart: (enable: boolean) => Promise<boolean>;
    }
  }
}