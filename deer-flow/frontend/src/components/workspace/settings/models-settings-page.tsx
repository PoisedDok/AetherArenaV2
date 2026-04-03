"use client";

import {
  BrainCircuitIcon,
  CheckIcon,
  CpuIcon,
  EyeIcon,
  ExternalLinkIcon,
  KeyIcon,
  Loader2Icon,
  ServerIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import type { Model } from "@/core/models/types";
import {
  PROVIDER_DEFINITIONS,
  matchProviderForModel,
  type ProviderDefinition,
} from "@/core/providers/definitions";
import { useProvidersHealth, useTestProviderKey } from "@/core/providers/hooks";
import { useLocalSettings } from "@/core/settings";
import { env } from "@/env";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

// ── Capability badges ─────────────────────────────────────────────────────────

function CapBadge({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded border px-1 py-px text-[10px] font-medium", color)}>
      {icon}
      {label}
    </span>
  );
}

// ── Model row ─────────────────────────────────────────────────────────────────

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
      {/* Chat select button — whole left area is clickable */}
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

      {/* Capability indicators */}
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
              isVisionSelected
                ? "text-blue-400"
                : "text-muted-foreground/25 hover:text-blue-400/60",
            )}
          >
            <EyeIcon className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Cloud provider key test ───────────────────────────────────────────────────

function CloudKeyTest({ providerId, docUrl }: { providerId: string; docUrl?: string }) {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const { mutate: testKey, isPending, data: result, reset } = useTestProviderKey();

  const handleTest = () => {
    if (!key.trim()) return;
    testKey({ provider: providerId, api_key: key.trim() });
  };

  const handleKeyChange = (v: string) => {
    setKey(v);
    if (result) reset();
  };

  return (
    <div className="border-t border-border/30 px-3 py-2.5 space-y-2">
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
          disabled={!key.trim() || isPending}
          onClick={handleTest}
          className="shrink-0 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/60 disabled:opacity-40"
        >
          {isPending ? (
            <span className="flex items-center gap-1">
              <Loader2Icon className="size-3 animate-spin" />
              {t.settings.models.testKeyTesting}
            </span>
          ) : (
            t.settings.models.testKey
          )}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={cn(
          "flex items-center gap-1.5 text-xs",
          result.valid ? "text-emerald-400" : "text-red-400",
        )}>
          {result.valid
            ? <CheckIcon className="size-3.5" />
            : <XCircleIcon className="size-3.5" />}
          <span>
            {result.valid
              ? `${t.settings.models.testKeyValid}${result.models_count > 0 ? ` · ${result.models_count} models available` : ""}`
              : `${t.settings.models.testKeyInvalid}${result.error ? `: ${result.error}` : ""}`}
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
  );
}

// ── Provider card ─────────────────────────────────────────────────────────────

function ProviderCard({
  def,
  models,
  isReachable,
  isHealthLoading,
  selectedChatName,
  selectedVisionName,
  onSelectChat,
  onToggleVision,
  disabled,
}: {
  def: ProviderDefinition;
  models: Model[];
  isReachable: boolean | undefined;
  isHealthLoading: boolean;
  selectedChatName: string | undefined;
  selectedVisionName: string | undefined;
  onSelectChat: (name: string) => void;
  onToggleVision: (name: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const hasActiveModel = models.some((m) => m.name === selectedChatName);

  // Local provider status dot
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

  const isAvailable = def.kind === "local" ? isReachable === true : true;
  const isEmpty = models.length === 0;

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors overflow-hidden",
        hasActiveModel
          ? "border-primary/30 bg-primary/5"
          : "border-border/40 bg-muted/10",
        !isAvailable && isEmpty && "opacity-60",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <ServerIcon className={cn("size-4 shrink-0", hasActiveModel ? "text-primary" : "text-muted-foreground/40")} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{def.displayName}</span>
            {hasActiveModel && (
              <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                Active
              </span>
            )}
            {statusDot}
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5 truncate">{def.description}</p>
        </div>
        {models.length > 0 && (
          <span className="shrink-0 text-[10px] text-muted-foreground/40">
            {models.length} {models.length === 1 ? "model" : "models"}
          </span>
        )}
      </div>

      {/* Cloud key test */}
      {def.kind === "cloud" && (
        <CloudKeyTest providerId={def.id} docUrl={def.docUrl} />
      )}

      {/* Model list */}
      {models.length > 0 ? (
        <div className="border-t border-border/30 divide-y divide-border/20">
          {models.map((m) => (
            <ModelRow
              key={m.name}
              model={m}
              isChatSelected={m.name === selectedChatName}
              isVisionSelected={m.name === selectedVisionName}
              onSelectChat={() => onSelectChat(m.name)}
              onToggleVision={() => onToggleVision(m.name)}
              disabled={disabled}
            />
          ))}
        </div>
      ) : isAvailable ? (
        <p className="border-t border-border/30 px-3 py-2.5 text-xs text-muted-foreground/50 italic">
          {t.settings.models.noModelsConfigured}
        </p>
      ) : null}
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

  const handleSelectChat = (name: string) => {
    setLocalSettings("context", { model_name: name });
  };

  const handleToggleVision = (name: string) => {
    setLocalSettings("context", {
      vision_model_name: name === selectedVisionName ? undefined : name,
    });
  };

  // Map each model to its provider id
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
                models={providerModels}
                isReachable={isReachable}
                isHealthLoading={healthLoading}
                selectedChatName={selectedChatName}
                selectedVisionName={selectedVisionName}
                onSelectChat={handleSelectChat}
                onToggleVision={handleToggleVision}
                disabled={demo}
              />
            );
          })}
        </div>
      )}
    </SettingsSection>
  );
}
