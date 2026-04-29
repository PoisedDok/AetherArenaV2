/**
 * Gate lifecycle & queue drain integration tests.
 *
 * These tests exercise the exact invariants that were broken before the
 * sendInFlightRef fix (commit that removed the premature `finally` reset and
 * moved `sendInFlightRef.current = false` unconditionally before the drain IIFE
 * in `onFinish`).
 *
 * They model the gate as a plain boolean ref (matching the React useRef pattern
 * in hooks.ts) and the drain as the `processQueueIfReady` call made by
 * onFinish / onError / stopStream. No React, no DOM required.
 *
 * Invariants under test:
 *   1. Gate is true while a stream is in flight.
 *   2. Messages sent while gate=true go to the queue (not sent directly).
 *   3. Gate is reset to false BEFORE drain — so queued messages can be sent.
 *   4. Gate reset is unconditional — happens even when the queue is empty.
 *   5. Gate reset is idempotent — resetting an already-false gate is harmless.
 *   6. All three drain sites (onFinish, onError, stopStream) follow the same pattern.
 *   7. Double-drain is safe (second drain finds empty queue, returns processed=false).
 *   8. After a drain, newly queued messages are picked up by the next drain.
 */

import { describe, test, expect, beforeEach } from "vitest";

import { clear, enqueue, getSize } from "./messageQueueManager";
import { processQueueIfReady } from "./turnProcessor";

const THREAD_ID = "gate-test-thread";

function makeMsg(text: string) {
  return { threadId: THREAD_ID, text, priority: "next" as const, hasAttachments: false };
}

/** Minimal gate simulation — mirrors hooks.ts sendInFlightRef behaviour. */
function makeGate() {
  let inflight = false;
  return {
    lock: () => { inflight = true; },
    release: () => { inflight = false; },
    isLocked: () => inflight,
  };
}

/**
 * Simulate sendMessage: if gate is locked, enqueue; otherwise lock and "submit".
 * Returns true if the message was submitted (gate was free), false if enqueued.
 */
function simulateSendMessage(gate: ReturnType<typeof makeGate>, text: string): boolean {
  if (gate.isLocked()) {
    enqueue(makeMsg(text));
    return false; // queued
  }
  gate.lock();
  return true; // submitted
}

/**
 * Simulate onFinish: release gate UNCONDITIONALLY, then drain queue.
 * This matches the fixed code path in hooks.ts.
 */
function simulateOnFinish(gate: ReturnType<typeof makeGate>): ReturnType<typeof processQueueIfReady> {
  // FIXED: gate release is unconditional and happens BEFORE drain
  gate.release();
  return processQueueIfReady(THREAD_ID);
}

/**
 * Simulate the OLD (broken) onFinish: gate release inside drain conditional.
 * Used in regression tests to prove the bug.
 */
function simulateOnFinishBroken(gate: ReturnType<typeof makeGate>): ReturnType<typeof processQueueIfReady> {
  const result = processQueueIfReady(THREAD_ID);
  if (result.processed && result.messages.length > 0) {
    gate.release(); // BUG: only releases when queue had items
  }
  return result;
}

/**
 * Simulate onError: same pattern as onFinish (release before drain).
 */
function simulateOnError(gate: ReturnType<typeof makeGate>): ReturnType<typeof processQueueIfReady> {
  gate.release();
  return processQueueIfReady(THREAD_ID);
}

/**
 * Simulate stopStream: release gate synchronously, then drain.
 */
function simulateStopStream(gate: ReturnType<typeof makeGate>): ReturnType<typeof processQueueIfReady> {
  gate.release();
  return processQueueIfReady(THREAD_ID);
}

beforeEach(() => {
  clear();
});

// ---------------------------------------------------------------------------
// Invariant 1-3: basic M1 → M2 concurrent submission scenario
// ---------------------------------------------------------------------------

