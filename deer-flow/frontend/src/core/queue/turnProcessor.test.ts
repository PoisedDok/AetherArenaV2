import { expect, test, describe } from "vitest";

import { clear, enqueue, getSnapshot } from "./messageQueueManager";
import { processQueueIfReady, getQueueSummary } from "./turnProcessor";

const baseMsg = (
  overrides: Partial<Parameters<typeof enqueue>[0]> = {},
) => ({
  threadId: "t1",
  text: "hello",
  priority: "next" as const,
  hasAttachments: false,
  ...overrides,
});

describe("processQueueIfReady", () => {
  test("returns not processed when queue empty", () => {
    clear();
    const result = processQueueIfReady("t1");
    expect(result.processed).toBe(false);
    expect(result.messages).toEqual([]);
  });

  test("returns not processed when no messages for matching thread", () => {
    clear();
    enqueue(baseMsg({ threadId: "other" }));
    const result = processQueueIfReady("t1");
    expect(result.processed).toBe(false);
    expect(result.messages).toEqual([]);
  });

  test("processes and returns messages for matching thread", () => {
    clear();
    enqueue(baseMsg({ threadId: "t1", text: "msg1" }));
    enqueue(baseMsg({ threadId: "t1", text: "msg2" }));
    enqueue(baseMsg({ threadId: "t2", text: "other" }));
    const result = processQueueIfReady("t1");
    expect(result.processed).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]?.content).toBe("msg1");
    expect(result.messages[1]?.content).toBe("msg2");
    expect(result.messages[0]?.skipAttachments).toBe(false);
    expect(result.messages[1]?.skipAttachments).toBe(true);
  });

  test("only drains next priority automatically", () => {
    clear();
    enqueue(baseMsg({ threadId: "t1", text: "later", priority: "later" }));
    enqueue(baseMsg({ threadId: "t1", text: "now", priority: "now" }));
    enqueue(baseMsg({ threadId: "t1", text: "next", priority: "next" }));
    const result = processQueueIfReady("t1");
    expect(result.processed).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe("next");
  });

  test("first message gets skipAttachments false, rest true", () => {
    clear();
    enqueue(baseMsg({ threadId: "t1", text: "first", hasAttachments: true }));
    enqueue(baseMsg({ threadId: "t1", text: "second", hasAttachments: false }));
    enqueue(baseMsg({ threadId: "t1", text: "third" }));
    const result = processQueueIfReady("t1");
    expect(result.messages[0]?.skipAttachments).toBe(false);
    expect(result.messages[1]?.skipAttachments).toBe(true);
    expect(result.messages[2]?.skipAttachments).toBe(true);
  });
});

describe("getQueueSummary", () => {
  test("returns empty summary when queue empty", () => {
    clear();
    const summary = getQueueSummary("t1");
    expect(summary.total).toBe(0);
    expect(summary.byPriority).toEqual({ now: 0, next: 0, later: 0 });
    expect(summary.oldestTimestamp).toBeNull();
  });

  test("returns summary with counts by priority", () => {
    clear();
    enqueue(baseMsg({ priority: "now" }));
    enqueue(baseMsg({ priority: "next" }));
    enqueue(baseMsg({ priority: "next" }));
    enqueue(baseMsg({ priority: "later" }));
    const summary = getQueueSummary();
    expect(summary.total).toBe(4);
    expect(summary.byPriority).toEqual({ now: 1, next: 2, later: 1 });
  });

  test("filters summary by threadId when provided", () => {
    clear();
    enqueue(baseMsg({ threadId: "t1", priority: "now" }));
    enqueue(baseMsg({ threadId: "t2", priority: "next" }));
    enqueue(baseMsg({ threadId: "t1", priority: "later" }));
    const t1Summary = getQueueSummary("t1");
    expect(t1Summary.total).toBe(2);
    expect(t1Summary.byPriority).toEqual({ now: 1, next: 0, later: 1 });
    const t2Summary = getQueueSummary("t2");
    expect(t2Summary.total).toBe(1);
    expect(t2Summary.byPriority).toEqual({ now: 0, next: 1, later: 0 });
  });

  test("returns oldest timestamp", () => {
    clear();
    enqueue(baseMsg({ threadId: "ts1" }));
    const t1 = getSnapshot()[0]!.timestamp;
    enqueue(baseMsg({ threadId: "ts2" }));
    const summary = getQueueSummary();
    expect(summary.oldestTimestamp).toBe(t1);
  });
});
