"use client";

/**
 * CompactButton — context-usage ring + compact dropdown.
 *
 * Clicking "Compact now" or "Compact with instructions":
 *  1. Updates CompactContext state → CompactingCard appears in the message list.
 *  2. Opens an SSE stream to POST /api/threads/{id}/compact/stream.
 *  3. Tokens from the LLM are streamed into CompactContext.streamedText.
 *  4. On "done" event: CompactingCard shows token savings and auto-dismisses
 *     after router.refresh() pulls the updated thread state (compact boundary
 *     now sits at the top of the same thread — no navigation required).
 *  5. On "error" or abort: CompactingCard shows the error.
 *
 * Any message typed while compact is in progress is handled by the existing
 * queue system (sendInFlightRef gate in hooks.ts).
 */

import type { Message } from "@langchain/langgraph-sdk";
import { ArchiveIcon, ScissorsIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useCompactContext } from "@/core/compact/context";
import { getBackendBaseURL } from "@/core/config";
import { setThreadParent } from "@/core/threads/chain";
import { cn } from "@/lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

// ── Token estimation ──────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function countMessageTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    const content = msg.content;
    if (typeof content === "string") {
      total += estimateTokens(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === "string") total += estimateTokens(block);
        else if (block && typeof block === "object" && "text" in block && typeof block.text === "string")
          total += estimateTokens(block.text);
      }
    }
  }
  return total;
}

const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-3.5-turbo": 16_385,
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,
  "claude-3-opus": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-opus-4": 200_000,
  "claude-haiku-4": 200_000,
  "gemini-1.5-pro": 1_000_000,
  "gemini-1.5-flash": 1_000_000,
  "gemini-2.0-flash": 1_000_000,
  "deepseek-chat": 64_000,
  "deepseek-reasoner": 64_000,
};
const DEFAULT_CONTEXT_WINDOW = 32_000;

function getContextWindow(modelName: string | undefined): number {
  if (!modelName) return DEFAULT_CONTEXT_WINDOW;
  const lower = modelName.toLowerCase();
  for (const [key, win] of Object.entries(KNOWN_CONTEXT_WINDOWS)) {
    if (lower.includes(key)) return win;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

// ── Arc ring SVG ──────────────────────────────────────────────────────────────

function ContextRing({
  fraction,
  size = 18,
  strokeWidth = 2.5,
}: {
  fraction: number;
  size?: number;
  strokeWidth?: number;
}) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped);
  const color =
    clamped >= 0.9
      ? "#ef4444"
      : clamped >= 0.8
        ? "#f97316"
        : clamped >= 0.6
          ? "#f59e0b"
          : "currentColor";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", clamped >= 0.8 && "drop-shadow-[0_0_4px_rgba(249,115,22,0.5)]")}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeOpacity={clamped === 0 ? 0 : 1}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90, ${size / 2}, ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.3s ease" }}
      />
    </svg>
  );
}

// ── SSE event shapes from /compact/stream ─────────────────────────────────────

interface CompactSSEEvent {
  type: "start" | "token" | "done" | "error";
  text?: string;
  pre_tokens?: number;
  post_tokens?: number;
  summarized_count?: number;
  message_count?: number;
  summary?: string;
  method?: string;
  message?: string;
  /** New thread created by the backend to hold the compact state. Frontend navigates here. */
  new_thread_id?: string;
}

// ── Main component ────────────────────────────────────────────────────────────

export interface CompactButtonProps {
  threadId: string;
  messages: Message[];
  modelName: string | undefined;
  disabled?: boolean;
}

