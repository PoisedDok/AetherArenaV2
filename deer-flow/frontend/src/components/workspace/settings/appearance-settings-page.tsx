"use client";

import { BookOpenIcon, CheckIcon, ChevronDownIcon, Loader2Icon, Volume2Icon, VolumeXIcon, ZapIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import { type LocalSettings, useLocalSettings } from "@/core/settings";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

type GlassPreset = LocalSettings["layout"]["glass_preset"];

function useDebouncedCallback<T extends (arg: string) => void>(fn: T, delay: number) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useMemo(() => {
    return (arg: string) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => fn(arg), delay);
    };
  }, [fn, delay]);
}

export function AppearanceSettingsPage() {
  const { t } = useI18n();
  const [localSettings, setLocalSettings, settingsReady] = useLocalSettings();

  // Local input state for immediate typing feedback
  const [displayNameInput, setDisplayNameInput] = useState(
    localSettings.profile.displayName,
  );
  const [saved, setSaved] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Sync local input only once when settings hydrate
  useEffect(() => {
    if (!initialized && settingsReady) {
      setDisplayNameInput(localSettings.profile.displayName);
      setInitialized(true);
    }
  }, [initialized, settingsReady, localSettings.profile.displayName]);

  // Debounced save to localSettings + localStorage
  const debouncedSave = useDebouncedCallback((value: string) => {
    setLocalSettings("profile", { displayName: value });
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }, 300);

  const onDisplayNameChange = (value: string) => {
    setDisplayNameInput(value);
    debouncedSave(value);
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t.settings.appearance.displayNameTitle}
        description={t.settings.appearance.displayNameDescription}
      >
        <div className="flex max-w-md items-center gap-2">
          <Input
            className="flex-1"
            value={displayNameInput}
            onChange={(e) => onDisplayNameChange(e.target.value)}
            placeholder={t.settings.appearance.displayNamePlaceholder}
            autoComplete="name"
            disabled={!settingsReady}
          />
          {saved && (
            <span className="text-muted-foreground flex items-center gap-1 text-sm">
              <CheckIcon className="size-4" />
              Saved
            </span>
          )}
        </div>
      </SettingsSection>

      <Separator />

      <SettingsSection
        title={t.settings.appearance.glassTitle}
        description={t.settings.appearance.glassDescription}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              {
                id: "subtle" as GlassPreset,
                label: t.settings.appearance.glassSubtle,
                description: t.settings.appearance.glassSubtleDescription,
                blurPx: 10,
              },
              {
                id: "medium" as GlassPreset,
                label: t.settings.appearance.glassMedium,
                description: t.settings.appearance.glassMediumDescription,
                blurPx: 28,
              },
              {
                id: "frosted" as GlassPreset,
                label: t.settings.appearance.glassFrosted,
                description: t.settings.appearance.glassFrostedDescription,
                blurPx: 64,
              },
              {
                id: "none" as GlassPreset,
                label: t.settings.appearance.glassNone,
                description: t.settings.appearance.glassNoneDescription,
                blurPx: 0,
              },
            ] as const
          ).map((preset) => (
            <GlassPresetCard
              key={preset.id}
              id={preset.id}
              label={preset.label}
              description={preset.description}
              blurPx={preset.blurPx}
              active={localSettings.layout.glass_preset === preset.id}
              onSelect={(v) => setLocalSettings("layout", { glass_preset: v })}
            />
          ))}
        </div>
      </SettingsSection>

      <Separator />

      <SettingsSection
        title={t.settings.appearance.autoFollowupTitle}
        description={t.settings.appearance.autoFollowupDescription}
      >
        <div className="flex max-w-md justify-start">
          <Switch
            checked={localSettings.behavior.auto_followup}
            onCheckedChange={(checked) =>
              setLocalSettings("behavior", { auto_followup: checked })
            }
          />
        </div>
      </SettingsSection>

      <Separator />

      <SettingsSection
        title={t.settings.appearance.autoMemoryTitle}
        description={t.settings.appearance.autoMemoryDescription}
      >
        <div className="flex max-w-md justify-start">
          <Switch
            checked={localSettings.behavior.auto_memory}
            onCheckedChange={(checked) =>
              setLocalSettings("behavior", { auto_memory: checked })
            }
          />
        </div>
      </SettingsSection>

      <Separator />

      <GuruSettingsSection
        localSettings={localSettings}
        setLocalSettings={setLocalSettings}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guru companion settings
// ---------------------------------------------------------------------------

type TestState = "idle" | "loading" | "ok" | "error";

