---
name: Claude Code Feature Extraction
overview: Audit of the Claude Code repository for extractable features, covering multi-agent coordination, memory, skills, lifecycle, feature flags, analytics, and infrastructure. The audit is complete from reconnaissance; this plan maps out what to build/adapt in our deer-flow project.
todos:
  - id: extract-memory-system
    content: Extract memory system core (memdir + extractMemories + autoDream) into deer-flow/src/core/memory-engine/
    status: pending
  - id: extract-forked-agent
    content: Implement forked agent pattern with cache-safe context isolation
    status: pending
  - id: extract-skill-system
    content: Build skill/agent system with multi-source discovery and conditional activation
    status: pending
  - id: extract-mailbox-rpc
    content: Implement teammate mailbox RPC system for multi-agent coordination
    status: pending
  - id: extract-scheduler-system
    content: Build scheduler lock + cron jitter system
    status: pending
isProject: false
---

# Claude Code Repository Audit -- Complete Findings

## Executive Summary

The Claude Code repository at `/Volumes/Disk-D/Aether/claude-code` contains a ~80K-line TypeScript codebase with six major feature systems worth extracting. Below are the concrete findings, followed by ranked extraction priorities.

---

## Feature 1: Multi-Agent Teammate System (HIGHEST VALUE)

### What It Is

A complete multi-agent coordination system where a "leader" Claude session spawns "teammate" agents that work concurrently, communicate via file-based mailboxes, and share context through layered identity resolution.

### Architecture

**Identity Resolution** (`src/utils/teammate.ts`, `src/utils/teammateContext.ts`):
- Three-layer priority: AsyncLocalStorage (in-process) > dynamicTeamContext (CLI args) > env vars (CLAUDE_CODE_AGENT_ID)
- `TeammateContext` type: `{ agentId, agentName, teamName, color, planModeRequired, parentSessionId, isInProcess: true, abortController }`

**Task Types** (`src/tasks/types.ts`):
```
TaskState = LocalShellTask | LocalAgentTask | RemoteAgentTask | InProcessTeammateTask | LocalWorkflowTask | MonitorMcpTask | DreamTask
```

**Forked Agent Execution** (`src/utils/forkedAgent.ts`, `src/utils/swarm/inProcessRunner.ts`):
- `runForkedAgent()` creates isolated `ToolUseContext` for sub-agents
- `CacheSafeParams` keeps system prompt, tools, model, message prefixes identical to parent for prompt cache hits
- `SubagentContextOverrides`: default-deny all mutations, opt-in sharing via `shareSetAppState`, `shareSetResponseLength`, `shareAbortController`

**Mailbox RPC** (`src/utils/teammateMailbox.ts`):
- File-based at `~/.claude/teams/{team_name}/inboxes/{agent_name}.json`
- Message types: IdleNotification, PermissionRequest/Response, PlanApproval, Shutdown, TaskAssignment, ModeSet
- Lock: `proper-lockfile` with 10 retries, 5ms-100ms backoff

**Swarm Backends** (`src/utils/swarm/backends/`):
- BackendType: `tmux` | `iterm2` | `in-process`
- Registry auto-detects: tmux > iTerm2 > fallback
- Pane creation locked via promises to prevent race conditions

