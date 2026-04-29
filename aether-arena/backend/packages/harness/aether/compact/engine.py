"""Core conversation compaction engine.

Uses a single LLM call (no tools) to summarize the conversation, then
builds the post-compact message list:
  [boundary_marker, summary_human_msg, ...recent_messages_to_keep]

PTL (Prompt-Too-Long) retry loop: if the compact model call fails because
the messages are too long, we drop the oldest API-round groups and retry
(up to MAX_PTL_RETRIES times).

compact_conversation_stream() is the streaming variant — yields SSE-style
dicts so the Gateway endpoint can stream tokens live to the frontend.
"""

import logging
from collections.abc import Generator

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from aether.compact.prompts import build_compact_prompt, extract_summary_from_response
from aether.compact.types import CompactBoundaryMessage, CompactionResult, CompactTrigger
from aether.utils.doc_summarizer import estimate_tokens

logger = logging.getLogger(__name__)

MAX_PTL_RETRIES = 3
PTL_RETRY_MARKER = "[earlier conversation truncated for compaction retry]"
# Number of recent messages to preserve verbatim after compaction
DEFAULT_MESSAGES_TO_KEEP = 10


import re as _re

_SPECIAL_TOKEN_RE = _re.compile(r"<\|[^|>]{1,40}\|>")


def _sanitize_content(text: str) -> str:
    """Remove model-specific special tokens (e.g. Mistral <|END_TOOL_REQUEST|>).

    When these tokens appear verbatim in message content and are fed back into
    the same model family (e.g. LMStudio Ministral), the tokenizer interprets
    them as real control tokens — causing the model to output EOS immediately
    and produce an empty response.
    """
    return _SPECIAL_TOKEN_RE.sub("", text)


