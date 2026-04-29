import { getBackendBaseURL } from "../config";

export interface ProviderHealthResult {
  reachable: boolean;
  url: string;
  model_count: number;
}

export interface ProvidersHealthResponse {
  providers: Record<string, ProviderHealthResult>;
}

export interface TestKeyRequest {
  provider: string;
  api_key: string;
}

export interface TestKeyResponse {
  valid: boolean;
  error: string | null;
  models_count: number;
}

export interface ProviderModel {
  id: string;
  name: string;
  supports_vision: boolean;
  supports_thinking: boolean;
  is_free: boolean;
  description: string | null;
}

export interface FetchModelsRequest {
  provider: string;
  api_key: string;
}

export interface FetchModelsResponse {
  models: ProviderModel[];
  error: string | null;
}

export interface TestChatRequest {
  provider: string;
  api_key: string;
  model: string;
  message?: string;
}

export type TestChatEvent =
  | { type: "content"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * POST to /api/providers/test-chat and stream back normalized events.
 * Invokes onEvent for each SSE data frame, and onEvent(doneEvent, true)
 * when the stream finishes or errors out.
 */
export async function streamTestProviderChat(
  req: TestChatRequest,
  onEvent: (ev: TestChatEvent, done: boolean) => void,
): Promise<void> {
  const res = await fetch(`${getBackendBaseURL()}/api/providers/test-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: res.statusText ?? "Server error" }, true);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? ""; // keep incomplete line

      let hasDone = false;
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const ev = JSON.parse(line.slice(6)) as TestChatEvent;
            if (ev.type === "error") {
              onEvent(ev, true);
              return;
            }
            onEvent(ev, false);
          } catch {
            /* ignore malformed */
          }
        }
        if (line.includes('"done":true')) {
          hasDone = true;
        }
      }
      if (hasDone) break;
    }
  } finally {
    reader.releaseLock();
  }
  onEvent({ type: "done" }, true);
}

export async function fetchProvidersHealth(): Promise<ProvidersHealthResponse> {
  const res = await fetch(`${getBackendBaseURL()}/api/providers/health`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ProvidersHealthResponse>;
}

export async function testProviderKey(
  req: TestKeyRequest,
): Promise<TestKeyResponse> {
  const res = await fetch(`${getBackendBaseURL()}/api/providers/test-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<TestKeyResponse>;
}

export async function fetchProviderModels(
  req: FetchModelsRequest,
): Promise<FetchModelsResponse> {
  const res = await fetch(`${getBackendBaseURL()}/api/providers/fetch-models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<FetchModelsResponse>;
}

export async function fetchOpenRouterModels(): Promise<FetchModelsResponse> {
  const res = await fetch(`${getBackendBaseURL()}/api/providers/openrouter-models`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { models: ProviderModel[] };
  return { models: data.models, error: null };
}
