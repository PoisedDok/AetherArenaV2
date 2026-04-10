import type { Message } from "@langchain/langgraph-sdk";
import {
  BookOpenTextIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FolderOpenIcon,
  GlobeIcon,
  ListTodoIcon,
  MessageCircleQuestionMarkIcon,
  NotebookPenIcon,
  SearchIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractContentFromMessage,
  extractReasoningContentFromMessage,
  findToolCallResult,
} from "@/core/messages/utils";
import { useRehypeSplitWordsIntoSpans } from "@/core/rehype";
import { extractTitleFromMarkdown } from "@/core/utils/markdown";
import { cn } from "@/lib/utils";

import { useArtifacts } from "../artifacts";
import { FlipDisplay } from "../flip-display";
import { Tooltip } from "../tooltip";

import { MarkdownContent } from "./markdown-content";

interface GenericCoTStep<T extends string = string> {
  id?: string;
  messageId?: string;
  type: T;
}

interface CoTReasoningStep extends GenericCoTStep<"reasoning"> {
  reasoning: string | null;
}

interface CoTToolCallStep extends GenericCoTStep<"toolCall"> {
  name: string;
  args: Record<string, unknown>;
  result?: string;
}

interface CoTContentStep extends GenericCoTStep<"content"> {
  content: string;
}

type CoTStep = CoTReasoningStep | CoTToolCallStep | CoTContentStep;

export function MessageGroup({
  className,
  messages,
  isLoading = false,
}: {
  className?: string;
  messages: Message[];
  isLoading?: boolean;
}) {
  const steps = useMemo(() => convertToSteps(messages), [messages]);
  const lastToolCallIndex = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      if (s?.type === "toolCall") {
        return i;
      }
    }
    return -1;
  }, [steps]);
  const rehypePlugins = useRehypeSplitWordsIntoSpans(isLoading);

  // Start open while loading; auto-collapse when the agent finishes
  const [isOpen, setIsOpen] = useState(isLoading);
  useEffect(() => {
    if (!isLoading) {
      setIsOpen(false);
    } else {
      setIsOpen(true);
    }
  }, [isLoading]);

  return (
    <ChainOfThought
      className={cn("w-full gap-2 rounded-lg border p-0.5", className)}
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      <button
        className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span>{isLoading ? "Working…" : "Tool calls"}</span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 transition-transform duration-200",
            isOpen ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      {steps.map((step, i) => {
        if (step.type === "reasoning" || step.type === "content") {
          return (
            <ChainOfThoughtContent
              key={step.id ?? `text-${i}`}
              className="px-4 pb-2"
            >
              <ChainOfThoughtStep
                label={
                  <MarkdownContent
                    content={
                      step.type === "reasoning"
                        ? (step.reasoning ?? "")
                        : step.content
                    }
                    isLoading={isLoading}
                    rehypePlugins={rehypePlugins}
                  />
                }
              ></ChainOfThoughtStep>
            </ChainOfThoughtContent>
          );
        }
        return (
          <ChainOfThoughtContent
            key={step.id ?? `tool-${i}`}
            className="px-4 pb-2"
          >
            <FlipDisplay uniqueKey={step.id ?? String(i)}>
              <ToolCall
                {...step}
                isLast={i === lastToolCallIndex}
                isLoading={isLoading}
              />
            </FlipDisplay>
          </ChainOfThoughtContent>
        );
      })}
    </ChainOfThought>
  );
}

