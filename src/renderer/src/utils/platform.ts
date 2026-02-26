import { Capacitor } from '@capacitor/core';

// 判断是否是 Electron 环境
export const isElectron = () => {
  return !!window.myElectronAPI;
};

// 判断是否是移动端 App (iOS / Android)
export const isMobileApp = () => {
  return Capacitor.isNativePlatform();
};

// 判断是否是纯网页 (运行 npm run dev 在浏览器里调试)
export const isWeb = () => {
  return !isElectron() && !isMobileApp();
};