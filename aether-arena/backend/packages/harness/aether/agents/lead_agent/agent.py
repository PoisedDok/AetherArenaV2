import logging

from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware
from langchain_core.runnables import RunnableConfig

from aether.agents.lead_agent.prompt import apply_prompt_template
from aether.compact.middleware import CompactMiddleware
from aether.agents.middlewares.loop_detection_middleware import LoopDetectionMiddleware
from aether.agents.middlewares.memory_middleware import MemoryMiddleware
from aether.agents.middlewares.subagent_limit_middleware import SubagentLimitMiddleware
from aether.agents.middlewares.title_middleware import TitleMiddleware
from aether.agents.middlewares.todo_middleware import TodoMiddleware
from aether.agents.middlewares.tool_error_handling_middleware import build_lead_runtime_middlewares
from aether.agents.middlewares.view_image_middleware import ViewImageMiddleware
from aether.agents.thread_state import ThreadState
from aether.config.agents_config import load_agent_config
from aether.config.app_config import get_app_config
from aether.config.summarization_config import get_summarization_config
from aether.models import create_chat_model

logger = logging.getLogger(__name__)


def _resolve_model_name(requested_model_name: str | None = None) -> str:
    """Resolve a runtime model name safely, falling back to default if invalid.

    Handles both simple names (e.g., 'gpt-4o') and provider-prefixed names
    from remote model endpoints (e.g., 'lmstudio/qwen/qwen3-4b-2507').
    """
    app_config = get_app_config()
    default_model_name = app_config.models[0].name if app_config.models else None
    if default_model_name is None:
        raise ValueError("No chat models are configured. Please configure at least one model in config.yaml.")

    if not requested_model_name:
        return default_model_name

    # First try exact match (static config model)
    if app_config.get_model_config(requested_model_name):
        return requested_model_name

    # Handle provider/model format (e.g., 'lmstudio/qwen/qwen3-4b-2507')
    if "/" in requested_model_name:
        provider_name = requested_model_name.split("/")[0]
        provider_config = app_config.get_model_config(provider_name)
        if provider_config:
            # Provider exists, treat this as a valid remote model reference
            # The actual model ID (after provider/) will be used when creating the chat model
            return requested_model_name

    # Fallback to default
    if requested_model_name != default_model_name:
        logger.warning(f"Model '{requested_model_name}' not found in config; fallback to default model '{default_model_name}'.")
    return default_model_name


def _create_summarization_middleware() -> SummarizationMiddleware | None:
    """Create and configure the summarization middleware from config."""
    config = get_summarization_config()

    if not config.enabled:
        return None

    # Prepare trigger parameter
    trigger = None
    if config.trigger is not None:
        if isinstance(config.trigger, list):
            trigger = [t.to_tuple() for t in config.trigger]
        else:
            trigger = config.trigger.to_tuple()

    # Prepare keep parameter
    keep = config.keep.to_tuple()

    # Prepare model parameter
    if config.model_name:
        model = config.model_name
    else:
        # Use a lightweight model for summarization to save costs
        # Falls back to default model if not explicitly specified
        model = create_chat_model(thinking_enabled=False)

    # Prepare kwargs
    kwargs = {
        "model": model,
        "trigger": trigger,
        "keep": keep,
    }

    if config.trim_tokens_to_summarize is not None:
        kwargs["trim_tokens_to_summarize"] = config.trim_tokens_to_summarize

    if config.summary_prompt is not None:
        kwargs["summary_prompt"] = config.summary_prompt

    return SummarizationMiddleware(**kwargs)