function ToolCall({
  id,
  messageId,
  name,
  args,
  result,
  isLast = false,
  isLoading = false,
}: {
  id?: string;
  messageId?: string;
  name: string;
  args: Record<string, unknown>;
  result?: string | Record<string, unknown>;
  isLast?: boolean;
  isLoading?: boolean;
}) {
  const { t } = useI18n();
  const { setOpen, autoOpen, autoSelect, selectedArtifact, select } =
    useArtifacts();

  if (name === "web_search") {
    let label: React.ReactNode = t.toolCalls.searchForRelatedInfo;
    if (typeof args.query === "string") {
      label = t.toolCalls.searchOnWebFor(args.query);
    }
    const searchResultText = !Array.isArray(result) ? toResultText(result) : null;
    return (
      <ChainOfThoughtStep key={id} label={label} icon={SearchIcon}>
        {Array.isArray(result) && (
          <ChainOfThoughtSearchResults>
            {result.map((item) => (
              <ChainOfThoughtSearchResult key={item.url}>
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
              </ChainOfThoughtSearchResult>
            ))}
          </ChainOfThoughtSearchResults>
        )}
        {searchResultText && <ToolOutput output={searchResultText} />}
      </ChainOfThoughtStep>
    );
  } else if (name === "image_search") {
    let label: React.ReactNode = t.toolCalls.searchForRelatedImages;
    if (typeof args.query === "string") {
      label = t.toolCalls.searchForRelatedImagesFor(args.query);
    }
    const imageResultObj = result as {
      results?: {
        source_url: string;
        thumbnail_url: string;
        image_url: string;
        title: string;
      }[];
    } | undefined;
    const imageResults = imageResultObj?.results;
    const imageResultText = !imageResults ? toResultText(result) : null;
    return (
      <ChainOfThoughtStep key={id} label={label} icon={SearchIcon}>
        {Array.isArray(imageResults) && imageResults.length > 0 && (
          <ChainOfThoughtSearchResults>
            {imageResults.map((item) => (
              <Tooltip key={item.image_url || item.thumbnail_url} content={item.title}>
                <a
                  className="block size-20 shrink-0 overflow-hidden rounded-md ring-1 ring-black/10 transition-opacity hover:opacity-80 dark:ring-white/10"
                  href={item.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    className="size-full object-cover"
                    src={item.thumbnail_url || item.image_url}
                    alt={item.title}
                    width={80}
                    height={80}
                    onError={(e) => {
                      // Fall back to full image if thumbnail fails
                      if (item.image_url && e.currentTarget.src !== item.image_url) {
                        e.currentTarget.src = item.image_url;
                      }
                    }}
                  />
                </a>
              </Tooltip>
            ))}
          </ChainOfThoughtSearchResults>
        )}
        {imageResultText && <ToolOutput output={imageResultText} />}
      </ChainOfThoughtStep>
    );
  } else if (name === "web_fetch") {
    const url = (args as { url: string })?.url;
    let title = url;
    if (typeof result === "string") {
      const potentialTitle = extractTitleFromMarkdown(result);
      if (potentialTitle && potentialTitle.toLowerCase() !== "untitled") {
        title = potentialTitle;
      }
    }
    const fetchResultText = toResultText(result);
    return (
      <ChainOfThoughtStep
        key={id}
        className="cursor-pointer"
        label={t.toolCalls.viewWebPage}
        icon={GlobeIcon}
        onClick={() => {
          window.open(url, "_blank");
        }}
      >
        <ChainOfThoughtSearchResult>
          {url && (
            <a href={url} target="_blank" rel="noreferrer">
              {title}
            </a>
          )}
        </ChainOfThoughtSearchResult>
        {fetchResultText && <ToolOutput output={fetchResultText} />}
      </ChainOfThoughtStep>
    );
  } else if (name === "ls") {
    let description: string | undefined = (args as { description: string })
      ?.description;
    if (!description) {
      description = t.toolCalls.listFolder;
    }
    const path: string | undefined = (args as { path: string })?.path;
    const lsResultText = toResultText(result);
    return (
      <ChainOfThoughtStep key={id} label={description} icon={FolderOpenIcon}>
        {path && (
          <ChainOfThoughtSearchResult className="cursor-pointer">
            {path}
          </ChainOfThoughtSearchResult>
        )}
        {lsResultText && <ToolOutput output={lsResultText} />}
      </ChainOfThoughtStep>
    );
  } else if (name === "read_file") {
    let description: string | undefined = (args as { description: string })
      ?.description;
    if (!description) {
      description = t.toolCalls.readFile;
    }
    const { path } = args as { path: string; content: string };
    const readResultText = toResultText(result);
    return (
      <ChainOfThoughtStep key={id} label={description} icon={BookOpenTextIcon}>
        {path && (
          <ChainOfThoughtSearchResult className="cursor-pointer">
            {path}
          </ChainOfThoughtSearchResult>
        )}
        {readResultText && <ToolOutput output={readResultText} />}
      </ChainOfThoughtStep>
    );
  } else if (name === "write_file" || name === "str_replace") {
    let description: string | undefined = (args as { description: string })
      ?.description;
    if (!description) {
      description = t.toolCalls.writeFile;
    }
    const path: string | undefined = (args as { path: string })?.path;
    if (isLoading && isLast && autoOpen && autoSelect && path) {
      setTimeout(() => {
        const url = new URL(
          `write-file:${path}?message_id=${messageId}&tool_call_id=${id}`,
        ).toString();
        if (selectedArtifact === url) {
          return;
        }
        select(url, true);
        setOpen(true);
      }, 100);
    }

    const writeResultText = toResultText(result);
    return (
      <ChainOfThoughtStep
        key={id}
        className="cursor-pointer"
        label={description}
        icon={NotebookPenIcon}
        onClick={() => {
          select(
            new URL(
              `write-file:${path}?message_id=${messageId}&tool_call_id=${id}`,
            ).toString(),
          );
          setOpen(true);
        }}
      >
        {path && (
          <ChainOfThoughtSearchResult className="cursor-pointer">
            {path}
          </ChainOfThoughtSearchResult>
        )}
        {writeResultText && <ToolOutput output={writeResultText} />}
      </ChainOfThoughtStep>
    );
  } else if (name === "bash") {
    const description: string | undefined = (args as { description: string })
      ?.description;
    if (!description) {
      return t.toolCalls.executeCommand;
    }
    const command: string | undefined = (args as { command: string })?.command;
    const bashResultText = toResultText(result);
    return (
      <ChainOfThoughtStep key={id} label={description} icon={SquareTerminalIcon}>
        {command && (
          <CodeBlock
            className="mx-0 cursor-pointer border-none px-0"
            showLineNumbers={false}
            language="bash"
            code={command}
          />
        )}
        {bashResultText && <ToolOutput output={bashResultText} />}
      </ChainOfThoughtStep>
    );
  } else if (name === "ask_clarification") {
    const clarificationResultText = toResultText(result);
    return (
      <ChainOfThoughtStep
        key={id}
        label={t.toolCalls.needYourHelp}
        icon={MessageCircleQuestionMarkIcon}
      >
        {clarificationResultText && <ToolOutput output={clarificationResultText} />}
      </ChainOfThoughtStep>
    );
  } else if (name === "write_todos") {
    const todosResultText = toResultText(result);
    return (
      <ChainOfThoughtStep
        key={id}
        label={t.toolCalls.writeTodos}
        icon={ListTodoIcon}
      >
        {todosResultText && <ToolOutput output={todosResultText} />}
      </ChainOfThoughtStep>
    );
  } else {
    const description: string | undefined = (args as { description: string })
      ?.description;
    const genericResultText = toResultText(result);
    return (
      <ChainOfThoughtStep
        key={id}
        label={description ?? t.toolCalls.useTool(name)}
        icon={WrenchIcon}
      >
        {genericResultText && <ToolOutput output={genericResultText} />}
      </ChainOfThoughtStep>
    );
  }
}

const TOOL_OUTPUT_COLLAPSE_THRESHOLD = 8; // lines before collapsing

/** Normalise any tool result to a display string. Returns null if empty. */
function toResultText(result: string | Record<string, unknown> | undefined): string | null {
  if (result === undefined || result === "") return null;
  const raw = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const lines = raw.split("\n");
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();
  return lines.join("\n") || null;
}

/**
 * Premium inline tool output block.
 * - Always shows for short output (≤ threshold lines)
 * - For longer output: collapsed by default with animated expand/collapse toggle
 */
function ToolOutput({ output }: { output: string }) {
  const lines = output.split("\n");
  const isLong = lines.length > TOOL_OUTPUT_COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border/35 bg-muted/25">
      {/* Header bar */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b border-border/25 px-3 py-1",
          isLong && "cursor-pointer select-none hover:bg-muted/40 transition-colors",
        )}
        onClick={isLong ? () => setExpanded((v) => !v) : undefined}
      >
        <div className="flex items-center gap-1.5">
          <div className="size-1.5 rounded-full bg-emerald-500/80" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            output
          </span>
          {isLong && (
            <span className="text-[10px] text-muted-foreground/40">
              · {lines.length} lines
            </span>
          )}
        </div>
        {isLong && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
            {expanded ? (
              <>
                <span>collapse</span>
                <ChevronUpIcon className="size-3" />
              </>
            ) : (
              <>
                <span>expand</span>
                <ChevronDownIcon className="size-3" />
              </>
            )}
          </div>
        )}
      </div>

      {/* Output body */}
      {isLong ? (
        expanded ? (
          <div className="max-h-96 overflow-auto px-3 py-2">
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/75">
              {output}
            </pre>
          </div>
        ) : (
          /* Collapsed preview — first few lines with a fade */
          <div
            className="relative cursor-pointer px-3 pt-2 pb-1"
            onClick={() => setExpanded(true)}
          >
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/75 line-clamp-4">
              {lines.slice(0, 4).join("\n")}
            </pre>
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-muted/60 to-transparent" />
          </div>
        )
      ) : (
        <div className="px-3 py-2">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/75">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}

function convertToSteps(messages: Message[]): CoTStep[] {
  const steps: CoTStep[] = [];
  for (const message of messages) {
    if (message.type === "ai") {
      const reasoning = extractReasoningContentFromMessage(message);
      if (reasoning) {
        const step: CoTReasoningStep = {
          id: message.id,
          messageId: message.id,
          type: "reasoning",
          reasoning,
        };
        steps.push(step);
      }
      // Only show content inside the processing group when there are NO tool calls.
      // When an AI message has content + tool calls, groupMessages() already renders
      // the content as a standalone assistant bubble — duplicating it here causes the
      // text to appear twice (once above, once inside the "Working…" container).
      const hasCalls = (message.tool_calls ?? []).length > 0;
      if (!hasCalls) {
        const content = extractContentFromMessage(message);
        if (content) {
          const step: CoTContentStep = {
            id: message.id + "-content",
            messageId: message.id,
            type: "content",
            content,
          };
          steps.push(step);
        }
      }
      for (const tool_call of message.tool_calls ?? []) {
        if (tool_call.name === "task") {
          continue;
        }
        const step: CoTToolCallStep = {
          id: tool_call.id,
          messageId: message.id,
          type: "toolCall",
          name: tool_call.name,
          args: tool_call.args,
        };
        const toolCallId = tool_call.id;
        if (toolCallId) {
          const toolCallResult = findToolCallResult(toolCallId, messages);
          if (toolCallResult) {
            try {
              const json = JSON.parse(toolCallResult);
              step.result = json;
            } catch {
              step.result = toolCallResult;
            }
          }
        }
        steps.push(step);
      }
    }
  }
  return steps;
}
