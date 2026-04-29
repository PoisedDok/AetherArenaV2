"use client";

import { CheckIcon, ChevronDownIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import { useDeleteMemoryFact, useMemory, useMemoryConfig, useUpdateMemoryFact, useUpdateMemoryModelName, useUpdateMemorySection } from "@/core/memory/hooks";
import type { UserMemory } from "@/core/memory/types";
import { useModels } from "@/core/models/hooks";
import { pathOfThread } from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

// ── Section edit component ────────────────────────────────────────────────────

interface SectionRowProps {
  label: string;
  sectionKey: string;
  summary: string;
  updatedAt: string;
}

function SectionRow({ label, sectionKey, summary, updatedAt }: SectionRowProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary);
  const { mutate: updateSection, isPending } = useUpdateMemorySection();

  function handleSave() {
    updateSection(
      { section: sectionKey, summary: draft },
      {
        onSuccess: () => {
          toast.success(t.settings.memory.sectionUpdatedSuccess);
          setEditing(false);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }

  function handleCancel() {
    setDraft(summary);
    setEditing(false);
  }

  return (
    <div className="group space-y-1.5 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <div className="flex items-center gap-1">
          {updatedAt && (
            <span className="text-[10px] text-muted-foreground/60">
              {formatTimeAgo(updatedAt)}
            </span>
          )}
          {!editing && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => { setDraft(summary); setEditing(true); }}
            >
              <PencilIcon className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[80px] resize-none text-sm"
            autoFocus
          />
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isPending}>
              <XIcon className="mr-1 size-3" />
              {t.common.cancel}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isPending}>
              <CheckIcon className="mr-1 size-3" />
              {t.settings.memory.saveChanges}
            </Button>
          </div>
        </div>
      ) : (
        <p className={cn("text-sm leading-relaxed", !summary && "text-muted-foreground/50 italic")}>
          {summary || "—"}
        </p>
      )}
    </div>
  );
}

// ── Fact row ──────────────────────────────────────────────────────────────────

interface FactRowProps {
  fact: UserMemory["facts"][number];
}