def _create_todo_list_middleware(is_plan_mode: bool) -> TodoMiddleware | None:
    """Create and configure the TodoList middleware.

    Args:
        is_plan_mode: Whether to enable plan mode with TodoList middleware.

    Returns:
        TodoMiddleware instance if plan mode is enabled, None otherwise.
    """
    if not is_plan_mode:
        return None

    # Custom prompts matching DeerFlow's style
    system_prompt = """
<todo_list_system>
You have access to the `write_todos` tool to help you manage and track complex multi-step objectives.

**CRITICAL RULES:**
- Mark todos as completed IMMEDIATELY after finishing each step - do NOT batch completions
- Keep EXACTLY ONE task as `in_progress` at any time (unless tasks can run in parallel)
- Update the todo list in REAL-TIME as you work - this gives users visibility into your progress
- DO NOT use this tool for simple tasks (< 3 steps) - just complete them directly

**When to Use:**
This tool is designed for complex objectives that require systematic tracking:
- Complex multi-step tasks requiring 3+ distinct steps
- Non-trivial tasks needing careful planning and execution
- User explicitly requests a todo list
- User provides multiple tasks (numbered or comma-separated list)
- The plan may need revisions based on intermediate results

**When NOT to Use:**
- Single, straightforward tasks
- Trivial tasks (< 3 steps)
- Purely conversational or informational requests
- Simple tool calls where the approach is obvious

**Best Practices:**
- Break down complex tasks into smaller, actionable steps
- Use clear, descriptive task names
- Remove tasks that become irrelevant
- Add new tasks discovered during implementation
- Don't be afraid to revise the todo list as you learn more

**Task Management:**
Writing todos takes time and tokens - use it when helpful for managing complex problems, not for simple requests.
</todo_list_system>
"""

    tool_description = """Use this tool to create and manage a structured task list for complex work sessions.

**IMPORTANT: Only use this tool for complex tasks (3+ steps). For simple requests, just do the work directly.**

## When to Use

Use this tool in these scenarios:
1. **Complex multi-step tasks**: When a task requires 3 or more distinct steps or actions
2. **Non-trivial tasks**: Tasks requiring careful planning or multiple operations
3. **User explicitly requests todo list**: When the user directly asks you to track tasks
4. **Multiple tasks**: When users provide a list of things to be done
5. **Dynamic planning**: When the plan may need updates based on intermediate results

## When NOT to Use

Skip this tool when:
1. The task is straightforward and takes less than 3 steps
2. The task is trivial and tracking provides no benefit
3. The task is purely conversational or informational
4. It's clear what needs to be done and you can just do it

## How to Use

1. **Starting a task**: Mark it as `in_progress` BEFORE beginning work
2. **Completing a task**: Mark it as `completed` IMMEDIATELY after finishing
3. **Updating the list**: Add new tasks, remove irrelevant ones, or update descriptions as needed
4. **Multiple updates**: You can make several updates at once (e.g., complete one task and start the next)

## Task States

- `pending`: Task not yet started
- `in_progress`: Currently working on (can have multiple if tasks run in parallel)
- `completed`: Task finished successfully

## Task Completion Requirements

**CRITICAL: Only mark a task as completed when you have FULLY accomplished it.**

Never mark a task as completed if:
- There are unresolved issues or errors
- Work is partial or incomplete
- You encountered blockers preventing completion
- You couldn't find necessary resources or dependencies
- Quality standards haven't been met

If blocked, keep the task as `in_progress` and create a new task describing what needs to be resolved.

## Best Practices

- Create specific, actionable items
- Break complex tasks into smaller, manageable steps
- Use clear, descriptive task names
- Update task status in real-time as you work
- Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
- Remove tasks that are no longer relevant
- **IMPORTANT**: When you write the todo list, mark your first task(s) as `in_progress` immediately
- **IMPORTANT**: Unless all tasks are completed, always have at least one task `in_progress` to show progress

Being proactive with task management demonstrates thoroughness and ensures all requirements are completed successfully.

**Remember**: If you only need a few tool calls to complete a task and it's clear what to do, it's better to just do the task directly and NOT use this tool at all.
"""

    return TodoMiddleware(system_prompt=system_prompt, tool_description=tool_description)


