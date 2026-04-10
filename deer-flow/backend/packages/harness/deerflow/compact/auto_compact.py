"""Auto-compact trigger logic with circuit breaker.

Decides when to automatically compact the conversation based on token count
thresholds, and tracks per-thread failure state for the circuit breaker.
"""

import logging
import os
from typing import Any

from langchain_core.messages import BaseMessage

from deerflow.compact.types import AutoCompactState
from deerflow.utils.doc_summarizer import estimate_tokens

logger = logging.getLogger(__name__)

# Default: compact when within 13K tokens of the model's context window
DEFAULT_BUFFER_TOKENS = 13_000
# Minimum context window assumed when model info is unavailable
_FALLBACK_CONTEXT_WINDOW = 32_000

# Model context window sizes for common models
_KNOWN_CONTEXT_WINDOWS: dict[str, int] = {
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
    "gpt-4-turbo": 128_000,
    "gpt-3.5-turbo": 16_385,
    "claude-3-5-sonnet": 200_000,
    "claude-3-5-haiku": 200_000,
    "claude-3-opus": 200_000,
    "claude-sonnet-4": 200_000,
    "claude-opus-4": 200_000,
    "claude-haiku-4": 200_000,
    "gemini-1.5-pro": 1_000_000,
    "gemini-1.5-flash": 1_000_000,
    "gemini-2.0-flash": 1_000_000,
    "deepseek-chat": 64_000,
    "deepseek-reasoner": 64_000,
}


def _get_context_window(model_name: str | None) -> int:
    """Estimate the context window for a given model name."""
    # Env override takes priority
    env_override = os.environ.get("COMPACT_CONTEXT_WINDOW_OVERRIDE")
    if env_override:
        try:
            return int(env_override)
        except ValueError:
            pass

    if not model_name:
        return _FALLBACK_CONTEXT_WINDOW

    name_lower = model_name.lower()
    for known_name, window in _KNOWN_CONTEXT_WINDOWS.items():
        if known_name in name_lower:
            return window

    return _FALLBACK_CONTEXT_WINDOW


def get_auto_compact_threshold(model_name: str | None = None) -> int:
    """Return the token count at which auto-compact should fire.

    Priority:
    1. config.compact.token_threshold_override (explicit fixed threshold)
    2. AUTOCOMPACT_PCT_OVERRIDE env var (percentage of context window)
    3. context_window - DEFAULT_BUFFER_TOKENS
    """
    # Config override takes top priority
    try:
        from deerflow.config.compact_config import get_compact_config
        cfg = get_compact_config()
        if cfg.token_threshold_override is not None:
            return cfg.token_threshold_override
    except Exception:
        pass

    context_window = _get_context_window(model_name)

    pct_override = os.environ.get("AUTOCOMPACT_PCT_OVERRIDE")
    if pct_override:
        try:
            pct = float(pct_override)
            if 0.0 < pct < 1.0:
                return int(context_window * pct)
        except ValueError:
            pass

    return max(0, context_window - DEFAULT_BUFFER_TOKENS)


def count_message_tokens(messages: list[BaseMessage]) -> int:
    """Estimate total tokens across all messages."""
    total = 0
    for msg in messages:
        content = msg.content
        if isinstance(content, str):
            total += estimate_tokens(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    text = block.get("text", "")
                    if text:
                        total += estimate_tokens(text)
                elif isinstance(block, str):
                    total += estimate_tokens(block)
    return total


def should_auto_compact(
    messages: list[BaseMessage],
    model_name: str | None = None,
    compact_state: AutoCompactState | None = None,
) -> bool:
    """Decide whether auto-compact should run now.

    Returns False if:
    - Compaction is disabled in config
    - Circuit breaker is open (too many consecutive failures)
    - Token count is below threshold
    - There aren't enough messages to compact (need at least 2 * messages_to_keep)

    Args:
        messages: Current conversation messages (excluding system prompt).
        model_name: Current model name for threshold calculation.
        compact_state: Thread-specific circuit breaker state.
    """
    # Config check
    try:
        from deerflow.config.compact_config import get_compact_config

        cfg = get_compact_config()
        if not cfg.enabled:
            return False
    except Exception:
        pass  # If config not available, proceed with defaults

    # Circuit breaker check
    if compact_state is not None and compact_state.is_circuit_open():
        logger.debug("Auto-compact suppressed: circuit breaker open (consecutive_failures=%d)", compact_state.consecutive_failures)
        return False

    if not messages:
        return False

    # Minimum message count: must have enough to summarize (DEFAULT_MESSAGES_TO_KEEP + 1 to summarize)
    from deerflow.compact.engine import DEFAULT_MESSAGES_TO_KEEP

    if len(messages) <= DEFAULT_MESSAGES_TO_KEEP + 1:
        return False

    token_count = count_message_tokens(messages)
    threshold = get_auto_compact_threshold(model_name)

    if token_count >= threshold:
        logger.info("Auto-compact triggered: token_count=%d >= threshold=%d (model=%s)", token_count, threshold, model_name)
        return True

    return False


def get_or_create_compact_state(thread_data: dict[str, Any] | None) -> AutoCompactState:
    """Load or create AutoCompactState from thread data dict."""
    if thread_data is None:
        return AutoCompactState()
    raw = thread_data.get("compact_state")
    if isinstance(raw, dict):
        return AutoCompactState.from_dict(raw)
    if isinstance(raw, AutoCompactState):
        return raw
    return AutoCompactState()


def save_compact_state(thread_data: dict[str, Any], state: AutoCompactState) -> None:
    """Persist AutoCompactState back into thread_data dict."""
    thread_data["compact_state"] = state.to_dict()
