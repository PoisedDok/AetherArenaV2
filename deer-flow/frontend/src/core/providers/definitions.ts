export type ProviderKind = "local" | "cloud";

export interface ProviderDefinition {
  id: string;
  displayName: string;
  kind: ProviderKind;
  description: string;
  /** Canonical probe URL for local providers */
  localUrl?: string;
  /** Link to get an API key for cloud providers */
  docUrl?: string;
  /** Substrings matched against Model.provider_use to assign models to this provider */
  providerUsePatterns: string[];
  /** Substrings matched against Model.endpoint_url to assign models to this provider */
  endpointPatterns?: string[];
}

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: "lmstudio",
    displayName: "LM Studio",
    kind: "local",
    localUrl: "http://localhost:1234",
    description: "Run any GGUF model locally. No API key needed.",
    providerUsePatterns: ["lmstudio", "patched_openai", "local-model"],
    endpointPatterns: ["localhost:1234", "host.docker.internal:1234"],
  },
  {
    id: "ollama",
    displayName: "Ollama",
    kind: "local",
    localUrl: "http://localhost:11434",
    description: "Pull and run open-weight models locally.",
    providerUsePatterns: ["ollama"],
    endpointPatterns: ["localhost:11434", "host.docker.internal:11434"],
  },
  {
    id: "openai",
    displayName: "OpenAI",
    kind: "cloud",
    description: "GPT-4o, o1, o3 and more.",
    docUrl: "https://platform.openai.com/api-keys",
    providerUsePatterns: ["langchain_openai", "chatopenai"],
    endpointPatterns: ["api.openai.com"],
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    kind: "cloud",
    description: "Claude 3.5, 3.7, and latest Claude models.",
    docUrl: "https://console.anthropic.com/settings/keys",
    providerUsePatterns: ["anthropic", "claude"],
  },
  {
    id: "google",
    displayName: "Google Gemini",
    kind: "cloud",
    description: "Gemini Pro, Flash, and Ultra models.",
    docUrl: "https://aistudio.google.com/app/apikey",
    providerUsePatterns: ["google", "gemini"],
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    kind: "cloud",
    description: "Access 200+ models from one unified API.",
    docUrl: "https://openrouter.ai/keys",
    providerUsePatterns: ["openrouter"],
    endpointPatterns: ["openrouter.ai"],
  },
  {
    id: "groq",
    displayName: "Groq",
    kind: "cloud",
    description: "Ultra-fast inference for Llama, Mixtral and more.",
    docUrl: "https://console.groq.com/keys",
    providerUsePatterns: ["groq"],
    endpointPatterns: ["api.groq.com"],
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    kind: "cloud",
    description: "DeepSeek Chat and R1 reasoning models.",
    docUrl: "https://platform.deepseek.com/api_keys",
    providerUsePatterns: ["deepseek"],
    endpointPatterns: ["api.deepseek.com"],
  },
];

/** Match a Model's provider_use + endpoint_url to a ProviderDefinition id */
export function matchProviderForModel(
  providerUse: string,
  endpointUrl?: string | null,
): string {
  const use = providerUse.toLowerCase();
  const endpoint = (endpointUrl ?? "").toLowerCase();

  for (const def of PROVIDER_DEFINITIONS) {
    // Endpoint patterns take precedence (differentiates OpenRouter from OpenAI)
    if (def.endpointPatterns?.some((p) => endpoint.includes(p))) return def.id;
  }
  for (const def of PROVIDER_DEFINITIONS) {
    if (def.providerUsePatterns.some((p) => use.includes(p))) return def.id;
  }
  return "lmstudio"; // fallback for unknown local-ish providers
}
