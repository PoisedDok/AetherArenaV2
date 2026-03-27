export interface DeerflowDesktopBridge {
  isElectron?: boolean;
  platform?: string;
  getSystemUserName?: () => string;
  versions?: {
    deerflow?: string;
    electron?: string;
    node?: string;
    chrome?: string;
  };
}

declare global {
  interface Window {
    deerflowDesktop?: DeerflowDesktopBridge;
  }
}

export {};
