---
name: Kairos Cron System Extraction and Implementation
overview: Extract the Kairos proactive scheduling system from Claude Code and adapt it for AetherArenaV2, integrating with the existing message queue and thread system for scheduled AI prompt execution.
todos:
  - id: extract-core
    content: Extract core cron library from Claude Code (cronTasks.ts, cronJitterConfig.ts, cronTasksLock.ts) - create src/core/cron/ directory with adapted versions
    status: pending
  - id: adapt-scheduler
    content: Adapt scheduler engine from cronScheduler.ts for AetherArenaV2 backend context (Node.js, no GrowthBook, integrate with queue system)
    status: pending
  - id: create-integration
    content: Create React integration hooks and API routes for cron management (useScheduledTasks, REST endpoints)
    status: pending
  - id: build-ui
    content: Add frontend UI components for cron task management (create, list, delete scheduled tasks)
    status: pending
  - id: test-integration
    content: Test end-to-end scheduling flow with existing thread/queue system integration
    status: pending
isProject: false
---

# Kairos Cron System Extraction and Implementation

## What Kairos Is

A complete end-to-end system for proactively injecting prompts into running/sleeping agent sessions on a schedule. It has three layers with sophisticated coordination mechanisms.

## Architecture Layers

### Layer 1: Persistent Cron Store (`cronTasks.ts`)

- **Task Storage**: `.claude/scheduled_tasks.json` with schema `{ tasks: [...] }`
- **Task Structure**: `id, cron, prompt, createdAt, lastFiredAt?, recurring?, permanent?, durable?, agentId?`
- **Core Operations**: `readCronTasks`, `writeCronTasks`, `addCronTask`, `removeCronTasks`, `markCronTasksFired`, `listAllCronTasks`
- **Two Task Flavors**: One-shot (fire once, auto-delete) vs Recurring (reschedule after firing)
- **Atomic Operations**: Batch marking fired, session vs durable separation
- **Time Utilities**: `nextCronRunMs`, `jitteredNextCronRunMs`, `oneShotJitteredNextCronRunMs`, `findMissedTasks`

### Layer 2: Scheduler Engine (`cronScheduler.ts`) 

- **Non-React Core**: Shared by REPL hooks and daemon mode
- **Lifecycle**: Poll → Load tasks → Watch file (chokidar) → 1s tick loop → Fire → Callback
- **Lock Acquisition**: Per-project lock prevents double-firing across sessions
- **Missed Task Detection**: Surfaces tasks missed during downtime on startup
- **Age-out Mechanism**: Recurring tasks auto-expire after configurable max age
- **Session vs File**: Session tasks read fresh from bootstrap state every tick, file tasks via chokidar

### Layer 3: Jitter & Tuning (`cronJitterConfig.ts`)

- **GrowthBook-backed**: Runtime config for ops to adjust scheduling fleet-wide
- **Forward Jitter**: Recurring tasks delayed by fraction of interval (default 10%, cap 15min)
- **Backward Jitter**: One-shots fire slightly early on :00/:30 minute boundaries
- **Minute-mod Gating**: Only jitter tasks landing on specific minute boundaries
- **Floor/Cap Logic**: Prevents exact boundary hits, guarantees minimum lead time

## Complete Data Flow

1. **Create**: `CronCreateTool` → validate cron → generate ID → `addCronTask` → write to `scheduled_tasks.json` or session memory
2. **Watch**: chokidar detects file change → `load()` → parse/validate tasks
3. **Tick**: Every 1s, `check()` → compute next fire times with jitter → compare to now
4. **Fire**: If `now >= nextFireAt` → `onFire(prompt)` callback
5. **REPL Path**: `useScheduledTasks` hook → `enqueuePendingNotification` with `priority: 'later'`, `isMeta: true` → command queue drain → agent processes
6. **Daemon Path**: `print.ts` → direct `enqueue()` → `drainCommandQueue()` → `run()` → agent processes  
7. **Reschedule**: Recurring tasks → `lastFiredAt` stamped → `writeCronTasks` → chokidar reload → `nextFireAt` recomputed
8. **Missed Recovery**: On startup, `findMissedTasks` → surface notification → user confirms → execute or discard

## Lock Mechanism Details

- **File**: `.claude/scheduled_tasks.lock`
- **Content**: `{ sessionId, pid, acquiredAt }`
- **Acquisition**: O_EXCL (`'wx'` flag) for atomic test-and-set
- **Liveness Check**: `isProcessRunning(existing.pid)` - detects dead PID
- **Recovery**: If PID dead → unlink → retry exclusive create (race condition handled)
- **Takeover**: Non-owners probe every 5s → try acquire if owner appears dead
- **Cleanup**: Register on process exit → `releaseSchedulerLock` → unlink if owner
- **Idempotent**: Re-acquire with same session ID succeeds, updates PID

## Jitter Math (Exact)

### Recurring (Forward Jitter)
```
jitter = jitterFrac(taskId) * recurringFrac * (t2 - t1)
finalFire = t1 + min(jitter, recurringCapMs)
```
- `jitterFrac(taskId) = parseInt(taskId.slice(0, 8), 16) / 0x1_0000_0000` → [0, 1)
- `t1 = next fire, t2 = second next fire` (interval between fires)
- Default: 10% of interval, capped at 15 minutes
- Example: Hourly task spreads across [:00, :06), per-minute task spreads by ~6 seconds

