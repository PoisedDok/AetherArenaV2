"""Manual compact command — called by the Gateway /compact endpoint.

Fetches the thread's current message list from the LangGraph checkpointer,
runs compact_conversation(), and persists the result back.

Sumy fallback: if no LLM is configured or compact_conversation() fails,
we fall back to sumy LexRank conversation summarization (no LLM needed).
"""

from __future__ import annotations

import logging

from langchain_core.messages import BaseMessage, HumanMessage

from aether.compact.engine import DEFAULT_MESSAGES_TO_KEEP, build_post_compact_messages, compact_conversation
from aether.compact.types import CompactTrigger
from aether.utils.doc_summarizer import summarize_messages_with_sumy

logger = logging.getLogger(__name__)


def _messages_to_text(messages: list[BaseMessage] | list[dict]) -> str:
    """Serialize messages to plain text for sumy fallback."""
    parts: list[str] = []
    for msg in messages:
        if isinstance(msg, dict):
            # Raw dict from LangGraph
            role = msg.get("type", "unknown")
            content = msg.get("content", "")
        else:
            # BaseMessage object
            role = getattr(msg, "type", "unknown")
            content = msg.content

        if isinstance(content, list):
            content = " ".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
        parts.append(f"{role}: {content}")
    return "\n".join(parts)


def run_manual_compact(
    messages: list[BaseMessage] | list[dict],
    model_name: str | None = None,
    custom_instructions: str | None = None,
    messages_to_keep: int = DEFAULT_MESSAGES_TO_KEEP,
) -> dict:
    """Run manual compaction on the provided message list.

    Accepts either BaseMessage objects or raw dicts from LangGraph.

    Tries LLM compaction first; falls back to sumy LexRank if LLM fails or
    no model is configured.

    Returns a dict with:
        success: bool
        pre_tokens: int
        post_tokens: int
        summary: str
        messages: list  — the compacted message list (same format as input)
        error: str | None
    """
    # Convert raw dicts to BaseMessage objects if needed
    from langchain_core.messages import AIMessage, SystemMessage, ToolMessage

    from aether.utils.doc_summarizer import estimate_tokens

    processed_messages: list[BaseMessage] = []
    for m in messages:
        if isinstance(m, dict):
            # Convert dict to appropriate BaseMessage type
            msg_type = m.get("type", "human")
            content = m.get("content", "")

            if msg_type == "human":
                processed_messages.append(HumanMessage(content=content))
            elif msg_type == "ai":
                processed_messages.append(AIMessage(content=content))
            elif msg_type == "tool":
                processed_messages.append(ToolMessage(content=content, tool_use_id=m.get("id", "unknown")))
            elif msg_type == "system":
                processed_messages.append(SystemMessage(content=content))
            else:
                # Default to HumanMessage for unknown types
                processed_messages.append(HumanMessage(content=content))
        else:
            processed_messages.append(m)

    pre_tokens = 0
    for m in processed_messages:
        content = m.content if isinstance(m.content, str) else str(m.content)
        pre_tokens += estimate_tokens(content)

    logger.info("run_manual_compact: starting compact_conversation with model_name=%s, msg_count=%d", model_name, len(processed_messages))
    result = compact_conversation(
        messages=processed_messages,
        model_name=model_name,
        custom_instructions=custom_instructions,
        messages_to_keep=messages_to_keep,
        trigger=CompactTrigger.MANUAL,
    )

    logger.info("run_manual_compact: compact_conversation returned success=%s, error=%s", result.success, result.error)
    if result.success:
        new_messages = build_post_compact_messages(result, messages, messages_to_keep)
        return {
            "success": True,
            "pre_tokens": result.pre_token_count or pre_tokens,
            "post_tokens": result.post_token_count,
            "summary": result.summary,
            "messages": new_messages,
            "error": None,
        }

    # LLM compact failed — fall back to sumy
    logger.warning("Manual compact LLM failed (%s), falling back to sumy", result.error)
    messages_text = _messages_to_text(processed_messages)
    summary = summarize_messages_with_sumy(messages_text, target_sentences=20)

    if summary == messages_text:
        # sumy produced no change — just truncate to kept messages
        kept = processed_messages[-messages_to_keep:] if messages_to_keep > 0 else processed_messages
        kept_tokens = sum(
            estimate_tokens(m.content if isinstance(m.content, str) else str(m.content))
            for m in kept
        )
        return {
            "success": False,
            "pre_tokens": pre_tokens,
            "post_tokens": kept_tokens,
            "summary": "",
            "messages": kept,
            "error": result.error,
        }

    post_tokens = estimate_tokens(summary)
    kept = processed_messages[-messages_to_keep:] if messages_to_keep > 0 else []
    kept_tokens = sum(
        estimate_tokens(m.content if isinstance(m.content, str) else str(m.content))
        for m in kept
    )
    summary_msg = HumanMessage(
        content=f"[Conversation summary — sumy LexRank fallback]\n\n{summary}"
    )
    new_messages = [summary_msg] + list(kept)

    return {
        "success": True,
        "pre_tokens": pre_tokens,
        "post_tokens": post_tokens + kept_tokens,
        "summary": summary,
        "messages": new_messages,
        "error": None,
    }
