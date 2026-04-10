"use client";

/**
 * CompactBoundary — renders a visual divider in the message list when
 * auto-compact or manual compact has summarized earlier messages.
 *
 * The backend inserts a HumanMessage whose content starts with
 * "[COMPACT_BOUNDARY] summarized=N trigger=auto pre_tokens=X post_tokens=Y"
 * This component parses that marker and renders a clean divider.
 */

import { ArchiveIcon } from "lucide-react";

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
  const { summarizedCount, trigger, preTokens, postTokens } = parseBoundary(content);
  const saved = preTokens > 0 && postTokens > 0 ? preTokens - postTokens : 0;

  return (
    <div className="relative my-2 flex items-center gap-3 py-1 select-none">
      <div className="bg-border h-px flex-1" />
      <div className="text-muted-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium">
        <ArchiveIcon className="size-3 shrink-0" />
        <span>
          {summarizedCount > 0 ? `${summarizedCount} messages summarized` : "Context compacted"}
          {trigger === "auto" ? " (auto)" : ""}
          {saved > 0 ? ` — saved ~${saved.toLocaleString()} tokens` : ""}
        </span>
      </div>
      <div className="bg-border h-px flex-1" />
    </div>
  );
}