export function CompactButton({ threadId, messages, modelName, disabled }: CompactButtonProps) {
  const { state, setState, abortRef } = useCompactContext();
  const router = useRouter();
  const [customInstructions, setCustomInstructions] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const contextWindow = useMemo(() => getContextWindow(modelName), [modelName]);
  const tokenCount = useMemo(() => countMessageTokens(messages), [messages]);
  const fraction = useMemo(() => Math.min(1, tokenCount / contextWindow), [tokenCount, contextWindow]);

  const pct = Math.round(fraction * 100);
  const isWarning = fraction >= 0.6;
  const isHigh = fraction >= 0.8;
  const isCritical = fraction >= 0.9;
  const isCompacting = state.status !== "idle";

  const triggerCompact = useCallback(
    async (instructions?: string) => {
      if (isCompacting) return;
      setDropdownOpen(false);

      const abort = new AbortController();
      abortRef.current = abort;

      setState({
        status: "starting",
        streamedText: "",
        preTokens: 0,
        postTokens: 0,
        summarizedCount: 0,
        method: "llm",
        errorMessage: null,
      });

      console.log(`[compact] triggerCompact: threadId=${threadId} modelName=${modelName ?? "auto"} instructions=${instructions ?? "none"}`);
      try {
        const res = await fetch(`${getBackendBaseURL()}/api/threads/${threadId}/compact/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model_name: modelName ?? undefined,
            custom_instructions: instructions ?? undefined,
          }),
          signal: abort.signal,
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          setState((prev) => ({ ...prev, status: "error", errorMessage: errText }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (!payload) continue;

            let event: CompactSSEEvent;
            try {
              event = JSON.parse(payload) as CompactSSEEvent;
            } catch {
              continue;
            }

            if (event.type === "start") {
              console.log(`[compact] started — pre_tokens=${event.pre_tokens ?? 0} summarized_count=${event.summarized_count ?? 0}`);
              setState((prev) => ({
                ...prev,
                status: "streaming",
                preTokens: event.pre_tokens ?? 0,
                summarizedCount: event.summarized_count ?? 0,
              }));
            } else if (event.type === "token") {
              setState((prev) => ({
                ...prev,
                streamedText: prev.streamedText + (event.text ?? ""),
              }));
            } else if (event.type === "done") {
              const newThreadId = event.new_thread_id;
              console.log(`[compact] stream done — post_tokens=${event.post_tokens ?? 0} summarized_count=${event.summarized_count ?? 0} method=${event.method ?? "llm"} summary_length=${(event.summary ?? "").length} new_thread_id=${newThreadId ?? "none"}`);

              // Persist the compact chain entry so CompactBoundary can show the
              // summary and parent link on the new thread.
              if (newThreadId) {
                setThreadParent(newThreadId, {
                  parent_id: threadId,
                  summary: event.summary ?? "",
                  method: event.method ?? "llm",
                  pre_tokens: event.pre_tokens ?? 0,
                  post_tokens: event.post_tokens ?? 0,
                  summarized_count: event.summarized_count ?? 0,
                  compacted_at: new Date().toISOString(),
                });
              }

              setState((prev) => ({
                ...prev,
                status: "done",
                postTokens: event.post_tokens ?? 0,
                summarizedCount: event.summarized_count ?? prev.summarizedCount,
                method: event.method ?? "llm",
              }));
              setShowCustomInput(false);
              setCustomInstructions("");

              // Navigate to the new thread after a brief pause so the user sees
              // the "Context compacted" card before being redirected.
              if (newThreadId) {
                setTimeout(() => {
                  console.log("[compact] navigating to new thread:", newThreadId);
                  router.push(`/workspace/chats/${newThreadId}`);
                }, 1200);
              }
            } else if (event.type === "error") {
              console.error("[compact] stream error:", event.message);
              setState((prev) => ({
                ...prev,
                status: "error",
                errorMessage: event.message ?? "Compact failed.",
              }));
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Already set to "cancelled" by the cancel button handler
        } else {
          setState((prev) => ({
            ...prev,
            status: "error",
            errorMessage: err instanceof Error ? err.message : "Compact request failed.",
          }));
        }
      }
    },
    [isCompacting, modelName, threadId, setState, abortRef, router],
  );

  const handleCompact = useCallback(() => void triggerCompact(), [triggerCompact]);
  const handleCompactWithInstructions = useCallback(
    () => void triggerCompact(customInstructions || undefined),
    [triggerCompact, customInstructions],
  );

  const ringColor = isCritical
    ? "text-red-500"
    : isHigh
      ? "text-orange-500"
      : isWarning
        ? "text-amber-500"
        : "text-muted-foreground";

  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled ?? isCompacting}
          className={cn(
            "focus-visible:ring-ring inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs transition-colors",
            "hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:outline-none",
            "disabled:pointer-events-none disabled:opacity-50",
            ringColor,
          )}
          aria-label={`Context usage: ${pct}%. Click to compact.`}
          title={`Context: ~${tokenCount.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${pct}%)`}
        >
          <ContextRing fraction={fraction} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-foreground text-sm font-semibold">Context Usage</span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-xs font-mono font-medium",
                isCritical
                  ? "bg-red-500/15 text-red-500"
                  : isHigh
                    ? "bg-orange-500/15 text-orange-500"
                    : isWarning
                      ? "bg-amber-500/15 text-amber-500"
                      : "bg-muted text-muted-foreground",
              )}
            >
              {pct}%
            </span>
          </div>

          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isCritical
                  ? "bg-red-500"
                  : isHigh
                    ? "bg-orange-500"
                    : isWarning
                      ? "bg-amber-500"
                      : "bg-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="text-muted-foreground flex justify-between text-[11px] font-normal">
            <span>~{tokenCount.toLocaleString()} tokens used</span>
            <span>{contextWindow.toLocaleString()} limit</span>
          </div>

          {isCritical && (
            <div className="mt-1 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-500">
              Context nearly full — compact now to continue.
            </div>
          )}
          {isHigh && !isCritical && (
            <div className="mt-1 rounded-md bg-orange-500/10 px-2 py-1.5 text-[11px] text-orange-500">
              Context is filling up. Consider compacting soon.
            </div>
          )}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onSelect={handleCompact}
            disabled={isCompacting || messages.length < 4}
          >
            <ScissorsIcon className="size-4 shrink-0" />
            <div className="flex flex-col">
              <span className="font-medium">Compact now</span>
              <span className="text-muted-foreground text-[11px]">
                Summarise older messages, continue in same session
              </span>
            </div>
          </DropdownMenuItem>

          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onSelect={(e) => {
              e.preventDefault();
              setShowCustomInput((v) => !v);
            }}
            disabled={isCompacting || messages.length < 4}
          >
            <ArchiveIcon className="size-4 shrink-0" />
            <div className="flex flex-col">
              <span className="font-medium">Compact with instructions</span>
              <span className="text-muted-foreground text-[11px]">Guide what to focus on in the summary</span>
            </div>
          </DropdownMenuItem>

          {showCustomInput && (
            <div className="px-2 pb-1">
              <textarea
                autoFocus
                className="bg-muted focus:ring-ring w-full resize-none rounded-md px-2 py-1.5 text-xs focus:ring-1 focus:outline-none"
                rows={2}
                placeholder="e.g. focus on code changes, ignore setup steps…"
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleCompactWithInstructions();
                  }
                }}
              />
              <button
                type="button"
                className="bg-primary text-primary-foreground hover:bg-primary/90 mt-1 w-full rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50"
                disabled={isCompacting}
                onClick={handleCompactWithInstructions}
              >
                Compact
              </button>
            </div>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
