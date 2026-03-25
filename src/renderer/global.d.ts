import type { ElectronApi } from '../shared/electron-api';

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}

export {};
