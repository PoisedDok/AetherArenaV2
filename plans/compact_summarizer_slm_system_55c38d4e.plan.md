---
name: Compact Summarizer SLM System
overview: Extract the conversation compact/summarization system from Claude Code and adapt it into deer-flow, optimized for SLM (small language model) contexts. Includes auto-compact triggers, manual user-initiated summarization, token budget management, post-compaction file restoration, PTL retry escape hatches, micro-compaction, and comprehensive testing.
todos:
  - id: compact-types
    content: Define all compact types (CompactionResult, AutoCompactTrackingState, PartialCompactDirection, Config)
    status: pending
  - id: compact-prompts
    content: Create SLM-optimized compact prompts with NO_TOOLS preamble/trailer, analysis+summary xml structure, adapted from Claude Code production prompts
    status: pending
  - id: compact-engine
    content: Build core compact engine: compactConversation with forked agent + streaming fallback, PTL retry loop, image stripping, post-compact file restoration
    status: pending
  - id: partial-compaction
    content: Build partial compaction with 'earlier'/'later' directions, adjustIndexToPreserveAPIInvariants for tool_pair and thinking_block invariants
    status: pending
  - id: compact-grouping
    content: Message grouping by API round (PTL retries, token estimation)
    status: pending
  - id: compact-token-counting
    content: Token estimation pipeline: estimateMessageTokens, tokenCountWithEstimation, roughTokenCountEstimation
    status: pending
  - id: compact-ptl-retry
    content: Implement truncateHeadForPTLRetry with marker stripping, API-round grouping, gap parsing, synthetic prepend
    status: pending
  - id: compact-post-restore
    content: Post-compaction file restoration: createPostCompactFileAttachments, plan/skill/agent attachments, budget enforcement
    status: pending
  - id: auto-compact
    content: Auto-compaction: shouldAutoCompact, autoCompactIfNeeded, circuit breaker (3 failures), recompaction tracking
    status: pending
  - id: auto-compact-ui
    content: Token threshold warnings (20K), error limits (3K), percentage-based override for SLM models
    status: pending
  - id: micro-compact-time
    content: Time-based micro-compact: gap detection, keepRecent, tool result clearing, token savings tracking
    status: pending
  - id: away-summary
    content: Away/session resume summary using small fast model on last 30 messages
    status: pending
  - id: compact-hooks
    content: Pre-compact and post-compact hook system: executePreCompactHooks, executePostCompactHooks, SessionStart hooks, mergeHookInstructions, collapseHookSummaries
    status: pending
  - id: compact-cleanup
    content: Post-compaction cleanup: microcompact state, caches, system prompt sections, attribution sweep
    status: pending
  - id: compact-ui-components
    content: CompactBoundary.tsx, CompactSummary.tsx, TokenUsageIndicator.tsx, compactWarningSuppression
    status: pending
  - id: compact-command
    content: /compact command handler: manual trigger, custom instructions, SM-compact attempt first, reactive mode fallback
    status: pending
  - id: compact-test
    content: Full test suite for all modules (Claude Code has ZERO dedicated compact tests - this is critical to get right)
    status: pending
isProject: false
---

# Compact/Summarization System for SLM-Ready Architecture

## Source Audit

The Claude Code compact system spans 4,705 lines across these key files:

| File | Lines | Status for deer-flow |
|------|-------|---------------------|
| `src/services/compact/compact.ts` | 1,707 | Must implement core |
| `src/services/compact/autoCompact.ts` | 353 | Must implement |
| `src/services/compact/microCompact.ts` | 531 | Must implement time-based; cached MC optional |
| `src/services/compact/sessionMemoryCompact.ts` | 632 | Must implement (session memory pruning) |
| `src/services/compact/prompt.ts` | 376 | Must adapt for SLM |
| `src/services/compact/postCompactCleanup.ts` | 79 | Must implement |
| `src/services/compact/grouping.ts` | 65 | Must implement |
| `src/services/compact/compactWarningState.ts` | 20 | Must implement (UI) |
| `src/services/compact/compactWarningHook.ts` | 18 | Must implement (UI hook) |
| `src/services/compact/timeBasedMCConfig.ts` | 45 | Must implement |
| `src/services/compact/cachedMicrocompact.ts` | (lazy, feature-gated) | OPTIONAL |
| `src/services/awaySummary.ts` | 75 | Must implement |
| `src/utils/collapseHookSummaries.ts` | 60 | Must implement |

