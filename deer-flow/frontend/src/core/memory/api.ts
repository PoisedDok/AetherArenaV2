import { getBackendBaseURL } from "../config";

import type { UserMemory } from "./types";

export async function loadMemory() {
  const memory = await fetch(`${getBackendBaseURL()}/api/memory`);
  const json = await memory.json();
  return json as UserMemory;
}

export async function deleteMemoryFact(factId: string): Promise<UserMemory> {
  const res = await fetch(`${getBackendBaseURL()}/api/memory/facts/${encodeURIComponent(factId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete fact: ${res.statusText}`);
  return res.json() as Promise<UserMemory>;
}

export async function updateMemoryFact(factId: string, content: string): Promise<UserMemory> {
  const res = await fetch(`${getBackendBaseURL()}/api/memory/facts/${encodeURIComponent(factId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Failed to update fact: ${res.statusText}`);
  return res.json() as Promise<UserMemory>;
}

export async function updateMemorySection(section: string, summary: string): Promise<UserMemory> {
  const res = await fetch(`${getBackendBaseURL()}/api/memory/sections`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section, summary }),
  });
  if (!res.ok) throw new Error(`Failed to update section: ${res.statusText}`);
  return res.json() as Promise<UserMemory>;
}
