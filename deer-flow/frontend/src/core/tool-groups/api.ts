import { getBackendBaseURL } from "@/core/config";

export interface ToolGroup {
  name: string;
  enabled: boolean;
}

export async function listToolGroups(): Promise<ToolGroup[]> {
  const res = await fetch(`${getBackendBaseURL()}/api/tool-groups`);
  if (!res.ok) throw new Error(`Failed to load tool groups: ${res.statusText}`);
  const data = (await res.json()) as { tool_groups: ToolGroup[] };
  return data.tool_groups;
}

export async function updateToolGroup(name: string, enabled: boolean): Promise<ToolGroup> {
  const res = await fetch(`${getBackendBaseURL()}/api/tool-groups/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`Failed to update tool group: ${res.statusText}`);
  return res.json() as Promise<ToolGroup>;
}
