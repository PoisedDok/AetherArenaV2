"use client";

import { CheckIcon, MonitorSmartphoneIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from "react";

import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
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
  const { theme, setTheme, systemTheme } = useTheme();
  const [localSettings, setLocalSettings, settingsReady] = useLocalSettings();
  const currentTheme = (theme ?? "system") as "system" | "light" | "dark";

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

  const themeOptions = useMemo(
    () => [
      {
        id: "system",
        label: t.settings.appearance.system,
        description: t.settings.appearance.systemDescription,
        icon: MonitorSmartphoneIcon,
      },
      {
        id: "light",
        label: t.settings.appearance.light,
        description: t.settings.appearance.lightDescription,
        icon: SunIcon,
      },
      {
        id: "dark",
        label: t.settings.appearance.dark,
        description: t.settings.appearance.darkDescription,
        icon: MoonIcon,
      },
    ],
    [
      t.settings.appearance.dark,
      t.settings.appearance.darkDescription,
      t.settings.appearance.light,
      t.settings.appearance.lightDescription,
      t.settings.appearance.system,
      t.settings.appearance.systemDescription,
    ],
  );

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
        title={t.settings.appearance.themeTitle}
        description={t.settings.appearance.themeDescription}
      >
        <div className="grid gap-3 lg:grid-cols-3">
          {themeOptions.map((option) => (
            <ThemePreviewCard
              key={option.id}
              icon={option.icon}
              label={option.label}
              description={option.description}
              active={currentTheme === option.id}
              mode={option.id as "system" | "light" | "dark"}
              systemTheme={systemTheme}
              onSelect={(value) => setTheme(value)}
            />
          ))}
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
    </div>
  );
}

function ThemePreviewCard({
  icon: Icon,
  label,
  description,
  active,
  mode,
  systemTheme,
  onSelect,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  description: string;
  active: boolean;
  mode: "system" | "light" | "dark";
  systemTheme?: string;
  onSelect: (mode: "system" | "light" | "dark") => void;
}) {
  const previewMode =
    mode === "system" ? (systemTheme === "dark" ? "dark" : "light") : mode;
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      className={cn(
        "group flex h-full flex-col gap-3 rounded-lg border p-4 text-left transition-all",
        active
          ? "border-primary ring-primary/30 shadow-sm ring-2"
          : "hover:border-border hover:shadow-sm",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="bg-muted rounded-md p-2">
          <Icon className="size-4" />
        </div>
        <div className="space-y-1">
          <div className="text-sm leading-none font-semibold">{label}</div>
          <p className="text-muted-foreground text-xs leading-snug">
            {description}
          </p>
        </div>
      </div>
      <div
        className={cn(
          "relative overflow-hidden rounded-md border text-xs transition-colors",
          previewMode === "dark"
            ? "border-neutral-800 bg-neutral-900 text-neutral-200"
            : "border-slate-200 bg-white text-slate-900",
        )}
      >
        <div className="border-border/50 flex items-center gap-2 border-b px-3 py-2">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              previewMode === "dark" ? "bg-emerald-400" : "bg-emerald-500",
            )}
          />
          <div className="h-2 w-10 rounded-full bg-current/20" />
          <div className="h-2 w-6 rounded-full bg-current/15" />
        </div>
        <div className="grid grid-cols-[1fr_240px] gap-3 px-3 py-3">
          <div className="space-y-2">
            <div className="h-3 w-3/4 rounded-full bg-current/15" />
            <div className="h-3 w-1/2 rounded-full bg-current/10" />
            <div className="h-[90px] rounded-md border border-current/10 bg-current/5" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-md bg-current/10" />
              <div className="space-y-2">
                <div className="h-2 w-14 rounded-full bg-current/15" />
                <div className="h-2 w-10 rounded-full bg-current/10" />
              </div>
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-dashed border-current/15 p-2">
              <div className="h-2 w-3/5 rounded-full bg-current/15" />
              <div className="h-2 w-2/5 rounded-full bg-current/10" />
            </div>
          </div>
        </div>
      </div>
    </button>
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
