/**
 * Runs before splash DOM so html.native-glass applies before first paint (CSP-safe).
 */
'use strict';
try {
  const g = typeof window !== 'undefined' ? window.aetherArenaDesktop : null;
  if (g && g.glassBackgroundMode === 'native') {
    document.documentElement.classList.add('native-glass');
  }
} catch {
  /* ignore */
}
