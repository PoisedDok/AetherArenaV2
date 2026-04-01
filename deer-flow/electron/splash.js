/**
 * Startup splash — ported from AetherArena StartupSplash.js
 * Health checks use main-process IPC (file:// cannot rely on fetch to localhost).
 */
'use strict';

(function () {
  /** @returns {Record<string, unknown>} */
  function getDesktopApi() {
    return typeof window !== 'undefined' ? window.deerflowDesktop || {} : {};
  }

  class StartupSplash {
    constructor(options = {}) {
      this.configSnapshot = options.configSnapshot || null;

      this._root = null;
      this._statusEl = null;
      this._progressBarEl = null;
      this._timers = [];
      this._isDisposed = false;
      this._healthPollStop = false;
    }

    attach() {
      if (typeof document === 'undefined' || !document.body) {
        throw new Error('[StartupSplash] DOM not ready');
      }
      if (this._root) {
        return;
      }

      const root = document.querySelector('.aether-startup-splash');
      if (!root) {
        throw new Error('[StartupSplash] Missing .aether-startup-splash');
      }

      this._root = root;
      this._statusEl = root.querySelector('.aether-startup-splash__status');
      this._progressBarEl = root.querySelector('.aether-startup-splash__progress-bar');
      this._wordmarkEl = root.querySelector('.aether-startup-splash__wordmark');
      this._letterI = root.querySelector('.aether-startup-splash__letter--i');
      this._suffixInc = root.querySelector('.aether-startup-splash__suffix--inc');
      this._arenaWord = root.querySelector('.aether-startup-splash__arena-word');

      document.body.classList.add('is-startup-splash-active');
    }

    dispose() {
      this._isDisposed = true;
      this._healthPollStop = true;

      for (const t of this._timers) {
        try {
          clearTimeout(t);
        } catch {
          /* ignore */
        }
      }
      this._timers = [];

      if (this._root && this._root.parentNode) {
        this._root.parentNode.removeChild(this._root);
      }
      this._root = null;
      this._statusEl = null;
      this._progressBarEl = null;
      this._wordmarkEl = null;
      this._letterI = null;
      this._suffixInc = null;
      this._arenaWord = null;

      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.remove('is-startup-splash-active');
      }
    }

    _getCfg() {
      const fallback = {
        enabled: true,
        separationDelayMs: 1200,
        expandDelayMs: 2000,
        // AetherInc settles ~900ms after expandDelayMs; add 1.5s hold = ~4400ms
        productDelayMs: 4400,
        // Time to hold on AetherInc before rolling to AetherArena (in loop)
        incHoldMs: 1500,
        // Time to wait after a failed health check before rolling back to AetherInc
        notReadyWaitMs: 2000,
        fadeOutDurationMs: 550,
      };

      const cfg = this.configSnapshot && this.configSnapshot.ui && this.configSnapshot.ui.startupAnimation
        ? this.configSnapshot.ui.startupAnimation
        : null;
      if (!cfg || typeof cfg !== 'object') {
        return fallback;
      }

      return {
        enabled: cfg.enabled !== false,
        minDurationMs: Number(cfg.minDurationMs) > 0 ? Number(cfg.minDurationMs) : fallback.minDurationMs,
        separationDelayMs: Number(cfg.separationDelayMs) >= 0 ? Number(cfg.separationDelayMs) : fallback.separationDelayMs,
        expandDelayMs: Number(cfg.expandDelayMs) >= 0 ? Number(cfg.expandDelayMs) : fallback.expandDelayMs,
        productDelayMs: Number(cfg.productDelayMs) >= 0 ? Number(cfg.productDelayMs) : fallback.productDelayMs,
        incHoldMs: Number(cfg.incHoldMs) >= 0 ? Number(cfg.incHoldMs) : fallback.incHoldMs,
        notReadyWaitMs: Number(cfg.notReadyWaitMs) >= 0 ? Number(cfg.notReadyWaitMs) : fallback.notReadyWaitMs,
        fadeOutDurationMs: Number(cfg.fadeOutDurationMs) > 0 ? Number(cfg.fadeOutDurationMs) : fallback.fadeOutDurationMs,
      };
    }

    _nextAnimationFrame() {
      if (typeof requestAnimationFrame !== 'function') {
        return new Promise((resolve) => {
          const t = setTimeout(resolve, 16);
          this._timers.push(t);
        });
      }
      return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }

    _yieldToPaint() {
      return (async () => {
        await this._nextAnimationFrame();
        await new Promise((resolve) => {
          const t = setTimeout(resolve, 0);
          this._timers.push(t);
        });
      })();
    }

    /**
     * Instantly reposition elements to a given transform without triggering a
     * CSS transition, then restore. Used to "warp" a word to the correct
     * off-screen position before the next roll begins.
     */
    async _snapInstant(elements, transformValue) {
      const els = elements.filter(Boolean);
      for (const el of els) {
        el.style.transition = 'none';
        el.style.transform = transformValue;
      }
      // Two frames: first commits the style, second lets the browser register it
      await this._nextAnimationFrame();
      if (this._root) void this._root.offsetWidth;
      for (const el of els) {
        el.style.transition = '';
        el.style.transform = '';
      }
    }

    _setStatus(text) {
      if (this._statusEl) {
        this._statusEl.textContent = text;
        if (!this._statusEl.classList.contains('is-visible')) {
          this._statusEl.classList.add('is-visible');
        }
      }
    }

    _setProgress(pct) {
      if (this._progressBarEl) {
        this._progressBarEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
        const wrap = this._progressBarEl.parentElement;
        if (wrap && !wrap.classList.contains('is-visible')) {
          wrap.classList.add('is-visible');
        }
      }
    }

    async _waitForBackendHealth() {
      const POLL_INTERVAL_MS = 3000;
      const TIMEOUT_MS = 300000;
      const startTime = Date.now();
      const api = getDesktopApi();

      if (typeof api.checkBackendHealth !== 'function') {
        console.error('[StartupSplash] deerflowDesktop.checkBackendHealth is required');
        this._setStatus('Configuration error');
        return false;
      }

      this._setStatus('Starting services');
      this._setProgress(15);

      while (!this._isDisposed && !this._healthPollStop) {
        const elapsed = Date.now() - startTime;
        if (elapsed > TIMEOUT_MS) {
          this._setStatus('Services taking longer than expected');
          break;
        }

        if (elapsed < 15000) {
          this._setStatus('Starting services');
        } else if (elapsed < 45000) {
          this._setStatus('Loading backend');
        } else {
          this._setStatus('Almost ready');
        }

        const progressPct = Math.min(85, 15 + (elapsed / 90000) * 70);
        this._setProgress(progressPct);

        try {
          const ok = await api.checkBackendHealth();
          if (ok) {
            this._setStatus('Ready');
            this._setProgress(100);
            return true;
          }
        } catch {
          /* cold start — expected */
        }

        await this._sleep(POLL_INTERVAL_MS);
      }

      return false;
    }

    async _checkHealthOnce() {
      const api = getDesktopApi();
      if (typeof api.checkBackendHealth !== 'function') {
        console.error('[StartupSplash] deerflowDesktop.checkBackendHealth is required');
        return false;
      }
      try {
        return !!(await api.checkBackendHealth());
      } catch {
        return false;
      }
    }

    _sleep(ms) {
      return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        this._timers.push(t);
      });
    }

    _clearTimersOnly() {
      for (const t of this._timers) {
        try {
          clearTimeout(t);
        } catch {
          /* ignore */
        }
      }
      this._timers = [];
    }

    async run() {
      const cfg = this._getCfg();
      const api = getDesktopApi();
      // Slightly longer than the 580ms CSS transition, ensuring it fully settles
      const ROLL_SETTLE_MS = 700;
      // Pause on AetherArena before checking backend (both first reveal and loop)
      const ARENA_HOLD_MS = 1000;

      if (!cfg.enabled) {
        if (typeof api.loadMainApp !== 'function') {
          console.error('[StartupSplash] deerflowDesktop.loadMainApp is required');
          return;
        }
        await api.loadMainApp();
        return;
      }

      this.attach();
      if (!this._root) return;

      await this._yieldToPaint();
      if (this._isDisposed) return;

      // ── Mandatory visual sequence ──────────────────────────────────────
      // AI → separation → AetherInc (fire-and-forget timers)
      const separationDelayMs = Math.max(0, Math.min(cfg.separationDelayMs, cfg.expandDelayMs));
      if (separationDelayMs < cfg.expandDelayMs) {
        const tSeparate = setTimeout(() => {
          if (this._isDisposed || !this._root) return;
          this._root.classList.add('is-separated');
        }, separationDelayMs);
        this._timers.push(tSeparate);
      }

      const tExpand = setTimeout(() => {
        if (this._isDisposed || !this._root) return;
        this._root.classList.remove('is-separated');
        this._root.classList.add('is-expanded');
      }, cfg.expandDelayMs);
      this._timers.push(tExpand);

      // AetherInc → [1.5s gap] → AetherArena  (always happens, mandatory)
      const tProduct = setTimeout(() => {
        if (this._isDisposed || !this._root) return;
        this._root.classList.add('is-product');
      }, cfg.productDelayMs);
      this._timers.push(tProduct);

      // Block until AetherArena is on screen and settled
      await this._sleep(cfg.productDelayMs + ROLL_SETTLE_MS + ARENA_HOLD_MS);
      if (this._isDisposed || !this._root) return;

      // ── Backend check + loop ───────────────────────────────────────────
      const skipHealth = api.skipHealthCheck === true;

      if (skipHealth) {
        this._setStatus('Dev mode');
        this._setProgress(100);
        await this._sleep(200);
      } else {
        let healthy = await this._checkHealthOnce();

        while (!healthy && !this._isDisposed) {
          // Not ready — wait 2s, then roll: AetherArena → AetherInc → [1.5s] → AetherArena → check
          await this._sleep(cfg.notReadyWaitMs);
          if (this._isDisposed || !this._root) break;

          // Snap Inc to bottom so it enters from below
          await this._snapInstant([this._letterI, this._suffixInc], 'translateY(1.1em)');
          if (this._isDisposed || !this._root) break;

          // Roll to AetherInc
          this._root.classList.remove('is-product');
          this._root.classList.add('is-company');

          // Hold on AetherInc for 1.5s (after roll settles)
          await this._sleep(ROLL_SETTLE_MS + cfg.incHoldMs);
          if (this._isDisposed || !this._root) break;

          // Snap Arena to bottom so it enters from below
          await this._snapInstant([this._arenaWord], 'translateY(1.1em)');
          if (this._isDisposed || !this._root) break;

          // Roll to AetherArena
          this._root.classList.remove('is-company');
          this._root.classList.add('is-product');

          // Wait for roll to settle, then check again
          await this._sleep(ROLL_SETTLE_MS + ARENA_HOLD_MS);
          if (this._isDisposed || !this._root) break;

          healthy = await this._checkHealthOnce();
        }

        if (this._isDisposed || !this._root) return;

        if (healthy) {
          this._setStatus('Ready');
          this._setProgress(100);
          await this._sleep(500);
        }
      }

      if (this._isDisposed || !this._root) return;

      // ── Fade out and load app ──────────────────────────────────────────
      this._root.style.setProperty('--startup-fade-ms', `${cfg.fadeOutDurationMs}ms`);
      this._root.classList.add('is-fading');

      await this._sleep(cfg.fadeOutDurationMs);

      this._clearTimersOnly();
      this._isDisposed = true;
      this._healthPollStop = true;

      if (typeof api.loadMainApp !== 'function') {
        console.error('[StartupSplash] deerflowDesktop.loadMainApp is required');
        return;
      }
      await api.loadMainApp();
    }

    _showFatalError(onRetry) {
      this._setStatus('Startup failed');
      this._setProgress(0);
      if (this._root) {
        this._root.classList.add('is-fatal-error');
      }

      const inner = this._root && this._root.querySelector('.aether-startup-splash__inner');
      if (!inner) return;

      let errorUi = inner.querySelector('.fatal-startup-error');
      if (!errorUi) {
        errorUi = document.createElement('div');
        errorUi.className = 'fatal-startup-error';

        const title = document.createElement('h3');
        title.textContent = 'Service Unreachable';

        const desc = document.createElement('p');
        desc.textContent = 'Background services failed to start or respond in time.';

        const actions = document.createElement('div');
        actions.className = 'fatal-startup-actions';

        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn-primary btn-sm';
        retryBtn.type = 'button';
        retryBtn.textContent = 'Retry';
        retryBtn.onclick = () => {
          errorUi.remove();
          if (this._root) {
            this._root.classList.remove('is-fatal-error');
          }
          this._healthPollStop = false;
          if (onRetry) onRetry();
        };

        const quitBtn = document.createElement('button');
        quitBtn.className = 'btn-premium-link btn-sm';
        quitBtn.type = 'button';
        quitBtn.textContent = 'Quit';
        quitBtn.onclick = () => {
          const a = getDesktopApi();
          if (typeof a.quitApp === 'function') {
            a.quitApp();
          }
        };

        actions.appendChild(retryBtn);
        actions.appendChild(quitBtn);

        errorUi.appendChild(title);
        errorUi.appendChild(desc);
        errorUi.appendChild(actions);

        inner.appendChild(errorUi);
      }
    }
  }

  async function boot() {
    const splash = new StartupSplash({});
    await splash.run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot().catch((err) => {
        console.error('[StartupSplash]', err);
      });
    });
  } else {
    boot().catch((err) => {
      console.error('[StartupSplash]', err);
    });
  }
})();
