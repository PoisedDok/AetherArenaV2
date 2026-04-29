"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCompactConfig, useUpdateCompactConfig } from "@/core/compact/hooks";
import { useModels } from "@/core/models/hooks";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

export function CompactSettingsPage() {
  const { config, isLoading, error } = useCompactConfig();
  const { mutate: updateConfig, isPending } = useUpdateCompactConfig();
  const { models } = useModels();

  if (isLoading) {
    return (
      <SettingsSection title="Context Compact" description="Control how the assistant compresses long conversations.">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </SettingsSection>
    );
  }

  if (error || !config) {
    return (
      <SettingsSection title="Context Compact" description="Control how the assistant compresses long conversations.">
        <div className="text-destructive text-sm">{error ? `Error: ${error.message}` : "Config unavailable."}</div>
      </SettingsSection>
    );
  }

  const selectedModel = models.find((m) => m.name === config.model_name);
  const modelLabel = selectedModel ? (selectedModel.display_name ?? selectedModel.name) : "Auto (default model)";

  function patch(changes: Parameters<typeof updateConfig>[0]) {
    updateConfig(changes, {
      onSuccess: () => toast.success("Compact settings saved"),
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    });
  }

  return (
    <SettingsSection
      title="Context Compact"
      description="When a conversation gets long, compact summarises older messages so the assistant stays within its context window. Configure thresholds and behaviour here."
    >
      <div className="space-y-6">

        {/* Enabled toggle */}
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-0.5">
            <span className="text-sm font-medium">Auto-compact enabled</span>
            <p className="text-muted-foreground text-xs">
              Automatically compact the conversation when it approaches the context limit.
            </p>
          </div>
          <Switch
            checked={config.enabled}
            disabled={isPending}
            onCheckedChange={(checked) => patch({ enabled: checked })}
          />
        </div>

        {/* Messages to keep */}
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Messages to keep</span>
          <p className="text-muted-foreground text-xs">
            Number of recent messages to preserve verbatim after compaction. Older messages are replaced by the summary.
          </p>
          <div className="flex max-w-[140px] items-center gap-2">
            <Input
              type="number"
              min={1}
              max={50}
              value={config.messages_to_keep}
              disabled={isPending}
              className="text-sm"
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 1) patch({ messages_to_keep: val });
              }}
            />
          </div>
        </div>

        {/* Token threshold override */}
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Token threshold override</span>
          <p className="text-muted-foreground text-xs">
            Fixed token count at which auto-compact triggers. Leave blank to use the dynamic default
            (model context window minus a 13k buffer). Set a low value (e.g. 10 000) for testing.
          </p>
          <div className="flex max-w-[200px] items-center gap-2">
            <Input
              type="number"
              min={1000}
              placeholder="Auto (dynamic)"
              value={config.token_threshold_override ?? ""}
              disabled={isPending}
              className="text-sm"
              onChange={(e) => {
                const raw = e.target.value.trim();
                const val = raw === "" ? null : parseInt(raw, 10);
                if (raw === "" || (!isNaN(val!) && val! >= 1000)) {
                  patch({ token_threshold_override: val });
                }
              }}
            />
          </div>
        </div>

        {/* Model selector */}
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Compact model</span>
          <p className="text-muted-foreground text-xs">
            The model used to generate the conversation summary. A lightweight model is recommended to save tokens.
          </p>
          <div className="flex max-w-md">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-mono text-xs" disabled={models.length === 0 || isPending}>
                  <span className="truncate">{modelLabel}</span>
                  <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-64 overflow-y-auto">
                <DropdownMenuItem
                  onSelect={() => patch({ model_name: null })}
                  className={cn("text-xs font-mono gap-2", !config.model_name && "text-primary")}
                >
                  {!config.model_name && <CheckIcon className="size-3" />}
                  <span className={config.model_name ? "pl-5" : ""}>Auto (default model)</span>
                </DropdownMenuItem>
                {models.map((model) => {
                  const active = config.model_name === model.name;
                  return (
                    <DropdownMenuItem
                      key={model.name}
                      onSelect={() => patch({ model_name: model.name })}
                      className={cn("text-xs font-mono gap-2", active && "text-primary")}
                    >
                      {active ? <CheckIcon className="size-3 shrink-0" /> : <span className="w-3 shrink-0" />}
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
        </div>

        {/* ── Doc Summarization ──────────────────────────────────── */}
        <div className="border-t pt-5 space-y-4">
          <div>
            <span className="text-sm font-semibold">Document summarization</span>
            <p className="text-muted-foreground text-xs mt-0.5">
              When the agent reads a large file, an extractive summary is returned instead of the raw content.
              The agent can always request the full file or a specific section by line range.
            </p>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Auto-summarize large files</span>
              <p className="text-muted-foreground text-xs">
                Summarize files that exceed the token threshold before passing them to the agent.
              </p>
            </div>
            <Switch
              checked={config.doc_summarization_enabled}
              disabled={isPending}
              onCheckedChange={(checked) => patch({ doc_summarization_enabled: checked })}
            />
          </div>

          {/* Token threshold */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Token threshold</span>
            <p className="text-muted-foreground text-xs">
              Files smaller than this token count are passed verbatim. Larger files are summarized.
            </p>
            <div className="flex max-w-[160px] items-center gap-2">
              <Input
                type="number"
                min={500}
                max={32000}
                step={500}
                value={config.doc_summarization_threshold}
                disabled={isPending || !config.doc_summarization_enabled}
                className="text-sm"
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 500) patch({ doc_summarization_threshold: val });
                }}
              />
              <span className="text-muted-foreground text-xs">tokens</span>
            </div>
          </div>

          {/* Summary ratio */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">
              Summary ratio — <span className="text-primary font-mono">{Math.round(config.doc_summarization_ratio * 100)}%</span>
            </span>
            <p className="text-muted-foreground text-xs">
              Target fraction of the source content to retain. 15–20% gives the most informative sentences
              while keeping summaries concise. The agent can always read more via line range or raw mode.
            </p>
            <div className="flex max-w-[260px] items-center gap-3">
              <span className="text-muted-foreground text-xs w-8">10%</span>
              <input
                type="range"
                min={0.10}
                max={0.40}
                step={0.05}
                value={config.doc_summarization_ratio}
                disabled={isPending || !config.doc_summarization_enabled}
                className="flex-1 accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  patch({ doc_summarization_ratio: val });
                }}
              />
              <span className="text-muted-foreground text-xs w-8">40%</span>
            </div>
          </div>
        </div>

      </div>
    </SettingsSection>
  );
}
