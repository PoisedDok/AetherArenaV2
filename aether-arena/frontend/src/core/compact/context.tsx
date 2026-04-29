"use client";

/**
 * CompactContext — shared state between CompactButton (trigger) and
 * CompactingCard (in-message-list display).
 *
 * The state machine is:
 *   idle → starting → streaming → creating_thread → done
 *                  └→ error
 *                  └→ cancelled (via abortRef.current.abort())
 */

import { createContext, useContext, useRef, useState } from "react";

export type CompactStatus =
  | "idle"
  | "starting"       // request sent, waiting for first SSE event
  | "streaming"      // tokens arriving from LLM
  | "creating_thread" // "done" event received, prune in progress
  | "done"           // prune complete, ready to refresh
  | "error"
  | "cancelled";

export interface CompactStreamState {
  status: CompactStatus;
  /** Accumulated LLM tokens as they stream in. */
  streamedText: string;
  preTokens: number;
  postTokens: number;
  summarizedCount: number;
  method: string;
  errorMessage: string | null;
}

const INITIAL_STATE: CompactStreamState = {
  status: "idle",
  streamedText: "",
  preTokens: 0,
  postTokens: 0,
  summarizedCount: 0,
  method: "llm",
  errorMessage: null,
};

export interface CompactContextValue {
  state: CompactStreamState;
  setState: React.Dispatch<React.SetStateAction<CompactStreamState>>;
  /** AbortController for the in-flight SSE fetch. Set before fetch, abort() to cancel. */
  abortRef: React.MutableRefObject<AbortController | null>;
  /**
   * Ref set by the page to a function that forces the LangGraph useStream hook
   * to remount and re-fetch the latest thread state. Called after compact done
   * so the compact boundary message appears without a full page reload.
   */
  refetchThreadRef: React.MutableRefObject<(() => void) | null>;
}

const CompactContext = createContext<CompactContextValue | null>(null);

export function CompactProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CompactStreamState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const refetchThreadRef = useRef<(() => void) | null>(null);

  // Wrap setState to log every status transition with the call site stack.
  // Stack is captured HERE (at the call site), not inside the batched callback,
  // so the trace shows the actual code path that triggered the change.
  const debugSetState: typeof setState = (updater) => {
    const callSiteStack = new Error("trace").stack?.split("\n").slice(1, 10).join("\n");
    setState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (next.status !== prev.status) {
        console.log(`[compact:context] status ${prev.status} → ${next.status}\nCALL SITE:\n${callSiteStack}`);
      }
      return next;
    });
  };

  return (
    <CompactContext.Provider value={{ state, setState: debugSetState, abortRef, refetchThreadRef }}>
      {children}
    </CompactContext.Provider>
  );
}

export function useCompactContext(): CompactContextValue {
  const ctx = useContext(CompactContext);
  if (!ctx) throw new Error("useCompactContext must be called inside <CompactProvider>");
  return ctx;
}

export { INITIAL_STATE as COMPACT_INITIAL_STATE };
