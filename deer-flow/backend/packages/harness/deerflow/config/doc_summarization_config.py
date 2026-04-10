"""Configuration for LexRank-based document summarization in tool outputs."""

from pydantic import BaseModel, Field


class DocSummarizationConfig(BaseModel):
    """Configuration for automatic LexRank summarization of large tool outputs."""

    enabled: bool = Field(
        default=True,
        description="Whether to enable LexRank summarization of large tool outputs.",
    )
    token_threshold: int = Field(
        default=2000,
        description="Token count above which tool output is summarized instead of passed raw.",
    )
    max_sentences: int = Field(
        default=10,
        description="Number of sentences to extract via LexRank (higher = longer summary).",
    )


_doc_summarization_config: DocSummarizationConfig = DocSummarizationConfig()


def get_doc_summarization_config() -> DocSummarizationConfig:
    """Get the current doc summarization configuration."""
    return _doc_summarization_config


def set_doc_summarization_config(config: DocSummarizationConfig) -> None:
    """Set the doc summarization configuration."""
    global _doc_summarization_config
    _doc_summarization_config = config


def load_doc_summarization_config_from_dict(config_dict: dict) -> None:
    """Load doc summarization configuration from a dictionary."""
    global _doc_summarization_config
    _doc_summarization_config = DocSummarizationConfig(**config_dict)
