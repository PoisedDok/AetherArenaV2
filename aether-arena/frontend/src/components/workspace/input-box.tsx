"use client";

import type { ChatStatus } from "ai";
import {
  BotIcon,
  CheckIcon,
  ClockIcon,
  CpuIcon,
  GraduationCapIcon,
  LayersIcon,
  LightbulbIcon,
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  RocketIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentProps } from "react";

import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useAgents } from "@/core/agents/hooks";
import { getBackendBaseURL } from "@/core/config";
import { setGuruMuted } from "@/core/guru/guru";
import { useI18n } from "@/core/i18n/hooks";
import { useMCPConfig, useEnableMCPServer } from "@/core/mcp/hooks";
import { useModels } from "@/core/models/hooks";
import type { Model } from "@/core/models/types";
import { matchProviderForModel, PROVIDER_DEFINITIONS } from "@/core/providers/definitions";
import { useOpenRouterModels } from "@/core/providers/hooks";
import { subscribe as subscribeQueue, getSnapshot as getQueueSnapshot, removeById } from "@/core/queue";
import { useLocalSettings } from "@/core/settings";
import { useEnableSkill, useSkills } from "@/core/skills/hooks";
import type { AgentThreadContext } from "@/core/threads";
import { textOfMessage } from "@/core/threads/utils";
import { useToolGroups } from "@/core/tool-groups/hooks";
import { cn } from "@/lib/utils";

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "../ai-elements/model-selector";
import { Suggestion, Suggestions } from "../ai-elements/suggestion";

import { CompactButton } from "./compact-button";
import { useThread } from "./messages/context";
import { ModeHoverGuide } from "./mode-hover-guide";

// Helper to extract a short provider tag from display_name
function getProviderTag(displayName: string): string {
  const lower = displayName.toLowerCase();
  if (lower.includes("aether")) return "Aether";
  if (lower.includes("lmstudio") || lower.includes("lm-studio")) return "LM";
  if (lower.includes("openai") && lower.includes("azure")) return "Azure";
  if (lower.includes("openai")) return "OpenAI";
  if (lower.includes("anthropic")) return "Anthropic";
  if (lower.includes("google") || lower.includes("gemini")) return "Google";
  if (lower.includes("cohere")) return "Cohere";
  if (lower.includes("mistral")) return "Mistral";
  if (lower.includes("groq")) return "Groq";
  if (lower.includes("ollama")) return "Ollama";
  if (lower.includes("local")) return "Local";
  // Fallback: first word or first 3 chars
  const firstWord = displayName.split(/[\s-_]/)[0];
  return firstWord ? firstWord.slice(0, 3).toUpperCase() : "?";
}

// Format model for display using the best available identifier
function formatModelDisplay(m: Model): string {
  // Try to get a meaningful name from model field
  const cleanedModelId = m.model
    .replace(/^(aether-|lmstudio-|local-|ollama-)/i, "")
    .replace(/_/g, "-")
    .replace(/:latest$/i, "");

  // If cleaned model ID is meaningful (not just "model" or empty), use it
  if (cleanedModelId && cleanedModelId !== "model" && cleanedModelId.length > 1) {
    return cleanedModelId;
  }

  // Fall back to display_name if it's not just the provider name
  const dn = m.display_name ?? "";
  const displayLower = dn.toLowerCase();
  const isProviderOnly =
    displayLower === "lmstudio" ||
    displayLower === "local" ||
    displayLower === "ollama" ||
    displayLower === "lm-studio" ||
    displayLower.includes("openai") && !displayLower.includes(" ") ||
    displayLower.includes("anthropic") && !displayLower.includes(" ");

  if (!isProviderOnly && dn.length > 3) {
    return dn;
  }

  // Fall back to the name field (usually the config key)
  if (m.name && m.name.length > 0 && m.name !== "default") {
    return m.name
      .replace(/^(aether|lmstudio|local|ollama)_/i, "")
      .replace(/_/g, "-");
  }

  // Last resort: return the original model ID
  return m.model;
}

type InputMode = "flash" | "thinking" | "pro" | "ultra";