function FactRow({ fact }: FactRowProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.content);
  const { mutate: deleteFact, isPending: isDeleting } = useDeleteMemoryFact();
  const { mutate: updateFact, isPending: isUpdating } = useUpdateMemoryFact();

  function handleDelete() {
    deleteFact(fact.id, {
      onSuccess: () => toast.success(t.settings.memory.factDeletedSuccess),
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    });
  }

  function handleSave() {
    updateFact(
      { factId: fact.id, content: draft },
      {
        onSuccess: () => {
          toast.success(t.settings.memory.factUpdatedSuccess);
          setEditing(false);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }

  function handleCancel() {
    setDraft(fact.content);
    setEditing(false);
  }

  const confidencePct = Math.round(fact.confidence * 100);

  return (
    <div className="group flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-accent/30">
      <div className="mt-0.5 flex-1 min-w-0 space-y-1">
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[60px] resize-none text-sm"
              autoFocus
            />
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isUpdating}>
                <XIcon className="mr-1 size-3" />
                {t.common.cancel}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isUpdating}>
                <CheckIcon className="mr-1 size-3" />
                {t.settings.memory.saveChanges}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm leading-relaxed">{fact.content}</p>
        )}

        {!editing && (
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground/60">
            <span className="rounded-full border px-1.5 py-0.5 capitalize">{fact.category}</span>
            <span>{confidencePct}% confidence</span>
            {fact.source && (
              <a
                href={pathOfThread(fact.source)}
                className="hover:text-foreground underline underline-offset-2 transition-colors"
              >
                {t.settings.memory.markdown.table.view}
              </a>
            )}
            {fact.createdAt && <span>{formatTimeAgo(fact.createdAt)}</span>}
          </div>
        )}
      </div>

      {!editing && (
        <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => { setDraft(fact.content); setEditing(true); }}
          >
            <PencilIcon className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            <Trash2Icon className="size-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Context group ─────────────────────────────────────────────────────────────

interface SectionGroupProps {
  title: string;
  sections: { label: string; key: string; summary: string; updatedAt: string }[];
}

function SectionGroup({ title, sections }: SectionGroupProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="space-y-2">
        {sections.map((s) => (
          <SectionRow
            key={s.key}
            label={s.label}
            sectionKey={s.key}
            summary={s.summary}
            updatedAt={s.updatedAt}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function MemorySettingsPage() {
  const { t } = useI18n();
  const { memory, isLoading, error } = useMemory();
  const { config: memoryConfig, isLoading: configLoading } = useMemoryConfig();
  const { models } = useModels();
  const { mutate: updateModelName, isPending: savingModel } = useUpdateMemoryModelName();

  const selectedModel = models.find((m) => m.name === memoryConfig?.model_name);
  const displayLabel = selectedModel
    ? (selectedModel.display_name ?? selectedModel.name)
    : "Auto (default)";

  if (isLoading || configLoading) {
    return (
      <SettingsSection title={t.settings.memory.title} description={t.settings.memory.description}>
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      </SettingsSection>
    );
  }

  if (error) {
    return (
      <SettingsSection title={t.settings.memory.title} description={t.settings.memory.description}>
        <div className="text-destructive text-sm">Error: {error.message}</div>
      </SettingsSection>
    );
  }

  if (!memory) {
    return (
      <SettingsSection title={t.settings.memory.title} description={t.settings.memory.description}>
        <div className="text-muted-foreground text-sm">{t.settings.memory.empty}</div>
      </SettingsSection>
    );
  }

  const userSections = [
    { label: t.settings.memory.markdown.work, key: "user.workContext", summary: memory.user.workContext.summary, updatedAt: memory.user.workContext.updatedAt },
    { label: t.settings.memory.markdown.personal, key: "user.personalContext", summary: memory.user.personalContext.summary, updatedAt: memory.user.personalContext.updatedAt },
    { label: t.settings.memory.markdown.topOfMind, key: "user.topOfMind", summary: memory.user.topOfMind.summary, updatedAt: memory.user.topOfMind.updatedAt },
  ];

  const historySections = [
    { label: t.settings.memory.markdown.recentMonths, key: "history.recentMonths", summary: memory.history.recentMonths.summary, updatedAt: memory.history.recentMonths.updatedAt },
    { label: t.settings.memory.markdown.earlierContext, key: "history.earlierContext", summary: memory.history.earlierContext.summary, updatedAt: memory.history.earlierContext.updatedAt },
    { label: t.settings.memory.markdown.longTermBackground, key: "history.longTermBackground", summary: memory.history.longTermBackground.summary, updatedAt: memory.history.longTermBackground.updatedAt },
  ];

  return (
    <SettingsSection title={t.settings.memory.title} description={t.settings.memory.description}>
      <div className="space-y-6">

        {/* Model selector */}
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Model</div>
          <p className="text-muted-foreground text-xs">
            The model used to analyze conversations and extract memories.
          </p>
          <div className="flex max-w-md">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between font-mono text-xs"
                  disabled={models.length === 0}
                >
                  <span className="truncate">{displayLabel}</span>
                  <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-64 overflow-y-auto">
                <DropdownMenuItem
                  onSelect={() => updateModelName(null, { onSuccess: () => toast.success(t.settings.memory.saveChanges) })}
                  className={cn("text-xs font-mono gap-2", !memoryConfig?.model_name && "text-primary")}
                >
                  {!memoryConfig?.model_name && <CheckIcon className="size-3" />}
                  <span className={memoryConfig?.model_name ? "pl-5" : ""}>Auto (default)</span>
                </DropdownMenuItem>
                {models.map((model) => {
                  const active = memoryConfig?.model_name === model.name;
                  return (
                    <DropdownMenuItem
                      key={model.name}
                      onSelect={() => updateModelName(model.name, { onSuccess: () => toast.success(t.settings.memory.saveChanges) })}
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
          </div>
          {savingModel && <p className="text-xs text-muted-foreground">Updating...</p>}
        </div>

        <Separator />

        {/* User context */}
        <SectionGroup title={t.settings.memory.markdown.userContext} sections={userSections} />

        {/* History */}
        <SectionGroup title={t.settings.memory.markdown.historyBackground} sections={historySections} />

        {/* Facts */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t.settings.memory.markdown.facts}</h3>
            <span className="text-xs text-muted-foreground">{memory.facts.length} total</span>
          </div>

          {memory.facts.length === 0 ? (
            <p className="text-sm text-muted-foreground/60 italic">{t.settings.memory.markdown.empty}</p>
          ) : (
            <div className="space-y-1.5">
              {memory.facts.map((fact) => (
                <FactRow key={fact.id} fact={fact} />
              ))}
            </div>
          )}
        </div>

      </div>
    </SettingsSection>
  );
}
