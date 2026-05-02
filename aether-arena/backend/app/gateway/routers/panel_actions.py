"""Panel Actions router — start, poll, and cancel subagent executions triggered from inline HTML panels."""

import json
import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from aether.config.paths import get_paths
from aether.subagents.config import SubagentConfig
from aether.subagents.executor import (
    SubagentExecutor,
    SubagentStatus,
    cancel_background_task,
    cleanup_background_task,
    get_background_task_result,
)
from aether.subagents.registry import get_subagent_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["panel-actions"])

# Maximum allowed JSON size for args (bytes)
_MAX_ARGS_BYTES = 4096
# Maximum allowed prompt length (characters)
_MAX_PROMPT_CHARS = 8192

TOOL_LABELS: dict[str, str] = {
    "web_search": "Searched web",
    "web_fetch": "Read page",
    "bash": "Ran command",
    "read_file": "Read file",
    "write_file": "Wrote file",
    "str_replace": "Edited file",
    "ls": "Listed directory",
    "view_image": "Viewed image",
}


class PanelActionRequest(BaseModel):
    action_name: str
    args: dict[str, Any]
    panel_id: str
    subagent_type: str = "general-purpose"
    prompt: str | None = None
    max_turns: int = 10

    @field_validator("args")
    @classmethod
    def args_size_limit(cls, v: dict) -> dict:
        if len(json.dumps(v)) > _MAX_ARGS_BYTES:
            raise ValueError(f"args JSON must not exceed {_MAX_ARGS_BYTES} bytes")
        return v

    @field_validator("prompt")
    @classmethod
    def prompt_length_limit(cls, v: str | None) -> str | None:
        if v is not None and len(v) > _MAX_PROMPT_CHARS:
            raise ValueError(f"prompt must not exceed {_MAX_PROMPT_CHARS} characters")
        return v


def _build_generic_prompt(action_name: str, args: dict[str, Any]) -> str:
    """Build a generic prompt when the agent omits one."""
    args_str = json.dumps(args, ensure_ascii=False) if args else "(none)"
    return (
        f"Execute the '{action_name}' action.\n\n"
        f"Arguments:\n{args_str}\n\n"
        "Complete the task and return a concise summary of the result."
    )


