import type { BaseStream } from "@langchain/langgraph-sdk/react";
import { useRef } from "react";

import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import { useCompactContext } from "@/core/compact/context";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractContentFromMessage,
  extractPresentFilesFromMessage,
  extractTextFromMessage,
  groupMessages,
  hasContent,
  hasPresentFiles,
  hasReasoning,
} from "@/core/messages/utils";
import { useRehypeSplitWordsIntoSpans } from "@/core/rehype";
import type { Subtask } from "@/core/tasks";
import { useUpdateSubtask } from "@/core/tasks/context";
import type { AgentThreadState } from "@/core/threads";
import { cn } from "@/lib/utils";

import { InlineApp } from "@/components/ai-elements/inline-app";
import { ArtifactFileList } from "../artifacts/artifact-file-list";
import { StreamingIndicator } from "../streaming-indicator";

import { CompactBoundary, isCompactBoundaryContent } from "./compact-boundary";
import { CompactingCard } from "./compacting-card";
import { MarkdownContent } from "./markdown-content";
import { MessageGroup } from "./message-group";
import { MessageListItem } from "./message-list-item";
import { MessageListSkeleton } from "./skeleton";
import { SubtaskCard } from "./subtask-card";

export function MessageList({
  className,
  threadId,
  thread,
  paddingBottom = 160,
}: {
  className?: string;
  threadId: string;
  thread: BaseStream<AgentThreadState>;
  paddingBottom?: number;
}) {
  const { t } = useI18n();
  const rehypePlugins = useRehypeSplitWordsIntoSpans(thread.isLoading);
  const updateSubtask = useUpdateSubtask();
  const { state: compactState } = useCompactContext();
  const messages = thread.messages;

  // Track whether we have ever loaded messages — once we have, never show the
  // skeleton again. This prevents CompactingCard from being unmounted when the
  // useStream hook briefly enters isThreadLoading=true after _prune_thread
  // updates the LangGraph checkpoint (which would cause the skeleton to render,
  // unmounting CompactingCard and potentially causing re-render loops).
  const hasEverLoadedRef = useRef(messages.length > 0);
  if (messages.length > 0) hasEverLoadedRef.current = true;

  // Also don't show skeleton while compact is active — CompactingCard must
  // stay mounted throughout the compact lifecycle.
  const compactActive = compactState.status !== "idle";

  if (
    thread.isThreadLoading &&
    messages.length === 0 &&
    !hasEverLoadedRef.current &&
    !compactActive
  ) {
    return <MessageListSkeleton />;
  }

  return (
    <Conversation
      className={cn("flex size-full flex-col justify-center", className)}
    >
      <ConversationContent className="mx-auto w-full max-w-(--container-width-md) gap-8 pt-12">
        {(() => {
          // NOTE: this relies on groupMessages invoking the callback synchronously.
          let prevGroupType: string | null = null;
          return groupMessages(messages, (group) => {
            const isPostSubagent = prevGroupType === "assistant:subagent";
            prevGroupType = group.type;

            if (group.type === "human" || group.type === "assistant") {
              const isSynthesis = group.type === "assistant" && isPostSubagent;
              return group.messages.map((msg) => {
                if (
                  group.type === "human" &&
                  isCompactBoundaryContent(msg.content)
                ) {
                  return (
                    <CompactBoundary
                      key={`${group.id}/${msg.id}`}
                      content={msg.content as string}
                    />
                  );
                }
                return (
                  <div
                    key={`${group.id}/${msg.id}`}
                    className={
                      isSynthesis ? "border-l-2 border-primary/30 pl-3" : ""
                    }
                  >
                    {isSynthesis && (
                      <span className="text-muted-foreground mb-2 block text-xs">
                        Synthesis
                      </span>
                    )}
                    <MessageListItem
                      message={msg}
                      isLoading={thread.isLoading}
                    />
                  </div>
                );
              });
            }

            if (group.type === "assistant:present-files") {
              const files: string[] = [];
              for (const message of group.messages) {
                if (hasPresentFiles(message)) {
                  const presentFiles = extractPresentFilesFromMessage(message);
                  files.push(...presentFiles);
                }
              }
              return (
                <div className="w-full" key={group.id}>
                  {group.messages[0] && hasContent(group.messages[0]) && (
                    <MarkdownContent
                      content={extractContentFromMessage(group.messages[0])}
                      isLoading={thread.isLoading}
                      rehypePlugins={rehypePlugins}
                      className="mb-4"
                    />
                  )}
                  <ArtifactFileList files={files} threadId={threadId} />
                </div>
              );
            }

            if (group.type === "assistant:subagent") {
              // FIX: track task IDs separately from the Set so that
              // updateSubtask calls (which update context) don't cause the
              // displayed count to fall out of sync with the rendered cards.
              const taskIds: string[] = [];

              for (const message of group.messages) {
                if (message.type === "ai") {
                  for (const toolCall of message.tool_calls ?? []) {
                    if (toolCall.name === "task") {
                      const task: Subtask = {
                        id: toolCall.id!,
                        subagent_type: toolCall.args.subagent_type,
                        description: toolCall.args.description,
                        prompt: toolCall.args.prompt,
                        status: "in_progress",
                      };
                      updateSubtask(task);
                      taskIds.push(toolCall.id!);
                    }
                  }
                } else if (message.type === "tool") {
                  const taskId = message.tool_call_id;
                  if (taskId) {
                    const result = extractTextFromMessage(message);
                    if (result.startsWith("Task Succeeded. Result:")) {
                      updateSubtask({
                        id: taskId,
                        status: "completed",
                        result: result
                          .split("Task Succeeded. Result:")[1]
                          ?.trim(),
                      });
                    } else if (result.startsWith("Task failed.")) {
                      updateSubtask({
                        id: taskId,
                        status: "failed",
                        error: result.split("Task failed.")[1]?.trim(),
                      });
                    } else if (result.startsWith("Task timed out")) {
                      updateSubtask({
                        id: taskId,
                        status: "timed_out",
                        error: result,
                      });
                    } else {
                      updateSubtask({
                        id: taskId,
                        status: "in_progress",
                      });
                    }
                  }
                }
              }

              const results: React.ReactNode[] = [];
              for (const message of group.messages.filter(
                (message) => message.type === "ai",
              )) {
                // Render reasoning if present
                if (hasReasoning(message)) {
                  results.push(
                    <MessageGroup
                      key={"thinking-group-" + message.id}
                      messages={[message]}
                      isLoading={thread.isLoading}
                    />,
                  );
                }

                // Render text content between subtask calls
                if (hasContent(message)) {
                  const content = extractContentFromMessage(message);
                  if (content) {
                    results.push(
                      <MarkdownContent
                        key={"subtask-text-" + message.id}
                        content={content}
                        isLoading={thread.isLoading}
                        rehypePlugins={rehypePlugins}
                        className="my-2"
                      />,
                    );
                  }
                }

                // FIX: use taskIds.length (derived from the current AI message's
                // tool_calls) instead of the shared Set so the count is accurate.
                const msgTaskIds =
                  message.tool_calls?.map((tc) => tc.id).filter(Boolean) ?? [];

                results.push(
                  <div
                    key={"subtask-count-" + message.id}
                    // FIX: was "font-norma" (typo) — corrected to "font-normal"
                    className="text-muted-foreground font-normal pt-2 text-sm"
                  >
                    {t.subtasks.executing(msgTaskIds.length)}
                  </div>,
                );

                for (const taskId of msgTaskIds) {
                  results.push(
                    <SubtaskCard
                      key={"task-group-" + taskId}
                      taskId={taskId!}
                      isLoading={thread.isLoading}
                    />,
                  );
                }
              }

              return (
                <div
                  key={"subtask-group-" + group.id}
                  className="relative z-1 flex flex-col gap-2"
                >
                  {results}
                </div>
              );
            }

            if (group.type === "assistant:inline-ui") {
              const aiMsg = group.messages[0];
              if (aiMsg?.type !== "ai") return null;
              const toolCall = aiMsg.tool_calls?.[0];
              if (!toolCall) return null;
              const url = toolCall.args?.url as string | undefined;
              const title = toolCall.args?.title as string | undefined;
              if (!url) return null;
              return (
                <div key={group.id} className="w-full">
                  <InlineApp url={url} title={title} />
                </div>
              );
            }

            return (
              <MessageGroup
                key={"group-" + group.id}
                messages={group.messages}
                isLoading={thread.isLoading}
              />
            );
          });
        })()}

        {/* CompactingCard — appears while compact is in progress */}
        <CompactingCard />
        {thread.isLoading && <StreamingIndicator className="my-4" />}
        <div style={{ height: `${paddingBottom}px` }} />
      </ConversationContent>
    </Conversation>
  );
}