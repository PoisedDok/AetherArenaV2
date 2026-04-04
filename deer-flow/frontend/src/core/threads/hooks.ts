import type { AIMessage, Message } from "@langchain/langgraph-sdk";
import type { ThreadsClient } from "@langchain/langgraph-sdk/client";
import { useStream } from "@langchain/langgraph-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

import { getAPIClient } from "../api";
import { getGuru, getGuruMuted } from "../guru/guru";
import { fireGuruObserver } from "../guru/observer";
import { useI18n } from "../i18n/hooks";
import type { FileInMessage } from "../messages/utils";
import type { Model } from "../models/types";
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
  onFinish?: (state: AgentThreadState) => void;
  onToolEnd?: (event: ToolEndEvent) => void;
};

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
  onFinish,
  onToolEnd,
}: ThreadStreamOptions) {
  const { t } = useI18n();
  // Track the thread ID that is currently streaming to handle thread changes during streaming
  const [onStreamThreadId, setOnStreamThreadId] = useState(() => threadId);
  // Ref to track current thread ID across async callbacks without causing re-renders,
  // and to allow access to the current thread id in onUpdateEvent
  const threadIdRef = useRef<string | null>(threadId ?? null);
  const startedRef = useRef(false);

  const listeners = useRef({
    onStart,
    onFinish,
    onToolEnd,
  });

  // Keep listeners ref updated with latest callbacks
  useEffect(() => {
    listeners.current = { onStart, onFinish, onToolEnd };
  }, [onStart, onFinish, onToolEnd]);

  useEffect(() => {
    const normalizedThreadId = threadId ?? null;
    if (!normalizedThreadId) {
      // Just reset for new thread creation when threadId becomes null/undefined
      startedRef.current = false;
      setOnStreamThreadId(normalizedThreadId);
    }
    threadIdRef.current = normalizedThreadId;
  }, [threadId]);

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
      handleStreamStart(meta.thread_id);
      setOnStreamThreadId(meta.thread_id);
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
      toast.error(getStreamErrorMessage(error));
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
            // Default to "lfm" (small, fast 1.2B model) if no Guru model configured
            const guruModelName = getLocalSettings().guru.model_name ?? "lfm";
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
    },
  });

  // Optimistic messages shown before the server stream responds
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const sendInFlightRef = useRef(false);
  // Track message count before sending so we know when server has responded
  const prevMsgCountRef = useRef(thread.messages.length);

  // Messages frozen at stop time — keeps partial streamed content visible until
  // the next submit's server response arrives and replaces them.
  const [frozenMessages, setFrozenMessages] = useState<Message[] | null>(null);

  // Clear optimistic + frozen when server messages arrive (count increases past
  // what we saw before the submit). Also signal Guru that streaming has started —
  // but only when a real send is in-flight (not on initial history rehydration).
  useEffect(() => {
    if (thread.messages.length > prevMsgCountRef.current) {
      if (optimisticMessages.length > 0) setOptimisticMessages([]);
      if (frozenMessages !== null) setFrozenMessages(null);
      // Only fire streaming state if user actually sent something (not history load)
      if (optimisticMessages.length > 0) {
        window.dispatchEvent(new CustomEvent("guru:state", { detail: "streaming" }));
      }
    }
  }, [thread.messages.length, optimisticMessages.length, frozenMessages]);

  const sendMessage = useCallback(
    async (
      threadId: string,
      message: PromptInputMessage,
      extraContext?: Record<string, unknown>,
    ) => {
      if (sendInFlightRef.current) {
        return;
      }
      sendInFlightRef.current = true;

      const text = message.text.trim();

      // Capture current count before showing optimistic messages.
      // Use frozenMessages length if available (after a stop, thread.messages
      // reverts to the checkpoint and may be shorter than what the user saw).
      const baseMessages = frozenMessages ?? thread.messages;
      prevMsgCountRef.current = baseMessages.length;
      // Clear frozen now that a new submit is underway
      setFrozenMessages(null);

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
        void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
      } catch (error) {
        setOptimisticMessages([]);
        setIsUploading(false);
        throw error;
      } finally {
        sendInFlightRef.current = false;
      }
    },
    [thread, _handleOnStart, t.uploads.uploadingFiles, context, queryClient, frozenMessages],
  );

  // Wrap thread.stop() to freeze visible messages before the SDK reverts them.
  // After stop(), thread.messages reverts to the last checkpoint (dropping partial
  // streaming content). We capture the current messages first so the UI keeps
  // showing them until the next submit's server response arrives.
  const stopStream = useCallback(async () => {
    // Capture what the user can currently see (optimistic + real)
    const currentlyVisible =
      optimisticMessages.length > 0
        ? [...thread.messages, ...optimisticMessages]
        : thread.messages.length > 0
          ? [...thread.messages]
          : null;
    if (currentlyVisible && currentlyVisible.length > 0) {
      setFrozenMessages(currentlyVisible);
    }
    // Signal Guru to settle — user stopped the stream
    window.dispatchEvent(new CustomEvent("guru:state", { detail: "idle" }));
    await thread.stop();
  }, [thread, optimisticMessages]);

  // Merge thread with optimistic/frozen messages for display.
  // Priority: if frozenMessages exist, use them as the base (they include partial
  // streamed content captured at stop time). Otherwise use thread.messages.
  // On top of either base, append any pending optimistic messages (deduplicated).
  const mergedThread = (() => {
    const baseMessages = frozenMessages ?? thread.messages;

    if (optimisticMessages.length === 0) {
      if (frozenMessages === null) return thread;
      return { ...thread, messages: frozenMessages } as typeof thread;
    }

    const realHumanTexts = new Set(
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
      return !realHumanTexts.has(text);
    });
    if (deduped.length === 0) {
      return { ...thread, messages: baseMessages } as typeof thread;
    }
    return {
      ...thread,
      messages: [...baseMessages, ...deduped],
    } as typeof thread;
  })();

  // Expose stopStream instead of raw thread.stop so callers get the freeze behaviour.
  const mergedThreadWithStop = {
    ...mergedThread,
    stop: stopStream,
  };

  return [mergedThreadWithStop, sendMessage, isUploading] as const;
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
