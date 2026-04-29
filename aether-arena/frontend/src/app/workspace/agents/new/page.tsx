"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  LayersIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArtifactsProvider } from "@/components/workspace/artifacts";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import type { Agent } from "@/core/agents";
import { checkAgentName, getAgent } from "@/core/agents/api";
import { useI18n } from "@/core/i18n/hooks";
import { useMCPConfig } from "@/core/mcp/hooks";
import { useSkills } from "@/core/skills/hooks";
import { useThreadStream } from "@/core/threads/hooks";
import { useToolGroups } from "@/core/tool-groups/hooks";
import { uuid } from "@/core/utils/uuid";
import { cn } from "@/lib/utils";

type Step = "identity" | "tools" | "chat";

const NAME_RE = /^[A-Za-z0-9-]+$/;

export default function NewAgentPage() {
  const { t } = useI18n();
  const router = useRouter();

  // ── Form ───────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("identity");
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState("");
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [description, setDescription] = useState("");
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());

  // ── Chat ───────────────────────────────────────────────────────────────────
  const [agentName, setAgentName] = useState("");
  const [agent, setAgent] = useState<Agent | null>(null);
  const threadId = useMemo(() => uuid(), []);

  const { skills } = useSkills();
  const { config: mcpConfig } = useMCPConfig();
  const mcpEntries = Object.entries(mcpConfig?.mcp_servers ?? {}).filter(([, cfg]) => cfg.enabled);
  const { toolGroups: allToolGroups } = useToolGroups();
  const toolGroups = allToolGroups.filter((g) => g.enabled);

  const [thread, sendMessage] = useThreadStream({
    threadId: step === "chat" ? threadId : undefined,
    context: { mode: "flash", is_bootstrap: true },
    onToolEnd({ name }) {
      if (name !== "setup_agent" || !agentName) return;
      getAgent(agentName)
        .then((fetched) => setAgent(fetched))
        .catch((_err: unknown) => { /* agent write may not be flushed yet */ });
    },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleIdentityContinue = useCallback(async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    if (!NAME_RE.test(trimmed)) {
      setNameError(t.agents.nameStepInvalidError);
      return;
    }
    setNameError("");
    setIsCheckingName(true);
    try {
      const result = await checkAgentName(trimmed);
      if (!result.available) {
        setNameError(t.agents.nameStepAlreadyExistsError);
        return;
      }
    } catch {
      setNameError(t.agents.nameStepCheckError);
      return;
    } finally {
      setIsCheckingName(false);
    }
    setStep("tools");
  }, [nameInput, t.agents.nameStepInvalidError, t.agents.nameStepAlreadyExistsError, t.agents.nameStepCheckError]);

  const handleToolsContinue = useCallback(async () => {
    const trimmed = nameInput.trim();
    const toolList = Array.from(selectedTools);
    const toolsLine = toolList.length > 0
      ? `Tools assigned: ${toolList.join(", ")}.`
      : "No specific tools assigned.";
    const descLine = description.trim()
      ? `Purpose: ${description.trim()}.`
      : "";

    const bootstrapMessage = [
      `Create a new custom agent named "${trimmed}".`,
      descLine,
      toolsLine,
      "Based on the above, craft a focused system prompt (SOUL) for this agent that defines its persona, capabilities, and behaviour. Then call setup_agent to save it.",
    ].filter(Boolean).join(" ");

    setAgentName(trimmed);
    setStep("chat");
    await sendMessage(threadId, { text: bootstrapMessage, files: [] }, { agent_name: trimmed });
  }, [nameInput, description, selectedTools, sendMessage, threadId]);

  const handleChatSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thread.isLoading) return;
    await sendMessage(threadId, { text: trimmed, files: [] }, { agent_name: agentName });
  }, [thread.isLoading, sendMessage, threadId, agentName]);

  function toggleTool(name: string) {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // ── Shared header ───────────────────────────────────────────────────────────
  const header = (
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          if (step === "tools") setStep("identity");
          else if (step === "chat") setStep("tools");
          else router.push("/workspace/agents");
        }}
      >
        <ArrowLeftIcon className="h-4 w-4" />
      </Button>
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold">{t.agents.createPageTitle}</h1>
        {/* Step pills */}
        <div className="flex items-center gap-1 ml-2">
          {(["identity", "tools", "chat"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-1.5 rounded-full transition-all",
                step === s ? "w-4 bg-primary" : i < ["identity","tools","chat"].indexOf(step) ? "w-1.5 bg-primary/40" : "w-1.5 bg-muted-foreground/20",
              )}
            />
          ))}
        </div>
      </div>
      {step === "chat" && agentName && (
        <Badge variant="secondary" className="ml-auto text-xs">{agentName}</Badge>
      )}
    </header>
  );

  // ── Step 1: Identity ────────────────────────────────────────────────────────
  if (step === "identity") {
    return (
      <div className="flex size-full flex-col">
        {header}
        <main className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-sm space-y-6">

            <div className="space-y-3 text-center">
              <div className="bg-primary/10 mx-auto flex h-14 w-14 items-center justify-center rounded-full">
                <BotIcon className="text-primary h-7 w-7" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">{t.agents.nameStepTitle}</h2>
                <p className="text-muted-foreground text-sm">{t.agents.nameStepHint}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t.agents.fieldName}</label>
                <Input
                  autoFocus
                  placeholder={t.agents.nameStepPlaceholder}
                  value={nameInput}
                  onChange={(e) => { setNameInput(e.target.value); setNameError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleIdentityContinue(); } }}
                  className={cn(nameError && "border-destructive")}
                />
                {nameError && <p className="text-destructive text-xs">{nameError}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {t.agents.fieldDescription}
                  <span className="text-muted-foreground ml-1.5 text-xs font-normal">({t.agents.fieldOptional})</span>
                </label>
                <Textarea
                  placeholder={t.agents.fieldDescriptionPlaceholder}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[72px] resize-none"
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleIdentityContinue(); } }}
                />
              </div>

              <Button
                className="w-full"
                onClick={() => void handleIdentityContinue()}
                disabled={!nameInput.trim() || isCheckingName}
              >
                {isCheckingName ? t.common.loading : (
                  <span className="flex items-center gap-2">
                    {t.agents.identityContinue}
                    <ArrowRightIcon className="size-4" />
                  </span>
                )}
              </Button>
            </div>

          </div>
        </main>
      </div>
    );
  }

  // ── Step 2: Tools ───────────────────────────────────────────────────────────
  if (step === "tools") {
    const hasSkills = skills.length > 0;
    const hasMCP = mcpEntries.length > 0;
    const hasToolGroups = toolGroups.length > 0;
    const hasAnyTools = hasSkills || hasMCP || hasToolGroups;

    return (
      <div className="flex size-full flex-col">
        {header}
        <main className="flex flex-1 items-center justify-center px-4">
          <div className="w-full max-w-sm space-y-5">

            <div className="space-y-1 text-center">
              <h2 className="text-lg font-semibold">{t.agents.toolsStepTitle}</h2>
              <p className="text-muted-foreground text-sm">{t.agents.toolsStepHint}</p>
            </div>

            {!hasAnyTools ? (
              <div className="rounded-xl border border-dashed py-8 text-center">
                <p className="text-muted-foreground text-sm">{t.agents.editToolsEmpty}</p>
              </div>
            ) : (
              <div className="space-y-2 rounded-xl border overflow-hidden">

                {/* Skills section */}
                {hasSkills && (
                  <Collapsible>
                    <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/50 transition-colors">
                      <SparklesIcon className="text-muted-foreground size-3.5 shrink-0" />
                      <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t.settings.skills.title}
                      </span>
                      {Array.from(selectedTools).filter(n => skills.some(s => s.name === n)).length > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {Array.from(selectedTools).filter(n => skills.some(s => s.name === n)).length}
                        </Badge>
                      )}
                      <ChevronDownIcon className="text-muted-foreground size-3.5 transition-transform [[data-state=open]_&]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t px-3 py-2 flex flex-wrap gap-1.5">
                        {skills.map((skill) => (
                          <button
                            key={skill.name}
                            type="button"
                            title={skill.description}
                            onClick={() => toggleTool(skill.name)}
                            className={cn(
                              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                              selectedTools.has(skill.name)
                                ? "border-primary bg-primary/10 text-primary font-medium"
                                : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground",
                            )}
                          >
                            {selectedTools.has(skill.name) && <span className="size-1.5 rounded-full bg-primary" />}
                            {skill.name}
                          </button>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {/* System tool groups section */}
                {hasToolGroups && (
                  <Collapsible>
                    {(hasSkills || hasMCP) && <div className="border-t" />}
                    <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/50 transition-colors">
                      <LayersIcon className="text-muted-foreground size-3.5 shrink-0" />
                      <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t.agents.toolGroupsSection}
                      </span>
                      {Array.from(selectedTools).filter(n => toolGroups.some(g => g.name === n)).length > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {Array.from(selectedTools).filter(n => toolGroups.some(g => g.name === n)).length}
                        </Badge>
                      )}
                      <ChevronDownIcon className="text-muted-foreground size-3.5 transition-transform [[data-state=open]_&]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t px-3 py-2 flex flex-wrap gap-1.5">
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
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {/* MCP section */}
                {hasMCP && (
                  <Collapsible>
                    {(hasSkills || hasToolGroups) && <div className="border-t" />}
                    <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/50 transition-colors">
                      <WrenchIcon className="text-muted-foreground size-3.5 shrink-0" />
                      <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t.settings.tools.mcpTitle}
                      </span>
                      {Array.from(selectedTools).filter(n => mcpEntries.some(([k]) => k === n)).length > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {Array.from(selectedTools).filter(n => mcpEntries.some(([k]) => k === n)).length}
                        </Badge>
                      )}
                      <ChevronDownIcon className="text-muted-foreground size-3.5 transition-transform [[data-state=open]_&]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t px-3 py-2 flex flex-wrap gap-1.5">
                        {mcpEntries.map(([name, cfg]) => (
                          <button
                            key={name}
                            type="button"
                            title={cfg.description}
                            onClick={() => toggleTool(name)}
                            className={cn(
                              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                              selectedTools.has(name)
                                ? "border-primary bg-primary/10 text-primary font-medium"
                                : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground",
                            )}
                          >
                            {selectedTools.has(name) && <span className="size-1.5 rounded-full bg-primary" />}
                            {name}
                          </button>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}

              </div>
            )}

            <Button className="w-full" onClick={() => void handleToolsContinue()}>
              <span className="flex items-center gap-2">
                {t.agents.configureContinue}
                <ArrowRightIcon className="size-4" />
              </span>
            </Button>

          </div>
        </main>
      </div>
    );
  }

  // ── Step 3: Chat ────────────────────────────────────────────────────────────
  return (
    <ThreadContext.Provider value={{ thread }}>
      <ArtifactsProvider>
        <div className="flex size-full flex-col">
          {header}
          <main className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 justify-center">
              <MessageList className="size-full pt-10" threadId={threadId} thread={thread} />
            </div>
            <div className="bg-background flex shrink-0 justify-center border-t px-4 py-4">
              <div className="w-full max-w-(--container-width-md)">
                {agent ? (
                  <div className="flex flex-col items-center gap-4 rounded-2xl border py-8 text-center">
                    <CheckCircleIcon className="text-primary h-10 w-10" />
                    <p className="font-semibold">{t.agents.agentCreated}</p>
                    <div className="flex gap-2">
                      <Button onClick={() => router.push(`/workspace/agents/${agentName}/chats/new`)}>
                        {t.agents.startChatting}
                      </Button>
                      <Button variant="outline" onClick={() => router.push("/workspace/agents")}>
                        {t.agents.backToGallery}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <PromptInput onSubmit={({ text }) => void handleChatSubmit(text)}>
                    <PromptInputTextarea
                      autoFocus
                      placeholder={t.agents.createPageSubtitle}
                      disabled={thread.isLoading}
                    />
                    <PromptInputFooter className="justify-end">
                      <PromptInputSubmit disabled={thread.isLoading} />
                    </PromptInputFooter>
                  </PromptInput>
                )}
              </div>
            </div>
          </main>
        </div>
      </ArtifactsProvider>
    </ThreadContext.Provider>
  );
}
