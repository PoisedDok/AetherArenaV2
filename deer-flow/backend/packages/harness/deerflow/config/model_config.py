from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# Keys on model YAML that may hold a public HTTP(S) inference endpoint (never secrets).
_GATEWAY_INFERENCE_URL_KEYS: tuple[str, ...] = (
    "base_url",
    "api_base",
    "openai_api_base",
    "azure_endpoint",
)


class ModelConfig(BaseModel):
    """Config section for a model"""

    name: str = Field(..., description="Unique name for the model")
    display_name: str | None = Field(..., default_factory=lambda: None, description="Display name for the model")
    description: str | None = Field(..., default_factory=lambda: None, description="Description for the model")
    use: str = Field(
        ...,
        description="Class path of the model provider(e.g. langchain_openai.ChatOpenAI)",
    )
    model: str = Field(..., description="Model name")
    model_config = ConfigDict(extra="allow")
    use_responses_api: bool | None = Field(
        default=None,
        description="Whether to route OpenAI ChatOpenAI calls through the /v1/responses API",
    )
    output_version: str | None = Field(
        default=None,
        description="Structured output version for OpenAI responses content, e.g. responses/v1",
    )
    supports_thinking: bool = Field(default_factory=lambda: False, description="Whether the model supports thinking")
    supports_reasoning_effort: bool = Field(default_factory=lambda: False, description="Whether the model supports reasoning effort")
    when_thinking_enabled: dict | None = Field(
        default_factory=lambda: None,
        description="Extra settings to be passed to the model when thinking is enabled",
    )
    supports_vision: bool = Field(default_factory=lambda: False, description="Whether the model supports vision/image inputs")
    thinking: dict | None = Field(
        default_factory=lambda: None,
        description=(
            "Thinking settings for the model. If provided, these settings will be passed to the model when thinking is enabled. "
            "This is a shortcut for `when_thinking_enabled` and will be merged with `when_thinking_enabled` if both are provided."
        ),
    )


def _first_whitelisted_http_url(data: dict[str, Any]) -> str | None:
    for key in _GATEWAY_INFERENCE_URL_KEYS:
        val = data.get(key)
        if isinstance(val, str):
            s = val.strip()
            if s.startswith("http://") or s.startswith("https://"):
                return s
    return None


def model_to_gateway_dict(model: ModelConfig) -> dict[str, Any]:
    """Build the public model DTO for the gateway API and DeerFlowClient (no secrets)."""
    dumped = model.model_dump(mode="python")
    endpoint_url = _first_whitelisted_http_url(dumped)
    return {
        "name": model.name,
        "model": model.model,
        "display_name": model.display_name,
        "description": model.description,
        "supports_thinking": model.supports_thinking,
        "supports_reasoning_effort": model.supports_reasoning_effort,
        "provider_use": model.use,
        "endpoint_url": endpoint_url,
    }