# ThreadDataMiddleware must be before SandboxMiddleware to ensure thread_id is available
# UploadsMiddleware should be after ThreadDataMiddleware to access thread_id
# DanglingToolCallMiddleware patches missing ToolMessages before model sees the history
# SummarizationMiddleware should be early to reduce context before other processing
# TodoListMiddleware should be before LoopDetectionMiddleware to allow todo management
# TitleMiddleware generates title after first exchange
# MemoryMiddleware queues conversation for memory update (after TitleMiddleware)
# ViewImageMiddleware injects image details before LLM
# ToolErrorHandlingMiddleware converts tool exceptions to ToolMessages
# LoopDetectionMiddleware should be last to detect repetitive loops
def _build_middlewares(config: RunnableConfig, model_name: str | None, agent_name: str | None = None):
    """Build middleware chain based on runtime configuration.

    Args:
        config: Runtime configuration containing configurable options like is_plan_mode.
        agent_name: If provided, MemoryMiddleware will use per-agent memory storage.

    Returns:
        List of middleware instances.
    """
    middlewares = build_lead_runtime_middlewares(lazy_init=True)

    # Add summarization middleware if enabled
    summarization_middleware = _create_summarization_middleware()
    if summarization_middleware is not None:
        middlewares.append(summarization_middleware)

    # Add auto-compact middleware (deer-flow native, runs after SummarizationMiddleware)
    middlewares.append(CompactMiddleware())

    # Add TodoList middleware if plan mode is enabled
    is_plan_mode = config.get("configurable", {}).get("is_plan_mode", False)
    todo_list_middleware = _create_todo_list_middleware(is_plan_mode)
    if todo_list_middleware is not None:
        middlewares.append(todo_list_middleware)

    # Add TitleMiddleware
    middlewares.append(TitleMiddleware())

    # Add MemoryMiddleware (after TitleMiddleware)
    middlewares.append(MemoryMiddleware(agent_name=agent_name))

    # Add ViewImageMiddleware only if the current model supports vision.
    # For dynamic provider/model names (e.g. "lmstudio/qwen2.5-vl"), fall back to base provider config.
    app_config = get_app_config()
    model_config = app_config.get_model_config(model_name) if model_name else None
    if model_config is None and model_name and "/" in model_name:
        model_config = app_config.get_model_config(model_name.split("/")[0])
    if model_config is not None and model_config.supports_vision:
        middlewares.append(ViewImageMiddleware())

    # Add DeferredToolFilterMiddleware to hide deferred tool schemas from model binding
    if app_config.tool_search.enabled:
        from aether.agents.middlewares.deferred_tool_filter_middleware import DeferredToolFilterMiddleware
        middlewares.append(DeferredToolFilterMiddleware())

    # Add SubagentLimitMiddleware to truncate excess parallel task calls
    subagent_enabled = config.get("configurable", {}).get("subagent_enabled", False)
    if subagent_enabled:
        max_concurrent_subagents = config.get("configurable", {}).get("max_concurrent_subagents", 3)
        middlewares.append(SubagentLimitMiddleware(max_concurrent=max_concurrent_subagents))

    # LoopDetectionMiddleware — detect and break repetitive tool call loops (always last)
    middlewares.append(LoopDetectionMiddleware())
    return middlewares


