import type { AIMessage, Message } from "@langchain/langgraph-sdk";
import type { ThreadsClient } from "@langchain/langgraph-sdk/client";
import { useStream } from "@langchain/langgraph-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

import { getAPIClient } from "../api";
import { getGuru, getGuruMuted } from "../guru/guru";
import { fireGuruObserver } from "../guru/observer";
import { useI18n } from "../i18n/hooks";
import type { FileInMessage } from "../messages/utils";
import type { Model } from "../models/types";
import { matchProviderForModel } from "../providers/definitions";
import { enqueue, processQueueIfReady } from "../queue";
import type { LocalSettings } from "../settings";
import { getLocalSettings } from "../settings/local";
import { useUpdateSubtask } from "../tasks/context";
import type { UploadedFileInfo } from "../uploads";
import { uploadFiles } from "../uploads";

import type { AgentThread, AgentThreadState } from "./types";

export type ToolEndEvent = {
  name: string;
  data: unknown;
};

export type ThreadStreamOptions = {
  threadId?: string | null | undefined;
  context: LocalSettings["context"];
  isMock?: boolean;
  onStart?: (threadId: string) => void;
  onThreadCreated?: (threadId: string) => void;
  onFinish?: (state: AgentThreadState) => void;
  onToolEnd?: (event: ToolEndEvent) => void;
};

// ── Provider API key resolution for runtime submission ────────────────────────

const API_KEY_STORAGE_PREFIX = "aether-arena.provider-key.";

/**
 * Resolve the provider API key for a given model name.
 *
 * Reads the saved key from localStorage using the same prefix as the
 * settings UI (models-settings-page.tsx). The provider id is inferred
 * from the model name's prefix or by resolving through known models.
 *
 * @param modelName - E.g. "openrouter", "qwen/qwen3.6-plus:free", "gpt-4o"
 * @param cachedModels - The same models list from the query cache (used for pattern matching)
 * @returns The saved API key, or undefined if none is set.
 */
export function getProviderApiKeyForModel(
  modelName: string | undefined,
  cachedModels: Model[],
): string | undefined {
  if (typeof window === "undefined") return undefined;
  if (!modelName) return undefined;

  let providerId: string | null = null;

  if (modelName.includes("/")) {
    // Check if model name matches a known OpenRouter pattern (author/model:tag)
    // OpenRouter models use format like "qwen/qwen3.6-plus:free" where the first
    // segment is a model author, not a provider. Config provider models use
    // the provider ID as the first segment (e.g. "lmstudio/qwen3-4b").
    const orModel = cachedModels.find(
      (m) => m.name === modelName && m.provider_use.toLowerCase().includes("openrouter"),
    );
    if (orModel) {
      providerId = "openrouter";
    }

    // If no match in cache, fall back to pattern-based detection
    if (!providerId) {
      // OpenRouter free models carry ":free" — treat as openrouter by default
      if (modelName.includes(":free")) {
        providerId = "openrouter";
      }
    }

    // Check if this is a known provider-prefixed name (e.g., "lmstudio/qwen3-4b")
    if (!providerId) {
      const parts = modelName.split("/");
      const firstSegment = parts[0] ? parts[0].toLowerCase() : "";
      for (const m of cachedModels) {
        if (m.name === modelName) {
          providerId = matchProviderForModel(m.provider_use, m.endpoint_url);
          break;
        }
        // If first segment matches a model's first segment, use that model's provider
        if (firstSegment && m.name.startsWith(firstSegment + "/")) {
          providerId = matchProviderForModel(m.provider_use, m.endpoint_url);
          break;
        }
      }
    }

    // Fall back: if first segment matches a provider pattern directly
    if (!providerId) {
      const parts = modelName.split("/");
      const firstSegment = parts[0] ?? "";
      for (const seg of cachedModels.map((m) => m.provider_use)) {
        if (seg.toLowerCase().includes(firstSegment.toLowerCase())) {
          providerId = matchProviderForModel(seg, null);
          break;
        }
      }
    }
  } else {
    // Simple name without "/": check if it's a known model config name
    const exactModel = cachedModels.find((m) => m.name === modelName);
    if (exactModel) {
      providerId = matchProviderForModel(exactModel.provider_use, exactModel.endpoint_url);
    } else if (modelName.toLowerCase().includes("openrouter")) {
      providerId = "openrouter";
    }
  }

  if (!providerId) return undefined;

  return localStorage.getItem(API_KEY_STORAGE_PREFIX + providerId) ?? undefined;
}

function getStreamErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }
    const nestedError = Reflect.get(error, "error");
    if (nestedError instanceof Error && nestedError.message.trim()) {
      return nestedError.message;
    }
    if (typeof nestedError === "string" && nestedError.trim()) {
      return nestedError;
    }
  }
  return "Request failed.";
}

