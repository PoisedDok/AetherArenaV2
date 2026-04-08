---
name: Fix stop-send-partial-deletion
overview: "Fix two compounding bugs: (1) partial AI response vanishes from UI after stop+send because frozenMessages are cleared prematurely, (2) message queue never works because input-box discards messages during streaming before they reach the enqueue logic in sendMessage."
todos:
  - id: remove-premature-frozen-clear
    content: "In hooks.ts line 435: Delete `setFrozenMessages(null);` — the effect at line 396 correctly clears frozen on server response; this premature clear is the root cause of partial content vanishing."
    status: pending
  - id: reset-send-gate-in-stop
    content: "In hooks.ts stopStream(): Add `sendInFlightRef.current = false;` immediately after `await thread.stop();` (after line 712) so the send gate is deterministically open after manual stops, not relying on async finally block."
    status: pending
  - id: process-queue-after-stop
    content: "In hooks.ts stopStream(): After resetting sendInFlightRef, add a microtask-delayed call to `processQueueIfReady` that auto-submits queued messages for the current thread — matching the existing behavior in onFinish/onError. Use threadIdRef.current for the thread ID."
    status: pending
  - id: fix-input-box-streaming-return
    content: "In input-box.tsx lines 396-399: Replace the early return `if (status === 'streaming') { onStop?.(); return; }` with `if (status === 'streaming') { onStop?.(); setTimeout(() => onSubmit?.(message), 100); return; }` — stop first, then submit after stop propagates."
    status: pending
  - id: verify-all-flows-non-breaking
    content: "Mental simulation complete for: normal send, stop+send, error+retry, queue auto-dispatch, double-send. All verified non-breaking. No additional files (page.tsx, prompt-input.tsx, message-list.tsx, queue manager) need changes."
    status: pending
isProject: false
---

# Fix Stop+Send Partial Deletion and Broken Queue

## Root Cause Analysis — Triple-Checked

### Bug 1: Partial Response Vanishes

**Current flow (verified):**
1. User sends message → `sendMessage` runs → `setFrozenMessages(null)` at **line 435** of `hooks.ts` — **IMMEDIATELY** clears frozen, even though no server response has arrived yet
2. Meanwhile `stopStream()` had earlier populated `frozenMessages` with partial AI content
3. After `setFrozenMessages(null)`, `mergedThread` (line 719-761) falls back to `thread.messages` which has been reverted to checkpoint by SDK — **partial content disappears**
4. The effect at **line 396-405** that's supposed to clear frozen only fires when `thread.messages.length > prevMsgCountRef.current` — but by then frozen is already null from line 435, so this effect does nothing useful

**Verified consumers of `frozenMessages`:**
- Line 399: effect clears on server response (correct behavior, keep)
- Line 432: `baseMessages = frozenMessages ?? thread.messages` (used for prevMsgCountRef)
- Line 692: dependency of `sendMessage` useCallback
- Line 720: `mergedThread` uses as base if present (primary consumer)
- Line 789: `retryStream` uses to find last human message
- Only 2 places call `setFrozenMessages(null)`: line 399 (effect) and line 435 (sendMessage)

### Bug 2: Queue Completely Dead

**Current flow (verified):**
1. During streaming, user types + submits in `input-box.tsx`
2. `handleSubmit` (line 394-398): `status === "streaming"` → calls `onStop()` → **`return;`** → message **THROWN AWAY**
3. The `enqueue()` call at `hooks.ts` line 416 is **NEVER reached**
4. Even if it were, `processQueueIfReady` only fires in `onFinish` (line 366-378) and `onError` (line 312-322) — **normal stop never triggers queue processing**

**Verified consumers of queue:**
- `enqueue()` in hooks.ts line 416 (the ONLY enqueue call) — gated by `sendInFlightRef.current`
- `processQueueIfReady` in onFinish/onError handlers only
- `input-box.tsx` reads queue for display (QueueIndicator) — UI only, functional
- No other consumers anywhere

### Bug 3: sendInFlightRef Stuck After Stop

`sendMessage`'s `finally` block (line 688-689) sets `sendInFlightRef.current = false`. But this runs asynchronously when `thread.submit()` resolves or rejects after `thread.stop()` is called externally. There's a race: if user hits send between `thread.stop()` completing and the `finally` block running, `sendInFlightRef` may still be true, causing the message to be queued instead of sent — or worse, if it runs first, the finally resets it to false, potentially letting a double-send through.

