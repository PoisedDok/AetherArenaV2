"use client";

import { BotIcon, FileTextIcon, LayersIcon, SparklesIcon, WrenchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { Agent } from "@/core/agents";
import { useUpdateAgent } from "@/core/agents";
import { useI18n } from "@/core/i18n/hooks";
import { useMCPConfig } from "@/core/mcp/hooks";
import { useSkills } from "@/core/skills/hooks";
import { useToolGroups } from "@/core/tool-groups/hooks";
import { cn } from "@/lib/utils";

type Section = "overview" | "tools" | "soul";

interface AgentEditDialogProps {
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentEditDialog({
  agent,
  open,
  onOpenChange,
}: AgentEditDialogProps) {
  const { t } = useI18n();
  const { mutateAsync: updateAgent, isPending } = useUpdateAgent();
  const { skills } = useSkills();
  const { config: mcpConfig } = useMCPConfig();
  const mcpEntries = Object.entries(mcpConfig?.mcp_servers ?? {}).filter(([, cfg]) => cfg.enabled);
  const { toolGroups: allToolGroups } = useToolGroups();
  const toolGroups = allToolGroups.filter((g) => g.enabled);

  const [activeSection, setActiveSection] = useState<Section>("overview");
  const [description, setDescription] = useState(agent.description ?? "");
  const [selectedTools, setSelectedTools] = useState<Set<string>>(
    new Set(agent.tool_groups ?? []),
  );
  const [soul, setSoul] = useState(agent.soul ?? "");

  // Reset local state when dialog opens with a (possibly refreshed) agent
  useEffect(() => {
    if (open) {
      setDescription(agent.description ?? "");
      setSelectedTools(new Set(agent.tool_groups ?? []));
      setSoul(agent.soul ?? "");
      setActiveSection("overview");
    }
  }, [open, agent]);

  function toggleTool(name: string) {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleSave() {
    try {
      await updateAgent({
        name: agent.name,
        request: {
          description: description || null,
          tool_groups: selectedTools.size > 0 ? Array.from(selectedTools) : null,
          soul: soul || null,
        },
      });
      toast.success(t.agents.editSuccess);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const sections: { id: Section; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: t.agents.editSectionOverview, icon: BotIcon },
    { id: "tools", label: t.agents.editSectionTools, icon: SparklesIcon },
    { id: "soul", label: t.agents.editSectionSoul, icon: FileTextIcon },
  ];

  const toolCount = selectedTools.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[72vh] max-h-[calc(100vh-2rem)] flex-col gap-0 p-0 sm:max-w-3xl"
        aria-describedby={undefined}
      >
        {/* Header */}
        <DialogHeader className="flex-row items-center gap-3 border-b px-5 py-4">
          <div className="bg-primary/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            <BotIcon className="text-primary h-4 w-4" />
          </div>
          <div className="min-w-0">
            <DialogTitle className="truncate text-base leading-none">
              {agent.name}
            </DialogTitle>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t.agents.editSubtitle}
            </p>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="grid min-h-0 flex-1 md:grid-cols-[180px_1fr]">
          {/* Left nav */}
          <nav className="border-r p-2">
            <ul className="space-y-0.5">
              {sections.map(({ id, label, icon: Icon }) => {
                const active = activeSection === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setActiveSection(id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{label}</span>
                      {id === "tools" && toolCount > 0 && (
                        <Badge
                          variant={active ? "outline" : "secondary"}
                          className={cn(
                            "ml-auto shrink-0 px-1.5 py-0 text-[10px]",
                            active && "border-primary-foreground/40 text-primary-foreground",
                          )}
                        >
                          {toolCount}
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Right content */}
          <ScrollArea className="min-h-0">
            <div className="p-6">
              {/* Overview */}
              {activeSection === "overview" && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold">{t.agents.editSectionOverview}</h3>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t.agents.editOverviewHint}
                    </p>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t.agents.fieldName}</label>
                    <Input value={agent.name} disabled className="text-muted-foreground" />
                    <p className="text-muted-foreground text-xs">{t.agents.fieldNameReadonly}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      {t.agents.fieldDescription}
                    </label>
                    <Textarea
                      placeholder={t.agents.fieldDescriptionPlaceholder}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="min-h-24 resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Tools */}
              {activeSection === "tools" && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold">{t.agents.editSectionTools}</h3>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t.agents.editToolsHint}
                    </p>
                  </div>
                  <Separator />

                  {skills.length === 0 && mcpEntries.length === 0 && toolGroups.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {t.agents.editToolsEmpty}
                    </p>
                  ) : (
                    <div className="space-y-5">
                      {/* Skills */}
                      {skills.length > 0 && (
                        <div className="space-y-1">
                          <div className="mb-2 flex items-center gap-1.5">
                            <SparklesIcon className="text-muted-foreground size-3.5" />
                            <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                              {t.settings.skills.title}
                            </span>
                          </div>
                          <div className="rounded-lg border divide-y">
                            {skills.map((skill) => (
                              <label
                                key={skill.name}
                                className="flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-accent/50"
                              >
                                <Checkbox
                                  className="mt-0.5"
                                  checked={selectedTools.has(skill.name)}
                                  onCheckedChange={() => toggleTool(skill.name)}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium leading-none">
                                    {skill.name}
                                  </div>
                                  {skill.description && (
                                    <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                                      {skill.description}
                                    </div>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* System tool groups */}
                      {toolGroups.length > 0 && (
                        <div className="space-y-1">
                          <div className="mb-2 flex items-center gap-1.5">
                            <LayersIcon className="text-muted-foreground size-3.5" />
                            <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                              {t.agents.toolGroupsSection}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {toolGroups.map((group) => (
                              <button
                                key={group.name}
                                type="button"
                                onClick={() => toggleTool(group.name)}
                                className={cn(
                                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                                  selectedTools.has(group.name)
                                    ? "border-primary bg-primary/10 text-primary font-medium"
                                    : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground",
                                )}
                              >
                                {selectedTools.has(group.name) && <span className="size-1.5 rounded-full bg-primary" />}
                                {group.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* MCP */}
                      {mcpEntries.length > 0 && (
                        <div className="space-y-1">
                          <div className="mb-2 flex items-center gap-1.5">
                            <WrenchIcon className="text-muted-foreground size-3.5" />
                            <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                              {t.settings.tools.mcpTitle}
                            </span>
                          </div>
                          <div className="rounded-lg border divide-y">
                            {mcpEntries.map(([name, cfg]) => (
                              <label
                                key={name}
                                className="flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-accent/50"
                              >
                                <Checkbox
                                  className="mt-0.5"
                                  checked={selectedTools.has(name)}
                                  onCheckedChange={() => toggleTool(name)}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium leading-none">
                                    {name}
                                  </div>
                                  {cfg.description && (
                                    <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                                      {cfg.description}
                                    </div>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {toolCount > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {Array.from(selectedTools).map((name) => (
                            <Badge key={name} variant="secondary" className="text-xs">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* System prompt / soul */}
              {activeSection === "soul" && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold">{t.agents.editSectionSoul}</h3>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t.agents.editSoulHint}
                    </p>
                  </div>
                  <Separator />
                  <Textarea
                    placeholder={t.agents.editSoulPlaceholder}
                    value={soul}
                    onChange={(e) => setSoul(e.target.value)}
                    className="min-h-64 resize-none font-mono text-xs"
                  />
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void handleSave()} disabled={isPending}>
            {isPending ? t.common.loading : t.common.save}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
