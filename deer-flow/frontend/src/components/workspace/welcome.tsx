"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { renderSprite, spriteFrameCount } from "@/components/workspace/guru/guru-sprites";
import { getBackendBaseURL } from "@/core/config";
import { getGuru } from "@/core/guru/guru";
import type { Guru } from "@/core/guru/types";
import { RARITY_COLORS } from "@/core/guru/types";
import { useResolvedDisplayName } from "@/core/settings";
import { getLocalSettings } from "@/core/settings/local";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Sprite animation — much slower than the input widget, calm idle
// ---------------------------------------------------------------------------
const SPRITE_TICK_MS = 1200; // 1.2s per frame step — slow and meditative
const IDLE_SEQUENCE = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 2, 0, 0, 0, 0] as const;

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------
function getGreeting(hour: number, name: string): string {
  const base =
    hour >= 5 && hour < 12 ? "Good morning"
    : hour >= 12 && hour < 17 ? "Good afternoon"
    : hour >= 17 && hour < 21 ? "Good evening"
    : "Still awake";
  return name ? `${base}, ${name}.` : `${base}.`;
}

// ---------------------------------------------------------------------------
// Hardcoded fallback lines — time-aware, dry, Guru-voiced
// These rotate when the LLM is unavailable or hasn't responded yet
// ---------------------------------------------------------------------------
const FALLBACK_LINES: Record<"morning" | "afternoon" | "evening" | "night", string[]> = {
  morning: [
    "Early. Good sign.",
    "Morning sharpness is real. Use it.",
    "First thought, best thought.",
    "Coffee first, then clarity.",
    "The quiet before the noise.",
  ],
  afternoon: [
    "Momentum is yours to keep.",
    "Depth over speed, always.",
    "Mid-day. Don't drift.",
    "One clear problem at a time.",
    "The work continues.",
  ],
  evening: [
    "Evening focus is underrated.",
    "The good ideas come now.",
    "Quiet enough to hear yourself.",
    "End the day with intention.",
    "Late light, sharp mind.",
  ],
  night: [
    "Late. Bold choice.",
    "Nocturnal clarity is a thing.",
    "Night mind is different. Use it.",
    "The world is asleep. You're not.",
    "Careful. Tired logic lies.",
  ],
};