**Critical finding: ZERO dedicated test files exist for compact in Claude Code's 4,705 lines of production code.** This is a gap we must close. All modules listed above need tests.

## Key Mechanisms - Full Detail

### 1. Token Threshold System
- Auto-compact fires at `effectiveContextWindow - 13,000` tokens
- `effectiveContextWindow = min(modelMaxOutput, 20000)` reserved, so effective = total - reserved
- Warning threshold at 20K buffer
- Error threshold at 20K buffer
- Blocking limit at 3K buffer
- Env override `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` for percentage-based triggers (SLM-critical)
- Env override `CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE` for blocking threshold
- Env override `CLAUDE_CODE_AUTO_COMPACT_WINDOW` for context window override

### 2. Prompt Cache Sharing (forked agent)
- Primary path: `runForkedAgent()` reuses parent conversation's cached prefix
- Inherited: system prompt, tools, model, thinking config, message prefix
- Setting maxOutputTokens would break cache key matching - forbidden
- Compaction uses `maxTurns: 1, canUseTool: deny-all, skipCacheWrite: true`
- Failure rate: 2.79% on Sonnet 4.6+ vs 0.01% on 4.5 (adaptive-thinking models attempt tool calls despite instructions)
- Falls back to streaming path on: no text output, API error, exception, prompt-too-long
- NO_TOOLS_PREAMBLE is critical - warns model that tool calls will be REJECTED and will fail the task

### 3. Circuit Breaker
- `AutoCompactTrackingState.consecutiveFailures` counter
- Trips at 3 consecutive failures
- Logs warning when tripped
- Resets to 0 on success
- Without this, sessions with irrecoverably long context hammer the API endlessly

### 4. PTL (Prompt Too Long) Retry Escape Hatch
- Maximum 3 retries (`MAX_PTL_RETRIES = 3`)
- Algorithm:
  1. Strip previous `PTL_RETRY_MARKER` to avoid stalling
  2. Group messages by API round
  3. Parse token gap from error response; if unparseable, drop 20% of groups
  4. Drop oldest API-round groups until gap is covered
  5. Always keep at least 1 group
  6. If result starts with assistant message, prepend synthetic user marker
- Marker: `[earlier conversation truncated for compaction retry]`
- `ERROR_MESSAGE_PROMPT_TOO_LONG` if nothing left to drop
- Telemetry: `tengu_compact_ptl_retry` event per attempt

### 5. Post-Compact File Restoration
- Budgets: 50K total, 5K per file, 5 files max
- Skills: 25K total, 5K per skill, sorted most-recent-first
- Selects recently-read files from `readFileState` cache
- Re-reads via FileReadTool (ensures latest content)
- Dedup: skips files already in preserved messages' Read tool results
  - EXCEPT if result is `FILE_UNCHANGED_STUB` - do NOT skip, re-inject real content
- Re-announcements:
  - Plan attachment (`getPlan()`, plan file path)
  - Async agent attachments (running/finished but not retrieved)
  - Plan mode attachment (if active)
  - Skill attachment (invoked skills)
  - Deferred tools delta
  - Agent listing delta
  - MCP instructions delta

### 6. Partial Compaction
- Two directions: `earlier` (keep prefix, summarize suffix) and `later` (keep suffix, summarize prefix)
- Direction `earlier`: cache-safe since kept messages ARE the cache prefix
  - Keeps old compact boundaries intact
  - Anchor uuid = boundary message uuid
- Direction `later`: summary placed before kept messages (breaks cache)
  - Strips old compact boundaries/summaries from kept messages to avoid boundary chain corruption
  - Anchor uuid = last uuid of summary message (fallback: boundary uuid)
  - Both directions: filters progress messages from messagesToKeep
- `adjustIndexToPreserveAPIInvariants` solves two problems:
  1. Tool use/result pairing: if kept range has tool_results, must include tool_use blocks. Scans backwards for missing tool_use IDs.
  2. Thinking block pairing: streaming splits thinking/tool_use into separate messages with same message.id. Must include all parts. Scans backwards for matching message.ids.
- User feedback can be passed as custom instructions (merged with hook instructions via mergeHookInstructions)

