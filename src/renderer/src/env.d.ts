/// <reference types="vite/client" />
// 引入你在 shared 里定义的类型
import { SystemInfo } from '../../shared/types';

declare global {
  interface Window {
    myElectronAPI: {
      getSystemInfo: () => Promise<SystemInfo>;
      ping: () => Promise<number>;
      closeWindow: () => void;
    }
  }
}