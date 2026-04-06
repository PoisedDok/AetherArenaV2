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
  safeStorage?: {
    encrypt: (plaintext: string) => Promise<string>;
    decrypt: (encryptedBase64: string) => Promise<string>;
  };
}

declare global {
  interface Window {
    deerflowDesktop?: DeerflowDesktopBridge;
  }
}

export {};
