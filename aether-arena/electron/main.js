/**
 * AetherArena v2 — Electron desktop shell
 *
 * Loads the web UI from localhost:2026. Does not embed the Python backend.
 *
 * Window chrome matches AetherArena main windows: transparent + macOS vibrancy /
 * Windows background material so system glass shows through (not CSS-only fake).
 *
 * MIT License
 */

const { app, BrowserWindow, shell, ipcMain, nativeTheme, session, safeStorage } = require('electron');
const path = require('path');

const DEERFLOW_URL = 'http://localhost:2026';
const HEALTH_CHECK_URL = 'http://localhost:2026/health';

/** Set DEERFLOW_DISABLE_NATIVE_WINDOW_EFFECTS=1 to use opaque window + CSS splash only. */
const ENABLE_NATIVE_WINDOW_EFFECTS = process.env.DEERFLOW_DISABLE_NATIVE_WINDOW_EFFECTS !== '1';

let mainWindow = null;

/**
 * Flush the default session cookie jar to disk. Electron/Chromium may defer
 * writes, so an explicit flush ensures persistent cookies (rememberMe sessions
 * set by better-auth) survive process restarts.
 */
async function flushCookies() {
  try {
    const defaultSession = session.fromPartition('persist:aether-arena');
    await defaultSession.cookies.flushStore();
  } catch {
    /* Best-effort — do not block shutdown */
  }
}

function registerIpcHandlers() {
  ipcMain.handle('aether:backend-health', async () => checkBackendHealth());

  ipcMain.handle('aether:load-main-app', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    await mainWindow.loadURL(DEERFLOW_URL);
  });

  ipcMain.handle('aether:quit-app', async () => {
    await flushCookies();
    app.quit();
  });

  ipcMain.handle('aether:safe-storage:encrypt', async (_event, plaintext) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption not available');
    }
    const encrypted = safeStorage.encryptString(plaintext);
    return encrypted.toString('base64');
  });

  ipcMain.handle('aether:safe-storage:decrypt', async (_event, encryptedBase64) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption not available');
    }
    const buffer = Buffer.from(encryptedBase64, 'base64');
    return safeStorage.decryptString(buffer);
  });
}

/**
 * BrowserWindow options aligned with AetherArena MainWindow / ChatWindow / ArtifactsWindow.
 */
function buildWindowOptions() {
  const base = {
    width: 780,
    height: 860,
    minWidth: 600,
    minHeight: 560,
    title: 'AetherArena v2',
    titleBarStyle: 'default',
    /** Windows 11 / macOS — native rounded window shape (not a sharp rectangle). */
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      /**
       * Use a named persistent partition so cookies/storage survive restarts.
       * 'persist:' prefix creates a persistent (not in-memory) session.
       */
      partition: 'persist:aether-arena',
    },
  };

  if (ENABLE_NATIVE_WINDOW_EFFECTS && process.platform === 'darwin') {
    return {
      ...base,
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'under-window',
      visualEffectState: 'active',
      /**
       * Frameless + vibrancy/rounded shell — must keep native traffic lights.
       * `hiddenInset` draws close/minimize/zoom over the content (same window for splash + main URL).
       * Do not use plain `frame: false` without this or traffic lights disappear.
       */
      frame: false,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 12 },
    };
  }

  if (ENABLE_NATIVE_WINDOW_EFFECTS && process.platform === 'win32') {
    return {
      ...base,
      transparent: true,
      backgroundColor: '#00000000',
    };
  }

  return {
    ...base,
    transparent: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#f5f5f7',
  };
}

/**
 * Create the main application window
 */
function createWindow() {
  const windowOptions = buildWindowOptions();

  mainWindow = new BrowserWindow(windowOptions);

  if (ENABLE_NATIVE_WINDOW_EFFECTS && process.platform === 'win32') {
    try {
      if (typeof mainWindow.setBackgroundMaterial === 'function') {
        mainWindow.setBackgroundMaterial('acrylic');
      }
    } catch {
      /* Electron / OS version may not support */
    }
  }

  if (windowOptions.transparent) {
    try {
      mainWindow.setBackgroundColor('#00000000');
    } catch {
      /* ignore */
    }
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost:')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'splash.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Check if the unified proxy/backend is healthy
 */
async function checkBackendHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(HEALTH_CHECK_URL, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Electron Lifecycle
// ============================================================================

registerIpcHandlers();

app.whenReady().then(() => {
  setTimeout(createWindow, 100);
});

app.on('window-all-closed', () => {
  flushCookies();
  app.quit();
});

/**
 * Catch all quit paths and flush the cookie jar. Chromium defers cookie
 * writes; an explicit flush avoids losing the remember-me session.
 */
app.on('before-quit', () => {
  flushCookies();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('web-contents-created', (_, contents) => {
  contents.on('new-window', (event) => {
    event.preventDefault();
  });
});