function getTimeKey(hour: number): keyof typeof FALLBACK_LINES {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

// ---------------------------------------------------------------------------
// LLM line fetcher — pings /api/guru/react every N cycles with a welcome prompt
// Returns null if unavailable; caller falls back to hardcoded lines
// ---------------------------------------------------------------------------
async function fetchGuruLine(guru: Guru): Promise<string | null> {
  const settings = getLocalSettings();
  const modelName = settings.guru.model_name ?? "lfm";

  const toneMap: Record<string, string> = {
    WISDOM: "wise and minimal",
    SNARK: "wry and dry",
    CHAOS: "unpredictable but brief",
    PATIENCE: "warm but sparse",
  };
  const topStat = Object.entries(guru.stats).sort((a, b) => b[1] - a[1])[0];
  const tone = topStat ? (toneMap[topStat[0]] ?? "quietly encouraging") : "quietly encouraging";

  const system =
    `You are ${guru.name}, a ${guru.species} companion greeting a returning user. ` +
    `Write ONE short welcome observation — 4 to 9 words max. No punctuation flourish. No emoji. ` +
    `Tone: ${tone}. Think margin note, not headline. ` +
    `Examples: "Back again." / "Ready when you are." / "What are we solving?" / "Pick up where you left off."`;

  try {
    const res = await fetch(`${getBackendBaseURL()}/api/guru/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        last_ai_text: "The user has returned to the workspace and is starting a new session.",
        system,
        model_name: modelName,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { reaction?: string };
    return data.reaction?.trim() ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Line pool — mixes hardcoded + LLM-fetched lines, replacing stale ones over time
// LLM fetch is attempted once every LLM_FETCH_EVERY cycles
// ---------------------------------------------------------------------------
const LLM_FETCH_EVERY = 3; // fetch a new LLM line every 3 cycles through the pool

function useLinePool(guru: Guru | null, hour: number) {
  const timeKey = getTimeKey(hour);
  const base = useMemo(() => {
    // Rotate starting point by session minute so each session feels different
    const offset = Math.floor(Date.now() / 60_000) % FALLBACK_LINES[timeKey].length;
    const arr = FALLBACK_LINES[timeKey];
    return [...arr.slice(offset), ...arr.slice(0, offset)];
  }, [timeKey]);

  const [pool, setPool] = useState<string[]>(base);
  const cycleCountRef = useRef(0);

  // Re-seed pool when time-of-day changes
  useEffect(() => {
    setPool(base);
  }, [base]);

  // After each full cycle, optionally splice in a fresh LLM line
  const advanceAndMaybeFetch = useMemo(() => {
    return async () => {
      cycleCountRef.current++;
      if (guru && cycleCountRef.current % LLM_FETCH_EVERY === 0) {
        const line = await fetchGuruLine(guru);
        if (line) {
          // Replace the next line in pool with the LLM line for freshness
          setPool((prev) => {
            const next = [...prev];
            next[0] = line;
            return next;
          });
        }
      }
    };
  }, [guru]);

  return { pool, advanceAndMaybeFetch };
}

// ---------------------------------------------------------------------------
// Typewriter — slow, calm, deliberate
// Types forward char by char, holds, types backward char by char, pauses
// ---------------------------------------------------------------------------
type Phase = "typing" | "holding" | "erasing" | "pausing";

// Slow and calm — feels premium, not jittery
const CHAR_TYPE_MS = 55;    // ms per char typed
const CHAR_ERASE_MS = 38;   // ms per char erased
const HOLD_MS = 5500;       // hold full text for 5.5s
const PAUSE_MS = 1100;      // blank gap between lines

function useTypewriter(pool: string[], onCycleComplete: () => Promise<void>) {
  const [displayed, setDisplayed] = useState("");
  const [phase, setPhase] = useState<Phase>("pausing");
  const idxRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poolRef = useRef(pool);

  useEffect(() => {
    poolRef.current = pool;
  }, [pool]);

  useEffect(() => {
    let cancelled = false;

    function schedule(fn: () => void, ms: number) {
      timerRef.current = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    }

    function runCycle() {
      const text = poolRef.current[idxRef.current % poolRef.current.length]!;
      let pos = 0;

      setDisplayed("");
      setPhase("typing");

      function typeStep() {
        pos++;
        setDisplayed(text.slice(0, pos));
        if (pos < text.length) {
          schedule(typeStep, CHAR_TYPE_MS);
        } else {
          setPhase("holding");
          schedule(eraseStep_init, HOLD_MS);
        }
      }

      function eraseStep_init() {
        setPhase("erasing");
        let len = text.length;

        function eraseStep() {
          len--;
          setDisplayed(text.slice(0, len));
          if (len > 0) {
            schedule(eraseStep, CHAR_ERASE_MS);
          } else {
            setPhase("pausing");
            // Advance index, then optionally fetch LLM line before next cycle
            idxRef.current = (idxRef.current + 1) % poolRef.current.length;
            void onCycleComplete().then(() => {
              schedule(runCycle, PAUSE_MS);
            });
          }
        }
        eraseStep();
      }

      schedule(typeStep, CHAR_TYPE_MS);
    }

    // Initial delay before first line — let the page settle
    timerRef.current = setTimeout(() => {
      if (!cancelled) runCycle();
    }, 1200);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { displayed, phase };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function Welcome({ className }: { className?: string }) {
  const displayName = useResolvedDisplayName();
  const [hour, setHour] = useState(() => new Date().getHours());
  const [tick, setTick] = useState(0);
  const [guru, setGuru] = useState<Guru | null>(null);

  useEffect(() => {
    const id = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), SPRITE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setGuru(getGuru());
    const handler = () => setGuru(getGuru());
    window.addEventListener("guru:updated", handler);
    return () => window.removeEventListener("guru:updated", handler);
  }, []);

  const greeting = useMemo(() => getGreeting(hour, displayName), [hour, displayName]);
  const { pool, advanceAndMaybeFetch } = useLinePool(guru, hour);
  const { displayed, phase } = useTypewriter(pool, advanceAndMaybeFetch);

  // Sprite animation — slow idle
  const frameCount = guru ? spriteFrameCount(guru.species) : 1;
  let spriteFrame = 0;
  let blink = false;
  if (guru) {
    const step = IDLE_SEQUENCE[tick % IDLE_SEQUENCE.length] ?? 0;
    if (step === -1) { blink = true; spriteFrame = 0; }
    else spriteFrame = step % frameCount;
  }

  const bodyLines = guru
    ? renderSprite(guru, spriteFrame).map((line) =>
        blink ? line.replaceAll(guru.eye, "-") : line,
      )
    : null;

  const rarityTextClass = guru
    ? (RARITY_COLORS[guru.rarity].split(" ").find((c) => c.startsWith("text")) ?? "text-muted-foreground")
    : "text-muted-foreground";

  // Gentle two-axis sway: slow vertical bob + subtle left-right drift
  // Uses different periods so the motion never feels mechanical
  const bobY = tick % 6 < 3 ? -1 : 0
  // Horizontal: -3px → 0 → +3px → 0 over 8 ticks (~9.6s cycle)
  const swayPattern = [-3, -2, -1, 0, 0, 1, 2, 3] as const
  const swayX = swayPattern[tick % swayPattern.length] ?? 0
  // Tiny tilt to match sway direction
  const tiltDeg = swayX * 0.8;

  // Cursor blink — only while typing or in pause gap
  const [cursorOn, setCursorOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setCursorOn((v) => !v), 600);
    return () => clearInterval(id);
  }, []);
  const showCursor = phase === "typing" || phase === "pausing";

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-2xl items-center justify-center gap-10 px-8 py-6",
        className,
      )}
    >
      {/* Guru ASCII sprite */}
      {bodyLines && (
        <div
          className="flex shrink-0 flex-col items-center select-none cursor-pointer"
          style={{ transform: `translateX(${swayX}px) translateY(${bobY}px) rotate(${tiltDeg}deg)`, transition: "transform 1200ms ease-in-out" }}
          onClick={() => window.dispatchEvent(new CustomEvent("guru:pet"))}
          title={`${guru?.name ?? "Guru"} — click to pet`}
        >
          {bodyLines.map((line, i) => (
            <pre
              key={i}
              className={cn("font-mono text-[13px] leading-[1.35] whitespace-pre", rarityTextClass)}
            >
              {line}
            </pre>
          ))}
          <span className={cn("mt-0.5 font-mono text-[9px] italic leading-none opacity-70", rarityTextClass)}>
            {guru?.name ?? "Guru"}
          </span>
        </div>
      )}

      {/* Text */}
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="font-mono text-lg font-semibold tracking-tight text-foreground/90">
          {greeting}
        </h1>
        <div className="flex items-baseline font-mono text-sm text-muted-foreground/65 min-h-[1.4em]">
          <span>{displayed}</span>
          <span
            className={cn(
              "ml-px inline-block w-[2px] h-[0.9em] bg-current transition-opacity duration-100",
              showCursor && cursorOn ? "opacity-70" : "opacity-0",
            )}
          />
        </div>
      </div>
    </div>
  );
}
