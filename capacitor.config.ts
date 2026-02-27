import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.instadrop.app',
  appName: 'InstaDrop',
  webDir: 'out/renderer',
  bundledWebRuntime: false,
  server: {
    url: 'http://10.0.2.2:5173',
    cleartext: true
  }
};

export default config;
