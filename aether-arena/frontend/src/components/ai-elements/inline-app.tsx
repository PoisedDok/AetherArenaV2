"use client";

import { useEffect, useRef, useState } from "react";
import { DownloadIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { buildProxyHTML } from "@/core/ui-bridge/proxy";
import type { BridgeMessage } from "@/core/ui-bridge/types";

type InlineAppProps = {
  url?: string;
  html?: string;
  title?: string;
  className?: string;
  mode?: "url" | "html";
  panelId?: string;
  downloadUrl?: string;
  onAction?: (
    msg: BridgeMessage & { type: "action" },
    sendToPanel: (response: BridgeMessage) => void,
  ) => void;
};

const MIN_H = 120;
const MAX_H = 800;
const DEFAULT_H = 320;

export function InlineApp({
  url,
  html,
  title,
  className,
  mode = "url",
  panelId = "panel",
  downloadUrl,
  onAction,
}: InlineAppProps) {
  const proxyRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(DEFAULT_H);

  // All hooks must run unconditionally before any early return
  useEffect(() => {
    if (mode !== "html" || !html) return;

    const sendToPanel = (msg: BridgeMessage) => {
      proxyRef.current?.contentWindow?.postMessage(msg, "*");
    };

    function onMessage(e: MessageEvent) {
      const d = e.data;
      if (!d || typeof d !== "object") return;

      if (d.method === "ui/notifications/sandbox-proxy-ready") {
        setReady(true);
        proxyRef.current?.contentWindow?.postMessage(
          { method: "ui/notifications/sandbox-resource-ready", params: { html } },
          "*",
        );
        return;
      }

      if (d.__aether === true) {
        if (d.type === "resize" && typeof d.payload?.height === "number") {
          setHeight(Math.min(MAX_H, Math.max(MIN_H, d.payload.height)));
          return;
        }
        if (d.type === "action" && onAction) {
          onAction(d as BridgeMessage & { type: "action" }, sendToPanel);
        }
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [mode, html, onAction]);

  // Early return AFTER all hooks
  if (mode === "url") {
    const isValid = !!url && (url.startsWith("https://") || url.startsWith("/"));
    if (!isValid) return null;
  }

  const showHeader = !!title || !!downloadUrl;

  return (
    <div className={cn("flex w-full flex-col overflow-hidden rounded-lg border bg-card", className)}>
      {showHeader && (
        <div className="flex items-center justify-between border-b px-3 py-1.5">
          <span className="text-muted-foreground text-xs">{title ?? ""}</span>
          {downloadUrl && (
            <a
              href={`${downloadUrl}?download=true`}
              download
              className="text-muted-foreground hover:text-foreground ml-2 transition-colors"
              title="Download"
            >
              <DownloadIcon className="size-3.5" />
            </a>
          )}
        </div>
      )}

      {mode === "html" && !ready && (
        <div className="flex items-center justify-center" style={{ height: DEFAULT_H }}>
          <div className="relative flex items-center justify-center">
            <div
              className="absolute animate-spin rounded-full"
              style={{
                width: 48,
                height: 48,
                background: "conic-gradient(from 0deg, transparent 0%, #a78bfa 50%, transparent 100%)",
              }}
            />
            <div className="absolute rounded-full bg-card" style={{ width: 36, height: 36 }} />
            <div className="absolute animate-pulse rounded-full bg-primary/50" style={{ width: 7, height: 7 }} />
          </div>
        </div>
      )}

      {mode === "html" && (
        <iframe
          ref={proxyRef}
          srcDoc={buildProxyHTML(panelId)}
          title={title ?? "Interactive panel"}
          sandbox="allow-scripts"
          style={{ height: `${height}px`, display: ready ? "block" : "none" }}
          className="w-full"
        />
      )}

      {mode === "url" && (
        <iframe
          src={url}
          title={title ?? "Interactive panel"}
          sandbox="allow-scripts allow-forms allow-popups allow-presentation"
          className="h-80 w-full flex-1"
          loading="lazy"
        />
      )}
    </div>
  );
}
