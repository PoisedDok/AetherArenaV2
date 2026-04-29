"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Toaster } from "sonner";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CommandPalette } from "@/components/workspace/command-palette";
import { WindowTitlebar } from "@/components/workspace/window-titlebar";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import { getLocalSettings, useLocalSettings } from "@/core/settings";

const queryClient = new QueryClient();

export default function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [settings, setSettings] = useLocalSettings();
  const [open, setOpen] = useState(false); // SSR default: closed (matches server render)
  useLayoutEffect(() => {
    // Detect Electron on macOS and apply traffic-light safe area class
    const api = (window as unknown as { aetherArenaDesktop?: { isElectron?: boolean; platform?: string; glassBackgroundMode?: string } }).aetherArenaDesktop;
    if (api?.isElectron && api?.platform === 'darwin') {
      document.documentElement.classList.add('electron-darwin');
    }
    // Mirror splash-boot.js: transparent body when native vibrancy is active
    if (api?.glassBackgroundMode === 'native') {
      document.documentElement.classList.add('native-glass');
    }
    // Apply glass preset before first paint — no visual flash
    const s = getLocalSettings();
    // Sidebar always starts collapsed on fresh window open
    setOpen(false);
    document.documentElement.classList.add(`glass-${s.layout.glass_preset ?? "subtle"}`);
  }, []);
  // Reactively swap glass preset class when the setting changes
  useEffect(() => {
    const htmlEl = document.documentElement;
    htmlEl.classList.remove("glass-subtle", "glass-medium", "glass-frosted", "glass-none");
    htmlEl.classList.add(`glass-${settings.layout.glass_preset ?? "subtle"}`);
  }, [settings.layout.glass_preset]);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setOpen(open);
      setSettings("layout", { sidebar_collapsed: !open });
    },
    [setSettings],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <WindowTitlebar />
      <SidebarProvider
        className="h-screen overflow-hidden"
        open={open}
        onOpenChange={handleOpenChange}
      >
        <WorkspaceSidebar />
        <SidebarInset className="min-w-0 overflow-hidden">{children}</SidebarInset>
      </SidebarProvider>
      <CommandPalette />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
