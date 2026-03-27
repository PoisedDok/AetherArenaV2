"use client";

import { CheckIcon, CpuIcon } from "lucide-react";

import {
  Item,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import type { Model } from "@/core/models/types";
import { useLocalSettings } from "@/core/settings";
import { env } from "@/env";

import { SettingsSection } from "./settings-section";

function getProviderName(usePath: string): string {
  const lower = usePath.toLowerCase();
  if (lower.includes("lmstudio") || lower.includes("patched_openai") || lower.includes("local-model")) return "LM Studio";
  if (lower.includes("ollama")) return "Ollama";
  if (lower.includes("openai") && lower.includes("azure")) return "Azure";
  if (lower.includes("openai")) return "OpenAI";
  if (lower.includes("anthropic") || lower.includes("claude")) return "Anthropic";
  if (lower.includes("google") || lower.includes("gemini")) return "Google";
  if (lower.includes("groq")) return "Groq";
  if (lower.includes("deepseek")) return "DeepSeek";
  return "Custom";
}

// Format: "Provider — Model Name" like Perplexica
function formatModelLabel(m: Model): string {
  const provider = getProviderName(m.provider_use);
  const name = m.display_name?.trim() || m.name;
  return `${provider} — ${name}`;
}

export function ModelsSettingsPage() {
  const { t } = useI18n();
  const { models, isLoading, error } = useModels();
  const [localSettings, setLocalSettings] = useLocalSettings();
  const demo = env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true";

  const storedName: string | undefined = typeof localSettings.context.model_name === "string" && localSettings.context.model_name.length > 0
    ? localSettings.context.model_name
    : undefined;

  const selectedModel = models.find((m) => m.name === storedName);

  const handleModelChange = (modelName: string) => {
    setLocalSettings("context", { model_name: modelName });
  };

  // Group models by provider for the configured section
  const providers = new Map<string, { name: string; models: Model[]; endpointUrl: string | null }>();
  for (const m of models) {
    const providerName = getProviderName(m.provider_use);
    const existing = providers.get(providerName);
    if (existing) {
      existing.models.push(m);
    } else {
      providers.set(providerName, {
        name: providerName,
        models: [m],
        endpointUrl: m.endpoint_url || null,
      });
    }
  }
  const providerGroups = Array.from(providers.values());

  return (
    <SettingsSection
      title={t.settings.models.title}
      description={t.settings.models.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div className="text-destructive text-sm">
          {t.settings.models.loadError}: {error.message}
        </div>
      ) : models.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          {t.settings.models.empty}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Single Model Selector - Perplexica style */}
          <div className="space-y-3">
            <div className="text-sm font-medium flex items-center gap-2">
              <CpuIcon className="size-4" />
              {t.settings.models.defaultModelTitle}
            </div>
            <p className="text-muted-foreground text-sm">
              {t.settings.models.defaultModelDescription}
            </p>
            <Select
              value={storedName}
              disabled={demo}
              onValueChange={(v: string) => handleModelChange(v)}
            >
              <SelectTrigger className="w-full max-w-md">
                <SelectValue placeholder={t.settings.models.selectPlaceholder}>
                  {selectedModel && formatModelLabel(selectedModel)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    <span className="flex items-center justify-between gap-4 w-full">
                      <span>{formatModelLabel(m)}</span>
                      <span className="flex items-center gap-1">
                        {m.supports_thinking && (
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                            {t.settings.models.capabilitiesThinking}
                          </span>
                        )}
                        {m.supports_reasoning_effort && (
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                            {t.settings.models.capabilitiesReasoning}
                          </span>
                        )}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedModel && (
              <div className="flex flex-col gap-1 text-xs text-muted-foreground pt-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{selectedModel.name}</span>
                  {selectedModel.endpoint_url && (
                    <span className="font-mono text-[10px] truncate">{selectedModel.endpoint_url}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Configured Providers List */}
          <div className="flex flex-col gap-4">
            <div className="text-sm font-medium">
              {t.settings.models.configuredTitle}
            </div>
            {providerGroups.map((group) => (
              <div key={group.name} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {group.name}
                  </span>
                  {group.endpointUrl && (
                    <span className="text-[10px] font-mono text-muted-foreground/60 truncate max-w-[200px]">
                      {group.endpointUrl}
                    </span>
                  )}
                </div>
                <div className="grid gap-2">
                  {group.models.map((m) => (
                    <Item
                      className={cn(
                        "w-full cursor-pointer transition-colors",
                        storedName === m.name && "border-primary/50 bg-primary/5"
                      )}
                      variant="outline"
                      key={m.name}
                      onClick={() => !demo && handleModelChange(m.name)}
                    >
                      <ItemContent>
                        <ItemTitle className="flex items-center gap-2">
                          {storedName === m.name && (
                            <CheckIcon className="size-4 text-primary" />
                          )}
                          <span>{m.display_name?.trim() || m.name}</span>
                          <span className="text-xs text-muted-foreground font-mono">({m.model})</span>
                        </ItemTitle>
                        <div className="flex items-center gap-2 mt-1">
                          {m.supports_thinking && (
                            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {t.settings.models.capabilitiesThinking}
                            </span>
                          )}
                          {m.supports_reasoning_effort && (
                            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {t.settings.models.capabilitiesReasoning}
                            </span>
                          )}
                        </div>
                      </ItemContent>
                    </Item>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
