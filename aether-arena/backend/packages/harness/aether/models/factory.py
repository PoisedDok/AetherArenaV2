import logging

from langchain.chat_models import BaseChatModel

from aether.config import get_app_config, get_tracing_config, is_tracing_enabled
from aether.reflection import resolve_class

logger = logging.getLogger(__name__)


def create_chat_model(
    name: str | None = None,
    thinking_enabled: bool = False,
    provider_api_key: str | None = None,
    **kwargs,
) -> BaseChatModel:
    """Create a chat model instance from the config.

    Args:
        name: The name of the model to create. If None, the first model in the config will be used.
              Supports both simple names (e.g., 'gpt-4o') and provider-prefixed names
              from remote endpoints (e.g., 'lmstudio/qwen/qwen3-4b-2507').
        thinking_enabled: Whether thinking/reasoning mode is active.
        provider_api_key: Runtime-provided API key from the frontend settings.
                          Overrides the static config.yaml api_key for cloud providers.

    Returns:
        A chat model instance.
    """
    config = get_app_config()
    if name is None:
        name = config.models[0].name

    # Handle provider/model format (e.g., 'lmstudio/qwen/qwen3-4b-2507')
    actual_model_id: str | None = None
    config_name = name
    if "/" in name:
        provider_name = name.split("/")[0]
        actual_model_id = name[len(provider_name) + 1:]  # Everything after "provider/"
        config_name = provider_name

    model_config = config.get_model_config(config_name)
    if model_config is None:
        # Fallback: treat as OpenRouter model (author/model ID not provider/model)
        model_config = config.get_model_config("openrouter")
        if model_config is not None:
            actual_model_id = name  # Full model ID for OpenRouter (e.g. 'qwen/qwen3.6-plus:free')
    if model_config is None:
        raise ValueError(f"Model {name} not found in config") from None
    model_class = resolve_class(model_config.use, BaseChatModel)
    model_settings_from_config = model_config.model_dump(
        exclude_none=True,
        exclude={
            "use",
            "name",
            "display_name",
            "description",
            "supports_thinking",
            "supports_reasoning_effort",
            "when_thinking_enabled",
            "thinking",
            "supports_vision",
        },
    )

    # For remote models with specific IDs (e.g., from LM Studio), override the model field
    if actual_model_id:
        model_settings_from_config["model"] = actual_model_id

    # API key priority: runtime provider_api_key (frontend) > config api_key > env var (via LangChain default)
    if provider_api_key:
        model_settings_from_config["api_key"] = provider_api_key
    else:
        _api_key = getattr(model_config, "api_key", None)
        if _api_key:
            model_settings_from_config["api_key"] = _api_key
    # Compute effective when_thinking_enabled by merging in the `thinking` shortcut field.
    # The `thinking` shortcut is equivalent to setting when_thinking_enabled["thinking"].
    has_thinking_settings = (model_config.when_thinking_enabled is not None) or (model_config.thinking is not None)
    effective_wte: dict = dict(model_config.when_thinking_enabled) if model_config.when_thinking_enabled else {}
    if model_config.thinking is not None:
        merged_thinking = {**(effective_wte.get("thinking") or {}), **model_config.thinking}
        effective_wte = {**effective_wte, "thinking": merged_thinking}
    if thinking_enabled and has_thinking_settings:
        if not model_config.supports_thinking:
            raise ValueError(f"Model {name} does not support thinking. Set `supports_thinking` to true in the `config.yaml` to enable thinking.") from None
        if effective_wte:
            model_settings_from_config.update(effective_wte)
    if not thinking_enabled and has_thinking_settings:
        if effective_wte.get("extra_body", {}).get("thinking", {}).get("type"):
            # OpenAI-compatible gateway: thinking is nested under extra_body
            kwargs.update({"extra_body": {"thinking": {"type": "disabled"}}})
            kwargs.update({"reasoning_effort": "minimal"})
        elif effective_wte.get("thinking", {}).get("type"):
            # Native langchain_anthropic: thinking is a direct constructor parameter
            kwargs.update({"thinking": {"type": "disabled"}})
    if not model_config.supports_reasoning_effort and "reasoning_effort" in kwargs:
        del kwargs["reasoning_effort"]

    # For Codex Responses API models: map thinking mode to reasoning_effort
    from aether.models.openai_codex_provider import CodexChatModel

    if issubclass(model_class, CodexChatModel):
        # The ChatGPT Codex endpoint currently rejects max_tokens/max_output_tokens.
        model_settings_from_config.pop("max_tokens", None)

        # Use explicit reasoning_effort from frontend if provided (low/medium/high)
        explicit_effort = kwargs.pop("reasoning_effort", None)
        if not thinking_enabled:
            model_settings_from_config["reasoning_effort"] = "none"
        elif explicit_effort and explicit_effort in ("low", "medium", "high", "xhigh"):
            model_settings_from_config["reasoning_effort"] = explicit_effort
        elif "reasoning_effort" not in model_settings_from_config:
            model_settings_from_config["reasoning_effort"] = "medium"

    model_instance = model_class(**kwargs, **model_settings_from_config)

    if is_tracing_enabled():
        try:
            from langchain_core.tracers.langchain import LangChainTracer

            tracing_config = get_tracing_config()
            tracer = LangChainTracer(
                project_name=tracing_config.project,
            )
            existing_callbacks = model_instance.callbacks or []
            model_instance.callbacks = [*existing_callbacks, tracer]
            logger.debug(f"LangSmith tracing attached to model '{name}' (project='{tracing_config.project}')")
        except Exception as e:
            logger.warning(f"Failed to attach LangSmith tracing to model '{name}': {e}")
    return model_instance
