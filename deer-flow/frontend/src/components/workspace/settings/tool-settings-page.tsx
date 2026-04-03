"use client";

import { LayersIcon, SparklesIcon, WrenchIcon } from "lucide-react";

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
import { useEnableMCPServer, useMCPConfig } from "@/core/mcp/hooks";
import type { MCPServerConfig } from "@/core/mcp/types";
import { useEnableSkill, useSkills } from "@/core/skills/hooks";
import type { Skill } from "@/core/skills/type";
import { useEnableToolGroup, useToolGroups } from "@/core/tool-groups/hooks";
import type { ToolGroup } from "@/core/tool-groups/api";
import { env } from "@/env";

import { SettingsSection } from "./settings-section";

export function ToolSettingsPage() {
  const { t } = useI18n();
  const { config, isLoading: mcpLoading, error: mcpError } = useMCPConfig();
  const { skills, isLoading: skillsLoading } = useSkills();
  const { toolGroups, isLoading: toolGroupsLoading } = useToolGroups();

  const isLoading = mcpLoading || skillsLoading || toolGroupsLoading;

  return (
    <SettingsSection
      title={t.settings.tools.title}
      description={t.settings.tools.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : mcpError ? (
        <div>Error: {mcpError.message}</div>
      ) : (
        <div className="flex w-full flex-col gap-8">
          {/* Agent Skills */}
          <ToolSection
            icon={SparklesIcon}
            label={t.settings.skills.title}
          >
            {skills.length === 0 ? (
              <EmptyRow label={t.settings.acknowledge.emptyTitle} />
            ) : (
              <SkillList skills={skills} />
            )}
          </ToolSection>

          {/* System Tool Groups */}
          {toolGroups.length > 0 && (
            <ToolSection
              icon={LayersIcon}
              label={t.agents.toolGroupsSection}
            >
              <SystemToolList toolGroups={toolGroups} />
            </ToolSection>
          )}

          {/* MCP Servers */}
          {config && Object.keys(config.mcp_servers).length > 0 && (
            <ToolSection
              icon={WrenchIcon}
              label={t.settings.tools.mcpTitle}
            >
              <MCPServerList servers={config.mcp_servers} />
            </ToolSection>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

function ToolSection({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="text-muted-foreground size-3.5" />
        <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <p className="text-muted-foreground text-sm">{label}</p>
  );
}

function SkillList({ skills }: { skills: Skill[] }) {
  const { mutate: enableSkill } = useEnableSkill();
  return (
    <div className="flex w-full flex-col gap-3">
      {skills.map((skill) => (
        <Item className="w-full" variant="outline" key={skill.name}>
          <ItemContent>
            <ItemTitle>
              <div className="flex items-center gap-2">{skill.name}</div>
            </ItemTitle>
            <ItemDescription className="line-clamp-4">
              {skill.description}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={skill.enabled}
              disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
              onCheckedChange={(checked) =>
                enableSkill({ skillName: skill.name, enabled: checked })
              }
            />
          </ItemActions>
        </Item>
      ))}
    </div>
  );
}

function SystemToolList({ toolGroups }: { toolGroups: ToolGroup[] }) {
  const { mutate: enableToolGroup } = useEnableToolGroup();
  return (
    <div className="flex w-full flex-col gap-3">
      {toolGroups.map((group) => (
        <Item className="w-full" variant="outline" key={group.name}>
          <ItemContent>
            <ItemTitle>
              <div className="flex items-center gap-2">{group.name}</div>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={group.enabled}
              onCheckedChange={(checked) =>
                enableToolGroup({ groupName: group.name, enabled: checked })
              }
            />
          </ItemActions>
        </Item>
      ))}
    </div>
  );
}

function MCPServerList({
  servers,
}: {
  servers: Record<string, MCPServerConfig>;
}) {
  const { mutate: enableMCPServer } = useEnableMCPServer();
  return (
    <div className="flex w-full flex-col gap-3">
      {Object.entries(servers).map(([name, config]) => (
        <Item className="w-full" variant="outline" key={name}>
          <ItemContent>
            <ItemTitle>
              <div className="flex items-center gap-2">
                <div>{name}</div>
              </div>
            </ItemTitle>
            <ItemDescription className="line-clamp-4">
              {config.description}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={config.enabled}
              disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
              onCheckedChange={(checked) =>
                enableMCPServer({ serverName: name, enabled: checked })
              }
            />
          </ItemActions>
        </Item>
      ))}
    </div>
  );
}
