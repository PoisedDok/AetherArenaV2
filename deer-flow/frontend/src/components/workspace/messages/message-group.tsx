import type { Message } from "@langchain/langgraph-sdk";
import {
  BookOpenTextIcon,
  ChevronDownIcon,
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
      </ChainOfThoughtStep>
    );
  } else if (name === "image_search") {
    let label: React.ReactNode = t.toolCalls.searchForRelatedImages;
    if (typeof args.query === "string") {
      label = t.toolCalls.searchForRelatedImagesFor(args.query);
    }
    const results = (
      result as {
        results: {
          source_url: string;
          thumbnail_url: string;
          image_url: string;
          title: string;
        }[];
      }
    )?.results;
    return (
      <ChainOfThoughtStep key={id} label={label} icon={SearchIcon}>
        {Array.isArray(results) && results.length > 0 && (
          <ChainOfThoughtSearchResults>
            {results.map((item) => (
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
      </ChainOfThoughtStep>
    );
  } else if (name === "ls") {
    let description: string | undefined = (args as { description: string })
      ?.description;
    if (!description) {
      description = t.toolCalls.listFolder;
    }
    const path: string | undefined = (args as { path: string })?.path;
    return (
      <ChainOfThoughtStep key={id} label={description} icon={FolderOpenIcon}>
        {path && (
          <ChainOfThoughtSearchResult className="cursor-pointer">
            {path}
          </ChainOfThoughtSearchResult>
        )}
      </ChainOfThoughtStep>
    );
  } else if (name === "read_file") {
    let description: string | undefined = (args as { description: string })
      ?.description;
    if (!description) {
      description = t.toolCalls.readFile;
    }
    const { path } = args as { path: string; content: string };
    return (
      <ChainOfThoughtStep key={id} label={description} icon={BookOpenTextIcon}>
        {path && (
          <ChainOfThoughtSearchResult className="cursor-pointer">
            {path}
          </ChainOfThoughtSearchResult>
        )}
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
      </ChainOfThoughtStep>
    );
  } else if (name === "bash") {
    const description: string | undefined = (args as { description: string })
      ?.description;
    if (!description) {
      return t.toolCalls.executeCommand;
    }
    const command: string | undefined = (args as { command: string })?.command;
    const hasResult = result !== undefined && result !== "";
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
        {hasResult && (
          <details className="mt-2">
            <summary className="cursor-pointer text-muted-foreground text-xs hover:text-foreground transition-colors">
              Output
            </summary>
            <div className="mt-1 max-h-48 overflow-auto">
              <CodeBlock
                language="text"
                code={typeof result === "string" ? result : JSON.stringify(result, null, 2)}
                showLineNumbers={false}
                className="border-none px-0 text-xs"
              />
            </div>
          </details>
        )}
      </ChainOfThoughtStep>
    );
  } else if (name === "ask_clarification") {
    return (
      <ChainOfThoughtStep
        key={id}
        label={t.toolCalls.needYourHelp}
        icon={MessageCircleQuestionMarkIcon}
      ></ChainOfThoughtStep>
    );
  } else if (name === "write_todos") {
    return (
      <ChainOfThoughtStep
        key={id}
        label={t.toolCalls.writeTodos}
        icon={ListTodoIcon}
      ></ChainOfThoughtStep>
    );
  } else {
    const description: string | undefined = (args as { description: string })
      ?.description;
    return (
      <ChainOfThoughtStep
        key={id}
        label={description ?? t.toolCalls.useTool(name)}
        icon={WrenchIcon}
      ></ChainOfThoughtStep>
    );
  }
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
