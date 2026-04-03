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
