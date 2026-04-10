"""Manual compact endpoint — POST /api/threads/{thread_id}/compact.

Fetches the current conversation from the LangGraph checkpointer via the
langgraph_sdk, runs LLM compaction (with sumy fallback), and writes the
compacted message list back to the thread state.

The frontend CompactButton calls this endpoint directly.
"""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/threads/{thread_id}", tags=["compact"])

_LANGGRAPH_URL = os.environ.get("LANGGRAPH_BASE_URL", "http://localhost:2024")
_ASSISTANT_ID = "lead_agent"


class CompactRequest(BaseModel):
    model_name: str | None = None
    custom_instructions: str | None = None
    messages_to_keep: int = 10


class CompactResponse(BaseModel):
    success: bool
    pre_tokens: int = 0
    post_tokens: int = 0
    summary: str = ""
    error: str | None = None


@router.post("/compact", response_model=CompactResponse, summary="Manually compact conversation context")
async def compact_thread(thread_id: str, request: CompactRequest = CompactRequest()) -> CompactResponse:
    """Summarize the conversation history for a thread and replace it with the compact result.

    Uses LLM compaction by default; falls back to sumy LexRank if LLM is
    unavailable or returns an error.
    """
    try:
        from langgraph_sdk import get_client
    except ImportError:
        raise HTTPException(status_code=503, detail="langgraph_sdk not installed")

    try:
        client = get_client(url=_LANGGRAPH_URL)
        # Fetch current thread state
        state = await client.threads.get_state(
            thread_id=thread_id,
            checkpoint_id=None,
        )
    except Exception as exc:
        logger.warning("compact: failed to fetch thread state thread_id=%s: %s", thread_id, exc)
        raise HTTPException(status_code=404, detail=f"Thread not found or state unavailable: {exc}") from exc

    raw_messages = (state.get("values") or {}).get("messages", [])
    if not raw_messages:
        return CompactResponse(success=False, error="No messages in thread.")

    # Deserialize raw message dicts into LangChain BaseMessage objects
    try:
        from langchain_core.messages import messages_from_dict
        messages = messages_from_dict(raw_messages) if raw_messages and isinstance(raw_messages[0], dict) else raw_messages
    except Exception:
        # Already deserialized by SDK
        messages = raw_messages

    if len(messages) < 4:
        return CompactResponse(success=False, error="Not enough messages to compact (need at least 4).")

    # Resolve model name
    model_name = request.model_name
    if not model_name:
        try:
            from deerflow.config.app_config import get_app_config
            cfg = get_app_config()
            if cfg.models:
                model_name = cfg.models[0].name
        except Exception:
            pass

    # Run compaction
    from deerflow.compact.command import run_manual_compact

    result = run_manual_compact(
        messages=messages,
        model_name=model_name,
        custom_instructions=request.custom_instructions,
        messages_to_keep=request.messages_to_keep,
    )

    if not result["messages"]:
        return CompactResponse(success=False, error="Compaction produced empty message list.")

    # Write compacted state back via LangGraph update_state
    try:
        from langchain_core.messages import messages_to_dict
        serialized = messages_to_dict(result["messages"])
        await client.threads.update_state(
            thread_id=thread_id,
            values={"messages": serialized},
            as_node="__start__",
        )
    except Exception as exc:
        logger.warning("compact: failed to update thread state thread_id=%s: %s", thread_id, exc)
        # Return partial success — compaction ran, but write failed
        return CompactResponse(
            success=False,
            pre_tokens=result["pre_tokens"],
            post_tokens=result["post_tokens"],
            summary=result.get("summary", ""),
            error=f"Compacted but failed to persist: {exc}",
        )

    return CompactResponse(
        success=result["success"],
        pre_tokens=result["pre_tokens"],
        post_tokens=result["post_tokens"],
        summary=result.get("summary", ""),
        error=result.get("error"),
    )
