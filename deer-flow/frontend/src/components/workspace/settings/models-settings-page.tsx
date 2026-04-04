"use client";

import {
  BrainCircuitIcon,
  CheckIcon,
  CpuIcon,
  EyeIcon,
  ExternalLinkIcon,
  KeyIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SparklesIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo, useRef, useState, useCallback } from "react";

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
} from "@/core/providers/hooks";
import { useLocalSettings } from "@/core/settings";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

// ── API key persistence (localStorage, never sent to server) ─────────────────

const API_KEY_STORAGE_PREFIX = "deerflow.provider-key.";

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

// ── Config model row (from backend config) ────────────────────────────────────

function ModelRow({
  model,
  isChatSelected,
  isVisionSelected,
  onSelectChat,
  onToggleVision,
  disabled,
}: {
  model: Model;
  isChatSelected: boolean;
  isVisionSelected: boolean;
  onSelectChat: () => void;
  onToggleVision: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const displayName = model.display_name?.trim() ?? model.model;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 transition-colors",
        isChatSelected ? "bg-primary/8" : "hover:bg-muted/40",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onSelectChat}
        className="flex flex-1 items-center gap-2 min-w-0 text-left"
      >
        <CpuIcon
          className={cn(
            "size-3.5 shrink-0 transition-colors",
            isChatSelected ? "text-primary" : "text-muted-foreground/30",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", isChatSelected ? "text-primary" : "")}>
            {displayName}
          </p>
          {model.model !== displayName && (
            <p className="truncate font-mono text-[10px] text-muted-foreground/50">{model.model}</p>
          )}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {model.supports_thinking && (
          <CapBadge
            icon={<BrainCircuitIcon className="size-2.5" />}
            label={t.settings.models.capabilitiesThinking}
            color="border-violet-500/20 bg-violet-500/10 text-violet-400"
          />
        )}
        {model.supports_reasoning_effort && (
          <CapBadge
            icon={<BrainCircuitIcon className="size-2.5" />}
            label={t.settings.models.capabilitiesReasoning}
            color="border-amber-500/20 bg-amber-500/10 text-amber-400"
          />
        )}
        {model.supports_vision && (
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

// ── Live model row (from provider API) ───────────────────────────────────────

function LiveModelRow({
  model,
  isChatSelected,
  isVisionSelected,
  onSelectChat,
  onToggleVision,
  disabled,
}: {
  model: ProviderModel;
  isChatSelected: boolean;
  isVisionSelected: boolean;
  onSelectChat: () => void;
  onToggleVision: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 transition-colors",
        isChatSelected ? "bg-primary/8" : "hover:bg-muted/40",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onSelectChat}
        className="flex flex-1 items-center gap-2 min-w-0 text-left"
      >
        <CpuIcon
          className={cn(
            "size-3.5 shrink-0 transition-colors",
            isChatSelected ? "text-primary" : "text-muted-foreground/30",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={cn("truncate text-sm font-medium", isChatSelected ? "text-primary" : "")}>
              {model.name}
            </p>
            {model.is_free && (
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1 py-px text-[9px] font-semibold text-emerald-400">
                {t.settings.models.freeLabel}
              </span>
            )}
          </div>
          {model.id !== model.name && (
            <p className="truncate font-mono text-[10px] text-muted-foreground/50">{model.id}</p>
          )}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {model.supports_thinking && (
          <CapBadge
            icon={<BrainCircuitIcon className="size-2.5" />}
            label={t.settings.models.capabilitiesThinking}
            color="border-violet-500/20 bg-violet-500/10 text-violet-400"
          />
        )}
        {model.supports_vision && (
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

// ── OpenRouter browser ────────────────────────────────────────────────────────

function OpenRouterBrowser({
  selectedChatName,
  selectedVisionName,
  onRequestSelect,
  onRequestVision,
  disabled,
}: {
  selectedChatName: string | undefined;
  selectedVisionName: string | undefined;
  onRequestSelect: (id: string, name: string) => void;
  onRequestVision: (id: string, name: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [showFreeOnly, setShowFreeOnly] = useState(false);
  const { data, isLoading, error } = useOpenRouterModels(true);

  const filtered = useMemo(() => {
    if (!data?.models) return [];
    return data.models.filter((m) => {
      if (showFreeOnly && !m.is_free) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
    });
  }, [data?.models, search, showFreeOnly]);

  return (
    <div className="border-t border-border/30">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.settings.models.searchModelsPlaceholder}
            className="w-full rounded border border-border/40 bg-muted/20 pl-6 pr-2 py-1 text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFreeOnly(!showFreeOnly)}
          className={cn(
            "shrink-0 rounded border px-2 py-1 text-[10px] font-semibold transition-colors",
            showFreeOnly
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
              : "border-border/40 bg-muted/20 text-muted-foreground/50 hover:text-muted-foreground",
          )}
        >
          {t.settings.models.freeLabel}
        </button>
      </div>

      {/* Model list */}
      <div className="max-h-72 overflow-y-auto divide-y divide-border/10">
        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            {t.settings.models.fetchModelsLoading}
          </div>
        ) : error ? (
          <p className="px-3 py-3 text-xs text-red-400">{t.settings.models.fetchModelsError}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground/50 italic">{t.settings.models.liveModelsEmpty}</p>
        ) : (
          filtered.map((m) => (
            <LiveModelRow
              key={m.id}
              model={m}
              isChatSelected={m.id === selectedChatName}
              isVisionSelected={m.id === selectedVisionName}
              onSelectChat={() => onRequestSelect(m.id, m.name)}
              onToggleVision={() => onRequestVision(m.id, m.name)}
              disabled={disabled}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Cloud provider key + live models ─────────────────────────────────────────

function CloudKeySection({
  providerId,
  docUrl,
  isOpenRouter,
  selectedChatName,
  selectedVisionName,
  onRequestSelect,
  onRequestVision,
  disabled,
}: {
  providerId: string;
  docUrl?: string;
  isOpenRouter: boolean;
  selectedChatName: string | undefined;
  selectedVisionName: string | undefined;
  onRequestSelect: (id: string, name: string) => void;
  onRequestVision: (id: string, name: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [key, setKey] = useState(() => loadSavedKey(providerId));
  const { mutate: testKey, isPending: isTesting, data: testResult, reset: resetTest } = useTestProviderKey();
  const { mutate: fetchModels, isPending: isFetching, data: modelsResult, reset: resetModels } = useFetchProviderModels();
  const [search, setSearch] = useState("");

  const handleTest = () => {
    if (!key.trim()) return;
    resetModels();
    testKey(
      { provider: providerId, api_key: key.trim() },
      {
        onSuccess: (result) => {
          if (result.valid) {
            saveKey(providerId, key.trim()); // persist on successful validation
            fetchModels({ provider: providerId, api_key: key.trim() });
          }
        },
      },
    );
  };

  const handleKeyChange = (v: string) => {
    setKey(v);
    if (testResult) { resetTest(); resetModels(); }
  };

  const liveModels = useMemo(() => modelsResult?.models ?? [], [modelsResult?.models]);

  const filteredModels = useMemo(() => {
    if (!search.trim()) return liveModels;
    const q = search.toLowerCase();
    return liveModels.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }, [liveModels, search]);

  return (
    <div className="border-t border-border/30">
      {/* Key input row */}
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <KeyIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/40" />
            <input
              type="password"
              value={key}
              onChange={(e) => handleKeyChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTest()}
              placeholder={t.settings.models.testKeyPlaceholder}
              className="w-full rounded-md border border-border/50 bg-muted/20 pl-7 pr-3 py-1.5 text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <button
            type="button"
            disabled={!key.trim() || isTesting || isFetching}
            onClick={handleTest}
            className="shrink-0 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/60 disabled:opacity-40"
          >
            {isTesting || isFetching ? (
              <span className="flex items-center gap-1">
                <Loader2Icon className="size-3 animate-spin" />
                {isTesting ? t.settings.models.testKeyTesting : t.settings.models.fetchModelsLoading}
              </span>
            ) : (
              t.settings.models.testKey
            )}
          </button>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={cn("flex items-center gap-1.5 text-xs", testResult.valid ? "text-emerald-400" : "text-red-400")}>
            {testResult.valid ? <CheckIcon className="size-3.5" /> : <XCircleIcon className="size-3.5" />}
            <span>
              {testResult.valid
                ? (liveModels.length > 0
                    ? `${t.settings.models.keyValidLoadModels} (${liveModels.length})`
                    : t.settings.models.testKeyValid)
                : `${t.settings.models.testKeyInvalid}${testResult.error ? `: ${testResult.error}` : ""}`}
            </span>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
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

      {/* Live models from this provider after key validated */}
      {liveModels.length > 0 && !isOpenRouter && (
        <div className="border-t border-border/20">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/15">
            <SparklesIcon className="size-3 text-primary/60" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {t.settings.models.liveModels}
            </span>
            {liveModels.length > 8 && (
              <div className="relative flex-1 ml-auto max-w-40">
                <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-2.5 text-muted-foreground/40" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.settings.models.searchModelsPlaceholder}
                  className="w-full rounded border border-border/30 bg-muted/20 pl-5 pr-2 py-0.5 text-[10px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-border/10">
            {filteredModels.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground/50 italic">{t.settings.models.liveModelsEmpty}</p>
            ) : (
              filteredModels.map((m) => (
                <LiveModelRow
                  key={m.id}
                  model={m}
                  isChatSelected={m.id === selectedChatName}
                  isVisionSelected={m.id === selectedVisionName}
                  onSelectChat={() => onRequestSelect(m.id, m.name)}
                  onToggleVision={() => onRequestVision(m.id, m.name)}
                  disabled={disabled}
                />
              ))
            )}
          </div>
        </div>
      )}

      {modelsResult?.error && (
        <p className="px-3 py-2 text-[10px] text-red-400">{t.settings.models.fetchModelsError}: {modelsResult.error}</p>
      )}
    </div>
  );
}

// ── Manual model input ────────────────────────────────────────────────────────

function ManualModelInput({
  onSelectChat,
  disabled,
}: {
  onSelectChat: (id: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    const id = value.trim();
    if (!id) return;
    onSelectChat(id);
    setValue("");
  };

  return (
    <div className="border-t border-border/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <PlusIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/40" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={t.settings.models.manualModelPlaceholder}
            disabled={disabled}
            className="w-full rounded-md border border-border/40 bg-muted/20 pl-7 pr-3 py-1.5 text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-40"
          />
        </div>
        <button
          type="button"
          disabled={!value.trim() || disabled}
          onClick={handleAdd}
          className="shrink-0 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-primary/20 hover:border-primary/40 hover:text-primary disabled:opacity-40"
        >
          {t.settings.models.manualModelAdd}
        </button>
      </div>
    </div>
  );
}

// ── Local provider section ────────────────────────────────────────────────────

function LocalProviderSection({
  providerId,
  isReachable,
  localUrl: _localUrl,
  selectedChatName,
  selectedVisionName,
  onRequestSelect,
  onRequestVision,
  disabled,
}: {
  providerId: string;
  isReachable: boolean | undefined;
  localUrl: string;
  selectedChatName: string | undefined;
  selectedVisionName: string | undefined;
  onRequestSelect: (id: string, name: string) => void;
  onRequestVision: (id: string, name: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { mutate: fetchModels, isPending, data: modelsResult } = useFetchProviderModels();
  const [fetched, setFetched] = useState(false);

  // Auto-fetch when provider becomes reachable
  const handleFetch = () => {
    setFetched(true);
    fetchModels({ provider: providerId, api_key: "" });
  };

  const liveModels = modelsResult?.models ?? [];

  if (!isReachable) return null;

  return (
    <div className="border-t border-border/30">
      {!fetched ? (
        <div className="px-3 py-2">
          <button
            type="button"
            onClick={handleFetch}
            disabled={disabled}
            className="flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary transition-colors"
          >
            <SparklesIcon className="size-3" />
            {t.settings.models.fetchModels}
          </button>
        </div>
      ) : isPending ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          {t.settings.models.fetchModelsLoading}
        </div>
      ) : modelsResult?.error ? (
        <p className="px-3 py-2 text-xs text-red-400">{t.settings.models.fetchModelsError}</p>
      ) : liveModels.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground/50 italic">{t.settings.models.liveModelsEmpty}</p>
      ) : (
        <div className="divide-y divide-border/10 max-h-56 overflow-y-auto">
          {liveModels.map((m) => (
            <LiveModelRow
              key={m.id}
              model={m}
              isChatSelected={m.id === selectedChatName}
              isVisionSelected={m.id === selectedVisionName}
              onSelectChat={() => onRequestSelect(m.id, m.name)}
              onToggleVision={() => onRequestVision(m.id, m.name)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Provider card ─────────────────────────────────────────────────────────────

function ProviderCard({
  def,
  configModels,
  isReachable,
  isHealthLoading,
  selectedChatName,
  selectedVisionName,
  onRequestSelect,
  onRequestVision,
  disabled,
}: {
  def: ProviderDefinition;
  configModels: Model[];
  isReachable: boolean | undefined;
  isHealthLoading: boolean;
  selectedChatName: string | undefined;
  selectedVisionName: string | undefined;
  onRequestSelect: (modelId: string, modelName: string, providerName: string) => void;
  onRequestVision: (modelId: string, modelName: string, providerName: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();

  const hasActiveConfigModel = configModels.some((m) => m.name === selectedChatName);
  const isOpenRouter = def.id === "openrouter";

  const statusDot = def.kind === "local" ? (
    isHealthLoading ? (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
        <Loader2Icon className="size-2.5 animate-spin" />
        {t.settings.models.localChecking}
      </span>
    ) : isReachable ? (
      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-400" />
        {t.settings.models.localRunning}
      </span>
    ) : (
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40">
        <span className="size-1.5 rounded-full bg-muted-foreground/30" />
        {t.settings.models.localNotRunning}
      </span>
    )
  ) : null;

  const isUnavailableLocal = def.kind === "local" && isReachable === false;

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors overflow-hidden",
        hasActiveConfigModel
          ? "border-primary/30 bg-primary/5"
          : "border-border/40 bg-muted/10",
        isUnavailableLocal && "opacity-60",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <ServerIcon className={cn("size-4 shrink-0", hasActiveConfigModel ? "text-primary" : "text-muted-foreground/40")} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{def.displayName}</span>
            {hasActiveConfigModel && (
              <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                Active
              </span>
            )}
            {statusDot}
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5 truncate">{def.description}</p>
        </div>
        {configModels.length > 0 && (
          <span className="shrink-0 text-[10px] text-muted-foreground/40">
            {configModels.length} configured
          </span>
        )}
      </div>

      {/* Config models (from backend config) */}
      {configModels.length > 0 && (
        <div className="border-t border-border/30 divide-y divide-border/20">
          {configModels.map((m) => (
            <ModelRow
              key={m.name}
              model={m}
              isChatSelected={m.name === selectedChatName}
              isVisionSelected={m.name === selectedVisionName}
              onSelectChat={() => onRequestSelect(m.name, m.display_name?.trim() ?? m.model, def.displayName)}
              onToggleVision={() => onRequestVision(m.name, m.display_name?.trim() ?? m.model, def.displayName)}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {/* Local provider: live model fetch when running */}
      {def.kind === "local" && def.localUrl && (
        <LocalProviderSection
          providerId={def.id}
          isReachable={isReachable}
          localUrl={def.localUrl}
          selectedChatName={selectedChatName}
          selectedVisionName={selectedVisionName}
          onRequestSelect={(id, name) => onRequestSelect(id, name, def.displayName)}
          onRequestVision={(id, name) => onRequestVision(id, name, def.displayName)}
          disabled={disabled}
        />
      )}

      {/* Cloud provider: key test + live models */}
      {def.kind === "cloud" && (
        <CloudKeySection
          providerId={def.id}
          docUrl={def.docUrl}
          isOpenRouter={isOpenRouter}
          selectedChatName={selectedChatName}
          selectedVisionName={selectedVisionName}
          onRequestSelect={(id, name) => onRequestSelect(id, name, def.displayName)}
          onRequestVision={(id, name) => onRequestVision(id, name, def.displayName)}
          disabled={disabled}
        />
      )}

      {/* OpenRouter: always-visible searchable catalog */}
      {isOpenRouter && (
        <OpenRouterBrowser
          selectedChatName={selectedChatName}
          selectedVisionName={selectedVisionName}
          onRequestSelect={(id, name) => onRequestSelect(id, name, def.displayName)}
          onRequestVision={(id, name) => onRequestVision(id, name, def.displayName)}
          disabled={disabled}
        />
      )}

      {/* Manual model input — always shown at bottom of each provider */}
      <ManualModelInput
        onSelectChat={(id) => onRequestSelect(id, id, def.displayName)}
        disabled={disabled}
      />
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

  // Called by any row — shows confirm dialog before applying
  const requestSelectChat = useCallback((modelId: string, modelName: string, providerName: string) => {
    if (modelId === selectedChatName) return; // already selected
    setPending({ modelId, modelName, kind: "chat", providerName });
  }, [selectedChatName]);

  const requestToggleVision = useCallback((modelId: string, modelName: string, providerName: string) => {
    if (modelId === selectedVisionName) {
      // deselect immediately — no confirm needed to clear
      setLocalSettings("context", { vision_model_name: undefined });
      return;
    }
    setPending({ modelId, modelName, kind: "vision", providerName });
  }, [selectedVisionName, setLocalSettings]);

  const confirmSelection = useCallback(() => {
    if (!pending) return;
    if (pending.kind === "chat") {
      setLocalSettings("context", { model_name: pending.modelId });
    } else {
      setLocalSettings("context", { vision_model_name: pending.modelId });
    }
    setPending(null);
  }, [pending, setLocalSettings]);


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

  const selectedChatModel = models.find((m) => m.name === selectedChatName);
  const selectedVisionModel = models.find((m) => m.name === selectedVisionName);

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
      {/* Active model summary */}
      <div className="mb-4 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
            {t.settings.models.activeModel}
          </p>
          {selectedChatModel ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium truncate">
                {selectedChatModel.display_name?.trim() ?? selectedChatModel.model}
              </span>
              {selectedChatModel.supports_thinking && (
                <BrainCircuitIcon className="size-3 text-violet-400" />
              )}
              {selectedChatModel.supports_vision && (
                <EyeIcon className="size-3 text-blue-400" />
              )}
            </div>
          ) : selectedChatName ? (
            <div className="flex items-center gap-1.5">
              <CpuIcon className="size-3 text-primary/60" />
              <span className="text-sm font-medium text-primary/80 truncate">{selectedChatName}</span>
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">{t.settings.models.noneSelected}</p>
          )}
        </div>
        {selectedVisionModel && selectedVisionModel.name !== selectedChatName && (
          <div className="shrink-0 border-l border-border/30 pl-4 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
              {t.settings.models.visionModelTitle}
            </p>
            <div className="flex items-center gap-1.5">
              <EyeIcon className="size-3 text-blue-400 shrink-0" />
              <span className="text-sm font-medium truncate">
                {selectedVisionModel.display_name?.trim() ?? selectedVisionModel.model}
              </span>
            </div>
          </div>
        )}
        {selectedVisionName && !selectedVisionModel && selectedVisionName !== selectedChatName && (
          <div className="shrink-0 border-l border-border/30 pl-4 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
              {t.settings.models.visionModelTitle}
            </p>
            <div className="flex items-center gap-1.5">
              <EyeIcon className="size-3 text-blue-400 shrink-0" />
              <span className="text-sm font-medium truncate">{selectedVisionName}</span>
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
        <div className="flex flex-col gap-3">
          {PROVIDER_DEFINITIONS.map((def) => {
            const providerModels = modelsByProvider.get(def.id) ?? [];
            const health = healthData?.providers[def.id];
            const isReachable = def.kind === "local" ? health?.reachable : undefined;

            return (
              <ProviderCard
                key={def.id}
                def={def}
                configModels={providerModels}
                isReachable={isReachable}
                isHealthLoading={healthLoading}
                selectedChatName={selectedChatName}
                selectedVisionName={selectedVisionName}
                onRequestSelect={requestSelectChat}
                onRequestVision={requestToggleVision}
                disabled={demo}
              />
            );
          })}
        </div>
      )}
    </SettingsSection>
    </>
  );
}
