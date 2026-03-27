"use client";

import { useEffect, useMemo, useState } from "react";

import { useI18n } from "@/core/i18n/hooks";

import { useLocalSettings } from "./hooks";

export function useResolvedDisplayName(): string {
  const { t } = useI18n();
  const [settings] = useLocalSettings();
  const [systemName, setSystemName] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.deerflowDesktop;
    if (!bridge?.getSystemUserName) {
      return;
    }
    try {
      const name = bridge.getSystemUserName()?.trim();
      if (name) {
        setSystemName(name);
      }
    } catch {
      /* bridge must never break the UI */
    }
  }, []);

  return useMemo(() => {
    const custom = settings.profile.displayName.trim();
    if (custom) {
      return custom;
    }
    if (systemName) {
      return systemName;
    }
    return t.workspace.defaultDisplayName;
  }, [settings.profile.displayName, systemName, t.workspace.defaultDisplayName]);
}

export function displayNameInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "?";
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]?.[0];
    const b = parts[1]?.[0];
    if (a && b) {
      return (a + b).toUpperCase();
    }
  }
  if (trimmed.length >= 2) {
    return trimmed.slice(0, 2).toUpperCase();
  }
  return trimmed[0]!.toUpperCase();
}