**Permission Routing** (`src/utils/swarm/inProcessRunner.ts` lines 128-451):
- Path 1: Leader UI bridge (queue permission dialog in leader)
- Path 2: Mailbox fallback (write to leader's mailbox -> poll -> resolve)

**Cron Scheduling with Agent Routing** (`src/utils/cronTasks.ts`, `src/utils/cronTasksLock.ts`, `src/utils/cronScheduler.ts`):
- `CronTask.type` includes `agentId?: string` -- routes fires to specific teammate
- Jitter system: proportional to interval, configurable via GrowthBook feature `tengu_kairos_cron_config`
- Lock: O_EXCL file create, PID liveness probe, stale recovery

### Source Files
- `src/utils/teammateContext.ts` -- AsyncLocalStorage context
- `src/utils/teammateMailbox.ts` -- File-based messaging
- `src/utils/forkedAgent.ts` -- Subagent isolation
- `src/utils/swarm/inProcessRunner.ts` -- Main execution loop
- `src/utils/swarm/spawnInProcess.ts` -- Spawn logic
- `src/utils/swarm/backends/` -- Tmux/iTerm2/InProcess backends
- `src/utils/swarm/teamHelpers.ts` -- Team file management
- `src/tasks/types.ts` -- Task type registry
- `src/tasks/InProcessTeammateTask/` -- Teammate task state
- `src/utils/cronScheduler.ts` -- Cron with jitter
- `src/utils/cronTasksLock.ts` -- Cross-process lock

### Extraction Difficulty: Hard (deeply coupled)
Dependencies: AppState, Task registry, bootstrap state, GrowthBook feature flags, permission system

---

## Feature 2: Automated Memory System (HIGH VALUE)

### What It Is

A production-grade memory system with per-turn extraction, background consolidation (dream), team memory sync, and multiple memory types.

### Types (`src/memdir/memoryTypes.ts`)
```
MEMORY_TYPES = ['user', 'feedback', 'project', 'reference']
```

### File Format

**Topic Files** (with frontmatter):
```markdown
---
name: <memory name>
description: <one-line description>
type: user | feedback | project | reference
---
<content>
```

**MEMORY.md** (entrypoint index, no frontmatter):
- Max 200 lines, max 25KB
- Format: `- [Title](file.md) -- one-line hook`
- Dual-capped: line truncation then byte truncation

**Daily Log** (KAIROS mode):
- Pattern: `<autoMemPath>/logs/YYYY/MM/YYYY-MM-DD.md`
- Append-only timestamped bullets

**Lock File**: `.consolidate-lock` -- body = PID, mtime = lastConsolidatedAt

### Data Flows

**Per-Turn Extraction** (`src/services/extractMemories/extractMemories.ts`):
1. Post-turn hook fires `executeExtractMemories()`
2. Skip if main agent already wrote memory (`hasMemoryWritesSince`)
3. Throttle gate: every N eligible turns (configurable via `tengu_bramble_lintel`)
4. `runForkedAgent()` with `maxTurns: 5`, `canUseTool: createAutoMemCanUseTool(memoryDir)`
5. Extracted tool permissions: FileRead, Grep, Glob, REPL, read-only Bash; FileEdit/FileWrite ONLY within memory dir
6. Closure-state: `inFlightExtractions`, `lastMemoryMessageUuid`, `turnsSinceLastExtraction`
7. `drainPendingExtraction()` on shutdown

**Background Dream Consolidation** (`src/services/autoDream/autoDream.ts`):
1. Gate cascade: NOT KAIROS AND NOT remote AND auto enabled AND dream enabled
2. Time gate: hours since last >= minHours (default 24)
3. Scan throttle: 10-min cooldown
4. Session gate: transcripts touched >= minSessions (default 5)
5. Lock: `tryAcquireConsolidationLock()` (PID-based mtime lock)
6. 4-phase prompt: Orient -> Gather -> Consolidate -> Prune
7. DreamTask UI tracking with `filesTouched`, `turns`, `sessionsReviewing`
8. On failure: rollback lock mtime

**Memory Recall** (`src/memdir/findRelevantMemories.ts`):
1. `scanMemoryFiles()` -> manifest (top 200 files by mtime)
2. `sideQuery()` (Sonnet) selects up to 5 relevant memories
3. Read files, attach with freshness text ("today", "yesterday", "N days ago")

**Team Memory Sync** (`src/services/teamMemorySync/`):
- Syncs team MEMORY.md from remote at session boundary
- Path validation: two-pass (string containment + realpath deepeste existing + symlink escape detection)

### Source Files
- `src/memdir/memdir.ts` -- Prompt builder, truncation
- `src/memdir/memoryTypes.ts` -- Taxonomy
- `src/memdir/paths.ts` -- Path resolution, enablement
- `src/memdir/findRelevantMemories.ts` -- AI-driven recall
- `src/memdir/memoryScan.ts` -- Directory scanner, frontmatter parser
- `src/memdir/memoryAge.ts` -- Staleness
- `src/memdir/teamMemPaths.ts` -- Team memory path resolution
- `src/memdir/teamMemPrompts.ts` -- Combined prompt builder
- `src/services/extractMemories/extractMemories.ts` -- Per-turn extraction
- `src/services/autoDream/autoDream.ts` -- Background consolidation
- `src/services/autoDream/consolidationLock.ts` -- mtime lock
- `src/services/autoDream/consolidationPrompt.ts` -- 4-phase prompt
- `src/tasks/DreamTask/DreamTask.ts` -- UI task
- `src/utils/memoryFileDetection.ts` -- Path detection
- `src/components/memory/MemoryFileSelector.tsx` -- Ink UI

### Extraction Difficulty: Medium (2-3 deps)
Dependencies: `runForkedAgent`, `sideQuery`, `Task` registry, feature flags

---

## Feature 3: Skills/Plugin System (HIGH VALUE)

### What It Is

A multi-source skill system with discovery, conditional activation, hot-reload, MCP integration, and CLI management.

### Skill Sources (priority order)
1. **Bundled** (`src/skills/bundledSkills.ts`) -- Ships with CLI, programmatic registration
2. **Managed/Policy** (`~/.claude/skills/` via policy) -- Enterprise-managed
3. **User** (`~/.claude/skills/`) -- Global user skills
4. **Project** (`.claude/skills/`) -- Per-project
5. **Additional** (`--add-dir` paths) -- Explicit paths
6. **Dynamic** (discovered during session via file operations)
7. **MCP** (remote tool discovery)
8. **Plugin** marketplace

### Frontmatter Schema
```yaml
name: <display name>
description: <what it does>
when_to_use: <guidance>
allowed-tools: [Tool1, Tool2]
argument-hint: <args>
arguments: [arg1, arg2]
model: <model name or "inherit">
user-invocable: true/false
disable-model-invocation: true/false
context: "fork"
effort: minimal | default | high | 3
agent: <agent id>
paths: [glob patterns for conditional activation]
shell: <shell config>
version: <semver>
hooks: <hook config>
```

### Dynamic Discovery (`src/skills/loadSkillsDir.ts` lines 861-915)
1. On every Read/Write/Edit, walk up from file path to cwd
2. Discover `.claude/skills/` directories
3. Check gitignore (respects nested .gitignore, .git/info/exclude)
4. Load new skills, merge into `dynamicSkills` map
5. Fire `skillsLoaded` signal for cache clearing

### Conditional Skills (lines 997-1058)
- Skills with `paths` frontmatter stored in `conditionalSkills` map
- Activated when file operations match gitignore-style patterns
- Once activated, survives cache clears (tracked in `activatedConditionalSkillNames`)

### Variable Substitution in Skill Prompts
- `${CLAUDE_SKILL_DIR}` -> skill's own directory
- `${CLAUDE_SESSION_ID}` -> current session ID
- Argument substitution: `parseArgumentNames()`, `substituteArguments()`

### Bundled Skill File Extraction (lines 53-72, 131-144)
- Closure-local memoization: extract once per process
- O_NOFOLLOW + O_EXCL + 0o600 file permissions
- Prepends `Base directory for this skill: <dir>` to prompt

### Source Files
- `src/skills/bundledSkills.ts` -- Bundled skill registry
- `src/skills/loadSkillsDir.ts` -- All skill loading (820 lines)
- `src/skills/mcpSkillBuilders.ts` -- MCP skill bridge
- `src/utils/skills/skillChangeDetector.ts` -- File watcher for hot-reload
- `src/plugins/builtinPlugins.ts` -- Built-in plugin registry

### Extraction Difficulty: Medium
Dependencies: Frontmatter parser, markdown loader, settings system

---

## Feature 4: Agent Lifecycle / Session Management (MEDIUM VALUE)

### Bootstrap Pipeline (`src/setup.ts`)
```
1. Node version check (>= 18)
2. Custom session ID switch
3. UDS messaging server (Mac/Linux, non-bare)
4. Teammate snapshot (swarm mode)
5. Terminal backup (iTerm2/Terminal.app restore)
6. Set CWD (critical -- before hooks)
7. Hooks config snapshot
8. FileChanged watcher init
9. Worktree creation (git + tmux)
10. Background jobs: initSessionMemory, initContextCollapse, lockCurrentVersion
11. Prefetch: commands, plugin hooks, hot-reload
12. Attribution hooks (commits, file access, team memory watcher)
13. Sinks (error/analytics)
14. Health beacon (tengu_started)
15. API key prefetch
16. Release notes + recent activity
17. Permission security gate (--dangerously-skip-permissions validation)
18. Last session exit telemetry
```

### State Architecture
- `src/bootstrap/state.ts` -- 80+ field `STATE` singleton (session-global mutable state)
- `src/state/AppState.tsx` -- 95-field reactive UI state tree (React context + store)
- `src/state/store.ts` -- Generic `Store<T>` with publish-subscribe pattern
- Scroll drain mechanism (150ms debounce for expensive work)

### Session Lifecycle
- Session ID: UUID, switchable via `switchSession()`
- `onSessionSwitch` signal for external listeners
- Cost state restore from previous session
- Session persistence to disk with transcript linking
- Resume via teleport (bundle upload or sessions API)

### Task Eviction
- `evictTask` / `evictAfter` field for terminal task cleanup
- `evictTerminalTask` scheduler for background cleanup
- `release(task)` -- drops messages, sets evictAfter

### Source Files
- `src/setup.ts` -- 479-line bootstrap pipeline
- `src/bootstrap/state.ts` -- 56K-line state singleton
- `src/state/AppState.tsx` -- React provider
- `src/state/AppStateStore.ts` -- Store definition
- `src/state/onChangeAppState.ts` -- Side effects on state change
- `src/state/selectors.ts` -- Pure data derivation
- `src/state/teammateViewHelpers.ts` -- View transitions
- `src/Task.ts` -- Base task interface
- `src/commands/branch/branch.ts` -- Conversation forking

### Extraction Difficulty: Medium-High
Dependencies: React, settings, hooks system

---

## Feature 5: CLI / Headless Mode (MEDIUM VALUE)

### `src/cli/print.ts` -- 5596 lines
Main headless/daemon entry point with:
- JSON output for all events
- MCP elicitation flows
- Plugin sync/install
- OAuth flows in headless mode
- Bridge message passthrough
- MCP channel management

### `src/cli/structuredIO.ts` -- 861 lines
- Protocol: JSON lines with framing
- Batched event output
- Error envelope standardization

### CLI Commands (gated by feature flags):
- `--daemon-worker=<kind>` -- DAEMON feature
- `daemon` -- DAEMON + BRIDGE_MODE
- `new/list/reply` -- TEMPLATES feature
- `remote-control/rc` -- BRIDGE_MODE (161-line auth + policy check)
- `ps/logs/attach/kill/--bg` -- BG_SESSIONS feature
- `--tmux --worktree` -- git worktree + tmux session

### Source Files
- `src/cli/print.ts` -- 5596 lines, main daemon
- `src/cli/structuredIO.ts` -- Protocol
- `src/cli/remoteIO.ts` -- Remote transport
- `src/cli/transports/` -- SSE, WebSocket, Hybrid transports
- `src/cli/handlers/plugins.ts` -- Plugin CLI (880 lines)
- `src/cli/handlers/mcp.tsx` -- MCP CLI (336 lines)
- `src/entrypoints/cli.tsx` -- 303-line bootstrap dispatcher

### Extraction Difficulty: Easy-Medium

---

## Feature 6: Permission/Trust System (MEDIUM VALUE)

### Permission Modes
- `default` -- Prompt per tool
- `yolo` -- Auto-accept safe tools
- `agentic` -- Agent-style decisions (classifier-based)
- `plan` -- Plan mode gating

### Auto-Mode Decision Engine (`src/utils/permissions/yoloClassifier.ts`):
- Tool-specific safety rules
- Path-based allow/deny lists
- Denial tracking with limit escalation
- Outcome analytics (`tengu_auto_mode_outcome`, `tengu_auto_mode_decision`)

### Trust Dialog (`src/components/TrustDialog/`):
- One-time trust acceptance per project
- `--dangerously-skip-permissions` gate

### Source Files
- `src/utils/permissions/permissions.ts` -- Core permission engine
- `src/utils/permissions/yoloClassifier.ts` -- Auto-mode classifier
- `src/utils/permissions/permissionSetup.ts` -- Mode initialization
- `src/components/TrustDialog/TrustDialog.tsx` -- UI
- `src/utils/swarm/permissionSync.ts` -- Permission sync between teammates
- `src/utils/swarm/leaderPermissionBridge.ts` -- Bridge for leader UI

### Extraction Difficulty: Medium

---

## Feature 7: Forked Subagent with Cache Preservation (NOVEL)

### What It Is
When the main agent calls `runForkedAgent()`, the forked agent uses the same prompt cache as the parent, making sub-agent calls cheap.

### Key Types (`src/utils/forkedAgent.ts`)
```typescript
CacheSafeParams = {
  systemPrompt, userContext, systemContext, toolUseContext, forkContextMessages
}
```

### Mechanism
- `contentReplacementState` cloned to prevent wire prefix divergence
- All mutable state isolated by default
- Opt-in sharing: `shareSetAppState`, `shareSetResponseLength`, `shareAbortController`
- Usage tracked via `NonNullableUsage` accumulated from `message_delta` stream
- `tengu_fork_agent_query` analytics with full breakdown + cache hit rate

### Source Files
- `src/utils/forkedAgent.ts` -- 660 lines
- Used by: extractMemories, autoDream, agent hooks, skill improvement

### Extraction Difficulty: Medium
Dependencies: Tool use context, query loop, message handling

---

## Feature Flag Registry (83 flags discovered)

### Core Systems
| Flag | Area | Gate |
|---|---|---|
| KAIROS | Assistant/agent mode | Main assistant chat, KAIROS_BRIEF, KAIROS_CHANNELS |
| BRIDGE_MODE | Remote control | Bridge daemon, remote control protocol |
| DAEMON | Background workers | Daemon mode, worker processes |
| DIRECT_CONNECT | Server connections | Direct WebSocket connections |
| SSH_REMOTE | SSH tunnels | Remote SSH agent sessions |
| COORDINATOR_MODE | Multi-agent orchestration | Coordinator mode switching |
| BG_SESSIONS | Background sessions | ps/logs/attach/kill CLI |
| TEMPLATES | Session templates | new/list/reply commands |
| FORK_SUBAGENT | Subagent forking | /fork command |
| ULTRAPLAN | Ultra planning | Remote ultra planning UI |
| TRANSCRIPT_CLASSIFIER | Auto-mode | Permission auto-accept |
| EXTRACT_MEMORIES | Memory extraction | Per-turn memory extraction |
| KAIROS_DREAM | Dream tasks | Background consolidation |
| TEAMMEM | Team memory | Team memory sync |
| MCP_SKILLS | MCP as skills | MCP server tool discovery |
| VERIFICATION_AGENT | Verification | PR review task verification |
| AGENT_TRIGGERS | Agent lifecycle | Hook-based agent lifecycle |
| WEB_BROWSER_TOOL | Browser automation | WebView browser tool |
| CONTEXT_COLLAPSE | Context management | Project context compression |
| HISTORY_SNIP | History management | History truncation |
| TORCH | Torch mode | Quick torch command |
| BUDDY | Buddy feature | Buddy system |
| VOICE_MODE | Voice input | Voice command |
| WORKFLOW_SCRIPTS | Workflows | Workflow system |
| EXPERIMENTAL_SKILL_SEARCH | Skill search | Skill index cache |
| CCR_MIRROR | CCR mirroring | Mirror remote sessions |
| CHICAGO_MCP | Chicago MCP | Mac MCP integration |
| LODESTONE | Lodestone | Feature unknown |
| UDS_INBOX | Messaging | Unix socket messaging |
| MONITOR_TOOL | Monitoring | Monitor tool variant |
| PUSH_NOTIFICATIONS | Push | KAIROS_PUSH_NOTIFICATION |
| GITHUB_WEBHOOKS | PR monitoring | KAIROS_GITHUB_WEBHOOKS |

---

## Analytics Events (Key Novel Events, 400+ total)

### Multi-Agent Coordination
- `tengu_agent_tool_selected` / `_completed` / `_terminated` / `_remote_launched`
- `tengu_team_created` / `_deleted`
- `tengu_fork_agent_query` -- full usage breakdown + cache hit rate
- `tengu_dynamic_skills_changed` -- live skill discovery

### Memory System
- `tengu_auto_mem_tool_denied` -- extraction tool deny
- `tengu_extract_memories_skipped_direct_write` / `_extraction` / `_error` / `_coalesced`
- `tengu_auto_dream_fired` / `_completed` / `_failed`
- `tengu_memdir_loaded` / `_disabled` / `_prefetch_collected`
- `tengu_team_mem_sync_pull` / `_push` / `_started`

### Bridge/Remote
- `tengu_bridge_session_started` / `_done` / `_timeout` / `_fatal_error`
- `tengu_bridge_reconnected` / `_heartbeat_mode_entered` / `_exited`
- `tengu_teleport_started` / `_cancelled` / `_completed` / `_error_git_not_clean`
- `tengu_ccr_bundle_upload` / `_repl_connect_timeout`

### Task/Session
- `tengu_conversation_forked` / `_rewind`
- `tengu_session_resumed` (7+ variants by resume path)
- `tengu_cost_threshold_reached` / `_acknowledged`
- `tengu_ultraplan_approved` / `_launched` / `_failed`

---

## Ranked Extraction Priority

### Tier 1: Extract Now (High value, standalone)

1. **Memory System Core** (`src/memdir/` + `src/services/extractMemories/` + `src/services/autoDream/`)
   - Novelty: AI-driven memory extraction, background dream consolidation, 4 memory types with frontmatter
   - Feasibility: Medium -- depends on `runForkedAdapter` but can isolate with adapter interface
   - **Actionable: Extract as `src/core/memory-engine/` with types, extraction pipeline, dream scheduler**

2. **Forked Agent Pattern** (`src/utils/forkedAgent.ts`)
   - Novelty: Cache-safe subagent execution, configurable isolation, usage tracking
   - Feasibility: Medium -- depends on query loop but isolatable as adapter
   - **Actionable: Implement as `src/utils/forked-agent.ts` with `createSubagentContext` and `runForkedAgent` patterns**

3. **Skill System** (`src/skills/loadSkillsDir.ts`)
   - Novelty: Multi-source discovery, conditional activation, dynamic detection, MCP bridge
   - Feasibility: Medium -- needs frontmatter parser + settings integration but cleanly separated
   - **Actionable: Extract as `src/core/skills/` loader with path-based conditional activation**

### Tier 2: Extract Later (valuable but coupled)

4. **Teammate Mailbox System** -- File-based async RPC with lockfile serialization
5. **Scheduler Lock** -- O_EXCL + PID liveness + stale recovery for cross-process exclusive execution
6. **Cron Jitter System** -- Proportional jitter with feature flag config
7. **Task Lifecycle** -- `Task` interface with polymorphic kill, state machines per type
8. **Session State Management** -- `Store<T>` pattern with scroll drain, publish-subscribe

### Tier 3: Study Only (too coupled or low ROI)

9. Permission classifier + trust escalation
10. Bash security checks (2500+ lines in `bashSecurity.ts`)
11. PTY web server with multi-user session management
12. Settings migration system
13. SDK/API schemas (1891 lines Zod)

---

## Next Steps

This audit identified 83 feature flags, 400+ analytics events, and 7 major feature systems. The memory system + forked agent pattern + skills system represent the highest-value extraction targets. Each can be adapted independently with adapter interfaces replacing internal dependencies.