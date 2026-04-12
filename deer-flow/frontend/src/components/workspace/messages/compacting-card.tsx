"use client";

/**
 * CompactingCard — rendered inside the MessageList while compact is in progress.
 *
 * Looks like an agent tool-call container: bordered card, live streaming text,
 * expandable/collapsible body, cancel button while streaming, token count on done.
 *
 * State machine mirrors CompactStreamState from CompactContext:
 *   starting  → spinner + "Compacting context…"
 *   streaming → spinner + live text in expandable body
 *   done      → green check + token savings + expandable summary
 *   error     → red X + error message
 *   cancelled → muted X + "Cancelled"
 */

import {
  ArchiveIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Loader2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useCompactContext } from "@/core/compact/context";
import { cn } from "@/lib/utils";

export function CompactingCard() {
  const { state, setState, abortRef } = useCompactContext();
  const [expanded, setExpanded] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const { status, streamedText, preTokens, postTokens, summarizedCount, errorMessage } = state;

  // Auto-scroll streaming text to bottom
  useEffect(() => {
    if (bodyRef.current && status === "streaming") {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [streamedText, status]);

  // Auto-collapse body when done so the user sees the token count immediately.
  useEffect(() => {
    if (status === "done") setExpanded(false);
  }, [status]);

  if (status === "idle") return null;

  const isActive = status === "starting" || status === "streaming" || status === "creating_thread";
  const isDone = status === "done";
  const isError = status === "error";
  const isCancelled = status === "cancelled";
  const hasText = streamedText.length > 0;
  const savedTokens = preTokens > 0 && postTokens > 0 ? preTokens - postTokens : 0;

  const handleCancel = () => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, status: "cancelled" }));
  };

  const handleDismiss = () => {
    setState((prev) => ({ ...prev, status: "idle" }));
  };

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-xl border transition-colors duration-200",
        isActive && "border-border/60 bg-muted/20",
        isDone && "border-green-500/30 bg-green-500/5",
        isError && "border-red-500/30 bg-red-500/5",
        isCancelled && "border-border/30 bg-muted/10",
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {/* Status icon */}
        {isActive && <Loader2Icon className="size-3.5 shrink-0 animate-spin text-blue-500" />}
        {isDone && <CheckCircleIcon className="size-3.5 shrink-0 text-green-500" />}
        {isError && <XCircleIcon className="size-3.5 shrink-0 text-red-500" />}
        {isCancelled && <XIcon className="size-3.5 shrink-0 text-muted-foreground" />}

        {/* Archive icon + label */}
        <ArchiveIcon className="size-3 shrink-0 text-muted-foreground" />
        <span className={cn("text-sm font-medium", isDone && "text-green-600 dark:text-green-400", isError && "text-red-500", isCancelled && "text-muted-foreground")}>
          {status === "starting" && "Compacting context…"}
          {status === "streaming" && "Compacting context…"}
          {status === "creating_thread" && "Finalising compact…"}
          {isDone && "Context compacted — opening new thread…"}
          {isError && "Compact failed"}
          {isCancelled && "Compact cancelled"}
        </span>

        {/* Token savings badge (done only) */}
        {isDone && preTokens > 0 && (
          <span className="ml-1 text-xs text-muted-foreground tabular-nums">
            {preTokens.toLocaleString()} → {postTokens.toLocaleString()} tokens
            {savedTokens > 0 && (
              <span className="ml-1 font-medium text-green-600 dark:text-green-400">
                (−{savedTokens.toLocaleString()} saved)
              </span>
            )}
          </span>
        )}

        {/* Summarised count */}
        {isDone && summarizedCount > 0 && (
          <span className="ml-1 text-xs text-muted-foreground">
            · {summarizedCount} messages removed
          </span>
        )}

        {/* Right-side controls */}
        <div className="ml-auto flex items-center gap-0.5">
          {/* Expand/collapse toggle (when there is body text) */}
          {hasText && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
            </button>
          )}

          {/* Cancel button while streaming */}
          {isActive && (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-red-400"
              title="Cancel compact"
              aria-label="Cancel compact"
            >
              <XIcon className="size-3.5" />
            </button>
          )}

          {/* Dismiss button for done, error, or cancelled */}
          {(isDone || isError || isCancelled) && (
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Dismiss"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Streaming / summary body ── */}
      {expanded && hasText && (
        <div className="border-t border-border/30">
          <div
            ref={bodyRef}
            className="max-h-56 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {streamedText}
            {isActive && <span className="animate-pulse">▋</span>}
          </div>
        </div>
      )}

      {/* ── Error message body ── */}
      {isError && errorMessage && (
        <div className="border-t border-red-500/20 px-3 py-2 text-xs text-red-500">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
