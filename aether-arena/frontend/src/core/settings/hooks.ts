import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_LOCAL_SETTINGS,
  getLocalSettings,
  saveLocalSettings,
  subscribeToSettingsChanges,
  type LocalSettings,
} from "./local";

export function useLocalSettings(): [
  LocalSettings,
  (
    key: keyof LocalSettings,
    value: Partial<LocalSettings[keyof LocalSettings]>,
  ) => void,
  /** Whether settings have been hydrated from localStorage */
  boolean,
] {
  const [state, setState] = useState<LocalSettings>(DEFAULT_LOCAL_SETTINGS);
  const [ready, setReady] = useState(false);
  const pendingRef = useRef<Partial<LocalSettings> | null>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const saved = getLocalSettings();
    setState((prev) => ({ ...prev, ...saved }));
    setReady(true);
  }, []);

  // Subscribe to changes from other components
  useEffect(() => {
    if (!ready) return;
    return subscribeToSettingsChanges((newSettings) => {
      setState(newSettings);
    });
  }, [ready]);

  // If a change was attempted before hydration, apply it after hydration
  useEffect(() => {
    if (ready && pendingRef.current) {
      setState((prev) => {
        const patched = { ...prev, ...pendingRef.current };
        saveLocalSettings(patched);
        return patched;
      });
      pendingRef.current = null;
    }
  }, [ready]);

  const setter = useCallback(
    (
      key: keyof LocalSettings,
      value: Partial<LocalSettings[keyof LocalSettings]>,
    ) => {
      if (!ready) {
        // Queue the change to apply after hydration
        pendingRef.current = { ...pendingRef.current, [key]: value };
        return;
      }
      setState((prev) => {
        const prevSection = prev[key] as Record<string, unknown>;
        const hasChanges = Object.entries(value).some(
          ([k, v]) => prevSection[k] !== v,
        );
        if (!hasChanges) return prev;
        const newState = {
          ...prev,
          [key]: {
            ...prevSection,
            ...value,
          },
        };
        saveLocalSettings(newState);
        return newState;
      });
    },
    [ready],
  );

  return [state, setter, ready];
}
