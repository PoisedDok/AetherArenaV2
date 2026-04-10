"""Core conversation compaction engine.

Uses a single LLM call (no tools) to summarize the conversation, then
builds the post-compact message list:
  [boundary_marker, summary_human_msg, ...recent_messages_to_keep]

PTL (Prompt-Too-Long) retry loop: if the compact model call fails because
the messages are too long, we drop the oldest API-round groups and retry
(up to MAX_PTL_RETRIES times).
"""

import logging

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from deerflow.compact.prompts import build_compact_prompt, extract_summary_from_response
from deerflow.compact.types import CompactBoundaryMessage, CompactTrigger, CompactionResult
from deerflow.utils.doc_summarizer import estimate_tokens

logger = logging.getLogger(__name__)

MAX_PTL_RETRIES = 3
PTL_RETRY_MARKER = "[earlier conversation truncated for compaction retry]"
# Number of recent messages to preserve verbatim after compaction
DEFAULT_MESSAGES_TO_KEEP = 10


def _strip_images_from_messages(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Replace image/document content blocks with text markers to reduce tokens."""
    result = []
    for msg in messages:
        if isinstance(msg.content, list):
            new_content = []
            for block in msg.content:
                if isinstance(block, dict) and block.get("type") in ("image_url", "image", "document"):
                    new_content.append({"type": "text", "text": f"[{block.get('type', 'media')} content removed for summarization]"})
                else:
                    new_content.append(block)
            result.append(msg.model_copy(update={"content": new_content}))
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

    Returns the raw response text. Raises on API error.
    """
    from deerflow.models import create_chat_model

    # Use config compact model if no explicit model_name provided
    effective_model = model_name
    if not effective_model:
        try:
            from deerflow.config.compact_config import get_compact_config
            cfg = get_compact_config()
            if cfg.model_name:
                effective_model = cfg.model_name
        except Exception:
            pass

    model = create_chat_model(name=effective_model, thinking_enabled=False)
    prompt = build_compact_prompt(custom_instructions)

    # Build input: system prompt + messages to summarize
    input_messages: list[BaseMessage] = [SystemMessage(content=prompt)] + messages_to_summarize

    response = model.invoke(input_messages)
    if isinstance(response.content, str):
        return response.content
    if isinstance(response.content, list):
        parts = [b.get("text", "") if isinstance(b, dict) else str(b) for b in response.content]
        return "\n".join(p for p in parts if p)
    return str(response.content)


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
    if len(messages) <= messages_to_keep:
        return CompactionResult(
            success=False,
            trigger=trigger,
            error=f"Not enough messages to compact (have {len(messages)}, need more than {messages_to_keep}).",
        )

    messages_to_summarize = messages[:-messages_to_keep] if messages_to_keep > 0 else messages
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
