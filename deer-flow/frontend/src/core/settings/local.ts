import type { AgentThreadContext } from "../threads";

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  profile: {
    displayName: "",
  },
  notification: {
    enabled: true,
  },
  context: {
    model_name: undefined,
    vision_model_name: undefined,
    mode: undefined,
    reasoning_effort: undefined,
  },
  layout: {
    sidebar_collapsed: true,
    glass_preset: "subtle",
  },
  behavior: {
    auto_followup: true,
    auto_memory: true,
  },
};

const LOCAL_SETTINGS_KEY = "deerflow.local-settings";
const SETTINGS_CHANGE_EVENT = "deerflow:settings-change";

export interface LocalSettings {
  profile: {
    /** When non-empty, shown in the sidebar instead of the device account name. */
    displayName: string;
  };
  notification: {
    enabled: boolean;
  };
  context: Omit<
    AgentThreadContext,
    "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
  > & {
    mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
    reasoning_effort?: "minimal" | "low" | "medium" | "high";
  };
  layout: {
    sidebar_collapsed: boolean;
    glass_preset: "subtle" | "medium" | "frosted" | "none";
  };
  behavior: {
    auto_followup: boolean;
    /** When false, skip background memory update LLM calls for this client. */
    auto_memory: boolean;
  };
}

export function getLocalSettings(): LocalSettings {
  if (typeof window === "undefined") {
    return DEFAULT_LOCAL_SETTINGS;
  }
  const json = localStorage.getItem(LOCAL_SETTINGS_KEY);
  try {
    if (json) {
      const settings = JSON.parse(json);
      const mergedSettings = {
        ...DEFAULT_LOCAL_SETTINGS,
        profile: {
          ...DEFAULT_LOCAL_SETTINGS.profile,
          ...(settings.profile ?? {}),
        },
        context: {
          ...DEFAULT_LOCAL_SETTINGS.context,
          ...settings.context,
        },
        layout: {
          ...DEFAULT_LOCAL_SETTINGS.layout,
          ...settings.layout,
        },
        notification: {
          ...DEFAULT_LOCAL_SETTINGS.notification,
          ...settings.notification,
        },
        behavior: {
          ...DEFAULT_LOCAL_SETTINGS.behavior,
          ...(settings.behavior ?? {}),
        },
      };
      return mergedSettings;
    }
  } catch {}
  return DEFAULT_LOCAL_SETTINGS;
}

export function saveLocalSettings(settings: LocalSettings) {
  localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
  // Notify other components in the same tab (deferred to avoid setState during render)
  if (typeof window !== "undefined") {
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_CHANGE_EVENT, { detail: settings }),
      );
    }, 0);
  }
}

export function subscribeToSettingsChanges(
  callback: (settings: LocalSettings) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const handler = (e: Event) => {
    const settings = (e as CustomEvent<LocalSettings>).detail;
    callback(settings);
  };
  window.addEventListener(SETTINGS_CHANGE_EVENT, handler);
  return () => window.removeEventListener(SETTINGS_CHANGE_EVENT, handler);
}
