import { ElectronAPI } from '@electron-toolkit/preload'
import { SystemInfo } from '../shared/types'

declare global {
  interface MyElectronAPI {
    getSystemInfo(): Promise<SystemInfo>
    ping(): Promise<number>
    closeWindow(): void
    getFilePath(file: File): string
    minimizeWindow(): void
    getWindowStatus(): Promise<string>
    toggleWindowStatus(): void
    onWindowStateChanged(cb: (state: string) => void): () => void
    getFileInfo(filePath: string): Promise<{ name: string; size: number }>
    readFileChunk(filePath: string, offset: number, chunkSize: number): Promise<ArrayBuffer | Uint8Array>
    startReceiveFile(fileName: string, fileSize: number, savePath?: string): Promise<{ success: boolean; path?: string }>
    receiveFileChunk(chunk: ArrayBuffer): Promise<void>
    finishReceiveFile(): Promise<void>
    startReceiveServer(saveDir?: string): Promise<{ success: boolean; url?: string }>
    stopReceiveServer(): Promise<{ success: boolean }>
    uploadFileToUrl(filePath: string, url: string): Promise<void>
    onReceiveProgress(cb: (chunkLength: number) => void): () => void
    onReceiveDone(cb: (filePath: string) => void): () => void
    openDownloadsFolder(path?: string): Promise<void>
    selectFolder(): Promise<string | null>
    getAutoStartStatus(): Promise<boolean>
    setAutoStart(enable: boolean): Promise<boolean>
  }

  interface Window {
    electron: ElectronAPI
    api: unknown
    myElectronAPI: MyElectronAPI
  }
}