### One-Shot (Backward Jitter)  
```
if (minute % minuteMod === 0) {
  lead = floor + jitterFrac(taskId) * (maxMs - floorMs)
  fireTime = max(t1 - lead, createdAt)
} else {
  fireTime = t1
}
```
- Default: :00/:30 boundaries, max 90s early, floor 0s
- Example: "9:00am" task → fires 0-90s early, never after 9:00:00

### Missed Task Recovery
- **Detection**: On initial load, `findMissedTasks` → `nextCronRunMs(createdAt) < nowMs`
- **Surface**: Build notification with task metadata, ask user confirmation
- **Prevent Double-Surface**: `missedAsked` Set → track surfaced task IDs
- **Cleanup**: Auto-delete from file before showing notification
- **Fencing**: `nextFireAt.set(id, Infinity)` during processing → prevents re-fire

## Integration Touchpoints in Claude Code

- `src/bootstrap/state.ts` → In-memory state: `sessionCronTasks[]`, `scheduledTasksEnabled: boolean`, `kairosActive: boolean`
- `src/hooks/useScheduledTasks.ts` → React hook creating scheduler, enqueuing via `enqueuePendingNotification`
- `src/cli/print.ts` → Daemon mode scheduler setup, integration with command queue
- `src/Tool.ts` → Tool base class with `CronCreateTool`, `CronDeleteTool`, `CronListTool` implementations
- `src/constants/prompts.ts` → Feature gates like `tengu_kairos_cron`
- `src/services/autoDream/` → Uses Kairos infrastructure for nightly memory consolidation

## Adaptation for AetherArenaV2

### Key Differences to Handle
- **No Electron/Desktop**: We're Next.js → LangGraph, not REPL/desktop
- **No GrowthBook**: Our config management is different → use environment/config files
- **No Chokidar in Browser**: File watching only works in Node.js (electron main/backend)
- **Existing Queue Integration**: Already have `core/queue/` with `enqueue`, `dequeue`, priority system
- **Thread-based**: Messages route to specific threads, not global REPL
- **LangGraph Backend**: Not direct agent processing → streaming through LangGraph SDK

### Implementation Approach

#### Phase 1: Core Cron Library (Pure TypeScript)
- **Files to Extract**: `cronTasks.ts`, `cronJitterConfig.ts` (simplified), `cronTasksLock.ts` (modified for our context)
- **Location**: `deer-flow/frontend/src/core/cron/`
- **Adaptations**: 
  - Remove GrowthBook dependencies, use config/env instead
  - Simplify jitter config (no runtime tuning needed initially)
  - Keep task storage in `.aether/scheduled_tasks.json` or similar
  - Keep file-based lock for multi-session coordination

#### Phase 2: Scheduler Engine
- **File to Extract**: `cronScheduler.ts`
- **Location**: `deer-flow/frontend/src/core/cron/scheduler.ts`
- **Adaptations**:
  - **Server-side only**: Run in Electron main process or backend service
  - **No chokidar in browser**: Use Node.js file watch API or backend polling
  - **Integration hook**: `onFire` → our queue system or direct thread message injection
  - **Simplified gating**: Remove GrowthBook, use simpler feature flags

#### Phase 3: Integration
- **React Hook**: Create `useScheduledTasks` for frontend UI (list, create, delete)
- **Tool Wrappers**: API routes for cron CRUD operations
- **Queue Integration**: Fire cron events through existing `core/queue/` system
- **Thread Routing**: Associate tasks with threads via `threadId` in task metadata

## Critical Dependencies to Extract

| Source File | Destination | Notes |
|-------------|-------------|-------|
| `cronTasks.ts` | `src/core/cron/tasks.ts` | Core task types and CRUD |
| `cronScheduler.ts` | `src/core/cron/scheduler.ts` | Scheduling engine |
| `cronTasksLock.ts` | `src/core/cron/lock.ts` | File-based locking |
| `cronJitterConfig.ts` | `src/core/cron/jitter.ts` | Simplified jitter config |
| `cron.ts` (parser) | Need cron expression parser | May need to extract or use npm package |
| `useScheduledTasks.ts` | `src/core/cron/useScheduledTasks.ts` | React integration hook |

## External Dependencies Required
- **Chokidar**: File watching (Node.js only, for backend)
- **Zod**: Schema validation (already in project)
- **Cron parser**: Replace `parseCronExpression`/`computeNextCronRun` with npm package

## Implementation Priority
1. Core library (tasks CRUD + time utilities)
2. Scheduler engine (with simplified gating)  
3. File locking mechanism
4. React integration hooks
5. API routes for web access
6. Frontend UI components for cron management

## Risk Factors
- **Multi-session coordination**: File locking edge cases, crash recovery
- **Time zone handling**: Cron is local time, must handle TZ correctly
- **Backend vs Frontend split**: Scheduler runs server-side, UI client-side
- **Queue integration**: Must work with existing priority system and thread routing
- **No GrowthBook**: Lose runtime tuning, accept static config initially

This system enables proactively scheduled AI agent interactions - powerful for reminders, periodic analysis, automated workflows, and time-based agent triggers.