def make_lead_agent(config: RunnableConfig):
    # Factory reads config["configurable"] (merged from the run); runtime tool
    # context is separate. The web client mirrors mode/bootstrap fields there.
    # Lazy import to avoid circular dependency
    from aether.tools import get_available_tools
    from aether.tools.builtins import setup_agent

    cfg = config.get("configurable", {})

    thinking_enabled = cfg.get("thinking_enabled", True)
    reasoning_effort = cfg.get("reasoning_effort", None)
    requested_model_name: str | None = cfg.get("model_name") or cfg.get("model")
    is_plan_mode = cfg.get("is_plan_mode", False)
    subagent_enabled = cfg.get("subagent_enabled", False)
    max_concurrent_subagents = cfg.get("max_concurrent_subagents", 3)
    is_bootstrap = cfg.get("is_bootstrap", False)
    agent_name = cfg.get("agent_name")
    provider_api_key = cfg.get("provider_api_key")
    interrupted_response: str | None = cfg.get("interrupted_response") or None

    agent_config = load_agent_config(agent_name) if not is_bootstrap else None
    # Custom agent model or fallback to global/default model resolution
    agent_model_name = agent_config.model if agent_config and agent_config.model else _resolve_model_name()

    # Final model name resolution with request override, then agent config, then global default
    model_name = requested_model_name or agent_model_name

    app_config = get_app_config()
    model_config = None
    if model_name:
        # First try exact match (static config model)
        model_config = app_config.get_model_config(model_name)

        # Handle provider/model format (e.g., 'lmstudio/qwen/qwen3-4b-2507')
        if model_config is None and "/" in model_name:
            provider_name = model_name.split("/")[0]
            model_config = app_config.get_model_config(provider_name)

        # Handle OpenRouter model IDs (e.g., 'qwen/qwen3.6-plus:free', 'openai/gpt-4o')
        # These have format 'author/model' not 'provider/model', so the first-slash heuristic fails.
        # Fall back to the 'openrouter' provider entry which carries the correct base_url.
        if model_config is None:
            model_config = app_config.get_model_config("openrouter")

    if model_config is None:
        raise ValueError("No chat model could be resolved. Please configure at least one model in config.yaml or provide a valid 'model_name'/'model' in the request.")
    if thinking_enabled and not model_config.supports_thinking:
        logger.warning(f"Thinking mode is enabled but model '{model_name}' does not support it; fallback to non-thinking mode.")
        thinking_enabled = False

    logger.info(
        "Create Agent(%s) -> thinking_enabled: %s, reasoning_effort: %s, model_name: %s, api_key_provider: %s, is_plan_mode: %s, subagent_enabled: %s, max_concurrent_subagents: %s",
        agent_name or "default",
        thinking_enabled,
        reasoning_effort,
        model_name,
        "runtime" if provider_api_key else "config",
        is_plan_mode,
        subagent_enabled,
        max_concurrent_subagents,
    )

    # Inject run metadata for LangSmith trace tagging
    if "metadata" not in config:
        config["metadata"] = {}

    config["metadata"].update(
        {
            "agent_name": agent_name or "default",
            "model_name": model_name or "default",
            "thinking_enabled": thinking_enabled,
            "reasoning_effort": reasoning_effort,
            "is_plan_mode": is_plan_mode,
            "subagent_enabled": subagent_enabled,
        }
    )

    if is_bootstrap:
        # Special bootstrap agent with minimal prompt for initial custom agent creation flow
        return create_agent(
            model=create_chat_model(name=model_name, thinking_enabled=thinking_enabled, provider_api_key=provider_api_key),
            tools=get_available_tools(model_name=model_name, subagent_enabled=subagent_enabled) + [setup_agent],
            middleware=_build_middlewares(config, model_name=model_name),
            system_prompt=apply_prompt_template(subagent_enabled=subagent_enabled, max_concurrent_subagents=max_concurrent_subagents, available_skills=set(["bootstrap"]), interrupted_response=interrupted_response),
            state_schema=ThreadState,
        )

    # Default lead agent (unchanged behavior)
    return create_agent(
        model=create_chat_model(name=model_name, thinking_enabled=thinking_enabled, reasoning_effort=reasoning_effort, provider_api_key=provider_api_key),
        tools=get_available_tools(model_name=model_name, groups=agent_config.tool_groups if agent_config else None, subagent_enabled=subagent_enabled),
        middleware=_build_middlewares(config, model_name=model_name, agent_name=agent_name),
        system_prompt=apply_prompt_template(subagent_enabled=subagent_enabled, max_concurrent_subagents=max_concurrent_subagents, agent_name=agent_name, interrupted_response=interrupted_response),
        state_schema=ThreadState,
    )
