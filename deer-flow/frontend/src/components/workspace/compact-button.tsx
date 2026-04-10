"use client";

/**
 * CompactButton — Claude Code–style context ring with compact menu.
 *
 * Shows a thin circular arc (SVG) filled proportionally to % context used.
 * Color transitions: neutral → amber → orange → red as usage grows.
 * On click: dropdown with context stats + manual compact options.
 */

import type { Message } from "@langchain/langgraph-sdk";
import { ArchiveIcon, ChevronDownIcon, ScissorsIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { getBackendBaseURL } from "@/core/config";
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

// ── Token estimation (rough, client-side) ────────────────────────────────────

/** Estimate tokens from character count. ~4 chars/token on average. */
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
        if (typeof block === "string") {
          total += estimateTokens(block);
        } else if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
          total += estimateTokens(block.text);
        }
      }
    }
  }
  return total;
}

// Context windows for common models — must match backend auto_compact.py
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
  for (const [key, window] of Object.entries(KNOWN_CONTEXT_WINDOWS)) {
    if (lower.includes(key)) return window;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

// ── Arc ring SVG ──────────────────────────────────────────────────────────────

interface ContextRingProps {
  /** 0–1 fraction of context used */
  fraction: number;
  /** Size in px (width = height) */
  size?: number;
  /** Stroke width */
  strokeWidth?: number;
}

function ContextRing({ fraction, size = 18, strokeWidth = 2.5 }: ContextRingProps) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Arc starts at top (−90°) and goes clockwise
  const dashOffset = circumference * (1 - clamped);

  // Color: neutral below 60%, amber 60–80%, orange 80–90%, red 90%+
  const color =
    clamped >= 0.9
      ? "#ef4444" // red-500
      : clamped >= 0.8
        ? "#f97316" // orange-500
        : clamped >= 0.6
          ? "#f59e0b" // amber-500
          : "currentColor";

  const isHighUsage = clamped >= 0.8;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", isHighUsage && "drop-shadow-[0_0_4px_rgba(249,115,22,0.5)]")}
      aria-hidden="true"
    >
      {/* Track ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={strokeWidth}
      />
      {/* Filled arc */}
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
        // Start from top (12 o'clock)
        transform={`rotate(-90, ${size / 2}, ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.3s ease" }}
      />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface CompactButtonProps {
  threadId: string;
  messages: Message[];
  modelName: string | undefined;
  disabled?: boolean;
}

export function CompactButton({ threadId, messages, modelName, disabled }: CompactButtonProps) {
  const [isCompacting, setIsCompacting] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  const contextWindow = useMemo(() => getContextWindow(modelName), [modelName]);
  const tokenCount = useMemo(() => countMessageTokens(messages), [messages]);
  const fraction = useMemo(() => Math.min(1, tokenCount / contextWindow), [tokenCount, contextWindow]);

  const pct = Math.round(fraction * 100);
  const isWarning = fraction >= 0.6;
  const isHigh = fraction >= 0.8;
  const isCritical = fraction >= 0.9;

  const triggerCompact = useCallback(
    async (instructions?: string) => {
      if (isCompacting) return;
      setIsCompacting(true);
      try {
        const res = await fetch(`${getBackendBaseURL()}/api/threads/${threadId}/compact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ custom_instructions: instructions ?? undefined }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: "Compact failed" }));
          toast.error(err.detail ?? "Compact failed");
          return;
        }
        const data = (await res.json()) as { pre_tokens?: number; post_tokens?: number; summary?: string };
        const saved = (data.pre_tokens ?? 0) - (data.post_tokens ?? 0);
        toast.success(`Context compacted — saved ~${saved.toLocaleString()} tokens`);
        setShowCustomInput(false);
        setCustomInstructions("");
      } catch {
        toast.error("Compact request failed. Is the backend running?");
      } finally {
        setIsCompacting(false);
      }
    },
    [threadId, isCompacting],
  );

  const handleCompact = useCallback(() => triggerCompact(), [triggerCompact]);
  const handleCompactWithInstructions = useCallback(
    () => triggerCompact(customInstructions || undefined),
    [triggerCompact, customInstructions],
  );

  const ringColor =
    isCritical
      ? "text-red-500"
      : isHigh
        ? "text-orange-500"
        : isWarning
          ? "text-amber-500"
          : "text-muted-foreground";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || isCompacting}
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
        {/* Header: context stats */}
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

          {/* Progress bar */}
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isCritical ? "bg-red-500" : isHigh ? "bg-orange-500" : isWarning ? "bg-amber-500" : "bg-primary",
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
              <span className="font-medium">{isCompacting ? "Compacting…" : "Compact now"}</span>
              <span className="text-muted-foreground text-[11px]">Summarize older messages, keep recent ones</span>
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
                    void handleCompactWithInstructions();
                  }
                }}
              />
              <button
                type="button"
                className="bg-primary text-primary-foreground hover:bg-primary/90 mt-1 w-full rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50"
                disabled={isCompacting}
                onClick={() => void handleCompactWithInstructions()}
              >
                {isCompacting ? "Compacting…" : "Compact"}
              </button>
            </div>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
