"""Compact endpoint — POST /api/threads/{thread_id}/compact[/stream].

Two endpoints:
  POST /compact         — blocking, returns JSON (for programmatic callers)
  POST /compact/stream  — SSE streaming, yields tokens live then prunes thread

Both prune the EXISTING thread in-place using LangGraph's RemoveMessage
reducer. No new thread is created. The UI just refreshes and sees the
compact boundary marker at the top of the (now smaller) message list.

Thread state after compact:
  [COMPACT_BOUNDARY] marker  ← inserted as new HumanMessage
  [Conversation summary ...]  ← inserted as new HumanMessage
  <last N messages verbatim>  ← kept (their original IDs untouched)

Old messages (beyond messages_to_keep) are removed via {"type": "remove", "id": ...}
which the LangGraph add_messages reducer handles natively.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Thread-scoped router (prefixed with thread_id)
router = APIRouter(prefix="/api/threads/{thread_id}", tags=["compact"])
# Config router — no thread_id in path
config_router = APIRouter(prefix="/api/compact", tags=["compact"])

_LANGGRAPH_URL = __import__("os").environ.get("LANGGRAPH_BASE_URL", "http://localhost:2024")


# ── Config endpoints ──────────────────────────────────────────────────────────


class CompactConfigResponse(BaseModel):
    enabled: bool
    model_name: str | None
    messages_to_keep: int
    token_threshold_override: int | None
    # Doc summarization settings
    doc_summarization_enabled: bool
    doc_summarization_ratio: float
    doc_summarization_threshold: int


class UpdateCompactConfigRequest(BaseModel):
    enabled: bool | None = None
    model_name: str | None = None
    messages_to_keep: int | None = None
    token_threshold_override: int | None = None
    # Doc summarization settings
    doc_summarization_enabled: bool | None = None
    doc_summarization_ratio: float | None = None
    doc_summarization_threshold: int | None = None


def _build_config_response() -> CompactConfigResponse:
    from aether.config.compact_config import get_compact_config
    from aether.config.doc_summarization_config import get_doc_summarization_config
    cfg = get_compact_config()
    doc_cfg = get_doc_summarization_config()
    return CompactConfigResponse(
        enabled=cfg.enabled,
        model_name=cfg.model_name,
        messages_to_keep=cfg.messages_to_keep,
        token_threshold_override=cfg.token_threshold_override,
        doc_summarization_enabled=doc_cfg.enabled,
        doc_summarization_ratio=doc_cfg.target_ratio,
        doc_summarization_threshold=doc_cfg.token_threshold,
    )


@config_router.get("/config", response_model=CompactConfigResponse, summary="Get compact configuration")
async def get_compact_config_endpoint() -> CompactConfigResponse:
    """Return the current compact/summarization configuration."""
    return _build_config_response()


@config_router.put("/config", response_model=CompactConfigResponse, summary="Update compact configuration")
async def update_compact_config_endpoint(body: UpdateCompactConfigRequest) -> CompactConfigResponse:
    """Update mutable compact configuration fields."""
    from aether.config.compact_config import CompactConfig, get_compact_config, set_compact_config
    from aether.config.doc_summarization_config import DocSummarizationConfig, get_doc_summarization_config, set_doc_summarization_config

    existing = get_compact_config()
    updated = CompactConfig(
        enabled=body.enabled if body.enabled is not None else existing.enabled,
        model_name=body.model_name if body.model_name is not None else existing.model_name,
        messages_to_keep=body.messages_to_keep if body.messages_to_keep is not None else existing.messages_to_keep,
        token_threshold_override=body.token_threshold_override if body.token_threshold_override is not None else existing.token_threshold_override,
    )
    set_compact_config(updated)

    if body.doc_summarization_enabled is not None or body.doc_summarization_ratio is not None or body.doc_summarization_threshold is not None:
        existing_doc = get_doc_summarization_config()
        updated_doc = DocSummarizationConfig(
            enabled=body.doc_summarization_enabled if body.doc_summarization_enabled is not None else existing_doc.enabled,
            target_ratio=body.doc_summarization_ratio if body.doc_summarization_ratio is not None else existing_doc.target_ratio,
            token_threshold=body.doc_summarization_threshold if body.doc_summarization_threshold is not None else existing_doc.token_threshold,
            min_sentences=existing_doc.min_sentences,
        )
        set_doc_summarization_config(updated_doc)

    return _build_config_response()


class CompactRequest(BaseModel):
    model_name: str | None = None
    custom_instructions: str | None = None
    messages_to_keep: int | None = None  # None = use CompactConfig value


class CompactResponse(BaseModel):
    success: bool
    method: str = "llm"
    pre_tokens: int = 0
    post_tokens: int = 0
    summary: str = ""
    error: str | None = None


# ── Shared helpers ────────────────────────────────────────────────────────────


def _extract_text_content(content) -> str:
    """Extract plain text from a message content value.

    LangGraph stores content as either a plain string or a list of typed blocks
    (e.g. [{"type": "text", "text": "..."}]).  For AI messages that contain tool
    calls, the content may be empty string or a list with text + tool_use blocks.
    We only keep text so special tool tokens (e.g. Mistral's <|END_TOOL_REQUEST|>)
    are never forwarded to the compact model where they'd be re-tokenized as
    control tokens and cause empty responses.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(p for p in parts if p)
    return str(content) if content else ""


def _to_base_messages(raw_messages: list) -> list:
    """Convert raw LangGraph message dicts to LangChain BaseMessage objects.

    Only the text content is preserved — tool calls, tool results, and any
    model-specific special tokens are stripped so the compact model receives a
    clean conversation transcript.
    """
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    result = []
    for m in raw_messages:
        if not isinstance(m, dict):
            result.append(m)
            continue
        msg_type = m.get("type", "human")
        content = _extract_text_content(m.get("content", ""))
        # Skip tool messages entirely — they're low-level plumbing irrelevant to a summary
        if msg_type == "tool":
            continue
        # Skip AI messages that are pure tool calls with no text content
        if msg_type == "ai" and not content.strip():
            continue
        if msg_type == "human":
            result.append(HumanMessage(content=content))
        elif msg_type == "ai":
            result.append(AIMessage(content=content))
        elif msg_type == "system":
            result.append(SystemMessage(content=content))
        else:
            result.append(HumanMessage(content=content))
    return result


async def _prune_thread(
    client,
    thread_id: str,
    all_messages: list,
    messages_to_keep: int,
    pre_tokens: int,
    post_tokens: int,
    summarized_count: int,
    summary: str,
    method: str,
) -> None:
    """Prune the existing thread in-place.

    Removes all messages older than messages_to_keep using the LangGraph
    add_messages reducer's remove-by-id semantics, then inserts the compact
    boundary marker + summary as new messages at the front (by removing ALL
    messages first so the append order is: boundary → summary → kept).
    """
    boundary_content = (
        f"[COMPACT_BOUNDARY] summarized={summarized_count} trigger=manual"
        f" pre_tokens={pre_tokens} post_tokens={post_tokens}"
    )
    summary_content = (
        f"[Conversation summary — {summarized_count} earlier messages condensed"
        + (f" via {method}" if method == "sumy" else "")
        + f"]\n\n{summary}"
    )

    # Remove ALL messages so we can re-add in correct order:
    # boundary → summary → kept[-messages_to_keep:]
    # NOTE: LangGraph's add_messages reducer coerces these dicts via langchain's
    # _convert_to_message(), which requires a "content" key alongside "type".
    # Without "content": "" the coercion raises MESSAGE_COERCION_FAILURE.
    remove_ops = [
        {"type": "remove", "id": m.get("id"), "content": ""}
        for m in all_messages
        if isinstance(m, dict) and m.get("id")
    ]

    kept_messages = all_messages[-messages_to_keep:] if messages_to_keep > 0 else []

    new_messages = [
        {"type": "human", "id": str(uuid.uuid4()), "content": boundary_content},
        {"type": "human", "id": str(uuid.uuid4()), "content": summary_content},
        *kept_messages,
    ]

    logger.info(
        "compact: pruning thread_id=%s — removing %d msgs, re-adding %d (boundary+summary+%d kept)",
        thread_id, len(remove_ops), len(new_messages), len(kept_messages),
    )

    await client.threads.update_state(
        thread_id=thread_id,
        values={"messages": remove_ops + new_messages},
    )

    # Verify prune applied — diagnostic for "agent still saw full history" bugs.
    try:
        verify = await client.threads.get_state(thread_id=thread_id)
        actual_msgs = (verify.get("values") or {}).get("messages", [])
        logger.info(
            "compact: prune verification thread_id=%s — expected %d messages, got %d in checkpoint",
            thread_id, len(new_messages), len(actual_msgs),
        )
        if len(actual_msgs) > len(new_messages) + 2:
            logger.warning(
                "compact: prune may not have fully applied — thread has %d messages but expected ~%d. "
                "Agent may receive uncompacted history on next run.",
                len(actual_msgs), len(new_messages),
            )
    except Exception as verify_exc:
        logger.warning("compact: could not verify prune for thread_id=%s: %s", thread_id, verify_exc)


def _build_compact_messages(
    all_messages: list,
    messages_to_keep: int,
    summarized_count: int,
    pre_tokens: int,
    post_tokens: int,
    summary: str,
    method: str,
) -> tuple[list, list]:
    """Return (new_messages, kept_messages) for compact state.

    new_messages = [boundary_marker, summary_msg, ...kept_messages]
    kept_messages = all_messages[-messages_to_keep:]
    """
    boundary_content = (
        f"[COMPACT_BOUNDARY] summarized={summarized_count} trigger=manual"
        f" pre_tokens={pre_tokens} post_tokens={post_tokens}"
    )
    summary_content = (
        f"[Conversation summary — {summarized_count} earlier messages condensed"
        + (f" via {method}" if method == "sumy" else "")
        + f"]\n\n{summary}"
    )
    kept_messages = all_messages[-messages_to_keep:] if messages_to_keep > 0 else []
    new_messages = [
        {"type": "human", "id": str(uuid.uuid4()), "content": boundary_content},
        {"type": "human", "id": str(uuid.uuid4()), "content": summary_content},
        *kept_messages,
    ]
    return new_messages, kept_messages


async def _create_compact_thread(
    client,
    old_thread_id: str,
    all_messages: list,
    messages_to_keep: int,
    pre_tokens: int,
    post_tokens: int,
    summarized_count: int,
    summary: str,
    method: str,
) -> str:
    """Create a new continuation LangGraph thread seeded with the compact state.

    Preferred over in-place prune for the streaming endpoint: creates a fresh
    thread whose only messages are the boundary marker, summary, and N most-recent
    kept messages.  The frontend navigates to the new thread, eliminating any
    stale client-side message state.

    Returns the new thread_id.
    """
    new_messages, kept_messages = _build_compact_messages(
        all_messages=all_messages,
        messages_to_keep=messages_to_keep,
        summarized_count=summarized_count,
        pre_tokens=pre_tokens,
        post_tokens=post_tokens,
        summary=summary,
        method=method,
    )

    # Fetch the source thread to inherit its graph_id.
    # update_state() requires a graph_id on the thread — bare threads without
    # one raise "has no assigned graph ID".
    graph_id: str | None = None
    try:
        source_thread = await client.threads.get(thread_id=old_thread_id)
        # graph_id is stored inside metadata, not as a top-level key
        graph_id = (source_thread.get("metadata") or {}).get("graph_id")
        logger.info("compact: source thread %s graph_id=%s", old_thread_id, graph_id)
    except Exception as exc:
        logger.warning("compact: could not fetch source thread %s to get graph_id: %s", old_thread_id, exc)

    create_kwargs: dict = {
        "metadata": {
            "compact_parent": old_thread_id,
            "compact_pre_tokens": pre_tokens,
            "compact_post_tokens": post_tokens,
            "compact_summarized_count": summarized_count,
        }
    }
    if graph_id:
        create_kwargs["graph_id"] = graph_id

    new_thread = await client.threads.create(**create_kwargs)
    new_thread_id = new_thread["thread_id"]

    logger.info(
        "compact: creating continuation thread_id=%s from old_thread_id=%s — seeding %d messages (boundary+summary+%d kept)",
        new_thread_id, old_thread_id, len(new_messages), len(kept_messages),
    )

    # Seed the new thread.  No remove ops needed — thread is empty.
    await client.threads.update_state(
        thread_id=new_thread_id,
        values={"messages": new_messages},
    )

    # Verify seed took effect.
    try:
        verify = await client.threads.get_state(thread_id=new_thread_id)
        actual_msgs = (verify.get("values") or {}).get("messages", [])
        logger.info(
            "compact: new thread %s seeded — expected %d messages, got %d in checkpoint",
            new_thread_id, len(new_messages), len(actual_msgs),
        )
        if len(actual_msgs) != len(new_messages):
            logger.warning(
                "compact: seed mismatch for new thread %s — got %d messages but expected %d",
                new_thread_id, len(actual_msgs), len(new_messages),
            )
    except Exception as verify_exc:
        logger.warning("compact: could not verify new thread %s: %s", new_thread_id, verify_exc)

    return new_thread_id


# ── Blocking endpoint ─────────────────────────────────────────────────────────


@router.post("/compact", response_model=CompactResponse, summary="Compact conversation (blocking)")
async def compact_thread(thread_id: str, request: CompactRequest = CompactRequest()) -> CompactResponse:
    """Summarize conversation, prune the existing thread, return token counts.

    Blocking version — waits for LLM to finish before responding.
    Use /compact/stream for a live streaming experience.
    """
    try:
        from langgraph_sdk import get_client
    except ImportError:
        raise HTTPException(status_code=503, detail="langgraph_sdk not installed")

    client = get_client(url=_LANGGRAPH_URL)

    try:
        state = await client.threads.get_state(thread_id=thread_id, checkpoint_id=None)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Thread not found: {exc}") from exc

    values = state.get("values") or {}
    messages = values.get("messages", [])

    if not messages:
        return CompactResponse(success=False, error="No messages in thread.")
    if len(messages) < 4:
        return CompactResponse(success=False, error="Not enough messages to compact (need at least 4).")

    from aether.compact.command import run_manual_compact

    result = run_manual_compact(
        messages=messages,
        model_name=request.model_name,
        custom_instructions=request.custom_instructions,
        messages_to_keep=request.messages_to_keep,
    )

    if not result.get("summary"):
        return CompactResponse(success=False, error=result.get("error") or "Compaction produced no summary.")

    summary = result["summary"]
    method = "llm" if not result.get("error") else "sumy"
    pre_tokens = result["pre_tokens"]
    post_tokens = result["post_tokens"]
    summarized_count = max(0, len(messages) - request.messages_to_keep)

    try:
        await _prune_thread(
            client=client,
            thread_id=thread_id,
            all_messages=messages,
            messages_to_keep=request.messages_to_keep,
            pre_tokens=pre_tokens,
            post_tokens=post_tokens,
            summarized_count=summarized_count,
            summary=summary,
            method=method,
        )
    except Exception as exc:
        logger.error("compact: failed to prune thread %s: %s", thread_id, exc)
        raise HTTPException(status_code=500, detail=f"Compaction succeeded but thread prune failed: {exc}") from exc

    return CompactResponse(
        success=True,
        method=method,
        pre_tokens=pre_tokens,
        post_tokens=post_tokens,
        summary=summary,
    )


# ── Streaming SSE endpoint ────────────────────────────────────────────────────


@router.post("/compact/stream", summary="Compact conversation with live SSE token streaming")
async def compact_thread_stream(thread_id: str, request: CompactRequest = CompactRequest()) -> StreamingResponse:
    """Compact conversation and stream LLM tokens as Server-Sent Events.

    SSE event shapes:
      {"type": "start",  "pre_tokens": N, "message_count": N, "summarized_count": N}
      {"type": "token",  "text": "..."}
      {"type": "done",   "summary": "...", "pre_tokens": N, "post_tokens": N,
                         "summarized_count": N, "method": "llm", "new_thread_id": "..."}
      {"type": "error",  "message": "..."}

    After streaming the "done" event a NEW continuation thread is created and
    its ID is returned in the "done" event as "new_thread_id".  The frontend
    navigates to /workspace/chats/{new_thread_id} so there is no stale client-
    side message state — the new thread starts clean with only the compact
    boundary, summary, and kept messages.
    """
    try:
        from langgraph_sdk import get_client
    except ImportError:
        raise HTTPException(status_code=503, detail="langgraph_sdk not installed")

    client = get_client(url=_LANGGRAPH_URL)

    try:
        state = await client.threads.get_state(thread_id=thread_id, checkpoint_id=None)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"Thread not found: {exc}") from exc

    values = state.get("values") or {}
    messages: list = values.get("messages", [])

    if not messages:
        raise HTTPException(status_code=400, detail="No messages in thread.")
    if len(messages) < 4:
        raise HTTPException(status_code=400, detail="Not enough messages to compact (need at least 4).")

    # Resolve messages_to_keep: use request value if provided, else fall back to config
    from aether.config.compact_config import get_compact_config
    _cfg = get_compact_config()
    resolved_messages_to_keep = request.messages_to_keep if request.messages_to_keep is not None else _cfg.messages_to_keep
    effective_model = request.model_name or _cfg.model_name

    logger.info(
        "compact stream: thread_id=%s messages_to_keep=%d (req=%s cfg=%d) model=%s",
        thread_id, resolved_messages_to_keep, request.messages_to_keep, _cfg.messages_to_keep, effective_model or "default",
    )

    loop = asyncio.get_event_loop()
    event_queue: asyncio.Queue[dict | None] = asyncio.Queue()

    def _run_compact_in_thread() -> None:
        """Run the synchronous streaming compact generator in a background thread."""
        try:
            from aether.compact.engine import compact_conversation_stream
            from aether.compact.types import CompactTrigger

            processed = _to_base_messages(messages)
            for event in compact_conversation_stream(
                messages=processed,
                model_name=effective_model,
                custom_instructions=request.custom_instructions,
                messages_to_keep=resolved_messages_to_keep,
                trigger=CompactTrigger.MANUAL,
            ):
                asyncio.run_coroutine_threadsafe(event_queue.put(event), loop).result(timeout=30)
        except Exception as exc:
            asyncio.run_coroutine_threadsafe(
                event_queue.put({"type": "error", "message": str(exc)}), loop
            ).result(timeout=10)
        finally:
            asyncio.run_coroutine_threadsafe(event_queue.put(None), loop).result(timeout=10)

    compact_thread_obj = threading.Thread(target=_run_compact_in_thread, daemon=True)
    compact_thread_obj.start()

    async def _generate():
        pre_tokens = 0
        summarized_count = 0

        while True:
            event = await asyncio.wait_for(event_queue.get(), timeout=120)

            if event is None:
                # Generator exhausted without a done/error — shouldn't happen
                logger.warning("compact stream: generator exhausted without done event")
                break

            if event["type"] == "start":
                pre_tokens = event.get("pre_tokens", 0)
                summarized_count = event.get("summarized_count", 0)
                logger.info("compact stream: started thread_id=%s pre_tokens=%d summarized=%d", thread_id, pre_tokens, summarized_count)
                yield f"data: {json.dumps(event)}\n\n"

            elif event["type"] == "token":
                yield f"data: {json.dumps(event)}\n\n"

            elif event["type"] == "done":
                summary = event.get("summary", "")
                post_tokens = event.get("post_tokens", 0)
                method = "llm"

                # Create a new continuation thread seeded with compact state.
                # This is more reliable than in-place prune: in-place prune has
                # been observed to leave the agent with the full uncompacted history
                # because LangGraph checkpoint ordering doesn't guarantee the remove
                # ops are fully settled before the next run starts.
                try:
                    new_thread_id = await _create_compact_thread(
                        client=client,
                        old_thread_id=thread_id,
                        all_messages=messages,
                        messages_to_keep=resolved_messages_to_keep,
                        pre_tokens=pre_tokens,
                        post_tokens=post_tokens,
                        summarized_count=summarized_count,
                        summary=summary,
                        method=method,
                    )
                    event["method"] = method
                    event["new_thread_id"] = new_thread_id
                    yield f"data: {json.dumps(event)}\n\n"
                    logger.info(
                        "compact stream: done thread_id=%s → new_thread_id=%s tokens %d→%d saved=%d",
                        thread_id, new_thread_id, pre_tokens, post_tokens, pre_tokens - post_tokens,
                    )
                except Exception as exc:
                    logger.error("compact stream: thread creation failed thread_id=%s: %s", thread_id, exc)
                    yield f"data: {json.dumps({'type': 'error', 'message': f'Compact thread creation failed: {exc}'})}\n\n"
                break

            elif event["type"] == "error":
                logger.error("compact stream: LLM error thread_id=%s: %s", thread_id, event.get("message"))
                yield f"data: {json.dumps(event)}\n\n"
                break

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