### 7. Session Memory Compact (SM-Compact)
- Env overrides: `ENABLE_CLAUDE_CODE_SM_COMPACT` / `DISABLE_CLAUDE_CODE_SM_COMPACT`
- Requires both `tengu_session_memory` and `tengu_sm_compact` feature flags
- Config: minTokens=10K, minTextBlockMessages=5, maxTokens=40K
- Flow:
  1. Wait for session memory extraction (with timeout)
  2. Normal: use lastSummarizedMessageId as boundary
  3. Resumed session (no boundary): all messages treated as unsummarized
  4. calculateMessagesToKeepIndex: expand backwards from lastSummarizedIndex+1 until minTokens+minTextBlockMessages met or maxTokens reached, floored at last boundary+1
  5. Filter out old compact boundary messages from messagesToKeep
  6. Apply adjustIndexToPreserveAPIInvariants
  7. Truncate session memory if oversized
  8. Returns null if postCompact exceeds autoCompactThreshold (fallback to legacy)
- Cheaper than full summarization (no API call to generate summary)

### 8. Time-Based Micro-Compact
- Config: enabled=false, gapThresholdMinutes=60, keepRecent=5
- Trigger: main-thread querySource, gap exceeds threshold
- Collects compactable tool IDs (FILE_READ, FILE_EDIT, FILE_WRITE, GLOB, GREP, WEB_SEARCH, WEB_FETCH, all SHELL tools)
- Keeps most recent N, clears the rest: replaces tool_result content with `[Old tool result content cleared]`
- Clears warning suppression at start
- Resets microcompact state
- Notifies cache deletion (prompt cache break detection)

### 9. Cached Micro-Compact (OPTIONAL for deer-flow)
- Feature-gated: requires CACHED_MICROCOMPACT feature flag
- Does NOT mutate message content - instead registers cache_edits for API layer
- `registerToolResult(state, id)` groups by user message
- `getToolResultsToDelete(state)` returns compactable set
- `createCacheEditsBlock(state, toolsToDelete)` prepares edits
- Boundary message deferred until after API response (actual cache_deleted_input_tokens)

### 10. Image Stripping
- `stripImagesFromMessages()` replaces image/document text blocks with text markers
- Handles nested media inside tool_result content arrays
- `stripReinjectedAttachments()` filters out skill_discovery/skill_listing attachments when EXPERIMENTAL_SKILL_SEARCH

### 11. Away Summary
- Takes last 30 messages + away summary prompt
- Uses small fast model, no tools, no thinking, no cache write
- Returns null on abort, empty transcript, or error

### 12. Message Ordering Invariant (buildPostCompactMessages)
Strict ordering enforced:
1. boundaryMarker (always first)
2. summaryMessages (compact summary content)
3. messagesToKeep (preserved recent messages, if any)
4. attachments (files, agents, plan, skills, deltas)
5. hookResults (session-start hook outputs)

### 13. Hook System
- Pre-compact hooks: `executePreCompactHooks(trigger, customInstructions)`
  - Returns instructions string to merge with compact prompt
- Post-compact hooks: `executePostCompactHooks(result)`
  - Returns display messages to append after compaction
- SessionStart hooks: `processSessionStartHooks('compact', {model})`
  - Run after compaction, results appended as hookResults
- `mergeHookInstructions(userInstructions, hookInstructions)`: user first, empty->undefined
- `collapseHookSummaries(messages)`: collapses consecutive hook summaries with same hookLabel, aggregates hookCount/hookInfos/hookErrors

### 14. Post-Compact Cleanup (runPostCompactCleanup)
- Main-thread check: querySource undefined, starts with 'repl_main_thread', or equals 'sdk'
- Always: reset microcompact state
- If CONTEXT_COLLAPSE + main-thread: reset context collapse
- If main-thread: clear getUserContext cache, clear getMemoryFiles cache
- Always: clear system prompt sections, classifier approvals, speculative checks, beta tracing state, session messages cache
- If COMMIT_ATTRIBUTION: sweep attribution file content cache
- Does NOT reset invoked skill content (must survive across compactions)
- Does NOT reset main-thread module state when subagents are compacting

### 15. /compact Command
- Gets messages after compact boundary (strips snipped messages)
- Guard: empty messages -> throw with user-facing message
- Attempts session memory compaction first (if no custom instructions)
- Reactive-only mode: compactViaReactive()
- Falls back to: microcompact first, then compactConversation
- Error mapping: aborted -> "Compaction canceled.", not enough messages -> rethrow, incomplete response -> rethrow, other -> generic error

