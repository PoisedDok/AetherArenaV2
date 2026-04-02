"use client";

/**
 * Window titlebar — thin, always-visible drag region at the very top of the
 * Electron window on macOS.  Renders as a fixed overlay so traffic lights
 * (close/minimize/zoom) sit naturally inside it and the user always has a
 * grab handle to drag/move the window.
 *
 * z-index is 40 — below modals/dialogs (50+) but above page content.
 * Interactive elements in the sidebar header and page headers that overlap
 * the titlebar zone must use z-index >= 41 to stay clickable.
 *
 * On non-Electron (browser) this renders nothing.
 */

import { useEffect, useState } from "react";

const TITLEBAR_HEIGHT = 38; // px — clears traffic lights at y≈12, ~14px tall

export function WindowTitlebar() {
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    const api = (
      window as unknown as {
        deerflowDesktop?: { isElectron?: boolean; platform?: string };
      }
    ).deerflowDesktop;
    if (api?.isElectron && api?.platform === "darwin") {
      setIsElectron(true);
    }
  }, []);

  if (!isElectron) return null;

  return (
    <div
      className="app-drag fixed top-0 right-0 left-0 z-[40]"
      style={{ height: TITLEBAR_HEIGHT }}
    />
  );
}