export function useThreadStream({
  threadId,
  context,
  isMock,
  onStart,
  onThreadCreated,
  onFinish,
  onToolEnd,
}: ThreadStreamOptions) {
  const { t } = useI18n();
  // Track the thread ID that is currently streaming to handle thread changes during streaming
  const [onStreamThreadId, setOnStreamThreadId] = useState(() => threadId);
  // Bumping this key forces the useStream hook to unmount and remount with a brand-new
  // stream instance — LangGraph creates a fresh connection that resumes from the server's
  // last checkpoint, so partial work (tool calls, generated text) is not lost.
  const [streamRestartKey, setStreamRestartKey] = useState(0);
  // Ref to track current thread ID across async callbacks without causing re-renders,
  // and to allow access to the current thread id in onUpdateEvent
  const threadIdRef = useRef<string | null>(threadId ?? null);
  const startedRef = useRef(false);
  // Ref to always-latest sendMessage — declared here so drain callbacks inside
  // useStream can call sendMessageRef.current() and get the current version
  // (which has the up-to-date `thread` object with the real threadId).
  // Assigned after sendMessage is defined; noop placeholder for first render.
  const sendMessageRef = useRef<(threadId: string, message: PromptInputMessage, extraContext?: Record<string, unknown>) => Promise<void>>(
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async () => {},
  );

  const listeners = useRef({
    onStart,
    onThreadCreated,
    onFinish,
    onToolEnd,
  });

  // Track the server-created thread ID to prevent the threadId prop sync from
  // overwriting it with the client UUID after isNewThread flips.
  const serverThreadIdRef = useRef<string | null>(null);
  // Track the last threadId prop so we can distinguish a genuine thread switch
  // (threadId changed) from an error-recovery streamRestartKey bump (same thread).
  const prevThreadIdPropRef = useRef<string | null | undefined>(threadId);

  // Keep listeners ref updated with latest callbacks
  useEffect(() => {
    listeners.current = { onStart, onThreadCreated, onFinish, onToolEnd };
  }, [onStart, onThreadCreated, onFinish, onToolEnd]);

  useEffect(() => {
    const normalizedThreadId = threadId ?? null;
    // When this is a restart (streamRestartKey changed), temporarily reset the thread
    // id to null to force the SDK to teardown the old stream, then set it back
    // on the next tick so it remounts with a fresh Stream instance.
    threadIdRef.current = normalizedThreadId;
    startedRef.current = false;

    // Don't overwrite the server-created thread ID with the client UUID when
    // isNewThread flips after onThreadCreated fires. The server ID and client
    // UUID are equal once the thread URL has been updated, so only bail out when
    // they differ (i.e. the prop still carries the old client UUID).
    if (
      serverThreadIdRef.current &&
      serverThreadIdRef.current !== normalizedThreadId &&
      normalizedThreadId !== null
    ) {
      return;
    }

    // If the threadId prop itself changed (not just streamRestartKey on same thread),
    // clear all transient UI state so the old chat's messages don't bleed into the
    // new thread's view.
    const prevThreadId = prevThreadIdPropRef.current;
    const threadIdPropChanged = prevThreadId !== threadId;
    prevThreadIdPropRef.current = threadId;
    if (threadIdPropChanged) {
      // Determine whether this is a genuine navigation to a DIFFERENT conversation
      // vs the server assigning a real thread ID to our just-created thread.
      //
      // When the user sends the very first message on a new thread:
      //   1. threadId prop starts as null/clientUUID
      //   2. LangGraph creates the thread → onCreated fires → onThreadCreated → URL
      //      updates → threadId prop changes to the server-assigned ID
      //   3. This effect fires with threadIdPropChanged=true, but the stream is
      //      still in flight — resetting sendInFlightRef here would open the gate
      //      while streaming, letting M2 bypass the queue (the core bug).
      //
      // Guard: only reset the gate if the new threadId is NOT the server-assigned
      // ID for our current stream. If it matches, the "change" is just our own
      // thread getting its canonical ID — don't touch in-flight state.
      const isServerIdAssignment = normalizedThreadId !== null &&
        serverThreadIdRef.current === normalizedThreadId;

      serverThreadIdRef.current = null;
      // For a server-ID assignment (isNewThread flipping after onThreadCreated),
      // the "change" is just our own new thread getting its canonical ID while the
      // stream is still in flight. Clearing optimistic/frozen/pinned here causes
      // the submitted message to visually disappear for a brief moment (the gap
      // between clearing optimistic and the stream delivering real messages).
      // Only wipe transient UI state on a genuine navigation to a different thread.
      if (!isServerIdAssignment) {
        setOptimisticMessages([]);
        setFrozenMessages(null);
        setPinnedPartials([]);
        frozenIdsRef.current = new Set();
        sendInFlightRef.current = false;
      }
      prevMsgCountRef.current = 0;
    }

    setOnStreamThreadId(normalizedThreadId);
  }, [threadId, streamRestartKey]);

  const _handleOnStart = useCallback((id: string) => {
    if (!startedRef.current) {
      listeners.current.onStart?.(id);
      startedRef.current = true;
    }
  }, []);

  const handleStreamStart = useCallback(
    (_threadId: string) => {
      threadIdRef.current = _threadId;
      _handleOnStart(_threadId);
    },
    [_handleOnStart],
  );

  const queryClient = useQueryClient();
  const updateSubtask = useUpdateSubtask();

  const thread = useStream<AgentThreadState>({
    client: getAPIClient(isMock),
    assistantId: "lead_agent",
    threadId: onStreamThreadId,
    reconnectOnMount: true,
    fetchStateHistory: { limit: 1 },
    onCreated(meta) {
      // onCreated fires on EVERY run (not just new threads). Guard: only treat
      // as a new-thread event when the thread_id is different from what we're
      // already tracking. For subsequent messages on the same thread, skip the
      // setOnStreamThreadId call (it would cause a spurious re-mount of useStream).
      const isNewThread = serverThreadIdRef.current !== meta.thread_id &&
        threadIdRef.current !== meta.thread_id;
      serverThreadIdRef.current = meta.thread_id;
      handleStreamStart(meta.thread_id);
      if (isNewThread) {
        setOnStreamThreadId(meta.thread_id);
        onThreadCreated?.(meta.thread_id);
      }
    },
    onLangChainEvent(event) {
      if (event.event === "on_tool_end") {
        listeners.current.onToolEnd?.({
          name: event.name,
          data: event.data,
        });
      }
    },
    onUpdateEvent(data) {
      const updates: Array<Partial<AgentThreadState> | null> = Object.values(
        data || {},
      );
      for (const update of updates) {
        if (update && "title" in update && update.title) {
          void queryClient.setQueriesData(
            {
              queryKey: ["threads", "search"],
              exact: false,
            },
            (oldData: Array<AgentThread> | undefined) => {
              return oldData?.map((t) => {
                if (t.thread_id === threadIdRef.current) {
                  return {
                    ...t,
                    values: {
                      ...t.values,
                      title: update.title,
                    },
                  };
                }
                return t;
              });
            },
          );
        }
      }
    },
    onCustomEvent(event: unknown) {
      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "task_running"
      ) {
        const e = event as {
          type: "task_running";
          task_id: string;
          message: AIMessage;
        };
        updateSubtask({ id: e.task_id, latestMessage: e.message });
      }
    },
    onError(error) {
      setOptimisticMessages([]);

      // Always reset the send gate so the user (or queue handler) can retry
      sendInFlightRef.current = false;

      // Freeze current messages (preserves partial streamed content that the user
      // already saw) — same pattern as stopStream, so nothing disappears on crash.
      const currentlyVisible =
        optimisticMessages.length > 0
          ? [...thread.messages, ...optimisticMessages]
          : thread.messages.length > 0
            ? [...thread.messages]
            : null;
      if (currentlyVisible && currentlyVisible.length > 0) {
        setFrozenMessages(currentlyVisible);
      }

      // Bump the restart key — forces the useEffect to re-run with a fresh thread
      // id assignment, clearing the SDK's dead Stream internal state.
      setStreamRestartKey((k) => k + 1);

      toast.error(getStreamErrorMessage(error));

      // Auto-resubmit queued messages for this thread after a stream error.
      // setTimeout(0) lets React flush pending state (incl. onStreamThreadId)
      // before sendMessage calls thread.submit — preventing 409 on new threads.
      setTimeout(() => {
        const activeThread = threadIdRef.current ?? threadId;
        if (!activeThread) return;
        const result = processQueueIfReady(activeThread);
        if (result.processed && result.messages.length > 0) {
          // Flush all queued messages as a single concatenated submission.
          const combinedText = result.messages.map((m) => m.content).join("\n\n");
          void sendMessageRef.current(activeThread, { text: combinedText, files: [] });
        }
      }, 0);
    },
    onFinish(state) {
      listeners.current.onFinish?.(state.values);
      void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });

      // Signal Guru to return to idle — LLM observer will fire guru:move shortly
      window.dispatchEvent(new CustomEvent("guru:state", { detail: "idle" }));

      // Fire Guru observer — generates a 1-sentence reaction from the companion.
      // Completely non-blocking; any errors are swallowed inside fireGuruObserver.
      const guru = getGuru();
      if (guru && !getGuruMuted()) {
        // Prefer state.values.messages, fall back to thread.messages (live ref)
        const messages = (state.values?.messages ?? []) as Array<{ type: string; content: unknown }>;
        const lastAi = [...messages].reverse().find((m) => m.type === "ai");
        if (lastAi) {
          const content = lastAi.content;
          const lastAiText =
            typeof content === "string"
              ? content
              : Array.isArray(content)
                ? (content as unknown[])
                    .filter((c) => typeof c === "object" && c !== null && (c as { type?: string }).type === "text")
                    .map((c) => (c as { text?: string }).text ?? "")
                    .join("")
                : "";
          if (lastAiText.trim()) {
            // null means backend resolves to the default/first available model —
            // respects whatever model the user has active in config.yaml.
            const guruModelName = getLocalSettings().guru.model_name ?? undefined;
            void fireGuruObserver(
              lastAiText,
              guru,
              (reaction) => {
                window.dispatchEvent(new CustomEvent("guru:reaction", { detail: reaction }));
              },
              undefined,
              guruModelName,
            );
          }
        }
      }

      // Release send gate synchronously — stream is fully done.
      // MUST happen unconditionally so gate is always open after a stream ends.
      sendInFlightRef.current = false;

      // Drain queued messages. setTimeout(0) lets React flush pending state
      // (including onStreamThreadId) before thread.submit is called, which
      // prevents 409 "Thread already exists" errors on newly created threads.
      setTimeout(() => {
        const activeThread = threadIdRef.current ?? threadId;
        if (!activeThread) return;
        const result = processQueueIfReady(activeThread);
        if (result.processed && result.messages.length > 0) {
          // Flush all queued messages as one concatenated submission so the
          // agent sees everything at once rather than in separate turns.
          const combinedText = result.messages.map((m) => m.content).join("\n\n");
          void sendMessageRef.current(activeThread, { text: combinedText, files: [] });
        }
      }, 0);
    },
  });

  // Optimistic messages shown before the server stream responds
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const sendInFlightRef = useRef(false);
  // Always-current live count of thread.messages — updated every render so
  // sendMessage (useCallback) can read the true current count without stale closure.
  const liveMessageCountRef = useRef(thread.messages.length);
  liveMessageCountRef.current = thread.messages.length;
  // Track message count before sending so we know when server has responded
  const prevMsgCountRef = useRef(thread.messages.length);

  // Messages frozen at stop time — keeps partial streamed content visible until
  // the new AI turn starts streaming. At that point frozen is cleared and
  // uncommitted messages from frozen are promoted to pinnedPartials.
  const [frozenMessages, setFrozenMessages] = useState<Message[] | null>(null);

  // Messages from a previous frozen snapshot that were never committed to the
  // server checkpoint (partial AI tokens + any interrupted human messages).
  // Injected into mergedThread at the split point until pinnedPartials is cleared.
  const [pinnedPartials, setPinnedPartials] = useState<Message[]>([]);

  // Stores the set of frozen message ids at the time frozen was cleared, so
  // mergedThread can find the injection point for pinnedPartials.
  const frozenIdsRef = useRef<Set<string>>(new Set());
  // Tracks last logged mergedThread count to suppress per-render log spam.

  // Build a stable set of human message texts in frozen for the clearing condition.
  const frozenHumanTexts = useMemo(() => {
    if (!frozenMessages) return null;
    const texts = new Set<string>();
    for (const m of frozenMessages) {
      if (m.type !== "human") continue;
      const t = typeof m.content === "string"
        ? m.content.trim()
        : Array.isArray(m.content)
          ? m.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim()
          : "";
      if (t) texts.add(t);
    }
    return texts;
  }, [frozenMessages]);

  // Clear optimistic + frozen when the server confirms the next submission.
  //
  // Two separate strategies:
  //   (a) No frozen: clear optimistic when thread.messages grows past the count
  //       recorded at submit time (prevMsgCountRef). This handles the normal flow.
  //   (b) Frozen is set (after a stop/error): clear frozen + optimistic when
  //       thread.messages contains a human message that was NOT in frozen — i.e.
  //       the server has received and committed the next user message. We cannot
  //       use the count strategy here because after stop the SDK resets
  //       thread.messages to the checkpoint (which is shorter than frozen), so the
  //       threshold set at submit time would never be crossed.
  useEffect(() => {
    if (frozenMessages !== null && frozenHumanTexts !== null) {
      // After stop: wait for new AI turn to start before clearing frozen.
      // Clearing on human arrival alone would drop the partial AI from frozen
      // before the new response arrives.
      let newHumanIdx = -1;
      for (let i = 0; i < thread.messages.length; i++) {
        const m = thread.messages[i]!;
        if (m.type !== "human") continue;
        const t = typeof m.content === "string"
          ? m.content.trim()
          : Array.isArray(m.content)
            ? m.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim()
            : "";
        if (t && !frozenHumanTexts.has(t)) {
          newHumanIdx = i;
          break;
        }
      }
      const hasNewAiAfterHuman = newHumanIdx >= 0 &&
        thread.messages.slice(newHumanIdx + 1).some((m) => m.type === "ai");
      if (hasNewAiAfterHuman) {
        // Extract uncommitted messages from frozen (dropped by LangGraph checkpoint on stop).
        // Pin them so they stay visible alongside the new conversation.
        const realIds = new Set(thread.messages.map((m) => (m as { id?: string }).id).filter(Boolean));
        const allFrozenIds = new Set(frozenMessages.map((m) => (m as { id?: string }).id).filter(Boolean) as string[]);
        const partials = frozenMessages.filter((m) => {
          const id = (m as { id?: string }).id;
          return id ? !realIds.has(id) : false;
        });
        frozenIdsRef.current = allFrozenIds;
        if (partials.length > 0) setPinnedPartials(partials);
        prevMsgCountRef.current = thread.messages.length;
        setFrozenMessages(null);
        if (optimisticMessages.length > 0) setOptimisticMessages([]);
        window.dispatchEvent(new CustomEvent("guru:state", { detail: "streaming" }));
      }
      return;
    }

    // Normal flow: clear optimistic when server count exceeds our pre-submit baseline.
    if (thread.messages.length > prevMsgCountRef.current) {
      prevMsgCountRef.current = thread.messages.length;
      if (optimisticMessages.length > 0) setOptimisticMessages([]);
      if (optimisticMessages.length > 0) {
        window.dispatchEvent(new CustomEvent("guru:state", { detail: "streaming" }));
      }
    }
  }, [thread.messages, thread.messages.length, optimisticMessages.length, frozenMessages, frozenHumanTexts]);

  const sendMessage = useCallback(
    async (
      threadId: string,
      message: PromptInputMessage,
      extraContext?: Record<string, unknown>,
    ) => {
      const trimmedText = message.text.trim();
      if (sendInFlightRef.current) {
        if (trimmedText) {
          enqueue({
            threadId: threadId,
            text: trimmedText,
            priority: "next",
            hasAttachments: (message.files?.length ?? 0) > 0,
          });
        }
        return;
      }
      sendInFlightRef.current = true;

      const text = trimmedText;

      // Capture current count before showing optimistic messages.
      // Read from liveMessageCountRef (updated every render) not thread.messages
      // directly — sendMessage is a useCallback and thread.messages.length in its
      // closure is stale when called from the onFinish drain setTimeout.
      prevMsgCountRef.current = liveMessageCountRef.current;
      // Do NOT clear frozenMessages here — clearing it eagerly causes partial AI
      // content to vanish from the UI before the server response arrives.
      // The effect at line 396 clears frozen when thread.messages.length increases
      // past prevMsgCountRef (i.e. server has confirmed the new message).

      // Build optimistic files list with uploading status
      const optimisticFiles: FileInMessage[] = (message.files ?? []).map(
        (f) => ({
          filename: f.filename ?? "",
          size: 0,
          status: "uploading" as const,
        }),
      );

      // Create optimistic human message (shown immediately)
      const optimisticHumanMsg: Message = {
        type: "human",
        id: `opt-human-${Date.now()}`,
        content: text ? [{ type: "text", text }] : "",
        additional_kwargs:
          optimisticFiles.length > 0 ? { files: optimisticFiles } : {},
      };

      const newOptimistic: Message[] = [optimisticHumanMsg];
      if (optimisticFiles.length > 0) {
        // Mock AI message while files are being uploaded
        newOptimistic.push({
          type: "ai",
          id: `opt-ai-${Date.now()}`,
          content: t.uploads.uploadingFiles,
          additional_kwargs: { element: "task" },
        });
      }
      setOptimisticMessages(newOptimistic);

      // Signal Guru to start pacing — user submitted, waiting for first token
      window.dispatchEvent(new CustomEvent("guru:state", { detail: "processing" }));

      _handleOnStart(threadId);

      let uploadedFileInfo: UploadedFileInfo[] = [];

      try {
        // Upload files first if any
        if (message.files && message.files.length > 0) {
          setIsUploading(true);
          try {
            // Convert FileUIPart to File objects by fetching blob URLs
            const filePromises = message.files.map(async (fileUIPart) => {
              if (fileUIPart.url && fileUIPart.filename) {
                try {
                  // Fetch the blob URL to get the file data
                  const response = await fetch(fileUIPart.url);
                  const blob = await response.blob();

                  // Create a File object from the blob
                  return new File([blob], fileUIPart.filename, {
                    type: fileUIPart.mediaType || blob.type,
                  });
                } catch (error) {
                  console.error(
                    `Failed to fetch file ${fileUIPart.filename}:`,
                    error,
                  );
                  return null;
                }
              }
              return null;
            });

            const conversionResults = await Promise.all(filePromises);
            const files = conversionResults.filter(
              (file): file is File => file !== null,
            );
            const failedConversions = conversionResults.length - files.length;

            if (failedConversions > 0) {
              throw new Error(
                `Failed to prepare ${failedConversions} attachment(s) for upload. Please retry.`,
              );
            }

            if (!threadId) {
              throw new Error("Thread is not ready for file upload.");
            }

            if (files.length > 0) {
              const uploadResponse = await uploadFiles(threadId, files);
              uploadedFileInfo = uploadResponse.files;

              // Update optimistic human message with uploaded status + paths
              const uploadedFiles: FileInMessage[] = uploadedFileInfo.map(
                (info) => ({
                  filename: info.filename,
                  size: info.size,
                  path: info.virtual_path,
                  status: "uploaded" as const,
                }),
              );
              setOptimisticMessages((messages) => {
                if (messages.length > 1 && messages[0]) {
                  const humanMessage: Message = messages[0];
                  return [
                    {
                      ...humanMessage,
                      additional_kwargs: { files: uploadedFiles },
                    },
                    ...messages.slice(1),
                  ];
                }
                return messages;
              });
            }
          } catch (error) {
            console.error("Failed to upload files:", error);
            const errorMessage =
              error instanceof Error
                ? error.message
                : "Failed to upload files.";
            toast.error(errorMessage);
            setOptimisticMessages([]);
            throw error;
          } finally {
            setIsUploading(false);
          }
        }

        // Build files metadata for submission (included in additional_kwargs)
        const filesForSubmit: FileInMessage[] = uploadedFileInfo.map(
          (info) => ({
            filename: info.filename,
            size: info.size,
            path: info.virtual_path,
            status: "uploaded" as const,
          }),
        );

        const thinkingEnabled = context.mode !== "flash";
        const isPlanMode =
          context.mode === "pro" || context.mode === "ultra";
        const subagentEnabled = context.mode === "ultra";
        const reasoningEffort =
          context.reasoning_effort ??
          (context.mode === "ultra"
            ? "high"
            : context.mode === "pro"
              ? "medium"
              : context.mode === "thinking"
                ? "low"
                : undefined);

        const ctxWithExtras = context as {
          is_bootstrap?: boolean;
          max_concurrent_subagents?: number;
          model_name?: string;
          vision_model_name?: string;
        };

        // If the message has image attachments and a dedicated vision model is set, use it —
        // but only if the primary model doesn't already support vision itself.
        const hasImageFiles = (message.files ?? []).some((f) => {
          const mediaType = f.mediaType ?? "";
          const filename = f.filename ?? "";
          return (
            mediaType.startsWith("image/") ||
            /\.(png|jpe?g|webp|gif)$/i.test(filename)
          );
        });
        const cachedModels = queryClient.getQueryData<Model[]>(["models"]) ?? [];
        const primaryModelName = ctxWithExtras.model_name;
        const primarySupportsVision = cachedModels.some(
          (m) => m.name === primaryModelName && m.supports_vision,
        );
        const effectiveModelName =
          hasImageFiles && ctxWithExtras.vision_model_name && !primarySupportsVision
            ? ctxWithExtras.vision_model_name
            : primaryModelName;
        const isBootstrap = Boolean(ctxWithExtras.is_bootstrap);
        const rawExtra = extraContext ?? {};
        const agentNameFromExtra =
          typeof rawExtra.agent_name === "string"
            ? rawExtra.agent_name
            : undefined;

        // Extract partial AI text from frozen/pinned state so the backend can include
        // it in the system prompt. LangGraph does not commit partial AI content to
        // checkpoints on stop, so this is the only way the model knows what it said.
        const partialSource = frozenMessages ?? (pinnedPartials.length > 0 ? pinnedPartials : null);
        const interruptedResponseText = partialSource
          ? partialSource
              .filter((m) => m.type === "ai")
              .map((m) => {
                if (typeof m.content === "string") return m.content.trim();
                if (Array.isArray(m.content)) {
                  return m.content
                    .map((c) => (c.type === "text" ? (c as { type: string; text: string }).text : ""))
                    .join("")
                    .trim();
                }
                return "";
              })
              .filter(Boolean)
              .join("\n\n") || null
          : null;

        // Build runtime context for LangGraph ≥0.6.
        // Do NOT include `configurable` inside `config`; LangGraph rejects requests
        // that specify both `config.configurable` and `context`. When only
        // `context` is provided, LangGraph copies it into `config["configurable"]`
        // before invoking the graph factory (make_lead_agent).
        const behavior = getLocalSettings().behavior;
        const runContext: Record<string, unknown> = {
          ...extraContext,
          ...context,
          thinking_enabled: thinkingEnabled,
          is_plan_mode: isPlanMode,
          subagent_enabled: subagentEnabled,
          thread_id: threadId,
          // Include factory flags that make_lead_agent reads from config["configurable"]
          is_bootstrap: isBootstrap,
          auto_memory: behavior.auto_memory,
        };
        if (interruptedResponseText) {
          runContext.interrupted_response = interruptedResponseText;
        }
        if (reasoningEffort !== undefined) {
          runContext.reasoning_effort = reasoningEffort;
        }
        if (effectiveModelName) {
          runContext.model_name = effectiveModelName;
        }
        if (agentNameFromExtra) {
          runContext.agent_name = agentNameFromExtra;
        }
        if (typeof ctxWithExtras.max_concurrent_subagents === "number") {
          runContext.max_concurrent_subagents =
            ctxWithExtras.max_concurrent_subagents;
        }

        // Resolve and attach the provider API key for the selected model
        const providerApiKey = getProviderApiKeyForModel(
          effectiveModelName,
          cachedModels,
        );
        if (providerApiKey) {
          runContext.provider_api_key = providerApiKey;
        }

        // Log the current thread message list before submit so we can verify
        // the compact boundary + summary are present after a compact operation.
        const currentMessages = thread.messages;
        console.log(`[thread] submitting to thread=${threadId} — current message count: ${currentMessages.length}`, {
          messageTypes: currentMessages.map((m) => `${m.type}:${typeof m.id === "string" ? m.id.slice(0, 8) : "?"}:${typeof m.content === "string" ? m.content.slice(0, 60) : "[array]"}`),
        });

        await thread.submit(
          {
            messages: [
              {
                type: "human",
                content: [
                  {
                    type: "text",
                    text,
                  },
                ],
                additional_kwargs:
                  filesForSubmit.length > 0 ? { files: filesForSubmit } : {},
              },
            ],
          },
          {
            threadId: threadId,
            streamSubgraphs: true,
            streamResumable: true,
            config: {
              recursion_limit: 1000,
              // No "configurable" here - it would conflict with "context"
            },
            context: runContext,
          },
        );
        // submit() resolved → SSE stream is now connected.
        // Gate (sendInFlightRef) stays true — owned by onFinish/onError/stopStream.
        void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
      } catch (error) {
        // submit() threw before SSE connected — onFinish/onError won't fire,
        // so we must reset the gate here.
        sendInFlightRef.current = false;
        setOptimisticMessages([]);
        setIsUploading(false);
        throw error;
      }
    },
    [thread, _handleOnStart, t.uploads.uploadingFiles, context, queryClient, frozenMessages, pinnedPartials],
  );

  // Keep sendMessageRef current after every memoization.
  sendMessageRef.current = sendMessage;

  // Wrap thread.stop() to freeze visible messages before the SDK reverts them.
  // After stop(), thread.messages reverts to the last checkpoint (dropping partial
  // streaming content). We capture the current messages first so the UI keeps
  // showing them until the next submit's server response arrives.
  const stopStream = useCallback(async () => {
    // Capture what the user can currently see (optimistic + pinned + real).
    // Include pinnedPartials from a previous stop so they survive into the new frozen.
    const buildVisible = (): Message[] | null => {
      const frozenIds = frozenIdsRef.current;
      let base: Message[];
      if (frozenIds.size > 0 && pinnedPartials.length > 0) {
        // Rebuild with pinned injected (same logic as mergedThread)
        let splitIdx = thread.messages.findIndex(
          (m) => !frozenIds.has((m as { id?: string }).id ?? "")
        );
        if (splitIdx === -1) splitIdx = thread.messages.length;
        base = [
          ...thread.messages.slice(0, splitIdx),
          ...pinnedPartials,
          ...thread.messages.slice(splitIdx),
        ];
      } else {
        base = thread.messages;
      }
      if (optimisticMessages.length > 0) return [...base, ...optimisticMessages];
      if (base.length > 0) return [...base];
      return null;
    };
    const currentlyVisible = buildVisible();
    // Clear any previous pinnedPartials — the new frozen snapshot supersedes them.
    if (pinnedPartials.length > 0) {
      setPinnedPartials([]);
      frozenIdsRef.current = new Set();
    }
    if (currentlyVisible && currentlyVisible.length > 0) {
      setFrozenMessages(currentlyVisible);
    }
    // Signal Guru to settle — user stopped the stream
    window.dispatchEvent(new CustomEvent("guru:state", { detail: "idle" }));
    await thread.stop();
    // Deterministically open the send gate after manual stop.
    sendInFlightRef.current = false;
    // Drain queued messages. setTimeout(0) lets React flush stop state before
    // thread.submit is called (same guard as onFinish/onError drain).
    setTimeout(() => {
      const activeThread = threadIdRef.current;
      if (!activeThread) return;
      const result = processQueueIfReady(activeThread);
      if (result.processed && result.messages.length > 0) {
        const combinedText = result.messages.map((m) => m.content).join("\n\n");
        void sendMessageRef.current(activeThread, { text: combinedText, files: [] });
      }
    }, 0);
  }, [thread, optimisticMessages, pinnedPartials]);

  // Compute the message list to display.
  //
  // Three layers, in priority order:
  //   1. frozenMessages — full snapshot captured at stop time. Used as base while
  //      server processes the next message. Cleared when new AI turn starts.
  //   2. pinnedPartials — uncommitted messages extracted from frozen when it clears.
  //      Injected into thread.messages at the split point (after last committed msg)
  //      so the user keeps seeing them even after the checkpoint reverts.
  //   3. optimisticMessages — human message shown immediately after submit, before
  //      server echoes it back. Deduped against base to avoid double-rendering.
  const mergedThread = (() => {
    // --- Phase 1: determine base ---
    let baseMessages: Message[];
    if (frozenMessages !== null) {
      // Stream was stopped; show frozen snapshot until new AI turn begins.
      baseMessages = frozenMessages;
    } else if (pinnedPartials.length > 0) {
      // Frozen was cleared; inject pinned uncommitted messages at the split point.
      // Split point = first message in thread.messages whose id was NOT in the
      // old frozen (frozenIdsRef). Everything before the split is shared history;
      // insert pinnedPartials right before the new messages.
      const frozenIds = frozenIdsRef.current;
      let splitIdx = thread.messages.findIndex(
        (m) => !frozenIds.has((m as { id?: string }).id ?? "")
      );
      if (splitIdx === -1) splitIdx = thread.messages.length; // all are shared, append
      baseMessages = [
        ...thread.messages.slice(0, splitIdx),
        ...pinnedPartials,
        ...thread.messages.slice(splitIdx),
      ];
    } else {
      baseMessages = thread.messages;
    }

    // --- Phase 2: append deduped optimistic ---
    if (optimisticMessages.length === 0) {
      if (baseMessages === thread.messages) return thread; // no changes, reuse object
      return { ...thread, messages: baseMessages } as typeof thread;
    }

    const baseHumanTexts = new Set(
      baseMessages
        .filter((m) => m.type === "human")
        .map((m) => {
          if (typeof m.content === "string") return m.content.trim();
          if (Array.isArray(m.content)) {
            return m.content
              .map((c) => (c.type === "text" ? c.text : ""))
              .join("")
              .trim();
          }
          return "";
        }),
    );
    const deduped = optimisticMessages.filter((m) => {
      if (m.type !== "human") return true;
      const text =
        typeof m.content === "string"
          ? m.content.trim()
          : Array.isArray(m.content)
            ? m.content
                .map((c) => (c.type === "text" ? c.text : ""))
                .join("")
                .trim()
            : "";
      return !baseHumanTexts.has(text);
    });

    const finalMsgs = deduped.length === 0 ? baseMessages : [...baseMessages, ...deduped];
    if (deduped.length === 0 && baseMessages === thread.messages) return thread;
    return {
      ...thread,
      messages: finalMsgs,
    } as typeof thread;
  })();

  // Expose stopStream instead of raw thread.stop so callers get the freeze behaviour.
  const mergedThreadWithStop = {
    ...mergedThread,
    stop: stopStream,
  };

  /**
   * Retry the last human message after an error.
   *
   * Captures the text of the last human message currently visible (frozen or real),
   * resets the send gate, and re-submits it. The useStream hook has already been
   * remounted by the onError handler (bumped streamRestartKey), so the new submit
   * hits a fresh LangGraph connection that resumes from checkpoint state.
   */
  const retryStream = useCallback(
    async (customMessage?: string) => {
      if (sendInFlightRef.current) return;

      // If caller provides a message, use it. Otherwise grab the last human message.
      if (customMessage) {
        const activeThread = threadIdRef.current;
        if (!activeThread) return;
        await sendMessage(activeThread, { text: customMessage, files: [] });
        return;
      }

      const baseMessages = frozenMessages ?? thread.messages;
      const lastHuman = [...baseMessages].reverse().find((m) => m.type === "human");
      if (!lastHuman) return;

      const text =
        typeof lastHuman.content === "string"
          ? lastHuman.content
          : Array.isArray(lastHuman.content)
            ? lastHuman.content
                .map((c) => (c.type === "text" ? c.text : ""))
                .join("")
            : "";

      if (!text.trim()) return;

      const activeThread = threadIdRef.current;
      if (!activeThread) return;
      await sendMessage(activeThread, { text, files: [] });
    },
    [sendMessage, frozenMessages, thread.messages],
  );

  /** Force the useStream hook to re-fetch the latest thread state.
   * Use this after out-of-band thread mutations (e.g. compact/prune) so the
   * message list reflects the new state (compact boundary appears) without a
   * full page reload.
   *
   * Mechanism: briefly set onStreamThreadId=null (tears down useStream), then
   * restore it so useStream remounts with reconnectOnMount=true and fetches
   * the latest checkpoint. A simple streamRestartKey bump doesn't work because
   * setOnStreamThreadId(sameValue) is a React no-op.
   */
  const refetchThread = useCallback(() => {
    const target = threadIdRef.current;
    console.log("[compact] refetchThread: remounting useStream to re-fetch thread state, target=", target);
    setOnStreamThreadId(null); // tear down → useStream sees no thread
    setTimeout(() => {
      console.log("[compact] refetchThread: restoring threadId=", target);
      setOnStreamThreadId(target); // remount → reconnectOnMount=true fetches latest state
    }, 50);
  }, []);

  return [mergedThreadWithStop, sendMessage, isUploading, retryStream, refetchThread] as const;
}

