/**
 * AetherArena v2 — Electron preload
 *
 * Context-isolated bridge for the renderer (web UI) and the main process.
 * MIT License
 */

const { contextBridge, ipcRenderer } = require('electron');

const skipHealthCheck = process.env.DEERFLOW_SKIP_HEALTH === '1';

/** Match AetherArena main windows: macOS vibrancy + Win background material; else CSS fallback. */
const glassBackgroundMode =
  process.env.DEERFLOW_DISABLE_NATIVE_WINDOW_EFFECTS === '1'
    ? 'css'
    : process.platform === 'darwin' || process.platform === 'win32'
      ? 'native'
      : 'css';

/**
 * Expose minimal API to the renderer process
 * All methods are read-only and safe
 */
contextBridge.exposeInMainWorld('deerflowDesktop', {
  platform: process.platform,

  versions: {
    deerflow: '2.x',
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },

  isElectron: true,

  /** When true, splash skips backend health and loads the web UI immediately (UI dev). */
  skipHealthCheck,

  /** `native`: transparent window + system glass (see main.js). `css`: painted mesh fallback. */
  glassBackgroundMode,

  checkBackendHealth: () => ipcRenderer.invoke('deerflow:backend-health'),

  loadMainApp: () => ipcRenderer.invoke('deerflow:load-main-app'),

  quitApp: () => ipcRenderer.invoke('deerflow:quit-app'),

  safeStorage: {
    encrypt: (plaintext) => ipcRenderer.invoke('deerflow:safe-storage:encrypt', plaintext),
    decrypt: (encryptedBase64) => ipcRenderer.invoke('deerflow:safe-storage:decrypt', encryptedBase64),
  },
});
