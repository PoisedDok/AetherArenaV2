import { expect, test } from "vitest";

import { enqueue, dequeue, dequeueAllMatching, peek, getSize, clear, subscribe, getSnapshot } from "./messageQueueManager";
import { MAX_QUEUE_SIZE } from "./types";

const baseMsg = (overrides: Partial<Parameters<typeof enqueue>[0]> = {}) => ({
  threadId: "t1",
  text: "hello",
  priority: "next" as const,
  hasAttachments: false,
  ...overrides,
});

test("enqueue adds message, dequeue removes it", () => {
  clear();
  expect(getSize()).toBe(0);
  enqueue(baseMsg({ threadId: "basic" }));
  expect(getSize()).toBe(1);
  const msg = dequeue((m) => m.threadId === "basic");
  expect(msg?.threadId).toBe("basic");
  expect(getSize()).toBe(0);
});

test("priority order: now before next before later", () => {
  clear();
  enqueue(baseMsg({ text: "later", priority: "later" }));
  enqueue(baseMsg({ text: "next", priority: "next" }));
  enqueue(baseMsg({ text: "now", priority: "now" }));
  expect(dequeue()?.text).toBe("now");
  expect(dequeue()?.text).toBe("next");
  expect(dequeue()?.text).toBe("later");
});

test("FIFO within same priority", () => {
  clear();
  enqueue(baseMsg({ text: "first" }));
  enqueue(baseMsg({ text: "second" }));
  expect(dequeue()?.text).toBe("first");
  expect(dequeue()?.text).toBe("second");
});

test("dequeue returns null on empty queue", () => {
  clear();
  expect(dequeue()).toBeNull();
});

test("dequeue with predicate returns null when no match", () => {
  clear();
  enqueue(baseMsg({ threadId: "t1" }));
  expect(dequeue((m) => m.threadId === "t99")).toBeNull();
  expect(getSize()).toBe(1);
});

test("dequeueAllMatching removes all matching in priority order", () => {
  clear();
  enqueue(baseMsg({ threadId: "t1", priority: "later" }));
  enqueue(baseMsg({ threadId: "t1", priority: "now" }));
  enqueue(baseMsg({ threadId: "t2", priority: "next" }));
  const batch = dequeueAllMatching((m) => m.threadId === "t1");
  expect(batch).toHaveLength(2);
  expect(batch[0]?.priority).toBe("now");
  expect(batch[1]?.priority).toBe("later");
  expect(getSize()).toBe(1);
});

test("dequeueAllMatching returns empty array when no match", () => {
  clear();
  enqueue(baseMsg({ threadId: "t1" }));
  expect(dequeueAllMatching((m) => m.threadId === "t99")).toEqual([]);
  expect(getSize()).toBe(1);
});

test("peek returns without removing", () => {
  clear();
  enqueue(baseMsg());
  const p1 = peek();
  expect(p1).not.toBeNull();
  expect(getSize()).toBe(1);
  const p2 = peek();
  expect(p2).not.toBeNull();
});

test("peek returns null on empty queue", () => {
  clear();
  expect(peek()).toBeNull();
});

test("clear with no predicate empties queue", () => {
  clear();
  enqueue(baseMsg());
  enqueue(baseMsg());
  clear();
  expect(getSize()).toBe(0);
});

test("clear with predicate only removes matching", () => {
  clear();
  enqueue(baseMsg({ threadId: "remove" }));
  enqueue(baseMsg({ threadId: "keep" }));
  clear((m) => m.threadId === "remove");
  expect(getSize()).toBe(1);
  expect(peek((m) => m.threadId === "keep")?.threadId).toBe("keep");
});

test("enqueue beyond MAX_QUEUE_SIZE is silently dropped", () => {
  clear();
  for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
    enqueue(baseMsg({ text: `msg${i}` }));
  }
  enqueue(baseMsg({ text: "overflow" }));
  expect(getSize()).toBe(MAX_QUEUE_SIZE);
  const snapshot = getSnapshot();
  for (const m of snapshot) {
    expect(m.text).not.toBe("overflow");
  }
});

test("getSnapshot returns frozen copy", () => {
  clear();
  enqueue(baseMsg());
  const snap = getSnapshot();
  expect(Object.isFrozen(snap)).toBe(true);
  enqueue(baseMsg());
  expect(getSize()).toBe(2);
  expect(snap.length).toBe(1);
});

test("subscribe and unsubscribe work correctly", () => {
  clear();
  let count = 0;
  const unsub = subscribe(() => { count++; });
  enqueue(baseMsg());
  expect(count).toBe(1);
  unsub();
  enqueue(baseMsg());
  expect(count).toBe(1);
});

test("clear with predicate that matches nothing still notifies (queue op signal)", () => {
  clear();
  enqueue(baseMsg({ threadId: "keep" }));
  let notified = false;
  subscribe(() => { notified = true; });
  clear((m) => m.threadId === "nonexistent");
  expect(notified).toBe(true);
});
