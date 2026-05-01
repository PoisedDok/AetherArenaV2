import {
  BookOpenTextIcon,
  CheckCircleIcon,
  ChevronUp,
  ClipboardListIcon,
  ClockIcon,
  Loader2Icon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Streamdown } from "streamdown";

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { ShineBorder } from "@/components/ui/shine-border";
import { useI18n } from "@/core/i18n/hooks";
import { extractContentFromMessage, hasToolCalls } from "@/core/messages/utils";
import { useRehypeSplitWordsIntoSpans } from "@/core/rehype";
import { streamdownPluginsWithWordAnimation } from "@/core/streamdown";
import { useSubtask } from "@/core/tasks/context";
import { explainLastToolCall } from "@/core/tools/utils";
import { cn } from "@/lib/utils";

import { CitationLink } from "../citations/citation-link";
import { FlipDisplay } from "../flip-display";

import { MarkdownContent } from "./markdown-content";

export function SubtaskCard({
  className,
  taskId,
  isLoading,
}: {
  className?: string;
  taskId: string;
  isLoading: boolean;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(true);
  const rehypePlugins = useRehypeSplitWordsIntoSpans(isLoading);
  const task = useSubtask(taskId)!;
  const icon = useMemo(() => {
    if (task.status === "completed") {
      return <CheckCircleIcon className="size-3" />;
    } else if (task.status === "failed") {
      return <XCircleIcon className="size-3 text-red-500" />;
    } else if (task.status === "timed_out") {
      return <ClockIcon className="size-3 text-amber-500" />;
    } else if (task.status === "in_progress") {
      return <Loader2Icon className="size-3 animate-spin" />;
    }
  }, [task.status]);
  return (
    <ChainOfThought
      className={cn("relative w-full gap-2 rounded-lg border py-0", className)}
      open={!collapsed}
    >
      <div
        className={cn(
          "ambilight z-[-1]",
          task.status === "in_progress" ? "enabled" : "",
        )}
      ></div>
      {task.status === "in_progress" && (
        <>
          <ShineBorder
            borderWidth={1}
            duration={40}
            shineColor={["#A07CFE", "#FE8FB5", "#FFBE7B"]}
            className="opacity-40"
          />
        </>
      )}
      <div className="glass-surface-card flex w-full flex-col rounded-lg">
        <div className="flex w-full items-center justify-between p-0.5">
          <Button
            className="w-full items-start justify-start text-left"
            variant="ghost"
            onClick={() => setCollapsed(!collapsed)}
          >
            <div className="flex w-full items-center justify-between">
              <ChainOfThoughtStep
                className="font-normal"
                label={
                  task.status === "in_progress" ? (
                    <Shimmer duration={3} spread={3}>
                      {task.description}
                    </Shimmer>
                  ) : (
                    task.description
                  )
                }
                icon={<ClipboardListIcon />}
              ></ChainOfThoughtStep>
              <div className="flex items-center gap-1">
                {collapsed && (
                  <div
                    className={cn(
                      "text-muted-foreground flex items-center gap-1 text-xs font-normal",
                      task.status === "failed" ? "text-red-500 opacity-67" : "",
                    )}
                  >
                    {icon}
                    <FlipDisplay
                      className="max-w-[420px] truncate pb-1"
                      uniqueKey={task.latestMessage?.id ?? ""}
                    >
                      {task.status === "in_progress" &&
                      task.latestMessage &&
                      hasToolCalls(task.latestMessage)
                        ? explainLastToolCall(task.latestMessage, t)
                        : t.subtasks[task.status]}
                    </FlipDisplay>
                  </div>
                )}
                <ChevronUp
                  className={cn(
                    "text-muted-foreground size-4",
                    !collapsed ? "" : "rotate-180",
                  )}
                />
              </div>
            </div>
          </Button>
        </div>
        <ChainOfThoughtContent className="px-4 pb-4">
          {task.prompt && (
            <ChainOfThoughtStep
              label={
                <Streamdown
                  {...streamdownPluginsWithWordAnimation}
                  components={{ a: CitationLink }}
                >
                  {task.prompt}
                </Streamdown>
              }
            ></ChainOfThoughtStep>
          )}
          {/* Expanded message history from subtask execution */}
          {task.messageHistory && task.messageHistory.length > 0 && (
            <ChainOfThoughtStep
              label={
                <span className="text-muted-foreground text-xs">
                  {task.messageHistory.length} step{task.messageHistory.length > 1 ? "s" : ""} recorded
                </span>
              }
              icon={<BookOpenTextIcon className="size-3" />}
              description={
                <div className="space-y-2 mt-1">
                  {task.messageHistory.map((msg, idx) => {
                    const hasTools = hasToolCalls(msg);
                    const content = extractContentFromMessage(msg);
                    const firstToolCall = msg.tool_calls?.[0];
                    const labelNode =
                      hasTools && firstToolCall
                        ? explainLastToolCall(msg, t)
                        : content
                          ? content.slice(0, 120) + (content.length > 120 ? "…" : "")
                          : "…";
                    return (
                      <div
                        key={msg.id ?? String(idx)}
                        className="rounded border border-border/30 bg-muted/20 px-2 py-1.5"
                      >
                        <div className="text-muted-foreground text-xs font-medium flex items-center gap-1.5">
                          {hasTools ? (
                            <WrenchIcon className="size-3 shrink-0" />
                          ) : (
                            <BookOpenTextIcon className="size-3 shrink-0" />
                          )}
                          {labelNode}
                        </div>
                        {content && (
                          <div className="mt-1 pl-[18px]">
                            <MarkdownContent
                              content={content}
                              isLoading={false}
                              rehypePlugins={rehypePlugins}
                              className="text-xs"
                            />
                          </div>
                        )}
                        {hasTools && firstToolCall && (
                          <div className="mt-1 pl-[18px]">
                            <span className="text-muted-foreground text-[10px] font-mono">
                              {firstToolCall.name}({JSON.stringify(firstToolCall.args).slice(0, 200)})
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              }
            ></ChainOfThoughtStep>
          )}
          {task.status === "in_progress" &&
            task.latestMessage &&
            hasToolCalls(task.latestMessage) && (
              <ChainOfThoughtStep
                label={t.subtasks.in_progress}
                icon={<Loader2Icon className="size-4 animate-spin" />}
              >
                {explainLastToolCall(task.latestMessage, t)}
              </ChainOfThoughtStep>
            )}
          {task.status === "completed" && (
            <>
              <ChainOfThoughtStep
                label={t.subtasks.completed}
                icon={<CheckCircleIcon className="size-4" />}
              ></ChainOfThoughtStep>
              <ChainOfThoughtStep
                label={
                  task.result ? (
                    <MarkdownContent
                      content={task.result}
                      isLoading={false}
                      rehypePlugins={rehypePlugins}
                    />
                  ) : null
                }
              ></ChainOfThoughtStep>
            </>
          )}
          {task.status === "failed" && (
            <ChainOfThoughtStep
              label={<div className="text-red-500">{task.error}</div>}
              icon={<XCircleIcon className="size-4 text-red-500" />}
            ></ChainOfThoughtStep>
          )}
          {task.status === "timed_out" && (
            <ChainOfThoughtStep
              label={<div className="text-amber-500">{task.error}</div>}
              icon={<ClockIcon className="size-4 text-amber-500" />}
            ></ChainOfThoughtStep>
          )}
        </ChainOfThoughtContent>
      </div>
    </ChainOfThought>
  );
}
