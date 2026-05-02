"""Tests for the panel_actions Gateway router."""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# SubagentStatus is provided by conftest as a real Enum inside the executor mock.
# Import it through the mock so the router and tests share the same object.
from aether.subagents.executor import SubagentStatus

import app.gateway.routers.panel_actions as panel_actions_router
from app.gateway.routers.panel_actions import (
    PanelActionRequest,
    _build_generic_prompt,
    _extract_steps,
    _persist_result,
)


# Minimal SubagentResult dataclass for test fixtures (real class not importable
# from the mocked executor module).
@dataclass
class SubagentResult:
    task_id: str
    trace_id: str
    status: SubagentStatus
    result: str | None = None
    error: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    ai_messages: list[dict[str, Any]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# _build_generic_prompt
# ---------------------------------------------------------------------------


def test_build_generic_prompt_uses_action_name():
    prompt = _build_generic_prompt("search", {"query": "python async"})
    assert "search" in prompt


def test_build_generic_prompt_includes_args():
    prompt = _build_generic_prompt("analyze", {"file": "data.csv", "mode": "summary"})
    assert "data.csv" in prompt


def test_build_generic_prompt_returns_string():
    prompt = _build_generic_prompt("do_something", {})
    assert isinstance(prompt, str)
    assert len(prompt) > 0


def test_build_generic_prompt_empty_args():
    prompt = _build_generic_prompt("run_task", {})
    assert "run_task" in prompt


# ---------------------------------------------------------------------------
# _extract_steps
# ---------------------------------------------------------------------------


def test_extract_steps_tool_call_web_search():
    messages = [
        {"tool_calls": [{"name": "web_search", "args": {"query": "test"}}], "content": ""},
    ]
    steps = _extract_steps(messages)
    assert len(steps) == 1
    assert steps[0]["label"] == "Searched web"
    assert steps[0]["done"] is True


def test_extract_steps_tool_call_bash():
    messages = [{"tool_calls": [{"name": "bash", "args": {}}], "content": ""}]
    steps = _extract_steps(messages)
    assert steps[0]["label"] == "Ran command"


def test_extract_steps_tool_call_read_file():
    messages = [{"tool_calls": [{"name": "read_file", "args": {}}], "content": ""}]
    steps = _extract_steps(messages)
    assert steps[0]["label"] == "Read file"


def test_extract_steps_tool_call_write_file():
    messages = [{"tool_calls": [{"name": "write_file", "args": {}}], "content": ""}]
    steps = _extract_steps(messages)
    assert steps[0]["label"] == "Wrote file"


def test_extract_steps_tool_call_str_replace():
    messages = [{"tool_calls": [{"name": "str_replace", "args": {}}], "content": ""}]
    steps = _extract_steps(messages)
    assert steps[0]["label"] == "Edited file"


def test_extract_steps_tool_call_ls():
    messages = [{"tool_calls": [{"name": "ls", "args": {}}], "content": ""}]
    steps = _extract_steps(messages)
    assert steps[0]["label"] == "Listed directory"


def test_extract_steps_tool_call_web_fetch():
    messages = [{"tool_calls": [{"name": "web_fetch", "args": {}}], "content": ""}]
    steps = _extract_steps(messages)
    assert steps[0]["label"] == "Read page"


def test_extract_steps_unknown_tool_uses_fallback():
    messages = [{"tool_calls": [{"name": "my_custom_tool", "args": {}}], "content": ""}]
    steps = _extract_steps(messages)
    assert steps[0]["label"] == "Used my_custom_tool"


def test_extract_steps_text_only_message():
    messages = [{"tool_calls": [], "content": "Analyzing the results and forming conclusions."}]
    steps = _extract_steps(messages)
    assert len(steps) == 1
    assert "Analyzing" in steps[0]["label"]


def test_extract_steps_text_truncated_to_80_chars():
    long_text = "A" * 100
    messages = [{"tool_calls": [], "content": long_text}]
    steps = _extract_steps(messages)
    assert len(steps[0]["label"]) <= 83  # 80 chars + "..."


def test_extract_steps_multiple_tool_calls_in_one_message():
    messages = [
        {
            "tool_calls": [
                {"name": "web_search", "args": {}},
                {"name": "web_fetch", "args": {}},
            ],
            "content": "",
        }
    ]
    steps = _extract_steps(messages)
    assert len(steps) == 2
    assert steps[0]["label"] == "Searched web"
    assert steps[1]["label"] == "Read page"


def test_extract_steps_empty_messages():
    assert _extract_steps([]) == []


def test_extract_steps_message_no_tool_calls_no_content():
    messages = [{"tool_calls": [], "content": ""}]
    steps = _extract_steps(messages)
    assert steps == []


def test_extract_steps_all_steps_marked_done():
    messages = [
        {"tool_calls": [{"name": "web_search", "args": {}}], "content": ""},
        {"tool_calls": [], "content": "Thinking..."},
    ]
    steps = _extract_steps(messages)
    for step in steps:
        assert step["done"] is True


# ---------------------------------------------------------------------------
# _persist_result
# ---------------------------------------------------------------------------


def test_persist_result_writes_file(tmp_path):
    task_id = "abc123"
    result_text = "# Summary\n\nFound 5 results."
    artifact_url = _persist_result(task_id, result_text, "thread-1", base_dir=tmp_path)

    expected_path = tmp_path / "threads" / "thread-1" / "user-data" / "outputs" / "panel-actions" / f"{task_id}.md"
    assert expected_path.exists()
    assert expected_path.read_text() == result_text
    assert artifact_url is not None
    assert task_id in artifact_url


def test_persist_result_is_idempotent(tmp_path):
    task_id = "idem123"
    _persist_result(task_id, "first write", "thread-1", base_dir=tmp_path)
    _persist_result(task_id, "second write", "thread-1", base_dir=tmp_path)

    expected_path = tmp_path / "threads" / "thread-1" / "user-data" / "outputs" / "panel-actions" / f"{task_id}.md"
    # Second write should NOT overwrite (idempotent)
    assert expected_path.read_text() == "first write"


def test_persist_result_creates_directories(tmp_path):
    task_id = "newdir456"
    _persist_result(task_id, "content", "thread-abc", base_dir=tmp_path)
    panel_actions_dir = tmp_path / "threads" / "thread-abc" / "user-data" / "outputs" / "panel-actions"
    assert panel_actions_dir.is_dir()


def test_persist_result_returns_none_on_error(tmp_path):
    # Pass a thread_id that would cause a ValueError in get_paths (path traversal)
    result = _persist_result("task1", "content", "../../../etc", base_dir=tmp_path)
    assert result is None


# ---------------------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------------------


def test_panel_action_request_args_too_large():
    """Args exceeding 4096 bytes should raise a validation error."""
    import json
    from pydantic import ValidationError

    large_args = {"data": "x" * 5000}
    with pytest.raises(ValidationError):
        PanelActionRequest(
            action_name="test",
            args=large_args,
            panel_id="panel-1",
        )


def test_panel_action_request_prompt_too_long():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        PanelActionRequest(
            action_name="test",
            args={},
            panel_id="panel-1",
            prompt="x" * 8193,
        )


def test_panel_action_request_valid_defaults():
    req = PanelActionRequest(
        action_name="search",
        args={"query": "hello"},
        panel_id="panel-1",
    )
    assert req.subagent_type == "general-purpose"
    assert req.max_turns == 10
    assert req.prompt is None


def test_panel_action_request_custom_subagent_type():
    req = PanelActionRequest(
        action_name="analyze",
        args={},
        panel_id="panel-1",
        subagent_type="bash",
    )
    assert req.subagent_type == "bash"


# ---------------------------------------------------------------------------
# Status mapping
# ---------------------------------------------------------------------------


def test_status_map_pending_is_running():
    status = panel_actions_router._map_status(SubagentStatus.PENDING)
    assert status == "running"


def test_status_map_running_is_running():
    status = panel_actions_router._map_status(SubagentStatus.RUNNING)
    assert status == "running"


def test_status_map_completed():
    status = panel_actions_router._map_status(SubagentStatus.COMPLETED)
    assert status == "completed"


def test_status_map_failed():
    status = panel_actions_router._map_status(SubagentStatus.FAILED)
    assert status == "failed"


def test_status_map_timed_out():
    status = panel_actions_router._map_status(SubagentStatus.TIMED_OUT)
    assert status == "timed_out"


def test_status_map_cancelled():
    status = panel_actions_router._map_status(SubagentStatus.CANCELLED)
    assert status == "cancelled"


# ---------------------------------------------------------------------------
# Cancel endpoint
# ---------------------------------------------------------------------------


def test_cancel_existing_task_returns_cancelled():
    """cancel_panel_action should call cancel_background_task and return cancelled:true."""
    with patch("app.gateway.routers.panel_actions.cancel_background_task", return_value=True) as mock_cancel:
        result = asyncio.run(panel_actions_router.cancel_panel_action("thread-1", "task-abc"))
        mock_cancel.assert_called_once_with("task-abc")
        assert result == {"cancelled": True}


def test_cancel_missing_task_raises_404():
    from fastapi import HTTPException

    with patch("app.gateway.routers.panel_actions.cancel_background_task", return_value=False):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(panel_actions_router.cancel_panel_action("thread-1", "nonexistent"))
        assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# Poll endpoint — status transitions
# ---------------------------------------------------------------------------


def _make_result(status: SubagentStatus, ai_messages=None, result=None, error=None) -> SubagentResult:
    return SubagentResult(
        task_id="t1",
        trace_id="tr1",
        status=status,
        result=result,
        error=error,
        ai_messages=ai_messages or [],
    )


def test_poll_running_returns_running_status():
    result = _make_result(SubagentStatus.RUNNING, ai_messages=[])
    with patch("app.gateway.routers.panel_actions.get_background_task_result", return_value=result):
        response = asyncio.run(panel_actions_router.poll_panel_action("thread-1", "t1", since=0))
    assert response["status"] == "running"


def test_poll_completed_returns_completed_status():
    result = _make_result(SubagentStatus.COMPLETED, result="Done!", ai_messages=[])
    with patch("app.gateway.routers.panel_actions.get_background_task_result", return_value=result):
        with patch("app.gateway.routers.panel_actions._persist_result", return_value="/api/threads/thread-1/artifacts/mnt/user-data/outputs/panel-actions/t1.md"):
            response = asyncio.run(panel_actions_router.poll_panel_action("thread-1", "t1", since=0))
    assert response["status"] == "completed"
    assert response["result"] == "Done!"


def test_poll_completed_cleans_up_task():
    result = _make_result(SubagentStatus.COMPLETED, result="Done!", ai_messages=[])
    with patch("app.gateway.routers.panel_actions.get_background_task_result", return_value=result):
        with patch("app.gateway.routers.panel_actions._persist_result", return_value=None):
            with patch("app.gateway.routers.panel_actions.cleanup_background_task") as mock_cleanup:
                asyncio.run(panel_actions_router.poll_panel_action("thread-1", "t1", since=0))
                mock_cleanup.assert_called_once_with("t1")


def test_poll_failed_returns_failed_status():
    result = _make_result(SubagentStatus.FAILED, error="Something went wrong")
    with patch("app.gateway.routers.panel_actions.get_background_task_result", return_value=result):
        with patch("app.gateway.routers.panel_actions.cleanup_background_task"):
            response = asyncio.run(panel_actions_router.poll_panel_action("thread-1", "t1", since=0))
    assert response["status"] == "failed"
    assert response["error"] == "Something went wrong"


def test_poll_timed_out_returns_timed_out_status():
    result = _make_result(SubagentStatus.TIMED_OUT, error="Timed out after 600s")
    with patch("app.gateway.routers.panel_actions.get_background_task_result", return_value=result):
        with patch("app.gateway.routers.panel_actions.cleanup_background_task"):
            response = asyncio.run(panel_actions_router.poll_panel_action("thread-1", "t1", since=0))
    assert response["status"] == "timed_out"


def test_poll_not_found_raises_404():
    from fastapi import HTTPException

    with patch("app.gateway.routers.panel_actions.get_background_task_result", return_value=None):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(panel_actions_router.poll_panel_action("thread-1", "missing", since=0))
        assert exc_info.value.status_code == 404


def test_poll_since_returns_only_new_messages():
    messages = [
        {"tool_calls": [{"name": "web_search", "args": {}}], "content": ""},
        {"tool_calls": [{"name": "web_fetch", "args": {}}], "content": ""},
        {"tool_calls": [], "content": "Summarizing..."},
    ]
    result = _make_result(SubagentStatus.RUNNING, ai_messages=messages)
    with patch("app.gateway.routers.panel_actions.get_background_task_result", return_value=result):
        response = asyncio.run(panel_actions_router.poll_panel_action("thread-1", "t1", since=1))
    # since=1 means skip the first message, return messages[1:]
    assert response["total_messages"] == 3
    assert len(response["new_messages"]) == 2
