import asyncio
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from aether.config import get_app_config
from aether.config.model_config import model_to_gateway_dict, ModelConfig

router = APIRouter(prefix="/api", tags=["models"])


class ModelResponse(BaseModel):
    """Response model for model information."""

    name: str = Field(..., description="Unique identifier for the model")
    model: str = Field(..., description="Actual provider model identifier")
    display_name: str | None = Field(None, description="Human-readable name")
    description: str | None = Field(None, description="Model description")
    supports_thinking: bool = Field(default=False, description="Whether model supports thinking mode")
    supports_reasoning_effort: bool = Field(default=False, description="Whether model supports reasoning effort")
    supports_vision: bool = Field(default=False, description="Whether model supports vision/image inputs")
    provider_use: str = Field(..., description="LangChain provider class path from config `use`")
    endpoint_url: str | None = Field(
        default=None,
        description="Resolved HTTP(S) base URL from whitelisted config keys, if any",
    )


class ModelsListResponse(BaseModel):
    """Response model for listing all models."""

    models: list[ModelResponse]


def _get_endpoint_url(model: ModelConfig) -> str | None:
    """Extract HTTP endpoint URL from model config."""
    dumped = model.model_dump(mode="python")
    for key in ("base_url", "api_base", "openai_api_base", "azure_endpoint"):
        val = dumped.get(key)
        if isinstance(val, str) and (val.startswith("http://") or val.startswith("https://")):
            return val.rstrip("/")
    return None


def _is_local_provider(use_path: str, endpoint_url: str | None) -> bool:
    """Check if this is a local/self-hosted provider like LM Studio or Ollama."""
    lower = use_path.lower()
    if endpoint_url and ("localhost" in endpoint_url or "127.0.0.1" in endpoint_url or "host.docker.internal" in endpoint_url):
        return True
    if "patched_openai" in lower or "lmstudio" in lower or "ollama" in lower:
        return True
    return False


def _detect_thinking_support(model_id: str) -> bool:
    """Detect if a model supports thinking/reasoning based on its ID.

    Model IDs often encode architecture/capabilities. This uses known patterns
    to detect thinking support when the provider doesn't expose capabilities.
    """
    lower = model_id.lower()

    # Models known to support reasoning/thinking
    thinking_patterns = [
        # Qwen3 models have thinking support (native or via QwQ)
        "qwen3",
        # DeepSeek reasoning models (R1, etc)
        "deepseek",
        # OpenAI reasoning models (o1, o3 series)
        "o1", "o3",
        # Claude 3.7+ has extended thinking mode
        "claude-3-7", "claude-3.7",
        # Gemma does NOT have thinking mode - removed
        # Llama 3.1+ with reasoning tools
        "llama-3.1", "llama-3.2",
    ]

    # Check for explicit thinking/reasoning in name
    if any(x in lower for x in ["thinking", "reasoning", "r1"]):
        return True

    # Check known model families
    for pattern in thinking_patterns:
        if pattern in lower:
            return True

    return False


def _detect_vision_support(model_id: str) -> bool:
    """Detect if a model supports vision/images based on its ID."""
    lower = model_id.lower()
    vision_patterns = [
        "vision", "vl", "llava", "bakllava", "moondream", "cogvlm",
        "qwen-vl", "qwenvl", "qwen2-vl", "qwen2vl", "qwen2.5-vl", "qwen2.5vl",
        "minicpm-v", "minicpmv", "internvl", "intern-vl",
        "phi-3-vision", "phi3-vision", "phi-4-vision", "phi4-vision",
        "pixtral", "gemma3", "llama-3.2-vision", "llama3.2-vision",
        "gpt-4o", "gpt4o", "claude-3", "gemini",
    ]
    return any(p in lower for p in vision_patterns)


def _detect_reasoning_effort_support(model_id: str) -> bool:
    """Detect if a model supports reasoning effort control.

    Reasoning effort is typically supported by models with controllable
    reasoning depth like OpenAI o1/o3 and some Claude variants.
    """
    lower = model_id.lower()
    # Currently only OpenAI o-series supports reasoning_effort parameter
    return any(x in lower for x in ["o1-", "o3-", "o1_", "o3_"])


