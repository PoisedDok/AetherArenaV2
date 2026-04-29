"""Configuration for the aether-arena conversation compact system."""

from pydantic import BaseModel, Field


class CompactConfig(BaseModel):
    """Configuration for automatic and manual conversation compaction."""

    enabled: bool = Field(
        default=True,
        description="Whether to enable automatic conversation compaction.",
    )
    model_name: str | None = Field(
        default=None,
        description="Model to use for compaction (None = use default model). Recommend a lightweight model.",
    )
    messages_to_keep: int = Field(
        default=10,
        description="Number of most-recent messages to preserve verbatim after compaction.",
    )
    # Token threshold is computed dynamically from model context window + AUTOCOMPACT_PCT_OVERRIDE env.
    # This field allows overriding with a fixed value when dynamic calculation is not desired.
    token_threshold_override: int | None = Field(
        default=None,
        description="Fixed token threshold to trigger compaction. If None, computed from model context window.",
    )


_compact_config: CompactConfig = CompactConfig()


def get_compact_config() -> CompactConfig:
    """Get the current compact configuration."""
    return _compact_config


def set_compact_config(config: CompactConfig) -> None:
    """Set the compact configuration."""
    global _compact_config
    _compact_config = config


def load_compact_config_from_dict(config_dict: dict) -> None:
    """Load compact configuration from a dictionary."""
    global _compact_config
    _compact_config = CompactConfig(**config_dict)