### 16. compactViaReactive (reactive compact mode)
- SDK status set to 'compacting'
- Parallel: pre-compact hooks + cache sharing params
- Calls reactive.reactiveCompactOnPromptTooLong()
- Error mapping: too_few_groups, aborted, exhausted/error/media_unstrippable
- On success: cleanup, warning suppression, cache clear
- Finally: reset modes

### 17. Warning Suppression
- `compactWarningStore` (Store<boolean>, default false)
- `suppressCompactWarning()` sets to true after compact
- `clearCompactWarningSuppression()` resets
- `useCompactWarningSuppression()` React hook (useSyncExternalStore)

## Edge Cases - Full List (from audit)

1. Empty messages array -> throw ERROR_MESSAGE_NOT_ENOUGH_MESSAGES
2. Session memory file exists but empty template -> fallback to legacy compact
3. lastSummarizedMessageId not in current messages -> return null (message was modified)
4. Resumed session with no lastSummarizedMessageId -> all messages unsummarized, boundary = last message
5. PTL retry with no droppable groups -> throw ERROR_MESSAGE_PROMPT_TOO_LONG
6. PTL retry leaves assistant-first sequence -> prepend synthetic PTL_RETRY_MARKER user message
7. PTL retry marker from previous attempt -> strip before grouping to avoid stalling
8. Streaming produces no response after retries -> throw ERROR_MESSAGE_INCOMPLETE_RESPONSE
9. Forked agent returns API error -> fall through to streaming fallback
10. Forked agent returns no text -> fall through to streaming fallback
11. Auto-compact fails -> circuit breaker after 3 consecutive failures
12. Post-compact exceeds autoCompactThreshold -> SM-compact returns null
13. File already in Read tool results -> skip in file restoration (dedup)
14. Read result is FILE_UNCHANGED_STUB -> do NOT skip, re-inject real content
15. Plan file, CLAUDE.md, memory files -> excluded from post-compact file restoration
16. Async agents running/finished but not retrieved -> re-announce as task_status attachments
17. Plan mode active -> re-inject plan mode attachment
18. Skills invoked -> per-skill truncation, budgeted re-injection
19. Subagents compacting -> do NOT reset main-thread state (context-collapse, memoryFiles)
20. Tool results already in preserved messages -> skip in file restoration
21. Compact boundary in messagesToKeep -> filtered out to prevent pruning cascade
22. Multiple streaming splits same message.id -> adjustIndexToPreserveAPIInvariants handles thinking blocks
23. Orphaned tool_results after truncation -> ensureToolResultPairing at API layer
24. Session metadata pushed out of 16KB tail window -> reAppendSessionMetadata after compact
25. Concurrent pre-compact hooks and cache params -> run in parallel (reactive path)
26. Progress messages in partial compact -> filtered from messagesToKeep in both directions
27. Re-injected attachments -> stripped before compaction when skill search enabled
28. Proactive/autonomous mode -> different continuation prompt (no "what should I work on")
29. CCD sessions with images -> images replaced with [image] text marker
30. Media inside tool_results -> also replaced with text marker
31. Streaming yields zero-length response -> retry once if enabled, otherwise throw
32. Context collapse mode active -> suppresses autocompact entirely
33. marble_origami context agent -> autocompact suppressed to avoid destroying committed log

## Error Constants (to port)

| Error | Constant | Message |
|-------|----------|---------|
| Not enough | ERROR_MESSAGE_NOT_ENOUGH_MESSAGES | "Not enough messages to compact." |
| PTL | ERROR_MESSAGE_PROMPT_TOO_LONG | "Conversation too long. Press esc twice to go up a few messages and try again." |
| Abort | ERROR_MESSAGE_USER_ABORT | "API Error: Request was aborted." |
| Incomplete | ERROR_MESSAGE_INCOMPLETE_RESPONSE | "Compaction interrupted · This may be due to network issues — please try again." |

## Implementation Plan for deer-flow

### Architecture