function GuruSettingsSection({
  localSettings,
  setLocalSettings,
}: {
  localSettings: LocalSettings;
  setLocalSettings: (key: keyof LocalSettings, value: Partial<LocalSettings[keyof LocalSettings]>) => void;
}) {
  const { models } = useModels();
  const selectedModel = models.find((m) => m.name === localSettings.guru.model_name);
  const displayLabel = selectedModel
    ? (selectedModel.display_name ?? selectedModel.name)
    : "Auto (default)";

  const [testState, setTestState] = useState<TestState>("idle");
  const [testResult, setTestResult] = useState<string | null>(null);

  async function runTest() {
    setTestState("loading");
    setTestResult(null);
    try {
      const res = await fetch(`${getBackendBaseURL()}/api/guru/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          last_ai_text:
            "Here is a clean recursive solution using memoisation. The key insight is that each subproblem overlaps, so we cache results in a hash map to avoid recomputation.",
          system:
            "You are Guru, a test companion. React in 3-8 words, dry margin-note style. No emoji.",
          model_name: localSettings.guru.model_name ?? null,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        setTestResult(`Error ${res.status}: ${text.slice(0, 120)}`);
        setTestState("error");
        return;
      }
      const data = (await res.json()) as { reaction?: string };
      if (data.reaction) {
        setTestResult(data.reaction);
        setTestState("ok");
      } else {
        setTestResult("No reaction returned");
        setTestState("error");
      }
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : "Network error");
      setTestState("error");
    }
  }

  return (
    <SettingsSection
      title={
        <span className="flex items-center gap-2">
          <BookOpenIcon className="size-4" />
          Guru Companion
        </span>
      }
      description="Your ASCII companion that watches conversations and reacts. Powered by a small, fast model."
    >
      <div className="space-y-4 max-w-md">
        {/* Mute toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-sm font-medium flex items-center gap-1.5">
              {localSettings.guru.muted ? (
                <VolumeXIcon className="size-3.5 text-muted-foreground" />
              ) : (
                <Volume2Icon className="size-3.5" />
              )}
              Reactions
            </div>
            <p className="text-muted-foreground text-xs">
              Show Guru&apos;s speech bubble after each AI response
            </p>
          </div>
          <Switch
            checked={!localSettings.guru.muted}
            onCheckedChange={(checked) =>
              setLocalSettings("guru", { muted: !checked })
            }
          />
        </div>

        {/* Model selector + test button */}
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Reaction model</div>
          <p className="text-muted-foreground text-xs">
            The model used to generate Guru&apos;s reactions. A small fast model works best.
          </p>
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="flex-1 justify-between font-mono text-xs h-8"
                  disabled={models.length === 0}
                >
                  <span className="truncate">{displayLabel}</span>
                  <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-64 overflow-y-auto">
                <DropdownMenuItem
                  onSelect={() => setLocalSettings("guru", { model_name: null })}
                  className={cn("text-xs font-mono gap-2", !localSettings.guru.model_name && "text-primary")}
                >
                  {!localSettings.guru.model_name && <CheckIcon className="size-3" />}
                  <span className={localSettings.guru.model_name ? "pl-5" : ""}>Auto (default)</span>
                </DropdownMenuItem>
                {models.map((model) => {
                  const active = localSettings.guru.model_name === model.name;
                  return (
                    <DropdownMenuItem
                      key={model.name}
                      onSelect={() => setLocalSettings("guru", { model_name: model.name })}
                      className={cn("text-xs font-mono gap-2", active && "text-primary")}
                    >
                      {active ? (
                        <CheckIcon className="size-3 shrink-0" />
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{model.display_name ?? model.name}</span>
                        {model.description && (
                          <span className="text-muted-foreground text-[10px] truncate">{model.description}</span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs shrink-0"
              disabled={testState === "loading"}
              onClick={() => void runTest()}
            >
              {testState === "loading" ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <ZapIcon className="size-3" />
              )}
              Test
            </Button>
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={cn(
                "rounded-md border px-3 py-2 font-mono text-xs",
                testState === "ok"
                  ? "border-green-500/30 bg-green-500/10 text-green-400"
                  : "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              {testState === "ok" && (
                <span className="text-muted-foreground mr-1.5 font-sans">Guru says:</span>
              )}
              {testResult}
            </div>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

function GlassPresetCard({
  id,
  label,
  description,
  blurPx,
  active,
  onSelect,
}: {
  id: GlassPreset;
  label: string;
  description: string;
  blurPx: number;
  active: boolean;
  onSelect: (id: GlassPreset) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        "group flex h-full flex-col gap-3 rounded-lg border p-4 text-left transition-all",
        active
          ? "border-primary ring-primary/30 shadow-sm ring-2"
          : "hover:border-border hover:shadow-sm",
      )}
    >
      <div className="space-y-1">
        <div className="text-sm leading-none font-semibold">{label}</div>
        <p className="text-muted-foreground text-xs leading-snug">{description}</p>
      </div>
      {/* Visual preview: background bars + glass panel overlay */}
      <div className="relative h-14 w-full overflow-hidden rounded-md border bg-neutral-900">
        <div className="absolute inset-0 flex flex-col justify-center gap-1 px-2 py-2">
          <div className="h-1.5 w-4/5 rounded-full bg-white/10" />
          <div className="h-1.5 w-3/5 rounded-full bg-white/[0.08]" />
          <div className="h-1.5 w-2/5 rounded-full bg-white/[0.06]" />
        </div>
        {blurPx > 0 ? (
          <div
            className="absolute inset-x-2 bottom-2 top-3 rounded-md border border-white/10"
            style={{
              background: `rgba(255,255,255,${0.03 + blurPx * 0.0012})`,
              backdropFilter: `blur(${Math.round(blurPx * 0.22)}px) saturate(150%)`,
              WebkitBackdropFilter: `blur(${Math.round(blurPx * 0.22)}px) saturate(150%)`,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
            }}
          />
        ) : (
          <div className="absolute inset-x-2 bottom-2 top-3 rounded-md border border-white/10 bg-neutral-800" />
        )}
      </div>
    </button>
  );
}