describe("concurrent submission: M2 sent while M1 is streaming", () => {
  test("M2 is queued when gate is locked (M1 in flight)", () => {
    const gate = makeGate();
    const m1Submitted = simulateSendMessage(gate, "M1");
    expect(m1Submitted).toBe(true);
    expect(gate.isLocked()).toBe(true);
    expect(getSize()).toBe(0);

    // M2 arrives while M1 stream is running
    const m2Submitted = simulateSendMessage(gate, "M2");
    expect(m2Submitted).toBe(false); // queued, NOT submitted
    expect(getSize()).toBe(1);
    expect(gate.isLocked()).toBe(true); // gate still locked — M1 still streaming
  });

  test("M2 is drained and submitted when M1 onFinish fires", () => {
    const gate = makeGate();
    simulateSendMessage(gate, "M1"); // submits, locks gate
    simulateSendMessage(gate, "M2"); // queued
    expect(getSize()).toBe(1);

    // M1 stream ends
    const result = simulateOnFinish(gate);
    expect(gate.isLocked()).toBe(false); // gate released BEFORE drain
    expect(result.processed).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe("M2");
    expect(getSize()).toBe(0);
  });

  test("M3 queued after M2 is drained correctly by next onFinish", () => {
    const gate = makeGate();
    simulateSendMessage(gate, "M1");
    simulateSendMessage(gate, "M2");

    // M1 finishes → drains M2
    const r1 = simulateOnFinish(gate);
    expect(r1.messages[0]?.content).toBe("M2");

    // Simulate M2 submission: re-lock gate (sendMessage would do this)
    gate.lock();
    // M3 arrives while M2 is streaming
    simulateSendMessage(gate, "M3");
    expect(getSize()).toBe(1);

    // M2 finishes → drains M3
    const r2 = simulateOnFinish(gate);
    expect(r2.processed).toBe(true);
    expect(r2.messages[0]?.content).toBe("M3");
    expect(getSize()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Invariant 4: gate reset is unconditional (the key bug fix)
// ---------------------------------------------------------------------------

describe("gate reset is unconditional — empty queue must not lock the gate forever", () => {
  test("FIXED: gate is released even when queue is empty after stream finishes", () => {
    const gate = makeGate();
    simulateSendMessage(gate, "M1"); // submits, locks gate

    // M1 finishes; no M2 was queued
    const result = simulateOnFinish(gate);
    expect(gate.isLocked()).toBe(false); // MUST be false regardless of queue
    expect(result.processed).toBe(false); // queue was empty
    expect(result.messages).toHaveLength(0);

    // The next sendMessage MUST be able to submit (gate is open)
    const m2Submitted = simulateSendMessage(gate, "M2-after-stream");
    expect(m2Submitted).toBe(true);
  });

  test("REGRESSION: broken onFinish locks gate forever when queue empty", () => {
    // This test documents the pre-fix bug — broken implementation keeps gate true
    const gate = makeGate();
    simulateSendMessage(gate, "M1");

    // Stream ends, broken drain
    simulateOnFinishBroken(gate);
    // Bug: gate is still locked because the conditional didn't fire
    expect(gate.isLocked()).toBe(true); // ← this is the bug behaviour

    // Consequence: all subsequent sends are silently enqueued forever
    const m2Submitted = simulateSendMessage(gate, "M2");
    expect(m2Submitted).toBe(false); // M2 stuck in queue
    expect(getSize()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Invariant 5: gate reset is idempotent
// ---------------------------------------------------------------------------

describe("gate reset idempotency", () => {
  test("releasing an already-false gate is safe and has no side effects", () => {
    const gate = makeGate();
    expect(gate.isLocked()).toBe(false);
    gate.release(); // should be a no-op
    expect(gate.isLocked()).toBe(false);

    // Can still submit normally
    const submitted = simulateSendMessage(gate, "normal");
    expect(submitted).toBe(true);
    expect(gate.isLocked()).toBe(true);
  });

  test("double onFinish (e.g. race between two drain callers) is safe", () => {
    const gate = makeGate();
    simulateSendMessage(gate, "M1");
    enqueue(makeMsg("M2"));

    // First drain (normal onFinish path)
    const r1 = simulateOnFinish(gate);
    expect(r1.processed).toBe(true);
    expect(r1.messages[0]?.content).toBe("M2");

    // Second drain fires (e.g. onError after stopStream already drained)
    gate.release(); // second release — idempotent
    const r2 = processQueueIfReady(THREAD_ID);
    expect(r2.processed).toBe(false); // queue already empty — correct
    expect(r2.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invariant 6: all three drain sites behave identically
// ---------------------------------------------------------------------------

describe("all three drain sites (onFinish, onError, stopStream) are equivalent", () => {
  test("onFinish drains and releases gate", () => {
    const gate = makeGate();
    gate.lock();
    enqueue(makeMsg("queued"));
    const result = simulateOnFinish(gate);
    expect(gate.isLocked()).toBe(false);
    expect(result.processed).toBe(true);
    expect(result.messages[0]?.content).toBe("queued");
  });

  test("onError drains and releases gate", () => {
    const gate = makeGate();
    gate.lock();
    enqueue(makeMsg("queued"));
    const result = simulateOnError(gate);
    expect(gate.isLocked()).toBe(false);
    expect(result.processed).toBe(true);
    expect(result.messages[0]?.content).toBe("queued");
  });

  test("stopStream drains and releases gate", () => {
    const gate = makeGate();
    gate.lock();
    enqueue(makeMsg("queued"));
    const result = simulateStopStream(gate);
    expect(gate.isLocked()).toBe(false);
    expect(result.processed).toBe(true);
    expect(result.messages[0]?.content).toBe("queued");
  });

  test("all three behave identically on empty queue", () => {
    for (const simFn of [simulateOnFinish, simulateOnError, simulateStopStream]) {
      clear();
      const gate = makeGate();
      gate.lock();
      const result = simFn(gate);
      expect(gate.isLocked()).toBe(false);   // gate released regardless
      expect(result.processed).toBe(false);  // empty queue
      expect(result.messages).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 7: double-drain safety
// ---------------------------------------------------------------------------

describe("double-drain safety", () => {
  test("stopStream drain + onError drain does not re-process messages", () => {
    const gate = makeGate();
    gate.lock();
    enqueue(makeMsg("once"));

    // stopStream fires first
    const r1 = simulateStopStream(gate);
    expect(r1.processed).toBe(true);
    expect(r1.messages[0]?.content).toBe("once");

    // onError fires after (race condition or error after stop)
    const r2 = simulateOnError(gate);
    expect(r2.processed).toBe(false); // already drained
    expect(r2.messages).toHaveLength(0);
    expect(getSize()).toBe(0); // no duplication
  });
});

// ---------------------------------------------------------------------------
// Invariant 8: newly queued messages after a drain are picked up next cycle
// ---------------------------------------------------------------------------

describe("messages queued after drain are picked up by next cycle", () => {
  test("user types M3 right after M2 finishes → M3 drained in M2's onFinish cycle", () => {
    // This simulates the timing edge case:
    // M2 is sent (sendMessage submitted it → gate locked)
    // User types M3 while M2 streams → M3 enqueued
    // M2's onFinish fires → releases gate, drains M3 immediately
    const gate = makeGate();
    simulateSendMessage(gate, "M2"); // gate locked
    enqueue(makeMsg("M3")); // user typed M3 during M2 stream

    const result = simulateOnFinish(gate);
    expect(result.processed).toBe(true);
    expect(result.messages[0]?.content).toBe("M3");
    expect(getSize()).toBe(0);
  });

  test("multiple queued messages are all drained in one cycle (FIFO)", () => {
    const gate = makeGate();
    gate.lock(); // stream in flight

    enqueue(makeMsg("Q1"));
    enqueue(makeMsg("Q2"));
    enqueue(makeMsg("Q3"));
    expect(getSize()).toBe(3);

    const result = simulateOnFinish(gate);
    expect(result.processed).toBe(true);
    expect(result.messages).toHaveLength(3);
    expect(result.messages.map((m) => m.content)).toEqual(["Q1", "Q2", "Q3"]);
    expect(getSize()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Full scenario: stop-and-send (interrupted stream)
// ---------------------------------------------------------------------------

describe("full scenario: stop-and-send (user stops M1, types M2 immediately)", () => {
  test("M2 sent during streaming → enqueued → stopStream drains M2", () => {
    const gate = makeGate();

    // M1 submitted
    const m1Ok = simulateSendMessage(gate, "M1");
    expect(m1Ok).toBe(true);
    expect(gate.isLocked()).toBe(true);

    // User submits M2 while M1 streams (input-box sends onSubmit then onStop)
    const m2Ok = simulateSendMessage(gate, "M2-while-streaming");
    expect(m2Ok).toBe(false); // queued
    expect(getSize()).toBe(1);

    // stopStream: gate released, drain fires
    const drainResult = simulateStopStream(gate);
    expect(gate.isLocked()).toBe(false);
    expect(drainResult.processed).toBe(true);
    expect(drainResult.messages[0]?.content).toBe("M2-while-streaming");
    expect(getSize()).toBe(0);
  });

  test("stop with no queued messages leaves gate open and queue empty", () => {
    const gate = makeGate();
    simulateSendMessage(gate, "M1");
    // User stops but doesn't send anything during the stream
    const drainResult = simulateStopStream(gate);
    expect(gate.isLocked()).toBe(false);
    expect(drainResult.processed).toBe(false);
    expect(getSize()).toBe(0);

    // Next send goes through normally
    const nextOk = simulateSendMessage(gate, "M2-after-stop");
    expect(nextOk).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invariant 9: threadId-change must NOT reset gate during active stream
// (the new-thread creation bug: server assigns real thread_id mid-stream)
// ---------------------------------------------------------------------------

/**
 * Simulate the threadId-change effect logic (from hooks.ts useEffect).
 *
 * @param gate - the gate ref
 * @param serverThreadId - what serverThreadIdRef.current holds (set by onCreated)
 * @param newThreadId - the new threadId prop value
 * @returns whether the gate was reset
 */
function simulateThreadIdChangeEffect(
  gate: ReturnType<typeof makeGate>,
  serverThreadId: string | null,
  newThreadId: string | null,
): { gateReset: boolean } {
  // Mirror the exact logic in hooks.ts:
  // isServerIdAssignment = newThreadId !== null && serverThreadId === newThreadId
  const isServerIdAssignment = newThreadId !== null && serverThreadId === newThreadId;

  if (!isServerIdAssignment) {
    gate.release();
    return { gateReset: true };
  }
  // Server-ID assignment: gate stays as-is
  return { gateReset: false };
}

describe("threadId-change effect: gate ownership during new thread creation", () => {
  test("FIXED: server-ID assignment does NOT reset gate (stream still in flight)", () => {
    const gate = makeGate();
    const serverThreadId = "server-real-id-123";

    // M1 submitted → gate locked
    gate.lock();
    enqueue(makeMsg("M2-queued-during-stream"));

    // onCreated fires: serverThreadIdRef set, URL updates, threadId prop changes
    // → threadId-change effect fires with new threadId = serverThreadId
    const { gateReset } = simulateThreadIdChangeEffect(gate, serverThreadId, serverThreadId);

    expect(gateReset).toBe(false);    // gate NOT reset — stream still owns it
    expect(gate.isLocked()).toBe(true); // still locked
    expect(getSize()).toBe(1);          // M2 still safely in queue

    // Stream ends normally → onFinish releases gate and drains
    const result = simulateOnFinish(gate);
    expect(gate.isLocked()).toBe(false);
    expect(result.processed).toBe(true);
    expect(result.messages[0]?.content).toBe("M2-queued-during-stream");
  });

  test("REGRESSION: old behavior — server-ID assignment resets gate prematurely", () => {
    // This documents the pre-fix bug. Without the guard, any threadId change
    // resets the gate, allowing M2 to bypass the queue.
    const gate = makeGate();
    gate.lock();
    enqueue(makeMsg("M2-queued-during-stream"));

    // Old (broken) behavior: gate reset unconditionally on any threadId change
    gate.release(); // ← what the old code did
    expect(gate.isLocked()).toBe(false); // gate open WHILE STREAM STILL RUNNING

    // Consequence: M2 goes directly through, bypassing the queue
    const m2Submitted = simulateSendMessage(gate, "M2-should-have-been-queued");
    expect(m2Submitted).toBe(true); // BUG: M2 submitted concurrently with M1
    // M1 is now racing with M2 on LangGraph — M1 gets discarded
  });

  test("genuine thread navigation DOES reset gate and clears state", () => {
    const gate = makeGate();
    const serverThreadId = "server-real-id-123";

    // User was on thread A, now navigates to thread B
    // serverThreadId is from old thread (or null after navigation clears it)
    gate.lock(); // simulate: somehow gate was left locked (edge case)

    const { gateReset } = simulateThreadIdChangeEffect(gate, serverThreadId, "completely-different-thread-id");

    expect(gateReset).toBe(true);     // gate reset — different thread
    expect(gate.isLocked()).toBe(false);
  });

  test("null serverThreadId + new threadId = navigation (gate reset)", () => {
    const gate = makeGate();
    gate.lock();

    // serverThreadIdRef is null (cleared on previous navigation)
    const { gateReset } = simulateThreadIdChangeEffect(gate, null, "new-thread-id");

    expect(gateReset).toBe(true); // no server ID to match → treat as navigation
    expect(gate.isLocked()).toBe(false);
  });

  test("M2 sent after server-ID assignment stays queued until M1 finishes", () => {
    const gate = makeGate();
    const serverThreadId = "server-real-id-abc";

    // M1 submitted on new thread (null threadId → gate locked)
    gate.lock();

    // Server assigns thread_id → threadId-change effect fires (fixed: gate NOT reset)
    simulateThreadIdChangeEffect(gate, serverThreadId, serverThreadId);
    expect(gate.isLocked()).toBe(true); // gate stays locked

    // User sends M2 while M1 still streams
    const m2Ok = simulateSendMessage(gate, "M2-concurrent");
    expect(m2Ok).toBe(false); // correctly queued
    expect(getSize()).toBe(1);

    // M1 stream finishes → gate released → M2 drained
    const result = simulateOnFinish(gate);
    expect(gate.isLocked()).toBe(false);
    expect(result.processed).toBe(true);
    expect(result.messages[0]?.content).toBe("M2-concurrent");
  });
});