export function useThreads(
  params: Parameters<ThreadsClient["search"]>[0] = {
    limit: 50,
    sortBy: "updated_at",
    sortOrder: "desc",
    select: ["thread_id", "updated_at", "values"],
  },
) {
  const apiClient = getAPIClient();
  return useQuery<AgentThread[]>({
    queryKey: ["threads", "search", params],
    queryFn: async () => {
      const maxResults = params.limit;
      const initialOffset = params.offset ?? 0;
      const DEFAULT_PAGE_SIZE = 50;

      // Preserve prior semantics: if a non-positive limit is explicitly provided,
      // delegate to a single search call with the original parameters.
      if (maxResults !== undefined && maxResults <= 0) {
        const response = await apiClient.threads.search<AgentThreadState>(params);
        return response as AgentThread[];
      }

      const pageSize =
        typeof maxResults === "number" && maxResults > 0
          ? Math.min(DEFAULT_PAGE_SIZE, maxResults)
          : DEFAULT_PAGE_SIZE;

      const threads: AgentThread[] = [];
      let offset = initialOffset;

      while (true) {
        if (typeof maxResults === "number" && threads.length >= maxResults) {
          break;
        }

        const currentLimit =
          typeof maxResults === "number"
            ? Math.min(pageSize, maxResults - threads.length)
            : pageSize;

        if (typeof maxResults === "number" && currentLimit <= 0) {
          break;
        }

        const response = (await apiClient.threads.search<AgentThreadState>({
          ...params,
          limit: currentLimit,
          offset,
        })) as AgentThread[];

        threads.push(...response);

        if (response.length < currentLimit) {
          break;
        }

        offset += response.length;
      }

      return threads;
    },
    refetchOnWindowFocus: false,
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }) => {
      await apiClient.threads.delete(threadId);
    },
    onSuccess(_, { threadId }) {
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread>) => {
          return oldData.filter((t) => t.thread_id !== threadId);
        },
      );
    },
  });
}

export function useRenameThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({
      threadId,
      title,
    }: {
      threadId: string;
      title: string;
    }) => {
      await apiClient.threads.updateState(threadId, {
        values: { title },
      });
    },
    onSuccess(_, { threadId, title }) {
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread>) => {
          return oldData.map((t) => {
            if (t.thread_id === threadId) {
              return {
                ...t,
                values: {
                  ...t.values,
                  title,
                },
              };
            }
            return t;
          });
        },
      );
    },
  });
}