async def _fetch_remote_models(endpoint_url: str, base_model: ModelConfig) -> list[ModelResponse]:
    """Fetch available models from a local provider's /v1/models endpoint."""
    try:
        # Ensure endpoint_url doesn't have trailing /v1 that would cause double path
        base_url = endpoint_url.rstrip("/")
        if base_url.endswith("/v1"):
            models_url = f"{base_url}/models"
        else:
            models_url = f"{base_url}/v1/models"

        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(models_url)
            response.raise_for_status()
            data = response.json()

        remote_models = data.get("data", data.get("models", []))
        results: list[ModelResponse] = []

        for rm in remote_models:
            model_id = rm.get("id", rm.get("name", "unknown"))
            # Skip embedding-only models
            if "embedding" in model_id.lower() or "rerank" in model_id.lower():
                continue
            # Skip non-ready models from providers that expose status
            if rm.get("status") and rm["status"] not in ("available", "ready"):
                continue

            # Format display name from model ID
            display_name = model_id.split("/")[-1].replace("-", " ").title()

            # Use native capabilities if the provider exposes them (e.g. Aether inference),
            # otherwise fall back to pattern matching on model ID (e.g. LM Studio).
            native_caps = rm.get("capabilities") or {}
            model_type = rm.get("model_type", "")

            supports_thinking = _detect_thinking_support(model_id)
            supports_reasoning_effort = _detect_reasoning_effort_support(model_id)
            if "vision" in native_caps:
                supports_vision = bool(native_caps["vision"])
            elif model_type in ("vision", "multimodal"):
                supports_vision = True
            else:
                supports_vision = _detect_vision_support(model_id)

            results.append(ModelResponse(
                name=f"{base_model.name}/{model_id}",
                model=model_id,
                display_name=display_name,
                description=f"Model from {base_model.display_name or base_model.name}",
                supports_thinking=supports_thinking,
                supports_reasoning_effort=supports_reasoning_effort,
                supports_vision=supports_vision,
                provider_use=base_model.use,
                endpoint_url=endpoint_url,
            ))

        return results
    except Exception:
        # If fetch fails, fall back to config model
        return []


@router.get(
    "/models",
    response_model=ModelsListResponse,
    summary="List All Models",
    description="Retrieve a list of all available AI models. For local providers (LM Studio, Ollama), queries their /v1/models endpoint to get actual available models.",
)
async def list_models() -> ModelsListResponse:
    """List all available models from configuration and remote providers."""
    config = get_app_config()

    all_models: list[ModelResponse] = []
    seen_models: set[str] = set()

    for base_model in config.models:
        endpoint_url = _get_endpoint_url(base_model)

        # For local providers with endpoints, try to fetch live models
        if endpoint_url and _is_local_provider(base_model.use, endpoint_url):
            remote_models = await _fetch_remote_models(endpoint_url, base_model)
            if remote_models:
                for rm in remote_models:
                    if rm.name not in seen_models:
                        all_models.append(rm)
                        seen_models.add(rm.name)
                continue  # Successfully fetched remote models, skip config model

        # Use config model (static or fallback)
        model_dict = model_to_gateway_dict(base_model)
        if model_dict["name"] not in seen_models:
            all_models.append(ModelResponse(**model_dict))
            seen_models.add(model_dict["name"])

    return ModelsListResponse(models=all_models)


@router.get(
    "/models/{model_name}",
    response_model=ModelResponse,
    summary="Get Model Details",
    description="Retrieve detailed information about a specific AI model by its name.",
)
async def get_model(model_name: str) -> ModelResponse:
    """Get a specific model by name.

    Args:
        model_name: The unique name of the model to retrieve.

    Returns:
        Model information if found.

    Raises:
        HTTPException: 404 if model not found.
    """
    config = get_app_config()

    # Check if it's a provider/model path (e.g., "lmstudio/qwen/qwen3-4b")
    if "/" in model_name:
        provider_name = model_name.split("/")[0]
        base_model = config.get_model_config(provider_name)
        if base_model:
            endpoint_url = _get_endpoint_url(base_model)
            if endpoint_url and _is_local_provider(base_model.use, endpoint_url):
                remote_models = await _fetch_remote_models(endpoint_url, base_model)
                for rm in remote_models:
                    if rm.name == model_name:
                        return rm

    # Fall back to static config
    model = config.get_model_config(model_name)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    return ModelResponse(**model_to_gateway_dict(model))