```
compact/
  types.ts             -- CompactionResult, AutoCompactTrackingState, PartialCompactDirection, SessionMemoryCompactConfig, TimeBasedMCConfig, ContextEditStrategy, ContextManagementConfig
  engine.ts            -- Core compact engine: compactConversation (forked agent + streaming fallback), stripImagesFromMessages, stripReinjectedAttachments, buildPostCompactMessages, annotateBoundaryWithPreservedSegment, formatCompactSummary, getCompactUserSummaryMessage, createCompactCanUseTool
  partial.ts           -- partialCompactConversation, calculateMessagesToKeepIndex, adjustIndexToPreserveAPIInvariants (tool_pair + thinking_block invariant preservation)
  grouping.ts          -- groupMessagesByApiRound (PTL retry, token estimation)
  tokenCounting.ts     -- estimateMessageTokens (with 4/3 padding), tokenCountWithEstimation integration
  ptlRetry.ts          -- truncateHeadForPTLRetry with marker logic, synthetic prepend, gap parsing, 20% fallback
  postRestore.ts       -- createPostCompactFileAttachments, createPlanAttachment, createSkillAttachment, createAsyncAgentAttachments, createPlanModeAttachment, delta re-announcement
  autoCompact.ts       -- shouldAutoCompact, autoCompactIfNeeded, circuit breaker, getEffectiveContextWindowSize, getAutoCompactThreshold, calculateTokenWarningState
  microCompact.ts      -- time-based micro-compact: evaluateTimeBasedTrigger, collectCompactableToolIds, execute time-based clearing
  sessionMemoryCompact.ts -- trySessionMemoryCompaction, shouldUseSessionMemoryCompaction, calculateMessagesToKeepIndex, adjustIndexToPreserveAPIInvariants, config management
  prompts.ts            -- SLM-adapted: BASE_COMPACT_PROMPT, PARTIAL_COMPACT_PROMPT, PARTIAL_COMPACT_UP_TO_PROMPT, NO_TOOLS_PREAMBLE, NO_TOOLS_TRAILER, formatCompactSummary, getCompactUserSummaryMessage
  cleanup.ts           -- runPostCompactCleanup: microcompact state, caches, system prompt sections, attribution sweep
  hooks.ts             -- executePreCompactHooks, executePostCompactHooks, mergeHookInstructions, processSessionStartHooks
  warningState.ts      -- compactWarningStore, suppressCompactWarning, clearCompactWarningSuppression
  awaySummary.ts       -- Away session resume summary
hooks/
  collapseHookSummaries.ts -- Collapse consecutive hook summaries with same hookLabel
commands/
  compact.ts           -- /compact command handler with SM-compact first, reactive fallback
```

### File Structure for deer-flow Frontend

```
core/compact/
  api.ts               -- API calls: compact conversation, partial compact, status check
  types.ts             -- Compact types matching backend
  hooks.ts             -- useAutoCompact, useCompactStatus, useCompactWarning
components/
  CompactBoundary.tsx  -- Compact boundary marker in message list (collapsible summary)
  CompactSummary.tsx   -- Display of compact summary content (detailed view)
  TokenUsageIndicator.tsx -- Token budget indicator (warning/error/blocking levels)
```

### SLM Token Budget Configuration

| Model Category | Context Window | Buffer | Auto Trigger | Max Summary Output |
|----------------|---------------|---------|---------------|-------------------|
| Haiku-class (4-8K) | model-specific | 15-20% of window | 80-85% | 1.5K |
| Sonnet-class (32-128K) | model-specific | 13K | window-13K | 3K |
| Opus-class (200K+) | model-specific | 13K | window-13K | 5K |

