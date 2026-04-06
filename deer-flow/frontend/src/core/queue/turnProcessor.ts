import { dequeueAllMatching, getSnapshot, peek } from "./messageQueueManager";
import type { QueuedMessage } from "./types";

export interface ProcessQueueResult {
  processed: boolean;
  messages: Array<{
    role: "human";
    content: string;
    skipAttachments: boolean;
  }>;
}

export function processQueueIfReady(threadId: string): ProcessQueueResult {
  const forThread = (msg: QueuedMessage) => msg.threadId === threadId;

  const next = peek((msg) => forThread(msg) && msg.priority === "next");

  if (!next) {
    return { processed: false, messages: [] };
  }

  const batch = dequeueAllMatching(
    (msg) => forThread(msg) && msg.priority === "next",
  );

  if (batch.length === 0) {
    return { processed: false, messages: [] };
  }

  const messages = batch.map((msg, i) => ({
    role: "human" as const,
    content: msg.text,
    skipAttachments: i > 0,
  }));

  return { processed: true, messages };
}

export function getQueueSummary(threadId?: string): {
  total: number;
  byPriority: Record<string, number>;
  oldestTimestamp: number | null;
} {
  const snapshot = getSnapshot();
  const filtered = threadId
    ? snapshot.filter((msg) => msg.threadId === threadId)
    : snapshot;

  const byPriority: Record<string, number> = { now: 0, next: 0, later: 0 };
  let oldestTimestamp: number | null = null;

  for (const msg of filtered) {
    byPriority[msg.priority] = (byPriority[msg.priority] ?? 0) + 1;
    if (!oldestTimestamp || msg.timestamp < oldestTimestamp) {
      oldestTimestamp = msg.timestamp;
    }
  }

  return {
    total: filtered.length,
    byPriority,
    oldestTimestamp,
  };
}
