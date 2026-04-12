import { getBackendBaseURL } from "../config";

export interface CompactConfig {
  enabled: boolean;
  model_name: string | null;
  messages_to_keep: number;
  token_threshold_override: number | null;
  // Doc summarization settings
  doc_summarization_enabled: boolean;
  doc_summarization_ratio: number;
  doc_summarization_threshold: number;
}

export async function loadCompactConfig(): Promise<CompactConfig> {
  const res = await fetch(`${getBackendBaseURL()}/api/compact/config`);
  if (!res.ok) throw new Error(`Failed to load compact config: ${res.statusText}`);
  return res.json() as Promise<CompactConfig>;
}

export async function updateCompactConfig(patch: Partial<CompactConfig>): Promise<CompactConfig> {
  const res = await fetch(`${getBackendBaseURL()}/api/compact/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Failed to update compact config: ${res.statusText}`);
  return res.json() as Promise<CompactConfig>;
}
