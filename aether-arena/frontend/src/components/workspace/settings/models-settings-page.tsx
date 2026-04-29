"use client";

import {
  BrainCircuitIcon,
  CheckIcon,
  CpuIcon,
  ExternalLinkIcon,
  EyeIcon,
  KeyIcon,
  Loader2Icon,
  SearchIcon,
  ServerIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import type { Model } from "@/core/models/types";
import type { ProviderModel } from "@/core/providers/api";
import {
  PROVIDER_DEFINITIONS,
  matchProviderForModel,
  type ProviderDefinition,
} from "@/core/providers/definitions";
import {
  useFetchProviderModels,
  useOpenRouterModels,
  useProvidersHealth,
  useTestProviderKey,
  useTestProviderChat,
} from "@/core/providers/hooks";
import { useLocalSettings } from "@/core/settings";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

// ── API key persistence (localStorage, never sent to server) ─────────────────

const API_KEY_STORAGE_PREFIX = "aether-arena.provider-key.";

function loadSavedKey(providerId: string): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(API_KEY_STORAGE_PREFIX + providerId) ?? "";
}

function saveKey(providerId: string, key: string) {
  if (typeof window === "undefined") return;
  if (key) {
    localStorage.setItem(API_KEY_STORAGE_PREFIX + providerId, key);
  } else {
    localStorage.removeItem(API_KEY_STORAGE_PREFIX + providerId);
  }
}

// ── Confirm dialog ────────────────────────────────────────────────────────────

type SelectionKind = "chat" | "vision";

interface PendingSelection {
  modelId: string;
  modelName: string;
  kind: SelectionKind;
  providerName: string;
  providerId?: string;
}