Env override: `AUTOCOMPACT_PCT_OVERRIDE` for percentage-based triggers (preferred for SLM where fixed token buffers don't scale well)

### SLM Compact Prompt Adaptations from Claude Code Production

**NO_TOOLS_PREAMBLE (adapted):**
```
CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.
```

**SLM Base Compact Prompt structure (simplified from production):**
- 5 sections instead of 9: Intent, Key Technical Concepts, Files/Changes, Errors/Fixes, Current Work & Next Steps
  - Merge: (Primary Request + All user messages) -> Intent
  - Merge: (Pending Tasks + Current Work + Optional Next Step) -> Current Work & Next Steps
  - Drop: Problem Solving (redundant with Current Work)
- Simpler example block (reduced nesting)
- `maxOutputTokens` capped at 3K (not 20K)
- `maxTurns: 1` strictly enforced
- No tool search or MCP injection

**NO_TOOLS_TRAILER:**
```
REMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block. Tool calls will be rejected and you will fail the task.
```

### Data Flow

```
User message sent → Append to thread
  ↓
estimateMessageTokens (4/3 padding per block)
  ↓
shouldAutoCompact?:
  - tokens >= effectiveContextWindow - buffer
  - autoCompact enabled (env + user config)
  - not inside compact fork
  - not suppressed (context collapse mode, context agents)
  - circuit breaker not tripped (< 3 consecutive failures)
  ↓
autoCompactIfNeeded():
  1. Try SM-compact (session-memory pruning, zero API cost for summary)
     - Config: minTokens=10K, minTextBlockMessages=5, maxTokens=40K
     - adjustIndexToPreserveAPIInvariants before slicing
     - If postCompact < threshold -> success
  2. If SM-compact insufficient/null:
     a. Run pre-compact hooks → merged instructions
     b. stripImagesFromMessages (remove image/doc blocks)
     c. stripReinjectedAttachments (if skill search enabled)
     d. Build compact prompt (SLM-optimized, from prompts.ts)
     e. PTL retry loop (max 3):
        - Try forked agent (cache sharing, maxTurns:1, deny tools)
        - If failure → streaming fallback
        - If streaming → retry loop (max 2 if enabled)
        - If PTL error → truncateHeadForPTLRetry → retry
     f. Validate summary (not empty, not API error)
     g. Snapshot + clear readFileState
     h. Parallel restore:
        - createPostCompactFileAttachments (budget: 50K total, 5K/file, 5 files)
        - createAsyncAgentAttachmentsIfNeeded
        - createPlanAttachment
        - createSkillAttachment (budget: 25K total, 5K/skill, sorted most-recent-first)
        - createPlanModeAttachment
        - Re-announce deferred tools/agent listing/MCP deltas
     i. Execute SessionStart hooks → hookResults
     j. Build boundary marker + summary messages
        - Ordering: boundary, summary, messagesToKeep, attachments, hookResults
        - Annotate preserved segment if applicable
     k. Calculate truePostCompactTokenCount
     l. Run post-compact hooks
     m. Cleanup: runPostCompactCleanup
     n. Notify compaction (prompt cache break detection)
     o. Mark post-compaction
     p. Re-append session metadata
  |
  If success: consecutiveFailures = 0
  If failure: consecutiveFailures++ (circuit breaker at 3)
  ↓
Continue conversation with reduced context
```

### Analytics / Telemetry Events (to implement)

| Event | Trigger | Key Metrics |
|-------|---------|-------------|
| compact_success | Any successful compaction | preTokens, postTokens, truePostTokens, threshold, isAuto, trigger, compaction token stats |
| compact_failed | Any compaction failure | reason (prompt_too_long/no_summary/api_error), preTokens, ptlAttempts |
| compact_ptl_retry | PTL retry | attempt, droppedMessages, remainingMessages |
| compact_cache_sharing | Forked agent success/failure | reason, preTokens, outputTokens, cacheRead, cacheCreation, cacheHitRate |
| partial_compact_success | Successful partial compaction | preTokens, postTokens, messagesKept, messagesSummarized, direction, hasUserFeedback |
| partial_compact_failed | Partial compact failure | reason, direction, messagesSummarized, ptlAttempts |
| time_based_microcompact | Time-based MC success | gapMinutes, tokensSaved, toolsCleared, toolsKept |
| post_compact_file_restore | File restoration | success/error, filesRestored |
| compact_auto_compact | Auto-compact attempt | consecutiveFailures, circuitBreakerTripped |

### Test Plan (Critical - Claude Code Has ZERO Tests For This)

**Unit Tests:**

| Module | Test Cases |
|--------|-----------|
| `grouping.test.ts` | Group messages by API round, empty array, single message, mixed assistant/user/tool rounds, PTL marker handling |
| `tokenCounting.test.ts` | estimateMessageTokens with text/tool_use/tool_result/image/thinking/redacted_thinking blocks, 4/3 padding verification, mixed message arrays |
| `ptlRetry.test.ts` | Truncate oldest groups, gap parsing, 20% fallback, marker stripping from previous retries, synthetic prepend for assistant-first, null when nothing droppable, preserve at least 1 group |
| `prompts.test.ts` | getCompactPrompt includes preamble+template+trailer, getPartialCompactPrompt direction variants, formatCompactSummary strips analysis, getCompactUserSummaryMessage with all optional flag combinations |
| `autoCompact.test.ts` | shouldAutoCompact threshold logic, circuit breaker at 3 failures, env overrides, context collapse suppression, query source suppression, recompaction tracking |
| `microCompact.test.ts` | evaluateTimeBasedTrigger gap calculation, keepRecent logic, tool result clearing, token savings calculation, zero-clear edge case |
| `sessionMemoryCompact.test.ts` | shouldUseSessionMemoryCompaction flag combinations, calculateMessagesToKeepIndex expansion logic, adjustIndexToPreserveAPIInvariants tool pairing and thinking block pairing, resumed session handling, threshold exceeded return null |
| `postRestore.test.ts` | File attachment creation with budgets, dedup logic (skip vs FILE_UNCHANGED_STUB), plan/skill/agent attachment creation, sorted order for skills, truncated skill content |
| `cleanup.test.ts` | Main thread detection, state reset scope, attribution sweep |
| `hooks.test.ts` | mergeHookInstructions combinations, pre/post hook execution, session start hook processing |
| `collapseHookSummaries.test.ts` | Consecutive same-label aggregation, mixed label preservation, error/count aggregation |

**Integration Tests:**

| Scenario | Validates |
|----------|-----------|
| Full compact flow (happy path) | Pre-hooks → compact → restore → post-hooks, correct message ordering, token counts |
| Full compact with PTL retry | PTL error detected, truncateHeadForPTLRetry drops groups, retry succeeds |
| Full compact with PTL exhausted | Drops all possible groups -> throws ERROR_MESSAGE_PROMPT_TOO_LONG |
| Partial compact 'earlier' | Pivot-based summarization, prefix preserved, old boundaries intact |
| Partial compact 'later' | Summaries stripped from kept suffix, cache-incompatible path, no boundary chain pollution |
| Auto-compact trigger | Threshold reached, compact fires, consecutiveFailures reset |
| Circuit breaker tripped | 3 failures in a row, no more attempts, warning logged |
| SM-compact success | Session memory used, no API summary call, messages sliced correctly |
| SM-compact fallback to legacy | SM returns null, full compact fires |
| Time-based micro-compact | Gap detected, tool results cleared, tokens saved tracked |
| Post-compact file restoration | Budget enforcement, dedup, delta re-announcements, correct attachment types |
| Image stripping | Image blocks replaced with markers, nested tool_result media handled |
| Error handling: all paths | Abort, API error, empty messages, incomplete response, user notifications |
| Reactive compact mode | SDK status, parallel hooks, cleanup on success |
| Away summary | Fast model call, 30 message limit, null on error/abort |

**End-to-End Tests:**

| Scenario | Validates |
|----------|-----------|
| Long session auto-compact chain | Multiple compaction cycles, circuit breaker state, telemetry accumulation |
| Resumed session compaction | No boundary found -> all messages treated as unsummarized |
| Manual compact with custom instructions | /compact command flow, SM-compact first attempt, fallback to full compact |
| Partial compact with user feedback | Feedback merged with hook instructions, direction-specific prompt used |
| Concurrent compact attempts | Lock/prevents double compact, streaming mode tracking |

## TODOs - Prioritized Implementation Order

1. **compact/types.ts** - All types defined once, shared across modules
2. **compact/grouping.ts + tokenCounting.ts** - Foundation for everything else
3. **compact/prompts.ts** - SLM-optimized prompts (extract from Claude Code + simplify)
4. **compact/hooks.ts + compact/cleanup.ts** - Hook framework and cleanup
5. **compact/warningState.ts** - Simple, unblocks UI
6. **compact/ptlRetry.ts + engine.ts** - Core compact engine with forked agent + streaming fallback
7. **compact/partial.ts + postRestore.ts** - Partial compaction and file restoration
8. **compact/autoCompact.ts** - Auto-trigger logic with circuit breaker
9. **compact/sessionMemoryCompact.ts** - SM-compact path (cheaper than full)
10. **compact/microCompact.ts** - Time-based micro-compact
11. **compact/awaySummary.ts** - Away summary generation
12. **commands/compact.ts** - Manual compaction command
13. **hooks/collapseHookSummaries.ts** - UI hook summary collapsing
14. **Frontend: core/compact/ + components/** - API layer + UI components
15. **Test suite** - All unit, integration, and E2E tests (15+ test files targeting zero gaps in Claude Code)
