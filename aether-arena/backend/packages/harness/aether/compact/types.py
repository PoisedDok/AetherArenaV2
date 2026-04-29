"""Types for the aether-arena conversation compaction system."""

from dataclasses import dataclass
from enum import Enum
from typing import Any, ClassVar


class CompactTrigger(str, Enum):
    """What initiated this compaction."""

    AUTO = "auto"
    MANUAL = "manual"
    PTL = "ptl"  # prompt-too-long error recovery


@dataclass
class CompactionResult:
    """Result of a compaction operation."""

    success: bool
    trigger: CompactTrigger
    summary: str = ""
    pre_token_count: int = 0
    post_token_count: int = 0
    # Number of messages before/after compaction
    pre_message_count: int = 0
    post_message_count: int = 0
    error: str | None = None
    # If True, the circuit breaker tripped — no further auto-compact attempts
    circuit_breaker_tripped: bool = False


@dataclass
class CompactBoundaryMessage:
    """Marker inserted into the message list at the compaction boundary.

    The frontend uses this to render a divider: "N messages summarized".
    Stored as a HumanMessage with a special role tag so it survives
    LangGraph state serialization without requiring a custom type.
    """

    BOUNDARY_TAG: ClassVar[str] = "[COMPACT_BOUNDARY]"
    summarized_count: int = 0
    trigger: str = CompactTrigger.AUTO.value
    pre_token_count: int = 0
    post_token_count: int = 0

    def to_content(self) -> str:
        return (
            f"{self.BOUNDARY_TAG} "
            f"summarized={self.summarized_count} "
            f"trigger={self.trigger} "
            f"pre_tokens={self.pre_token_count} "
            f"post_tokens={self.post_token_count}"
        )

    @classmethod
    def is_boundary(cls, content: str) -> bool:
        return isinstance(content, str) and content.startswith(cls.BOUNDARY_TAG)

    @classmethod
    def parse(cls, content: str) -> "CompactBoundaryMessage | None":
        if not cls.is_boundary(content):
            return None
        obj = cls()
        for token in content.split():
            if "=" in token:
                k, _, v = token.partition("=")
                if k == "summarized":
                    obj.summarized_count = int(v)
                elif k == "trigger":
                    obj.trigger = v
                elif k == "pre_tokens":
                    obj.pre_token_count = int(v)
                elif k == "post_tokens":
                    obj.post_token_count = int(v)
        return obj


@dataclass
class AutoCompactState:
    """Per-thread circuit-breaker state for auto-compaction.

    Stored in ThreadDataState under key 'compact_state'.
    """

    consecutive_failures: int = 0
    total_compactions: int = 0
    last_error: str | None = None

    MAX_CONSECUTIVE_FAILURES: int = 3

    def is_circuit_open(self) -> bool:
        return self.consecutive_failures >= self.MAX_CONSECUTIVE_FAILURES

    def record_success(self) -> None:
        self.consecutive_failures = 0
        self.total_compactions += 1
        self.last_error = None

    def record_failure(self, error: str) -> None:
        self.consecutive_failures += 1
        self.last_error = error

    def to_dict(self) -> dict[str, Any]:
        return {
            "consecutive_failures": self.consecutive_failures,
            "total_compactions": self.total_compactions,
            "last_error": self.last_error,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "AutoCompactState":
        obj = cls()
        obj.consecutive_failures = d.get("consecutive_failures", 0)
        obj.total_compactions = d.get("total_compactions", 0)
        obj.last_error = d.get("last_error")
        return obj