def _extract_steps(ai_messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map ai_messages entries to StepEntry dicts (label + done flag).

    All returned steps are marked done=True — the caller sets the last one
    to done=False only when the task is still running.
    """
    steps: list[dict[str, Any]] = []
    for msg in ai_messages:
        tool_calls = msg.get("tool_calls") or []
        for tc in tool_calls:
            name = tc.get("name", "")
            label = TOOL_LABELS.get(name, f"Used {name}")
            steps.append({"label": label, "done": True})

        # Text-only message (no tool calls) — use first 80 chars of content
        if not tool_calls:
            content = msg.get("content") or ""
            if isinstance(content, list):
                # Extract text from content blocks
                parts = [b.get("text", "") if isinstance(b, dict) else str(b) for b in content]
                content = " ".join(p for p in parts if p)
            if content:
                label = content[:80] + ("..." if len(content) > 80 else "")
                steps.append({"label": label, "done": True})

    return steps


def _persist_result(task_id: str, result_text: str, thread_id: str, base_dir: Path | None = None) -> str | None:
    """Write the subagent result to the panel-actions outputs directory.

    Returns the artifact URL path on success, None on any error.
    Idempotent — will not overwrite an existing file.
    """
    try:
        if base_dir is not None:
            # Validate thread_id manually (mirrors get_paths() behaviour)
            import re
            if not re.match(r"^[a-zA-Z0-9_\-]+$", thread_id):
                raise ValueError(f"Invalid thread_id {thread_id!r}")
            panel_actions_dir = base_dir / "threads" / thread_id / "user-data" / "outputs" / "panel-actions"
        else:
            panel_actions_dir = get_paths().sandbox_outputs_dir(thread_id) / "panel-actions"

        panel_actions_dir.mkdir(parents=True, exist_ok=True)
        md_path = panel_actions_dir / f"{task_id}.md"

        if not md_path.exists():
            md_path.write_text(result_text, encoding="utf-8")
            logger.info("Persisted panel action result: %s", md_path)

        artifact_url = f"/api/threads/{thread_id}/artifacts/mnt/user-data/outputs/panel-actions/{task_id}.md"
        return artifact_url
    except Exception:
        logger.exception("Failed to persist panel action result for task %s", task_id)
        return None


def _map_status(status: SubagentStatus) -> str:
    """Map SubagentStatus enum to the API response status string."""
    mapping = {
        SubagentStatus.PENDING: "running",
        SubagentStatus.RUNNING: "running",
        SubagentStatus.COMPLETED: "completed",
        SubagentStatus.FAILED: "failed",
        SubagentStatus.TIMED_OUT: "timed_out",
        SubagentStatus.CANCELLED: "cancelled",
    }
    return mapping.get(status, "failed")


@router.post(
    "/threads/{thread_id}/panel-actions",
    summary="Start Panel Action",
    description="Trigger a subagent execution from an inline HTML panel. Returns a task_id for polling.",
)
async def start_panel_action(thread_id: str, request: PanelActionRequest) -> dict:
    """Start a panel action subagent in the background.

    Args:
        thread_id: Thread ID scoping this action.
        request: Action request with name, args, subagent config.

    Returns:
        { task_id: str }
    """
    # Validate thread_id via get_paths (raises ValueError on traversal attempts)
    try:
        get_paths().thread_dir(thread_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Resolve subagent config
    subagent_config = get_subagent_config(request.subagent_type)
    if subagent_config is None:
        raise HTTPException(status_code=400, detail=f"Unknown subagent_type: {request.subagent_type!r}")

    # Build the prompt — agent-provided or generic fallback
    prompt = request.prompt or _build_generic_prompt(request.action_name, request.args)

    # Override max_turns from request
    config_with_turns = SubagentConfig(
        name=subagent_config.name,
        system_prompt=subagent_config.system_prompt,
        tools=subagent_config.tools,
        disallowed_tools=(subagent_config.disallowed_tools or []) + ["task"],
        max_turns=request.max_turns,
        timeout_seconds=subagent_config.timeout_seconds,
        model=subagent_config.model,
    )

    # Get tools — no MCP, no task nesting
    from aether.tools.tools import get_available_tools
    tools = get_available_tools(include_mcp=False, subagent_enabled=False)

    task_id = str(uuid.uuid4())
    executor = SubagentExecutor(
        config=config_with_turns,
        tools=tools,
        thread_id=thread_id,
    )
    executor.execute_async(prompt, task_id=task_id)

    logger.info("Started panel action task_id=%s for thread=%s action=%s", task_id, thread_id, request.action_name)
    return {"task_id": task_id}


@router.get(
    "/threads/{thread_id}/panel-actions/{task_id}",
    summary="Poll Panel Action",
    description="Poll the status of a running panel action. Use ?since=N to get only new messages.",
)
async def poll_panel_action(thread_id: str, task_id: str, since: int = 0) -> dict:
    """Poll a panel action's status and get new step messages.

    Args:
        thread_id: Thread ID (for scoping — not validated against task).
        task_id: Task ID returned by start_panel_action.
        since: Index of last seen message (0 on first call).

    Returns:
        Status response dict. Terminal statuses clean up the task entry.
    """
    result = get_background_task_result(task_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

    api_status = _map_status(result.status)
    ai_messages = result.ai_messages or []
    new_messages = ai_messages[since:]
    total_messages = len(ai_messages)

    if api_status == "running":
        return {
            "status": "running",
            "new_messages": new_messages,
            "total_messages": total_messages,
        }

    # Terminal status — clean up and return full response
    if api_status == "completed":
        artifact_url = _persist_result(task_id, result.result or "", thread_id)
        cleanup_background_task(task_id)
        return {
            "status": "completed",
            "result": result.result or "",
            "artifact_url": artifact_url,
            "new_messages": new_messages,
        }

    # failed / timed_out / cancelled
    cleanup_background_task(task_id)
    return {
        "status": api_status,
        "error": result.error,
        "new_messages": new_messages,
    }


@router.delete(
    "/threads/{thread_id}/panel-actions/{task_id}",
    summary="Cancel Panel Action",
    description="Cancel a running panel action. Marks it CANCELLED and cleans up immediately.",
)
async def cancel_panel_action(thread_id: str, task_id: str) -> dict:
    """Cancel a panel action.

    Args:
        thread_id: Thread ID (for scoping).
        task_id: Task ID to cancel.

    Returns:
        { cancelled: True }

    Raises:
        HTTPException 404 if task not found.
    """
    cancelled = cancel_background_task(task_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
    return {"cancelled": True}