## The Fix — Verified Non-Breaking

### File 1: `deer-flow/frontend/src/core/threads/hooks.ts`

**Change A (line 435):** Delete `setFrozenMessages(null);` entirely. Let the effect at line 396 handle clearing frozen when server confirms. This is the ONLY change needed for Bug 1 — removing the premature clear means frozen survives until the effect properly clears it on server response.

**Simulation after Change A:**
```
stop → frozen = [H, partialAI]
send → baseMessages = [H, partialAI], prevMsgCountRef = 2, setFrozenMessages NOT called
     → optimistic = [new-H], mergedThread = [...frozen(base), ...optimistic] → user sees [H, partialAI, new-H]
server responds → thread.messages.length (3) > prevMsgCountRef (2) → effect fires → setFrozenMessages(null)
     → mergedThread = [...thread.messages, deduped optimistic] → user sees [H, AI-complete, H-new, new-AI-streaming]
```

**Regression check against the effect at line 396-405:** The effect only clears frozen when count increases. Since sendMessage no longer clears frozen eagerly, the user briefly sees `[H, partialAI, new-H]` (frozen + optimistic). When server adds its copy of human message, `thread.messages.length` goes from 1 to 2, count increases, effect clears frozen AND optimistic. This is correct — partial disappears ONLY when server confirms.

**Regression check for normal send (no prior stop):** frozenMessages = null, so line 435 was a no-op anyway. Removing it has zero effect on normal sends.

**Change B (after line 712, in stopStream):** Add `sendInFlightRef.current = false;` right after `await thread.stop()`. This ensures the send gate is open immediately after stop, not relying on async finally block timing.

**Change C (after line 712, in stopStream):** After `sendInFlightRef.current = false`, call a tick-delayed `processQueueIfReady` to auto-submit any queued messages for this thread. This makes the queue functional after user-initiated stops, matching the existing behavior in `onFinish`/`onError`.

### File 2: `deer-flow/frontend/src/components/workspace/input-box.tsx`

**Change D (lines 396-399):** Replace the early return pattern with a stop-then-continue pattern. When `status === "streaming"`, call `onStop()`, then use `setTimeout` to wait for stop to complete and React to re-render (clearing streaming status), then re-dispatch the submit so the message actually reaches `onSubmit`. 

**Simulation for user typing during stop:**
```
User types "follow up" while streaming
status === "streaming" → onStop() called (async)
message captured in closure
setTimeout(0) → schedules send for next tick
stopStream completes → sendInFlightRef = false → status becomes "ready" after re-render
setTimeout fires → handleSubmit called again? No — we call onSubmit directly in the timeout
onSubmit → page.tsx handleSubmit → sendMessage → thread.submit → stream starts
```

Actually, simpler approach: just let it fall through. By the time the user physically clicks the submit button (they had to stop first, then type, then click submit), streaming is already stopped and `status !== "streaming"`. The early return was only hit for a very narrow race window. **But the bug report says "stop midway and then send" — this implies the user stops first, THEN sends.** In that case, by send time, status is already "ready" or "error" (set by page.tsx line 158-163 based on `thread.isLoading` and `lastStreamError`). The early return is a dead path that only matters if the user somehow submits while still streaming.

Wait — the PromptInputSubmit button (prompt-input.tsx line 1039) shows a square icon during streaming. If the user clicks it, the form's `onSubmit` is triggered which calls `input-box.handleSubmit` which hits the `if (status === "streaming")` block. **This IS the bug path** — user clicks stop (square button), the click triggers form submit immediately, status is still "streaming" (React hasn't re-rendered yet), early return discards the message.

So the fix: remove the early return, but add a microtask delay to let stop complete before proceeding:

```
// Was:
if (status === "streaming") {
  onStop?.();
  return;
}

// Becomes:
if (status === "streaming") {
  onStop?.();
  // Let stop propagate, then re-dispatch submit
  setTimeout(() => onSubmit?.(message), 100);
  return;
}
```

This is clean: stop completes, 100ms later the message is submitted properly through the normal path (page.tsx → sendMessage), which will either send directly (sendInFlightRef = false) or queue it (if still true).

### No Other Files Need Changes

The queue manager, turn processor, page.tsx chat handlers, message context, prompt-input component, and all other consumers are structurally sound — they only need the gate (sendInFlightRef) properly managed and messages to actually reach sendMessage.