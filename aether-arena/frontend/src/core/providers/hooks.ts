import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import {
  fetchOpenRouterModels,
  fetchProviderModels,
  fetchProvidersHealth,
  streamTestProviderChat,
  testProviderKey,
} from "./api";
import type { TestChatRequest } from "./api";

export function useProvidersHealth() {
  return useQuery({
    queryKey: ["providers-health"],
    queryFn: fetchProvidersHealth,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useTestProviderKey() {
  return useMutation({ mutationFn: testProviderKey });
}

export function useFetchProviderModels() {
  return useMutation({ mutationFn: fetchProviderModels });
}

export function useOpenRouterModels(enabled: boolean) {
  return useQuery({
    queryKey: ["openrouter-models"],
    queryFn: fetchOpenRouterModels,
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min cache
    retry: false,
  });
}

export interface UseTestChatReturn {
  state: "idle" | "streaming" | "done" | "error";
  text: string;
  reasoning: string;
  error: string | null;
  start: (req: Omit<TestChatRequest, "message">) => Promise<void>;
  stop: () => void;
}

let _activeAbort: AbortController | null = null;

export function useTestProviderChat(): UseTestChatReturn {
  const [state, setState] = useState<UseTestChatReturn["state"]>("idle");
  const [text, setText] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const start = useCallback(async (req: Omit<TestChatRequest, "message">) => {
    if (stateRef.current === "streaming") return;

    _activeAbort?.abort();
    _activeAbort = new AbortController();

    setState("streaming");
    setText("");
    setReasoning("");
    setError(null);

    try {
      await streamTestProviderChat(
        { ...req, message: "Reply with the word PONG in all caps." },
        (ev, done) => {
          if (ev.type === "content") {
            setText((prev) => prev + ev.content);
          } else if (ev.type === "reasoning") {
            setReasoning((prev) => prev + ev.content);
          } else if (ev.type === "error") {
            setError(ev.message ?? null);
            if (done) setState("error");
          } else if (done) {
            setState("done");
          }
        },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setState("error");
    }
  }, []);

  const stop = useCallback(() => {
    _activeAbort?.abort();
    _activeAbort = null;
  }, []);

  return { state, text, reasoning, error, start, stop };
}