def _strip_images_from_messages(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Replace image/document blocks with markers and strip model special tokens."""
    result = []
    for msg in messages:
        if isinstance(msg.content, list):
            new_content = []
            for block in msg.content:
                if isinstance(block, dict) and block.get("type") in ("image_url", "image", "document"):
                    new_content.append({"type": "text", "text": f"[{block.get('type', 'media')} content removed for summarization]"})
                elif isinstance(block, dict) and block.get("type") == "text":
                    sanitized = _sanitize_content(block.get("text", ""))
                    new_content.append({**block, "text": sanitized})
                else:
                    new_content.append(block)
            result.append(msg.model_copy(update={"content": new_content}))
        elif isinstance(msg.content, str):
            sanitized = _sanitize_content(msg.content)
            if sanitized != msg.content:
                result.append(msg.model_copy(update={"content": sanitized}))
            else:
                result.append(msg)
        else:
            result.append(msg)
    return result


def _group_messages_by_api_round(messages: list[BaseMessage]) -> list[list[BaseMessage]]:
    """Group messages into API rounds (one round = user turn + assistant response + any tool messages).

    Used by PTL retry to drop oldest rounds first.
    """
    groups: list[list[BaseMessage]] = []
    current_group: list[BaseMessage] = []

    for msg in messages:
        if isinstance(msg, HumanMessage) and current_group:
            groups.append(current_group)
            current_group = [msg]
        else:
            current_group.append(msg)

    if current_group:
        groups.append(current_group)

    return groups


def _truncate_head_for_ptl_retry(messages: list[BaseMessage], fraction_to_drop: float = 0.2) -> list[BaseMessage] | None:
    """Drop oldest message groups to recover from a prompt-too-long error.

    Args:
        messages: Current message list (already stripped of previous PTL marker).
        fraction_to_drop: Fraction of groups to drop if no token gap info available.

    Returns:
        Truncated message list, or None if nothing more to drop.
    """
    # Strip any previous PTL marker to avoid stalling
    cleaned = [m for m in messages if not (isinstance(m.content, str) and m.content.startswith(PTL_RETRY_MARKER))]

    groups = _group_messages_by_api_round(cleaned)
    if len(groups) <= 1:
        return None  # Nothing left to drop

    # Drop oldest 20% of groups (minimum 1)
    n_drop = max(1, int(len(groups) * fraction_to_drop))
    remaining_groups = groups[n_drop:]
    if not remaining_groups:
        return None

    remaining = [msg for group in remaining_groups for msg in group]

    # If result starts with AIMessage, prepend synthetic user marker
    if remaining and isinstance(remaining[0], AIMessage):
        remaining = [HumanMessage(content=PTL_RETRY_MARKER)] + remaining

    return remaining


def _call_compact_model(messages_to_summarize: list[BaseMessage], model_name: str | None, custom_instructions: str | None) -> str:
    """Call the LLM to generate a compact summary.

    Uses the same model resolution logic as the lead agent so the compact call
    goes to whichever model/provider the user has selected in the chat.

    Returns the raw response text. Raises on API error.
    """
    from aether.agents.lead_agent.agent import _resolve_model_name
    from aether.models import create_chat_model

    effective_model = _resolve_model_name(model_name)
    model = create_chat_model(name=effective_model, thinking_enabled=False)
    prompt = build_compact_prompt(custom_instructions)

    input_messages: list[BaseMessage] = [SystemMessage(content=prompt)] + messages_to_summarize
    response = model.invoke(input_messages)
    if isinstance(response.content, str):
        return response.content
    if isinstance(response.content, list):
        parts = [b.get("text", "") if isinstance(b, dict) else str(b) for b in response.content]
        return "\n".join(p for p in parts if p)
    return str(response.content)


def _stream_compact_model(
    messages_to_summarize: list[BaseMessage],
    model_name: str | None,
    custom_instructions: str | None,
) -> Generator[str, None, None]:
    """Stream text tokens from the compact LLM.  Yields raw text chunks."""
    from aether.agents.lead_agent.agent import _resolve_model_name
    from aether.models import create_chat_model

    effective_model = _resolve_model_name(model_name)
    logger.info("compact stream: using model=%s", effective_model)
    model = create_chat_model(name=effective_model, thinking_enabled=False)
    prompt = build_compact_prompt(custom_instructions)

    input_messages: list[BaseMessage] = [SystemMessage(content=prompt)] + messages_to_summarize
    for chunk in model.stream(input_messages):
        if isinstance(chunk.content, str) and chunk.content:
            yield chunk.content
        elif isinstance(chunk.content, list):
            for block in chunk.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text = block.get("text", "")
                    if text:
                        yield text


def compact_conversation_stream(
    messages: list[BaseMessage],
    model_name: str | None = None,
    custom_instructions: str | None = None,
    messages_to_keep: int = DEFAULT_MESSAGES_TO_KEEP,
    trigger: CompactTrigger = CompactTrigger.MANUAL,
) -> Generator[dict, None, None]:
    """Streaming version of compact_conversation.

    Yields dicts with types:
    - {"type": "start", "pre_tokens": N, "message_count": N, "summarized_count": N}
    - {"type": "token", "text": "..."}   — live LLM output tokens
    - {"type": "done",  "summary": "...", "pre_tokens": N, "post_tokens": N, "summarized_count": N}
    - {"type": "error", "message": "..."}
    """
    if not messages:
        yield {"type": "error", "message": "No messages to compact."}
        return
    if len(messages) < 2:
        yield {"type": "error", "message": f"Not enough messages to compact (have {len(messages)}, need at least 2)."}
        return

    # Pre-token count
    try:
        import tiktoken
        _enc = tiktoken.get_encoding("cl100k_base")
        pre_tokens = len(_enc.encode("\n".join(m.content if isinstance(m.content, str) else str(m.content) for m in messages)))
    except Exception:
        pre_tokens = sum(estimate_tokens(m.content if isinstance(m.content, str) else str(m.content)) for m in messages)

    # How many messages will actually be summarized (not kept verbatim).
    # If messages_to_keep >= total, we still summarize all-but-one (the most recent).
    if messages_to_keep >= len(messages):
        messages_to_summarize = messages[:-1] if len(messages) > 1 else []
        kept_count = 1
    else:
        messages_to_summarize = messages[:-messages_to_keep]
        kept_count = messages_to_keep
    summarized_count = len(messages) - kept_count

    logger.info(
        "compact stream: starting thread compact pre_tokens=%d msg_count=%d to_summarize=%d to_keep=%d trigger=%s",
        pre_tokens, len(messages), len(messages_to_summarize), kept_count, trigger.value,
    )
    yield {"type": "start", "pre_tokens": pre_tokens, "message_count": len(messages), "summarized_count": summarized_count}
    stripped = _strip_images_from_messages(messages_to_summarize)

    # Stream LLM tokens with PTL retry support
    full_text = ""
    last_error: str | None = None

    for attempt in range(MAX_PTL_RETRIES + 1):
        try:
            for token in _stream_compact_model(stripped, model_name, custom_instructions):
                full_text += token
                yield {"type": "token", "text": token}
            break  # success
        except Exception as e:
            error_str = str(e).lower()
            is_ptl = "prompt" in error_str and any(k in error_str for k in ("too long", "too large", "context", "maximum"))
            if is_ptl and attempt < MAX_PTL_RETRIES:
                logger.warning("compact stream: PTL error attempt %d/%d: %s — truncating and retrying", attempt + 1, MAX_PTL_RETRIES, e)
                truncated = _truncate_head_for_ptl_retry(stripped)
                if truncated is None:
                    last_error = f"Cannot truncate further. Original error: {e}"
                    break
                stripped = truncated
                full_text = ""  # reset for retry
                continue
            else:
                last_error = str(e)
                break

    if last_error and not full_text.strip():
        logger.error("compact stream: LLM failed: %s", last_error)
        yield {"type": "error", "message": f"LLM failed: {last_error}"}
        return

    if not full_text.strip():
        yield {"type": "error", "message": "LLM returned empty response."}
        return

    summary = extract_summary_from_response(full_text)
    if not summary:
        summary = full_text.strip()  # use raw response as fallback

    # Post-token estimate — use kept_count computed above (handles the
    # messages_to_keep >= len(messages) edge case correctly).
    kept_messages = messages[-kept_count:] if kept_count > 0 else []
    post_tokens = estimate_tokens(summary)
    for m in kept_messages:
        post_tokens += estimate_tokens(m.content if isinstance(m.content, str) else str(m.content))

    logger.info(
        "compact stream: done pre_tokens=%d summary_tokens=%d kept_count=%d kept_tokens=%d post_tokens=%d saved=%d",
        pre_tokens,
        estimate_tokens(summary),
        len(kept_messages),
        sum(estimate_tokens(m.content if isinstance(m.content, str) else str(m.content)) for m in kept_messages),
        post_tokens,
        pre_tokens - post_tokens,
    )
    yield {
        "type": "done",
        "summary": summary,
        "pre_tokens": pre_tokens,
        "post_tokens": post_tokens,
        "summarized_count": summarized_count,
    }


def compact_conversation(
    messages: list[BaseMessage],
    model_name: str | None = None,
    custom_instructions: str | None = None,
    messages_to_keep: int = DEFAULT_MESSAGES_TO_KEEP,
    trigger: CompactTrigger = CompactTrigger.AUTO,
) -> CompactionResult:
    """Summarize conversation history, return a CompactionResult.

    The compacted message list is NOT returned here — the middleware/caller
    is responsible for replacing state messages using `build_post_compact_messages`.

    Args:
        messages: Full current message list (excluding system prompt).
        model_name: LLM to use for summarization (None = default model).
        custom_instructions: Additional instructions injected into compact prompt.
        messages_to_keep: How many recent messages to preserve verbatim after the boundary.
        trigger: What initiated this compaction.

    Returns:
        CompactionResult with success/failure and summary text.
    """
    if not messages:
        return CompactionResult(
            success=False,
            trigger=trigger,
            error="No messages to compact.",
        )

    try:
        import tiktoken
        _enc = tiktoken.get_encoding("cl100k_base")
        pre_token_count = len(_enc.encode("\n".join(m.content if isinstance(m.content, str) else str(m.content) for m in messages)))
    except Exception:
        pre_token_count = sum(estimate_tokens(m.content if isinstance(m.content, str) else str(m.content)) for m in messages)
    pre_message_count = len(messages)

    # Split: summarize the older portion, keep recent messages verbatim
    # Need at least 2 messages total to have something to compact
    MIN_MESSAGES_FOR_COMPACT = 2
    if len(messages) < MIN_MESSAGES_FOR_COMPACT:
        return CompactionResult(
            success=False,
            trigger=trigger,
            error=f"Not enough messages to compact (have {len(messages)}, need at least {MIN_MESSAGES_FOR_COMPACT}).",
        )

    # If messages_to_keep >= total messages, nothing to summarize
    if messages_to_keep >= len(messages):
        messages_to_summarize = messages[:-1] if len(messages) > 1 else []
    else:
        messages_to_summarize = messages[:-messages_to_keep]
    stripped = _strip_images_from_messages(messages_to_summarize)

    # PTL retry loop
    summary_text: str | None = None
    last_error: str | None = None

    for attempt in range(MAX_PTL_RETRIES + 1):
        try:
            raw_response = _call_compact_model(stripped, model_name, custom_instructions)
            if not raw_response or not raw_response.strip():
                last_error = "Compact model returned empty response."
                continue

            summary_text = extract_summary_from_response(raw_response)
            if summary_text:
                break
            else:
                last_error = "Could not extract summary from model response."

        except Exception as e:
            error_str = str(e).lower()
            is_ptl = "prompt" in error_str and ("too long" in error_str or "too large" in error_str or "context" in error_str or "maximum" in error_str)

            if is_ptl and attempt < MAX_PTL_RETRIES:
                logger.warning("Compact PTL error (attempt %d/%d): %s — truncating head and retrying", attempt + 1, MAX_PTL_RETRIES, e)
                truncated = _truncate_head_for_ptl_retry(stripped)
                if truncated is None:
                    last_error = f"Cannot truncate further. Original error: {e}"
                    break
                stripped = truncated
                continue
            else:
                last_error = str(e)
                break

    if not summary_text:
        return CompactionResult(
            success=False,
            trigger=trigger,
            pre_token_count=pre_token_count,
            pre_message_count=pre_message_count,
            error=last_error or "Compaction failed.",
        )

    # Estimate post-compact tokens (summary + kept messages)
    kept_messages = messages[-messages_to_keep:] if messages_to_keep > 0 else []
    post_token_count = estimate_tokens(summary_text)
    for m in kept_messages:
        post_token_count += estimate_tokens(m.content if isinstance(m.content, str) else str(m.content))

    return CompactionResult(
        success=True,
        trigger=trigger,
        summary=summary_text,
        pre_token_count=pre_token_count,
        post_token_count=post_token_count,
        pre_message_count=pre_message_count,
        post_message_count=1 + len(kept_messages),  # boundary + kept
    )


def build_post_compact_messages(
    result: CompactionResult,
    original_messages: list[BaseMessage],
    messages_to_keep: int = DEFAULT_MESSAGES_TO_KEEP,
) -> list[BaseMessage]:
    """Build the replacement message list after a successful compaction.

    Structure:
      1. boundary_marker (HumanMessage with [COMPACT_BOUNDARY] tag)
      2. summary (HumanMessage with the summary text — attributed to assistant context)
      3. kept_messages (the most recent N messages, verbatim)

    Args:
        result: A successful CompactionResult.
        original_messages: The original message list before compaction.
        messages_to_keep: Must match the value used in compact_conversation().

    Returns:
        New message list to replace state["messages"].
    """
    kept_messages = original_messages[-messages_to_keep:] if messages_to_keep > 0 else []

    boundary = CompactBoundaryMessage(
        summarized_count=len(original_messages) - len(kept_messages),
        trigger=result.trigger.value,
        pre_token_count=result.pre_token_count,
        post_token_count=result.post_token_count,
    )

    boundary_msg = HumanMessage(content=boundary.to_content())
    summary_msg = HumanMessage(
        content=f"[Conversation summary — {boundary.summarized_count} earlier messages condensed]\n\n{result.summary}"
    )

    return [boundary_msg, summary_msg] + list(kept_messages)