function getResolvedMode(
  mode: InputMode | undefined,
  supportsThinking: boolean,
): InputMode {
  if (mode === "thinking" && !supportsThinking) {
    return "flash";
  }
  if (mode) {
    return mode;
  }
  return supportsThinking ? "pro" : "flash";
}

export function InputBox({
  className,
  disabled,
  autoFocus,
  status = "ready",
  context,
  extraHeader,
  isNewThread,
  threadId,
  initialValue,
  onContextChange,
  onSubmit,
  onStop,
  onRetry,
  ...props
}: Omit<ComponentProps<typeof PromptInput>, "onSubmit"> & {
  assistantId?: string | null;
  status?: ChatStatus;
  disabled?: boolean;
  context: Omit<
    AgentThreadContext,
    "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
  > & {
    mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
    reasoning_effort?: "minimal" | "low" | "medium" | "high";
  };
  extraHeader?: React.ReactNode;
  isNewThread?: boolean;
  threadId: string;
  initialValue?: string;
  onContextChange?: (
    context: Omit<
      AgentThreadContext,
      "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
    > & {
      mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
      reasoning_effort?: "minimal" | "low" | "medium" | "high";
    },
  ) => void;
  onSubmit?: (message: PromptInputMessage) => void;
  onStop?: () => void;
  onRetry?: () => void;
}): React.ReactElement {
  const { t } = useI18n();
  const [localSettings] = useLocalSettings();
  const searchParams = useSearchParams();
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const { models: configModels } = useModels();

  // Derive the provider ID consistently with Settings page
  const resolvedProviderId = useMemo(() => {
    const saved = localSettings.context.selected_provider_id;
    if (saved) {
      const def = PROVIDER_DEFINITIONS.find((p) => p.id === saved);
      if (def) return saved;
    }
    const modelName: string | undefined =
      typeof context.model_name === "string" && context.model_name.length > 0
        ? context.model_name
        : undefined;
    if (modelName) {
      return matchProviderForModel("", null, modelName);
    }
    return PROVIDER_DEFINITIONS[0]?.id ?? "";
  }, [localSettings.context.selected_provider_id, context.model_name]);

  const { data: openRouterData } = useOpenRouterModels(
    resolvedProviderId === "openrouter",
  );

  // Build model list based on selected provider
  const models = useMemo(() => {
    const result: Model[] = [];
    for (const m of configModels) {
      const pid = matchProviderForModel(m.provider_use, m.endpoint_url);
      if (pid === resolvedProviderId) {
        result.push(m);
      }
    }

    // If OpenRouter is selected, also include live models from the catalog
    if (resolvedProviderId === "openrouter" && openRouterData?.models) {
      const configModelIds = new Set(configModels.map((m) => m.model));
      for (const liveModel of openRouterData.models) {
        if (!configModelIds.has(liveModel.id)) {
          result.push({
            name: liveModel.id,
            model: liveModel.id,
            display_name: liveModel.name,
            description: liveModel.description,
            supports_thinking: liveModel.supports_thinking,
            supports_vision: liveModel.supports_vision,
            provider_use: "openrouter",
            endpoint_url: "https://openrouter.ai/api/v1",
          });
        }
      }
    }

    return result;
  }, [configModels, openRouterData, resolvedProviderId]);
  const { thread, isMock } = useThread();
  const { textInput } = usePromptInputController();
  const promptRootRef = useRef<HTMLDivElement | null>(null);

  const [followups, setFollowups] = useState<string[]>([]);
  const [followupsHidden, setFollowupsHidden] = useState(false);
  const [followupsLoading, setFollowupsLoading] = useState(false);
  const lastGeneratedForAiIdRef = useRef<string | null>(null);
  const wasStreamingRef = useRef(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(
    null,
  );

  // Queue state — tracks per-thread enqueued messages
  const [queueSize, setQueueSize] = useState(0);
  const [queuedItems, setQueuedItems] = useState<{ id: string; text: string; hasAttachments: boolean }[]>([]);

  useEffect(() => {
    const syncQueue = () => {
      const snapshot = getQueueSnapshot();
      const forThread = snapshot.filter((m) => m.threadId === threadId);
      setQueueSize(forThread.length);
      setQueuedItems(forThread.map((m) => ({ id: m.id, text: m.text, hasAttachments: m.hasAttachments })));
    };
    syncQueue();
    return subscribeQueue(syncQueue);
  }, [threadId]);

  useEffect(() => {
    if (!localSettings.behavior.auto_followup) {
      setFollowups([]);
      setFollowupsLoading(false);
      setFollowupsHidden(true);
    }
  }, [localSettings.behavior.auto_followup]);

  useEffect(() => {
    if (models.length === 0) {
      return;
    }
    const currentModel = models.find((m) => m.name === context.model_name);
    // If a custom/external model ID is set (e.g. OpenRouter), don't overwrite it
    if (!currentModel && context.model_name) {
      return;
    }
    const fallbackModel = currentModel ?? models[0]!;
    const supportsThinking = fallbackModel.supports_thinking ?? false;
    const nextModelName = fallbackModel.name;
    const nextMode = getResolvedMode(context.mode, supportsThinking);

    if (context.model_name === nextModelName && context.mode === nextMode) {
      return;
    }

    onContextChange?.({
      ...context,
      model_name: nextModelName,
      mode: nextMode,
    });
  }, [context, models, onContextChange]);

  const selectedModel = useMemo(() => {
    if (models.length === 0) {
      return undefined;
    }
    // If a custom/external model ID is set (e.g. OpenRouter), don't fall back to models[0]
    if (context.model_name) {
      return models.find((m) => m.name === context.model_name) ?? null;
    }
    return models[0];
  }, [context.model_name, models]);

  const supportThinking = useMemo(
    () => selectedModel?.supports_thinking ?? false,
    [selectedModel],
  );

  const supportReasoningEffort = useMemo(
    () => selectedModel?.supports_reasoning_effort ?? false,
    [selectedModel],
  );

  const handleModelSelect = useCallback(
    (model_name: string) => {
      const model = models.find((m) => m.name === model_name);
      onContextChange?.({
        ...context,
        model_name,
        mode: getResolvedMode(context.mode, model?.supports_thinking ?? false),
        reasoning_effort: context.reasoning_effort,
      });
      setModelDialogOpen(false);
    },
    [onContextChange, context, models],
  );

  const handleModeSelect = useCallback(
    (mode: InputMode) => {
      onContextChange?.({
        ...context,
        mode: getResolvedMode(mode, supportThinking),
        reasoning_effort: mode === "ultra" ? "high" : mode === "pro" ? "medium" : mode === "thinking" ? "low" : "minimal",
      });
    },
    [onContextChange, context, supportThinking],
  );

  const handleReasoningEffortSelect = useCallback(
    (effort: "minimal" | "low" | "medium" | "high") => {
      onContextChange?.({
        ...context,
        reasoning_effort: effort,
      });
    },
    [onContextChange, context],
  );

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (status === "streaming") {
        if (message.text?.trim()) {
          // Non-empty submit while streaming → queue the message.
          // sendMessage detects sendInFlightRef=true and enqueues. onFinish then
          // drains the queue automatically — no stop needed, no interruption.
          onSubmit?.(message);
        } else {
          // Empty submit while streaming = stop button click.
          onStop?.();
        }
        return;
      }
      if (status === "error") {
        onRetry?.();
        return;
      }
      if (!message.text) {
        return;
      }

      // Intercept /guru commands before sending to the AI
      const trimmed = message.text.trim();
      if (trimmed.startsWith("/guru")) {
        const sub = trimmed.slice(5).trim();
        if (sub === "pet") {
          window.dispatchEvent(new CustomEvent("guru:pet"));
          return;
        }
        if (sub === "mute") {
          setGuruMuted(true);
          return;
        }
        if (sub === "unmute") {
          setGuruMuted(false);
          return;
        }
        if (sub === "reset") {
          const { clearGuru } = await import("@/core/guru/guru");
          clearGuru();
          return;
        }
        // /guru stats and unrecognised subcommands fall through to AI
      }

      setFollowups([]);
      setFollowupsHidden(false);
      setFollowupsLoading(false);
      onSubmit?.(message);
    },
    [onSubmit, onStop, onRetry, status],
  );

  const requestFormSubmit = useCallback(() => {
    const form = promptRootRef.current?.querySelector("form");
    form?.requestSubmit();
  }, []);

  const handleFollowupClick = useCallback(
    (suggestion: string) => {
      if (status === "streaming") {
        return;
      }
      const current = (textInput.value ?? "").trim();
      if (current) {
        setPendingSuggestion(suggestion);
        setConfirmOpen(true);
        return;
      }
      textInput.setInput(suggestion);
      setFollowupsHidden(true);
      setTimeout(() => requestFormSubmit(), 0);
    },
    [requestFormSubmit, status, textInput],
  );

  const confirmReplaceAndSend = useCallback(() => {
    if (!pendingSuggestion) {
      setConfirmOpen(false);
      return;
    }
    textInput.setInput(pendingSuggestion);
    setFollowupsHidden(true);
    setConfirmOpen(false);
    setPendingSuggestion(null);
    setTimeout(() => requestFormSubmit(), 0);
  }, [pendingSuggestion, requestFormSubmit, textInput]);

  const confirmAppendAndSend = useCallback(() => {
    if (!pendingSuggestion) {
      setConfirmOpen(false);
      return;
    }
    const current = (textInput.value ?? "").trim();
    const next = current ? `${current}\n${pendingSuggestion}` : pendingSuggestion;
    textInput.setInput(next);
    setFollowupsHidden(true);
    setConfirmOpen(false);
    setPendingSuggestion(null);
    setTimeout(() => requestFormSubmit(), 0);
  }, [pendingSuggestion, requestFormSubmit, textInput]);

  useEffect(() => {
    const streaming = status === "streaming";
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = streaming;
    if (!wasStreaming || streaming) {
      return;
    }

    if (disabled || isMock) {
      return;
    }

    const lastAi = [...thread.messages].reverse().find((m) => m.type === "ai");
    const lastAiId = lastAi?.id ?? null;
    if (!lastAiId || lastAiId === lastGeneratedForAiIdRef.current) {
      return;
    }

    if (!localSettings.behavior.auto_followup) {
      return;
    }

    lastGeneratedForAiIdRef.current = lastAiId;

    const recent = thread.messages
      .filter((m) => m.type === "human" || m.type === "ai")
      .map((m) => {
        const role = m.type === "human" ? "user" : "assistant";
        const content = textOfMessage(m) ?? "";
        return { role, content };
      })
      .filter((m) => m.content.trim().length > 0)
      .slice(-6);

    if (recent.length === 0) {
      return;
    }

    const controller = new AbortController();
    setFollowupsHidden(false);
    setFollowupsLoading(true);
    setFollowups([]);

    fetch(`${getBackendBaseURL()}/api/threads/${threadId}/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: recent,
        n: 3,
        model_name: context.model_name ?? undefined,
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          return { suggestions: [] as string[] };
        }
        return (await res.json()) as { suggestions?: string[] };
      })
      .then((data) => {
        const suggestions = (data.suggestions ?? [])
          .map((s) => (typeof s === "string" ? s.trim() : ""))
          .filter((s) => s.length > 0)
          .slice(0, 5);
        setFollowups(suggestions);
      })
      .catch(() => {
        setFollowups([]);
      })
      .finally(() => {
        setFollowupsLoading(false);
      });

    return () => controller.abort();
  }, [
    context.model_name,
    disabled,
    isMock,
    localSettings.behavior.auto_followup,
    status,
    thread.messages,
    threadId,
  ]);

  return (
    <div ref={promptRootRef} className="relative">
      <PromptInput
        className={cn(
          "glass-chat-input rounded-2xl transition-all duration-300 ease-out *:data-[slot='input-group']:rounded-2xl",
          className,
        )}
        disabled={disabled}
        globalDrop
        multiple
        onSubmit={handleSubmit}
        {...props}
      >
        {extraHeader && (
          <div className="absolute top-0 right-0 left-0 z-10">
            <div className="absolute right-0 bottom-0 left-0 flex items-center justify-center">
              {extraHeader}
            </div>
          </div>
        )}
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>
        <PromptInputBody className="absolute top-0 right-0 left-0 z-3">
          <PromptInputTextarea
            className={cn("size-full")}
            disabled={disabled}
            placeholder={t.inputBox.placeholder}
            autoFocus={autoFocus}
            defaultValue={initialValue}
          />
        </PromptInputBody>
        <PromptInputFooter className="flex">
          <PromptInputTools>
          {/* TODO: Add more connectors here
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger className="px-2!" />
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments
                label={t.inputBox.addAttachments}
              />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu> */}
          <InputActionsMenu
            agentName={context.agent_name as string | undefined}
            onAgentSelect={(name) =>
              onContextChange?.({ ...context, agent_name: name ?? undefined })
            }
          />
          <PromptInputActionMenu>
            <ModeHoverGuide
              mode={
                context.mode === "flash" ||
                  context.mode === "thinking" ||
                  context.mode === "pro" ||
                  context.mode === "ultra"
                  ? context.mode
                  : "flash"
              }
            >
              <PromptInputActionMenuTrigger className="gap-1! px-2!">
                <div>
                  {context.mode === "flash" && <ZapIcon className="size-3" />}
                  {context.mode === "thinking" && (
                    <LightbulbIcon className="size-3" />
                  )}
                  {context.mode === "pro" && (
                    <GraduationCapIcon className="size-3" />
                  )}
                  {context.mode === "ultra" && (
                    <RocketIcon className="size-3 text-[#dabb5e]" />
                  )}
                </div>
                <div
                  className={cn(
                    "text-xs font-normal",
                    context.mode === "ultra" ? "golden-text" : "",
                  )}
                >
                  {(context.mode === "flash" && t.inputBox.flashMode) ||
                    (context.mode === "thinking" && t.inputBox.reasoningMode) ||
                    (context.mode === "pro" && t.inputBox.proMode) ||
                    (context.mode === "ultra" && t.inputBox.ultraMode)}
                </div>
              </PromptInputActionMenuTrigger>
            </ModeHoverGuide>
            <PromptInputActionMenuContent className="w-80">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  {t.inputBox.mode}
                </DropdownMenuLabel>
                <PromptInputActionMenu>
                  <PromptInputActionMenuItem
                    className={cn(
                      context.mode === "flash"
                        ? "text-accent-foreground"
                        : "text-muted-foreground/65",
                    )}
                    onSelect={() => handleModeSelect("flash")}
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1 font-bold">
                        <ZapIcon
                          className={cn(
                            "mr-2 size-4",
                            context.mode === "flash" &&
                            "text-accent-foreground",
                          )}
                        />
                        {t.inputBox.flashMode}
                      </div>
                      <div className="pl-7 text-xs">
                        {t.inputBox.flashModeDescription}
                      </div>
                    </div>
                    {context.mode === "flash" ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </PromptInputActionMenuItem>
                  {supportThinking && (
                    <PromptInputActionMenuItem
                      className={cn(
                        context.mode === "thinking"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleModeSelect("thinking")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          <LightbulbIcon
                            className={cn(
                              "mr-2 size-4",
                              context.mode === "thinking" &&
                              "text-accent-foreground",
                            )}
                          />
                          {t.inputBox.reasoningMode}
                        </div>
                        <div className="pl-7 text-xs">
                          {t.inputBox.reasoningModeDescription}
                        </div>
                      </div>
                      {context.mode === "thinking" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                  )}
                  <PromptInputActionMenuItem
                    className={cn(
                      context.mode === "pro"
                        ? "text-accent-foreground"
                        : "text-muted-foreground/65",
                    )}
                    onSelect={() => handleModeSelect("pro")}
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1 font-bold">
                        <GraduationCapIcon
                          className={cn(
                            "mr-2 size-4",
                            context.mode === "pro" && "text-accent-foreground",
                          )}
                        />
                        {t.inputBox.proMode}
                      </div>
                      <div className="pl-7 text-xs">
                        {t.inputBox.proModeDescription}
                      </div>
                    </div>
                    {context.mode === "pro" ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </PromptInputActionMenuItem>
                  <PromptInputActionMenuItem
                    className={cn(
                      context.mode === "ultra"
                        ? "text-accent-foreground"
                        : "text-muted-foreground/65",
                    )}
                    onSelect={() => handleModeSelect("ultra")}
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1 font-bold">
                        <RocketIcon
                          className={cn(
                            "mr-2 size-4",
                            context.mode === "ultra" && "text-[#dabb5e]",
                          )}
                        />
                        <div
                          className={cn(
                            context.mode === "ultra" && "golden-text",
                          )}
                        >
                          {t.inputBox.ultraMode}
                        </div>
                      </div>
                      <div className="pl-7 text-xs">
                        {t.inputBox.ultraModeDescription}
                      </div>
                    </div>
                    {context.mode === "ultra" ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </PromptInputActionMenuItem>
                </PromptInputActionMenu>
              </DropdownMenuGroup>
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          {supportReasoningEffort && context.mode !== "flash" && (
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger className="gap-1! px-2!">
                <div className="text-xs font-normal">
                  {t.inputBox.reasoningEffort}:
                  {context.reasoning_effort === "minimal" && " " + t.inputBox.reasoningEffortMinimal}
                  {context.reasoning_effort === "low" && " " + t.inputBox.reasoningEffortLow}
                  {context.reasoning_effort === "medium" && " " + t.inputBox.reasoningEffortMedium}
                  {context.reasoning_effort === "high" && " " + t.inputBox.reasoningEffortHigh}
                </div>
              </PromptInputActionMenuTrigger>
              <PromptInputActionMenuContent className="w-70">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground text-xs">
                    {t.inputBox.reasoningEffort}
                  </DropdownMenuLabel>
                  <PromptInputActionMenu>
                    <PromptInputActionMenuItem
                      className={cn(
                        context.reasoning_effort === "minimal"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleReasoningEffortSelect("minimal")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          {t.inputBox.reasoningEffortMinimal}
                        </div>
                        <div className="pl-2 text-xs">
                          {t.inputBox.reasoningEffortMinimalDescription}
                        </div>
                      </div>
                      {context.reasoning_effort === "minimal" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                    <PromptInputActionMenuItem
                      className={cn(
                        context.reasoning_effort === "low"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleReasoningEffortSelect("low")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          {t.inputBox.reasoningEffortLow}
                        </div>
                        <div className="pl-2 text-xs">
                          {t.inputBox.reasoningEffortLowDescription}
                        </div>
                      </div>
                      {context.reasoning_effort === "low" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                    <PromptInputActionMenuItem
                      className={cn(
                        context.reasoning_effort === "medium" || !context.reasoning_effort
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleReasoningEffortSelect("medium")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          {t.inputBox.reasoningEffortMedium}
                        </div>
                        <div className="pl-2 text-xs">
                          {t.inputBox.reasoningEffortMediumDescription}
                        </div>
                      </div>
                      {context.reasoning_effort === "medium" || !context.reasoning_effort ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                    <PromptInputActionMenuItem
                      className={cn(
                        context.reasoning_effort === "high"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleReasoningEffortSelect("high")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          {t.inputBox.reasoningEffortHigh}
                        </div>
                        <div className="pl-2 text-xs">
                          {t.inputBox.reasoningEffortHighDescription}
                        </div>
                      </div>
                      {context.reasoning_effort === "high" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                  </PromptInputActionMenu>
                </DropdownMenuGroup>
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
          )}
        </PromptInputTools>
        <PromptInputTools>
          {!isNewThread && (
            <CompactButton
              threadId={threadId}
              messages={thread.messages}
              modelName={typeof context.model_name === "string" ? context.model_name : undefined}
              disabled={disabled ?? status === "streaming"}
            />
          )}
          <ModelSelector
            open={modelDialogOpen}
            onOpenChange={setModelDialogOpen}
          >
            <ModelSelectorTrigger asChild>
              <PromptInputButton className="gap-1.5! px-2!">
                <CpuIcon className="size-3 shrink-0" />
                <span className="max-w-[96px] truncate text-xs font-normal">
                  {selectedModel ? formatModelDisplay(selectedModel) : typeof context.model_name === "string" && context.model_name ? (context.model_name.split("/").pop() ?? context.model_name) : "Model"}
                </span>
              </PromptInputButton>
            </ModelSelectorTrigger>
            <ModelSelectorContent>
              <ModelSelectorInput placeholder={t.inputBox.searchModels} />
              <ModelSelectorList>
                {models.map((m: Model) => (
                  <ModelSelectorItem
                    key={m.name}
                    value={m.name}
                    onSelect={() => handleModelSelect(m.name)}
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <ModelSelectorName>{formatModelDisplay(m)}</ModelSelectorName>
                      <span className="text-muted-foreground truncate text-[10px]">
                        {getProviderTag(m.display_name ?? "")}
                      </span>
                    </div>
                    {m.name === context.model_name ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </ModelSelectorItem>
                ))}
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelector>
          <PromptInputSubmit
            className="rounded-full"
            disabled={disabled}
            variant="outline"
            status={status}
          />
        </PromptInputTools>
      </PromptInputFooter>

      {!isNewThread && (
        <div className="absolute right-0 -bottom-[17px] left-0 z-0 h-4"></div>
      )}
      </PromptInput>

      {!disabled &&
        !isNewThread &&
        !followupsHidden &&
        (followupsLoading || followups.length > 0) && (
          <div className="absolute right-0 -top-20 left-0 z-20 flex items-center justify-center">
            <div className="flex items-center gap-2">
              {followupsLoading ? (
                <div className="glass-chip text-muted-foreground rounded-full border px-4 py-2 text-xs">
                  {t.inputBox.followupLoading}
                </div>
              ) : (
                <Suggestions className="min-h-16 w-fit items-start">
                  {followups.map((s) => (
                    <Suggestion
                      key={s}
                      suggestion={s}
                      onClick={() => handleFollowupClick(s)}
                    />
                  ))}
                  <Button
                    aria-label={t.common.close}
                    className="text-muted-foreground cursor-pointer rounded-full px-3 text-xs font-normal"
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => setFollowupsHidden(true)}
                  >
                    <XIcon className="size-4" />
                  </Button>
                </Suggestions>
              )}
            </div>
          </div>
        )}

      {queueSize > 0 && (
        <div className="absolute right-4 -top-14 z-20">
          <QueueIndicator count={queueSize} items={queuedItems} onCancel={removeById} />
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.inputBox.followupConfirmTitle}</DialogTitle>
            <DialogDescription>
              {t.inputBox.followupConfirmDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="secondary" onClick={confirmAppendAndSend}>
              {t.inputBox.followupConfirmAppend}
            </Button>
            <Button onClick={confirmReplaceAndSend}>
              {t.inputBox.followupConfirmReplace}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function QueueIndicator({
  count,
  items,
  onCancel,
}: {
  count: number;
  items: { id: string; text: string; hasAttachments: boolean }[];
  onCancel: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex max-w-[260px] items-center gap-1.5 rounded-full border border-amber-500/30 bg-background/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-all hover:border-amber-500/50 hover:bg-background hover:text-foreground"
        >
          <ClockIcon className="size-3.5 shrink-0 animate-pulse text-amber-500" />
          {count > 1 && (
            <span className="shrink-0 font-semibold text-amber-500">{count}</span>
          )}
          <span className="truncate">
            {items[0] ? items[0].text.slice(0, 40) + (items[0].text.length > 40 ? "…" : "") : "queued"}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-80">
        <DropdownMenuLabel className="flex items-center gap-2 pb-1 text-xs font-medium text-muted-foreground">
          <ClockIcon className="size-3.5 text-amber-500" />
          Queued — will send after current response
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onSelect={(e) => e.preventDefault()}
            className="group flex items-start gap-2 py-2.5"
          >
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
              {items.indexOf(item) + 1}
            </span>
            <span className="line-clamp-2 flex-1 text-sm leading-snug">{item.text}</span>
            <div className="flex shrink-0 items-center gap-1">
              {item.hasAttachments && (
                <PaperclipIcon className="size-3.5 text-muted-foreground/60" />
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCancel(item.id); }}
                className="rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                title="Remove from queue"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InputActionsMenu({
  agentName,
  onAgentSelect,
}: {
  agentName?: string;
  onAgentSelect?: (name: string | null) => void;
}) {
  const { t } = useI18n();
  const attachments = usePromptInputAttachments();
  const { agents } = useAgents();
  const { skills } = useSkills();
  const { mutate: enableSkill } = useEnableSkill();
  const { config: mcpConfig } = useMCPConfig();
  const { mutate: enableMCPServer } = useEnableMCPServer();
  const { toolGroups: allToolGroups } = useToolGroups();
  const enabledToolGroups = allToolGroups.filter((g) => g.enabled);
  const mcpServers = mcpConfig?.mcp_servers ?? {};
  const hasMCP = Object.keys(mcpServers).length > 0;
  const hasToolGroups = enabledToolGroups.length > 0;
  // Currently selected agent label for the trigger badge
  const activeAgent = agentName ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PromptInputButton className="px-2!">
          <PlusIcon className="size-3" />
        </PromptInputButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">

        {/* Attach */}
        <DropdownMenuItem onSelect={() => attachments.openFileDialog()}>
          <PaperclipIcon className="size-4" />
          {t.inputBox.addAttachments}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Agent submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <BotIcon className="size-4" />
            <span>{t.agents.title}</span>
            {activeAgent && (
              <span className="ml-auto max-w-[80px] truncate text-[10px] text-muted-foreground">
                {activeAgent}
              </span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t.inputBox.selectAgent}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* Default chat agent */}
            <DropdownMenuItem
              onSelect={() => onAgentSelect?.(null)}
              className="gap-2"
            >
              <BotIcon className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-sm">{t.inputBox.defaultAgent}</div>
                <div className="text-[10px] text-muted-foreground">
                  {t.inputBox.defaultAgentDescription}
                </div>
              </div>
              {!activeAgent && <CheckIcon className="ml-auto size-4" />}
            </DropdownMenuItem>
            {agents.length > 0 && <DropdownMenuSeparator />}
            {agents.map((agent) => (
              <DropdownMenuItem
                key={agent.name}
                onSelect={() => onAgentSelect?.(agent.name)}
                className="gap-2"
              >
                <BotIcon className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{agent.name}</div>
                  {agent.description && (
                    <div className="truncate text-[10px] text-muted-foreground">
                      {agent.description}
                    </div>
                  )}
                </div>
                {activeAgent === agent.name && (
                  <CheckIcon className="ml-auto size-4" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Skills submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <SparklesIcon className="size-4" />
            <span>{t.settings.skills.title}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t.settings.skills.title}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {skills.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground/60">
                {t.settings.skills.emptyTitle}
              </div>
            ) : (
              skills.map((skill) => (
                <DropdownMenuItem
                  key={skill.name}
                  onSelect={(e) => e.preventDefault()}
                  className="gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{skill.name}</div>
                    {skill.description && (
                      <div className="line-clamp-1 text-[10px] text-muted-foreground">
                        {skill.description}
                      </div>
                    )}
                  </div>
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={(checked) =>
                      enableSkill({ skillName: skill.name, enabled: checked })
                    }
                    className="shrink-0"
                  />
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* System Tool Groups submenu */}
        {hasToolGroups && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <LayersIcon className="size-4" />
              <span>{t.agents.toolGroupsSection}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t.agents.toolGroupsSection}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {enabledToolGroups.map((group) => (
                <DropdownMenuItem
                  key={group.name}
                  onSelect={(e) => e.preventDefault()}
                  className="gap-2"
                >
                  <LayersIcon className="size-4 text-muted-foreground shrink-0" />
                  <div className="truncate text-sm">{group.name}</div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* MCP Tools submenu — only shown when servers exist */}
        {hasMCP && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <WrenchIcon className="size-4" />
              <span>{t.settings.tools.mcpTitle}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t.settings.tools.mcpTitle}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {Object.entries(mcpServers).map(([name, serverConfig]) => (
                <DropdownMenuItem
                  key={name}
                  onSelect={(e) => e.preventDefault()}
                  className="gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{name}</div>
                    {serverConfig.description && (
                      <div className="line-clamp-1 text-[10px] text-muted-foreground">
                        {serverConfig.description}
                      </div>
                    )}
                  </div>
                  <Switch
                    checked={serverConfig.enabled}
                    onCheckedChange={(checked) =>
                      enableMCPServer({ serverName: name, enabled: checked })
                    }
                    className="shrink-0"
                  />
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

      </DropdownMenuContent>
    </DropdownMenu>
  );
}
