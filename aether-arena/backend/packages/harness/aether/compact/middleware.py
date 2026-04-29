"""Auto-compact middleware for the deer-flow agent system.

Hooks into `before_model` to check whether the conversation has grown too large,
and compacts it in-place if so.  The result is returned as a state update so
LangGraph persists the compacted message list.

Circuit breaker: after 3 consecutive failures, auto-compact is silently
suppressed for the remainder of the thread session to avoid burning tokens.
"""

from __future__ import annotations

import logging
from typing import NotRequired, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langgraph.runtime import Runtime

from aether.compact.auto_compact import (
    count_message_tokens,
    get_or_create_compact_state,
    save_compact_state,
    should_auto_compact,
)
from aether.compact.engine import DEFAULT_MESSAGES_TO_KEEP, build_post_compact_messages, compact_conversation
from aether.compact.types import CompactTrigger

logger = logging.getLogger(__name__)


class CompactMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    thread_data: NotRequired[dict | None]


class CompactMiddleware(AgentMiddleware[CompactMiddlewareState]):
    """Auto-compact middleware.

    In `before_model`:
    1. Reads `thread_data.compact_state` to check circuit breaker.
    2. Calls `should_auto_compact()` with current messages + model name.
    3. If triggered, runs `compact_conversation()` and replaces `messages`
       with the compacted list via the state update return value.
    4. Updates `thread_data.compact_state` (success or failure).

    Does nothing during agent bootstrapping or when auto-compact is disabled.
    """

    state_schema = CompactMiddlewareState

    def __init__(self, messages_to_keep: int | None = None):
        super().__init__()
        # If not explicitly provided, read from config (falls back to engine default)
        if messages_to_keep is None:
            try:
                from aether.config.compact_config import get_compact_config
                cfg = get_compact_config()
                messages_to_keep = cfg.messages_to_keep
            except Exception:
                messages_to_keep = DEFAULT_MESSAGES_TO_KEEP
        self._messages_to_keep = messages_to_keep

    @override
    def before_model(self, state: CompactMiddlewareState, runtime: Runtime) -> dict | None:
        messages = state.get("messages", [])
        if not messages:
            return None

        model_name: str | None = runtime.context.get("model_name")

        # Load per-thread compact state (circuit breaker)
        thread_data: dict = dict(state.get("thread_data") or {})
        compact_state = get_or_create_compact_state(thread_data)

        if not should_auto_compact(messages, model_name=model_name, compact_state=compact_state):
            return None

        token_count = count_message_tokens(messages)
        logger.info(
            "CompactMiddleware: auto-compact triggered (messages=%d tokens≈%d)",
            len(messages),
            token_count,
        )

        result = compact_conversation(
            messages=messages,
            model_name=model_name,
            messages_to_keep=self._messages_to_keep,
            trigger=CompactTrigger.AUTO,
        )

        if result.success:
            compact_state.record_success()
            save_compact_state(thread_data, compact_state)
            new_messages = build_post_compact_messages(result, messages, self._messages_to_keep)
            logger.info(
                "CompactMiddleware: compacted %d → %d messages (tokens %d → %d)",
                result.pre_message_count,
                result.post_message_count,
                result.pre_token_count,
                result.post_token_count,
            )
            return {"messages": new_messages, "thread_data": thread_data}
        else:
            compact_state.record_failure(result.error or "unknown")
            save_compact_state(thread_data, compact_state)
            if compact_state.is_circuit_open():
                logger.warning(
                    "CompactMiddleware: circuit breaker open after %d consecutive failures — auto-compact disabled for this thread",
                    compact_state.consecutive_failures,
                )
            else:
                logger.warning("CompactMiddleware: compact failed (attempt %d): %s", compact_state.consecutive_failures, result.error)
            return {"thread_data": thread_data}
