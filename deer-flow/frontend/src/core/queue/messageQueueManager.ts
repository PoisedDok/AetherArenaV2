import type { QueuedMessage, MessageQueueListener, QueuePriority } from "./types";
import { MAX_QUEUE_SIZE } from "./types";

const PRIORITY_ORDER: Record<QueuePriority, number> = {
  now: 0,
  next: 1,
  later: 2,
};

let queue: QueuedMessage[] = [];
const listeners: MessageQueueListener[] = [];

function notifyAll(): void {
  for (const listener of listeners) {
    listener();
  }
}

function sortedQueue(queueArray: QueuedMessage[]): QueuedMessage[] {
  return [...queueArray].sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return a.timestamp - b.timestamp;
  });
}

interface PartialQueuedMessage {
  threadId: string;
  text: string;
  priority: QueuePriority;
  hasAttachments: boolean;
}

export function enqueue(msg: PartialQueuedMessage): void {
  if (queue.length >= MAX_QUEUE_SIZE) {
    return;
  }
  const fullMsg: QueuedMessage = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    threadId: msg.threadId,
    text: msg.text,
    priority: msg.priority,
    hasAttachments: msg.hasAttachments,
  };
  queue.push(fullMsg);
  notifyAll();
}

export function dequeue(predicate?: (msg: QueuedMessage) => boolean): QueuedMessage | null {
  const sorted = sortedQueue(queue);
  let candidate: QueuedMessage | null = null;
  for (const msg of sorted) {
    if (!predicate || predicate(msg)) {
      candidate = msg;
      break;
    }
  }
  if (!candidate) {
    return null;
  }
  queue = queue.filter((m) => m.id !== candidate.id);
  notifyAll();
  return candidate;
}

export function dequeueAllMatching(predicate: (msg: QueuedMessage) => boolean): QueuedMessage[] {
  const sorted = sortedQueue(queue);
  const removed: QueuedMessage[] = [];
  const remaining: QueuedMessage[] = [];

  for (const msg of sorted) {
    if (predicate(msg)) {
      removed.push(msg);
    } else {
      remaining.push(msg);
    }
  }

  if (removed.length === 0) {
    return [];
  }

  queue = remaining;
  notifyAll();
  return removed;
}

export function peek(predicate?: (msg: QueuedMessage) => boolean): QueuedMessage | null {
  const sorted = sortedQueue(queue);
  for (const msg of sorted) {
    if (!predicate || predicate(msg)) {
      return msg;
    }
  }
  return null;
}

export function getSize(): number {
  return queue.length;
}

export function clear(predicate?: (msg: QueuedMessage) => boolean): void {
  if (!predicate) {
    queue = [];
  } else {
    queue = queue.filter((msg) => !predicate(msg));
  }
  notifyAll();
}

export function subscribe(listener: MessageQueueListener): () => void {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  };
}

export function getSnapshot(): readonly QueuedMessage[] {
  return Object.freeze(sortedQueue(queue));
}
