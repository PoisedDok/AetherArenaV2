"use client";

/**
 * CompactBoundary — visual divider rendered in the message list when compact
 * has summarized older messages into a new continuation thread.
 *
 * The backend seeds every compact thread with a HumanMessage whose content
 * starts with "[COMPACT_BOUNDARY] summarized=N trigger=T pre_tokens=X post_tokens=Y".
 * This component detects that marker and renders a clean, expandable divider.
 * It also reads the localStorage chain entry to show a parent-thread link.
 */

import { ArchiveIcon, ChevronDownIcon, ChevronUpIcon, HistoryIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";

import { getThreadParent } from "@/core/threads/chain";

const BOUNDARY_TAG = "[COMPACT_BOUNDARY]";

interface ParsedBoundary {
  summarizedCount: number;
  trigger: string;
  preTokens: number;
  postTokens: number;
}

export function isCompactBoundaryContent(content: unknown): boolean {
  return typeof content === "string" && content.startsWith(BOUNDARY_TAG);
}

function parseBoundary(content: string): ParsedBoundary {
  const result: ParsedBoundary = { summarizedCount: 0, trigger: "auto", preTokens: 0, postTokens: 0 };
  for (const token of content.split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq === -1) continue;
    const k = token.slice(0, eq);
    const v = token.slice(eq + 1);
    if (k === "summarized") result.summarizedCount = parseInt(v, 10) || 0;
    else if (k === "trigger") result.trigger = v;
    else if (k === "pre_tokens") result.preTokens = parseInt(v, 10) || 0;
    else if (k === "post_tokens") result.postTokens = parseInt(v, 10) || 0;
  }
  return result;
}

export function CompactBoundary({ content }: { content: string }) {
  const params = useParams<{ thread_id: string }>();
  const threadId = params?.thread_id;
  const chain = threadId ? getThreadParent(threadId) : null;

  const { summarizedCount, trigger, preTokens, postTokens } = parseBoundary(content);
  const saved = preTokens > 0 && postTokens > 0 ? preTokens - postTokens : 0;
  const method = chain?.method ?? "llm";
  const summary = chain?.summary ?? "";

  const [summaryExpanded, setSummaryExpanded] = useState(false);

  return (
    <div className="my-4 select-none">
      {/* Divider line */}
      <div className="relative flex items-center gap-3">
        <div className="bg-border h-px flex-1" />
        <div
          className={
            "text-muted-foreground flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors hover:border-border/80"
          }
          onClick={() => summary && setSummaryExpanded((v) => !v)}
          role={summary ? "button" : undefined}
          aria-expanded={summary ? summaryExpanded : undefined}
        >
          <ArchiveIcon className="size-3 shrink-0" />
          <span>
            {summarizedCount > 0 ? `${summarizedCount} messages compacted` : "Context compacted"}
            {trigger === "auto" ? " (auto)" : ""}
            {method === "sumy" ? " · fallback" : ""}
            {saved > 0 ? ` · saved ~${saved.toLocaleString()} tokens` : ""}
          </span>
          {summary && (
            summaryExpanded ? <ChevronUpIcon className="size-3" /> : <ChevronDownIcon className="size-3" />
          )}
        </div>
        <div className="bg-border h-px flex-1" />
      </div>

      {/* Expanded summary */}
      {summary && summaryExpanded && (
        <div className="mx-auto mt-3 max-w-2xl rounded-xl border border-border/50 bg-muted/40 px-4 py-3">
          <div className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
            <HistoryIcon className="size-3" />
            Previous conversation summary
          </div>
          <p className="text-muted-foreground whitespace-pre-wrap text-xs leading-relaxed">
            {summary}
          </p>
          {chain?.parent_id && (
            <a
              href={`/workspace/chats/${chain.parent_id}`}
              className="text-primary mt-2 inline-block text-[11px] hover:underline"
            >
              View full previous conversation →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