function ConfirmDialog({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingSelection;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border/60 bg-background shadow-2xl mx-4">
        <div className="px-5 py-4 border-b border-border/30">
          <p className="text-sm font-semibold">
            {pending.kind === "chat" ? "Set as chat model" : "Set as vision model"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{pending.providerName}</p>
        </div>
        <div className="px-5 py-4 space-y-1">
          <p className="text-sm font-medium truncate">{pending.modelName}</p>
          {pending.modelId !== pending.modelName && (
            <p className="font-mono text-[11px] text-muted-foreground/60 truncate">{pending.modelId}</p>
          )}
          <p className="text-xs text-muted-foreground/70 pt-1">
            {pending.kind === "chat"
              ? "This will be used as the default model for all new conversations."
              : "This will be used when messages contain images."}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/30">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border/50 bg-muted/30 px-3 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Capability badges ─────────────────────────────────────────────────────────

function CapBadge({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded border px-1 py-px text-[10px] font-medium", color)}>
      {icon}
      {label}
    </span>
  );
}

// ── Model row ────────────────────────────────────────────────────────────────

function ModelRow({
  id: _id,
  displayName,
  modelId,
  isChatSelected,
  isVisionSelected,
  supportsThinking,
  supportsReasoning,
  supportsVision,
  isFree,
  onSelectChat,
  onToggleVision,
  disabled,
}: {
  id: string;
  displayName: string;
  modelId: string;
  isChatSelected: boolean;
  isVisionSelected: boolean;
  supportsThinking?: boolean;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  isFree?: boolean;
  onSelectChat: () => void;
  onToggleVision: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-2.5 transition-colors cursor-pointer",
        isChatSelected
          ? "bg-primary/8 border-l-2 border-primary"
          : "border-l-2 border-transparent hover:bg-muted/30",
      )}
      onClick={!disabled ? onSelectChat : undefined}
    >
      <div
        className={cn(
          "size-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors",
          isChatSelected
            ? "border-primary bg-primary"
            : "border-border/50 group-hover:border-primary/50",
        )}
      >
        {isChatSelected && <div className="size-1.5 rounded-full bg-primary-foreground" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn("text-sm font-medium truncate", isChatSelected ? "text-primary" : "text-foreground")}>
            {displayName}
          </span>
          {isFree && (
            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-px text-[9px] font-semibold text-emerald-400">
              FREE
            </span>
          )}
        </div>
        {modelId !== displayName && (
          <p className="font-mono text-[10px] text-muted-foreground/50 truncate">{modelId}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {supportsThinking && (
          <CapBadge
            icon={<BrainCircuitIcon className="size-2.5" />}
            label={t.settings.models.capabilitiesThinking}
            color="border-violet-500/20 bg-violet-500/10 text-violet-400"
          />
        )}
        {supportsReasoning && (
          <CapBadge
            icon={<BrainCircuitIcon className="size-2.5" />}
            label={t.settings.models.capabilitiesReasoning}
            color="border-amber-500/20 bg-amber-500/10 text-amber-400"
          />
        )}
        {supportsVision && (
          <button
            type="button"
            disabled={disabled}
            title={isVisionSelected ? t.settings.models.clearVision : t.settings.models.setAsVision}
            onClick={onToggleVision}
            className={cn(
              "rounded p-0.5 transition-colors",
              isVisionSelected ? "text-blue-400" : "text-muted-foreground/25 hover:text-blue-400/60",
            )}
          >
            <EyeIcon className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Provider selector button group ────────────────────────────────────────────

function ProviderSelector({
  providers,
  selectedId,
  health,
  healthLoading,
  onChange,
}: {
  providers: ProviderDefinition[];
  selectedId: string;
  health: Record<string, { reachable: boolean }> | undefined;
  healthLoading: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {providers.map((p) => {
        const isActive = p.id === selectedId;
        const isLocal = p.kind === "local";
        const reachable = isLocal ? health?.[p.id]?.reachable : undefined;

        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
              isActive
                ? "border-primary bg-primary/10 text-primary shadow-sm"
                : "border-border/40 bg-muted/20 text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
            )}
          >
            <ServerIcon className="size-3.5 shrink-0" />
            <span>{p.displayName}</span>
            {isLocal && (
              healthLoading ? (
                <Loader2Icon className="size-2.5 animate-spin opacity-50" />
              ) : reachable ? (
                <span className="size-1.5 rounded-full bg-emerald-400" />
              ) : (
                <span className="size-1.5 rounded-full bg-muted-foreground/30" />
              )
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── API key section (cloud providers) ────────────────────────────────────────

function ApiKeySection({
  providerId,
  docUrl,
  onKeyValidated,
  onModelValidated,
}: {
  providerId: string;
  docUrl?: string;
  onKeyValidated: (key: string) => void;
  onModelValidated: (model: string) => void;
}) {
  const { t } = useI18n();
  const [key, setKey] = useState(() => loadSavedKey(providerId));
  const [showKey, setShowKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const { mutate: testKey, isPending: isTesting, data: testResult, reset: resetTest } = useTestProviderKey();
  const { mutate: fetchModels, data: modelsResult } = useFetchProviderModels();
  const chatTest = useTestProviderChat();
  const { data: openRouterData } = useOpenRouterModels(providerId === "openrouter");

  // Auto-load key on provider change
  useEffect(() => {
    const saved = loadSavedKey(providerId);
    setKey(saved);
    resetTest();
    setSelectedModel("");
    if (saved) onKeyValidated(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  // Reset chat test state on provider change
  useEffect(() => {
    chatTest.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const handleTest = () => {
    if (!key.trim()) return;
    resetTest();
    testKey(
      { provider: providerId, api_key: key.trim() },
      {
        onSuccess: (result) => {
          if (result.valid) {
            saveKey(providerId, key.trim());
            onKeyValidated(key.trim());
            fetchModels({ provider: providerId, api_key: key.trim() });
          }
        },
      },
    );
  };

  const handleChatTest = () => {
    if (!key.trim() || !selectedModel) return;
    void chatTest.start({ provider: providerId, api_key: key.trim(), model: selectedModel });
  };

  const handleChange = (v: string) => {
    setKey(v);
    if (testResult) resetTest();
  };

  const isValid = testResult?.valid === true;
  const isInvalid = testResult?.valid === false;

  const sortedModels = useMemo(() => {
    const baseModels = modelsResult?.models ?? [];
    const orModels = openRouterData?.models ?? [];
    const merged = providerId === "openrouter" ? [...orModels, ...baseModels] : baseModels;
    const unique = new Map<string, ProviderModel>();
    for (const m of merged) {
      if (!unique.has(m.id)) unique.set(m.id, m);
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [modelsResult?.models, openRouterData?.models, providerId]);

  useEffect(() => {
    if (chatTest.state === "done" && selectedModel) {
      onModelValidated(selectedModel);
    }
  }, [chatTest.state, selectedModel, onModelValidated]);

  return (
    <div className="space-y-3">
      {/* ── API key input + Validate button ── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <KeyIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/40" />
          <input
            type={showKey ? "text" : "password"}
            value={key}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleTest()}
            placeholder={t.settings.models.testKeyPlaceholder}
            className={cn(
              "w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors",
              isValid ? "border-emerald-500/50" : isInvalid ? "border-red-500/50" : "border-border/50",
            )}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            {showKey ? "hide" : "show"}
          </button>
        </div>
        <button
          type="button"
          disabled={!key.trim() || isTesting}
          onClick={handleTest}
          className="shrink-0 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-40"
        >
          {isTesting ? (
            <span className="flex items-center gap-1.5">
              <Loader2Icon className="size-3.5 animate-spin" />
              Validating
            </span>
          ) : (
            "Validate"
          )}
        </button>
      </div>

      {testResult && (
        <div className={cn("flex items-center gap-1.5 text-xs", isValid ? "text-emerald-400" : "text-red-400")}>
          {isValid ? <CheckIcon className="size-3.5" /> : <XCircleIcon className="size-3.5" />}
          <span>
            {isValid
              ? t.settings.models.testKeyValid
              : `${t.settings.models.testKeyInvalid}${testResult.error ? `: ${testResult.error}` : ""}`}
          </span>
        </div>
      )}

      {/* ── Model dropdown ── */}
      {sortedModels.length > 0 && (
        <div className="flex items-center gap-2">
          <CpuIcon className="size-3.5 text-muted-foreground/40 shrink-0" />
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="" disabled>
              Select a model…
            </option>
            {sortedModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.is_free ? " [FREE]" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Test Chat button + streaming output ── */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!key.trim() || !selectedModel || chatTest.state === "streaming" || chatTest.state === "done"}
          onClick={handleChatTest}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
            chatTest.state === "done"
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
              : chatTest.state === "error"
                ? "border-red-500/50 bg-red-500/10 text-red-400"
                : "border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted disabled:opacity-40",
          )}
        >
          {chatTest.state === "streaming" && <Loader2Icon className="size-3 animate-spin" />}
          {chatTest.state === "streaming"
            ? "Testing…"
            : chatTest.state === "done"
              ? "Passed"
              : chatTest.state === "error"
                ? `Failed — ${chatTest.error}`
                : "Test Chat"}
        </button>
      </div>

      {chatTest.state === "streaming" && (
        <div className="rounded-lg border border-border/30 bg-muted/10 px-3 py-2 font-mono text-[11px] leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap">
          {chatTest.reasoning && <span className="text-violet-400/60">{chatTest.reasoning}</span>}
          <span>{chatTest.text}</span>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
        {t.settings.models.testKeyNote}
        {docUrl && (
          <>
            {" "}
            <a
              href={docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-primary/70 hover:text-primary"
            >
              {t.settings.models.getApiKey}
              <ExternalLinkIcon className="size-2.5" />
            </a>
          </>
        )}
      </p>
    </div>
  );
}

// ── Model list panel ──────────────────────────────────────────────────────────

function ModelListPanel({
  def,
  configModels,
  apiKey,
  isReachable,
  selectedChatName,
  selectedVisionName,
  onRequestSelect,
  onRequestVision,
  disabled,
}: {
  def: ProviderDefinition;
  configModels: Model[];
  apiKey: string;
  isReachable: boolean | undefined;
  selectedChatName: string | undefined;
  selectedVisionName: string | undefined;
  onRequestSelect: (id: string, name: string) => void;
  onRequestVision: (id: string, name: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [showFreeOnly, setShowFreeOnly] = useState(false);

  const isOpenRouter = def.id === "openrouter";
  const isCloud = def.kind === "cloud";
  const isLocal = def.kind === "local";

  // Single mutation for both cloud and local live model fetching
  const { mutate: fetchModels, isPending: isFetching, data: modelsResult, reset: resetModels } = useFetchProviderModels();

  // Track what we last fetched to avoid duplicate calls
  const lastFetchKey = useRef<string>("");

  useEffect(() => {
    if (isOpenRouter) return;

    if (isCloud && apiKey) {
      const key = `cloud:${def.id}:${apiKey}`;
      if (lastFetchKey.current === key) return;
      lastFetchKey.current = key;
      resetModels();
      fetchModels({ provider: def.id, api_key: apiKey });
      return;
    }

    if (isLocal && isReachable === true) {
      const key = `local:${def.id}`;
      if (lastFetchKey.current === key) return;
      lastFetchKey.current = key;
      resetModels();
      fetchModels({ provider: def.id, api_key: "" });
      return;
    }

    // Provider changed or key removed — clear previous results
    if (lastFetchKey.current !== "") {
      lastFetchKey.current = "";
      resetModels();
    }
  }, [def.id, isCloud, isLocal, isOpenRouter, apiKey, isReachable, fetchModels, resetModels]);

  // OpenRouter models
  const { data: openRouterData, isLoading: isLoadingOR } = useOpenRouterModels(isOpenRouter);

  const liveModels: ProviderModel[] = useMemo(() => {
    if (isOpenRouter) return openRouterData?.models ?? [];
    return modelsResult?.models ?? [];
  }, [isOpenRouter, openRouterData?.models, modelsResult?.models]);

  const allModels = useMemo(() => {
    type ModelEntry = { id: string; displayName: string; modelId: string; supportsThinking?: boolean; supportsReasoning?: boolean; supportsVision?: boolean; isFree?: boolean };
    const result: ModelEntry[] = [];

    // Index live models by ID so we can merge their capabilities into config entries
    const liveById = new Map(liveModels.map((m) => [m.id, m]));

    // Config models take priority — index by their underlying model ID for dedup
    const configModelIds = new Set<string>();
    for (const m of configModels) {
      configModelIds.add(m.model); // m.model is the actual model ID (e.g. "mistralai/ministral-3-3b")
      const live = liveById.get(m.model);
      result.push({
        id: m.name,
        displayName: m.display_name?.trim() ?? m.model,
        modelId: m.model,
        supportsThinking: (m.supports_thinking ?? false) || (live?.supports_thinking ?? false),
        supportsReasoning: m.supports_reasoning_effort,
        // Live model data is authoritative for vision — LM Studio /api/v0/models knows better than static config
        supportsVision: (m.supports_vision ?? false) || (live?.supports_vision ?? false),
      });
    }

    // Live models — skip any whose ID matches a config model's underlying model ID
    for (const m of liveModels) {
      if (configModelIds.has(m.id)) continue;
      result.push({
        id: m.id,
        displayName: m.name,
        modelId: m.id,
        supportsThinking: m.supports_thinking,
        supportsVision: m.supports_vision,
        isFree: m.is_free,
      });
    }

    return result;
  }, [configModels, liveModels]);

  const filtered = useMemo(() => {
    return allModels.filter((m) => {
      if (showFreeOnly && !m.isFree) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return m.id.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q);
    });
  }, [allModels, search, showFreeOnly]);

  const isLoading = isFetching || isLoadingOR;
  const needsKey = isCloud && !isOpenRouter && !apiKey;
  const needsLocal = def.kind === "local" && isReachable === false;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Search + filters */}
      {(allModels.length > 6 || isOpenRouter) && (
        <div className="flex items-center gap-2 px-1 pb-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.settings.models.searchModelsPlaceholder}
              className="w-full rounded-lg border border-border/40 bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {isOpenRouter && (
            <button
              type="button"
              onClick={() => setShowFreeOnly(!showFreeOnly)}
              className={cn(
                "shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
                showFreeOnly
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
                  : "border-border/40 bg-muted/20 text-muted-foreground/60 hover:text-muted-foreground",
              )}
            >
              Free only
            </button>
          )}
        </div>
      )}

      {/* States */}
      {needsKey ? (
        <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
          <KeyIcon className="size-8 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/60">Enter and validate your API key above to see available models</p>
        </div>
      ) : needsLocal ? (
        <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
          <ServerIcon className="size-8 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/60">Start {def.displayName} to see available models</p>
          {def.docUrl && (
            <a href={def.docUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary/70 hover:text-primary">
              Get started <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          {t.settings.models.fetchModelsLoading}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-1.5">
          <CpuIcon className="size-8 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground/50 italic">
            {search || showFreeOnly ? t.settings.models.liveModelsEmpty : "No models configured"}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border/30 bg-background overflow-hidden divide-y divide-border/20">
          {filtered.map((m) => (
            <ModelRow
              key={m.id}
              id={m.id}
              displayName={m.displayName}
              modelId={m.modelId}
              isChatSelected={m.id === selectedChatName}
              isVisionSelected={m.id === selectedVisionName}
              supportsThinking={m.supportsThinking}
              supportsReasoning={m.supportsReasoning}
              supportsVision={m.supportsVision}
              isFree={m.isFree}
              onSelectChat={() => onRequestSelect(m.id, m.displayName)}
              onToggleVision={() => onRequestVision(m.id, m.displayName)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ModelsSettingsPage() {
  const { t } = useI18n();
  const { models, isLoading, error } = useModels();
  const { data: healthData, isLoading: healthLoading } = useProvidersHealth();
  const [localSettings, setLocalSettings] = useLocalSettings();
  const demo = env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true";
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [activeProviderId, setActiveProviderId] = useState<string>(() => {
    const saved = localSettings.context.selected_provider_id;
    if (saved) {
      const def = PROVIDER_DEFINITIONS.find((p) => p.id === saved);
      if (def) return saved;
    }
    const modelName: string | undefined = localSettings.context.model_name as
      | string
      | undefined;
    if (modelName) {
      return matchProviderForModel("", null, modelName);
    }
    return PROVIDER_DEFINITIONS[0]?.id ?? "";
  });
  const [validatedKey, setValidatedKey] = useState<string>("");

  const selectedChatName: string | undefined =
    typeof localSettings.context.model_name === "string" &&
    localSettings.context.model_name.length > 0
      ? localSettings.context.model_name
      : undefined;

  const selectedVisionName: string | undefined =
    typeof localSettings.context.vision_model_name === "string" &&
    localSettings.context.vision_model_name.length > 0
      ? localSettings.context.vision_model_name
      : undefined;

  // Pre-select provider of currently active model (when model is in config)
  useEffect(() => {
    if (!selectedChatName || !models.length) return;
    const m = models.find((x) => x.name === selectedChatName);
    if (!m) return;
    const pid = matchProviderForModel(m.provider_use, m.endpoint_url);
    if (pid) setActiveProviderId(pid);
  }, [selectedChatName, models]);

  // Auto-select provider when saved model is not in config
  useEffect(() => {
    if (!selectedChatName || !models.length) return;
    const inConfig = models.some((m) => m.name === selectedChatName);
    if (inConfig) return;

    // Use saved provider preference first
    const savedProvider = localSettings.context.selected_provider_id;
    if (savedProvider && savedProvider !== activeProviderId) {
      const def = PROVIDER_DEFINITIONS.find((p) => p.id === savedProvider);
      if (def) {
        setActiveProviderId(savedProvider);
        return;
      }
    }

    // Fall back to pattern matching
    const pid = matchProviderForModel("", null, selectedChatName);
    if (pid && pid !== activeProviderId) {
      setActiveProviderId(pid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChatName, models, localSettings.context.selected_provider_id]);

  // When provider changes, load saved key
  useEffect(() => {
    const saved = loadSavedKey(activeProviderId);
    setValidatedKey(saved);
  }, [activeProviderId]);

  const requestSelectChat = useCallback((modelId: string, modelName: string, providerName: string) => {
    if (modelId === selectedChatName) return;
    setPending({ modelId, modelName, kind: "chat", providerName, providerId: activeProviderId });
  }, [selectedChatName, activeProviderId]);

  const requestToggleVision = useCallback((modelId: string, modelName: string, providerName: string) => {
    if (modelId === selectedVisionName) {
      setLocalSettings("context", { vision_model_name: undefined });
      return;
    }
    setPending({ modelId, modelName, kind: "vision", providerName });
  }, [selectedVisionName, setLocalSettings]);

  const confirmSelection = useCallback(() => {
    if (!pending) return;
    if (pending.kind === "chat") {
      setLocalSettings("context", {
        model_name: pending.modelId,
        selected_provider_id: pending.providerId,
      });
    } else {
      setLocalSettings("context", { vision_model_name: pending.modelId });
    }
    setPending(null);
  }, [pending, setLocalSettings]);

  const handleOnKeyValidated = useCallback((key: string) => {
    setValidatedKey(key);
  }, []);

  const handleOnModelValidated = useCallback(
    (model: string) => {
      setLocalSettings("context", { model_name: model, selected_provider_id: activeProviderId });
    },
    [setLocalSettings, activeProviderId],
  );

  const modelsByProvider = useMemo(() => {
    const map = new Map<string, Model[]>();
    for (const m of models) {
      const pid = matchProviderForModel(m.provider_use, m.endpoint_url);
      const list = map.get(pid) ?? [];
      list.push(m);
      map.set(pid, list);
    }
    return map;
  }, [models]);

  const activeDef = PROVIDER_DEFINITIONS.find((p) => p.id === activeProviderId) ?? PROVIDER_DEFINITIONS[0];
  const selectedChatModel = models.find((m) => m.name === selectedChatName);
  const selectedVisionModel = models.find((m) => m.name === selectedVisionName);

  const health = healthData?.providers as Record<string, { reachable: boolean }> | undefined;
  const activeHealth = activeDef?.kind === "local" ? health?.[activeProviderId]?.reachable : undefined;

  return (
    <>
      {pending && (
        <ConfirmDialog
          pending={pending}
          onConfirm={confirmSelection}
          onCancel={() => setPending(null)}
        />
      )}
      <SettingsSection
        title={t.settings.models.title}
        description={t.settings.models.description}
      >
        {/* Active model summary bar */}
        <div className="flex items-center gap-4 rounded-xl border border-border/30 bg-muted/10 px-4 py-3 mb-6">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
              {t.settings.models.activeModel}
            </p>
            {selectedChatModel ? (
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold truncate">
                  {selectedChatModel.display_name?.trim() ?? selectedChatModel.model}
                </span>
                {selectedChatModel.supports_thinking && <BrainCircuitIcon className="size-3.5 text-violet-400 shrink-0" />}
                {selectedChatModel.supports_vision && <EyeIcon className="size-3.5 text-blue-400 shrink-0" />}
              </div>
            ) : selectedChatName ? (
              <div className="flex items-center gap-1.5">
                <CpuIcon className="size-3.5 text-primary/60" />
                <span className="text-sm font-semibold text-primary/80 truncate">{selectedChatName}</span>
              </div>
            ) : (
              <p className="text-sm italic text-muted-foreground/50">{t.settings.models.noneSelected}</p>
            )}
          </div>
          {(selectedVisionModel ?? selectedVisionName) && selectedVisionName !== selectedChatName && (
            <div className="shrink-0 border-l border-border/30 pl-4 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                {t.settings.models.visionModelTitle}
              </p>
              <div className="flex items-center gap-1.5">
                <EyeIcon className="size-3.5 text-blue-400 shrink-0" />
                <span className="text-sm font-semibold truncate">
                  {selectedVisionModel?.display_name?.trim() ?? selectedVisionModel?.model ?? selectedVisionName}
                </span>
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {t.common.loading}
          </div>
        ) : error ? (
          <p className="py-4 text-sm text-destructive">
            {t.settings.models.loadError}: {error.message}
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Step 1: Provider selector */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">Provider</p>
              <ProviderSelector
                providers={PROVIDER_DEFINITIONS}
                selectedId={activeProviderId}
                health={health}
                healthLoading={healthLoading}
                onChange={(id) => {
                  setActiveProviderId(id);
                  setLocalSettings("context", { selected_provider_id: id });
                }}
              />
            </div>

            {/* Step 2: API key (cloud providers) */}
            {activeDef?.kind === "cloud" && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">API Key</p>
                <ApiKeySection
                  providerId={activeProviderId}
                  docUrl={activeDef.docUrl}
                  onKeyValidated={handleOnKeyValidated}
                  onModelValidated={handleOnModelValidated}
                />
              </div>
            )}
            {/* Step 3: Model list */}
            {activeDef && (
              <div className="space-y-2 flex flex-col min-h-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">Models</p>
                  {activeDef.kind === "local" && activeHealth !== undefined && (
                    <span className={cn("flex items-center gap-1 text-[10px]", activeHealth ? "text-emerald-400" : "text-muted-foreground/40")}>
                      <span className={cn("size-1.5 rounded-full", activeHealth ? "bg-emerald-400" : "bg-muted-foreground/30")} />
                      {activeHealth ? t.settings.models.localRunning : t.settings.models.localNotRunning}
                    </span>
                  )}
                </div>
                <ModelListPanel
                  def={activeDef}
                  configModels={modelsByProvider.get(activeProviderId) ?? []}
                  apiKey={validatedKey}
                  isReachable={activeHealth}
                  selectedChatName={selectedChatName}
                  selectedVisionName={selectedVisionName}
                  onRequestSelect={(id, name) => requestSelectChat(id, name, activeDef.displayName)}
                  onRequestVision={(id, name) => requestToggleVision(id, name, activeDef.displayName)}
                  disabled={demo}
                />
              </div>
            )}
          </div>
        )}
      </SettingsSection>
    </>
  );
}
