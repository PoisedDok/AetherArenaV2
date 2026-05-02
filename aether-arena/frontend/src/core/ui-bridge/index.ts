import { useEffect } from "react";

import type { AetherBridgeEnvelope, BridgeMessage } from "./types";

function isAetherEnvelope(data: unknown): data is AetherBridgeEnvelope {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).__aether === true &&
    typeof (data as Record<string, unknown>).type === "string"
  );
}

export function useIframeBridge(
  onMessage: (msg: BridgeMessage) => void,
  trustedOrigins: string[],
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    function handler(e: MessageEvent) {
      if (trustedOrigins.length > 0 && !trustedOrigins.includes(e.origin)) return;
      if (!isAetherEnvelope(e.data)) return;
      onMessage(e.data as BridgeMessage);
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onMessage, trustedOrigins, enabled]);
}

export type { BridgeMessage, AetherBridgeEnvelope };
