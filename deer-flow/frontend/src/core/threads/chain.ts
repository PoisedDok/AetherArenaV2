/**
 * Compact thread chain — localStorage management.
 *
 * When compact fires, the backend creates a new continuation thread.
 * We track the parent→child relationship here so the UI can traverse
 * the full chain and display the complete history.
 *
 * Key schema:
 *   deerflow.thread-chain.{thread_id}  →  ThreadChainEntry
 */

const KEY_PREFIX = "deerflow.thread-chain.";
const MAX_CHAIN_DEPTH = 50;

export interface ThreadChainEntry {
  /** The thread that was compacted to produce this one. */
  parent_id: string;
  /** LLM or sumy summary text. */
  summary: string;
  /** "llm" | "sumy" */
  method: string;
  pre_tokens: number;
  post_tokens: number;
  summarized_count: number;
  compacted_at: string; // ISO date string
}

export function setThreadParent(newThreadId: string, entry: ThreadChainEntry): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY_PREFIX + newThreadId, JSON.stringify(entry));
  } catch {
    // storage full — ignore
  }
}

export function getThreadParent(threadId: string): ThreadChainEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + threadId);
    if (!raw) return null;
    return JSON.parse(raw) as ThreadChainEntry;
  } catch {
    return null;
  }
}

/**
 * Walk the chain from the given threadId back to the oldest ancestor.
 * Returns [oldest, ..., threadId].
 */
export function getFullChain(threadId: string): string[] {
  const chain: string[] = [threadId];
  let current = threadId;
  for (let i = 0; i < MAX_CHAIN_DEPTH; i++) {
    const entry = getThreadParent(current);
    if (!entry) break;
    chain.unshift(entry.parent_id);
    current = entry.parent_id;
  }
  return chain;
}

/** The oldest ancestor in the chain — the "root" conversation ID. */
export function getRootThreadId(threadId: string): string {
  const chain = getFullChain(threadId);
  return chain[0] ?? threadId;
}
