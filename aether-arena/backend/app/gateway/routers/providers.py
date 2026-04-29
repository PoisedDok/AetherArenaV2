"""Provider health probing, API key testing, and live model fetching endpoints."""

import asyncio
import json
import os

import httpx
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/providers", tags=["providers"])


# ── Request / Response models ─────────────────────────────────────────────────

class ProviderHealthResult(BaseModel):
    reachable: bool
    url: str
    model_count: int = 0


class ProvidersHealthResponse(BaseModel):
    providers: dict[str, ProviderHealthResult]


class TestKeyRequest(BaseModel):
    provider: str = Field(..., description="Provider id: openai | anthropic | google | groq | openrouter | deepseek")
    api_key: str = Field(..., description="API key to test — never stored")


class TestKeyResponse(BaseModel):
    valid: bool
    error: str | None = None
    models_count: int = 0


class ProviderModel(BaseModel):
    id: str
    name: str
    supports_vision: bool = False
    supports_thinking: bool = False
    is_free: bool = False
    description: str | None = None


class FetchModelsRequest(BaseModel):
    provider: str = Field(..., description="Provider id")
    api_key: str = Field(..., description="API key — never stored")


class FetchModelsResponse(BaseModel):
    models: list[ProviderModel]
    error: str | None = None


class OpenRouterModelsResponse(BaseModel):
    models: list[ProviderModel]


# ── Local provider probe ──────────────────────────────────────────────────────

_LOCAL_HOST = os.environ.get("AETHER_ARENA_SANDBOX_HOST", "localhost")

_LOCAL_PROVIDERS: dict[str, str] = {
    "lmstudio": f"http://{_LOCAL_HOST}:1234",
    "ollama": f"http://{_LOCAL_HOST}:11434",
}


async def _probe_lmstudio(base_url: str) -> ProviderHealthResult:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{base_url}/v1/models")
            r.raise_for_status()
            data = r.json()
            models = data.get("data", data.get("models", []))
            return ProviderHealthResult(reachable=True, url=base_url, model_count=len(models))
    except Exception:
        return ProviderHealthResult(reachable=False, url=base_url)


async def _probe_ollama(base_url: str) -> ProviderHealthResult:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{base_url}/api/tags")
            r.raise_for_status()
            data = r.json()
            models = data.get("models", [])
            return ProviderHealthResult(reachable=True, url=base_url, model_count=len(models))
    except Exception:
        return ProviderHealthResult(reachable=False, url=base_url)


# ── Cloud provider key test ───────────────────────────────────────────────────

_CLOUD_PROBE: dict[str, tuple[str, dict[str, str]]] = {
    "openai":     ("https://api.openai.com/v1/models",                         {}),
    "groq":       ("https://api.groq.com/openai/v1/models",                    {}),
    "openrouter": ("https://openrouter.ai/api/v1/models",                      {}),
    "deepseek":   ("https://api.deepseek.com/v1/models",                       {}),
    "anthropic":  ("https://api.anthropic.com/v1/models",                      {"anthropic-version": "2023-06-01"}),
    "google":     ("https://generativelanguage.googleapis.com/v1beta/models",   {}),
}


async def _test_cloud_key(provider: str, api_key: str) -> TestKeyResponse:
    entry = _CLOUD_PROBE.get(provider)
    if entry is None:
        return TestKeyResponse(valid=False, error=f"Unknown provider: {provider}")

    url, extra_headers = entry

    # Google uses query-param auth; everyone else uses Bearer
    if provider == "google":
        request_url = f"{url}?key={api_key}"
        headers: dict[str, str] = {}
    elif provider == "anthropic":
        request_url = url
        headers = {"x-api-key": api_key, **extra_headers}
    else:
        request_url = url
        headers = {"Authorization": f"Bearer {api_key}", **extra_headers}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(request_url, headers=headers)

        if r.status_code == 200:
            data = r.json()
            # Different providers use different keys for model lists
            models = (
                data.get("data")
                or data.get("models")
                or data.get("object") and []   # openai returns object:"list"
                or []
            )
            if isinstance(data, dict) and "data" in data:
                models = data["data"]
            elif isinstance(data, dict) and "models" in data:
                models = data["models"]
            elif isinstance(data, list):
                models = data
            else:
                models = []
            return TestKeyResponse(valid=True, models_count=len(models))

        if r.status_code in (401, 403):
            return TestKeyResponse(valid=False, error="Invalid API key")

        return TestKeyResponse(valid=False, error=f"Unexpected response: HTTP {r.status_code}")

    except httpx.TimeoutException:
        return TestKeyResponse(valid=False, error="Request timed out — check your network")
    except Exception as exc:
        return TestKeyResponse(valid=False, error=str(exc))


# ── Live model fetching ───────────────────────────────────────────────────────

def _vision_from_modalities(modalities: list | None) -> bool:
    if not modalities:
        return False
    return any("image" in str(m).lower() for m in modalities)


def _is_free_openrouter(pricing: dict | None) -> bool:
    if not pricing:
        return False
    prompt = str(pricing.get("prompt", "1"))
    completion = str(pricing.get("completion", "1"))
    return prompt == "0" and completion == "0"


async def _fetch_openai_models(api_key: str, base_url: str = "https://api.openai.com/v1") -> FetchModelsResponse:
    """Fetch models from OpenAI-compatible API (OpenAI, Groq, DeepSeek)."""
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{base_url}/models", headers=headers)
        if r.status_code in (401, 403):
            return FetchModelsResponse(models=[], error="Invalid API key")
        r.raise_for_status()
        data = r.json()
        raw_models = data.get("data", data if isinstance(data, list) else [])
        models = []
        for m in raw_models:
            mid = m.get("id", "")
            models.append(ProviderModel(
                id=mid,
                name=mid,
                supports_vision="vision" in mid.lower() or "4o" in mid.lower() or "gpt-4" in mid.lower(),
            ))
        return FetchModelsResponse(models=sorted(models, key=lambda x: x.id))
    except httpx.TimeoutException:
        return FetchModelsResponse(models=[], error="Request timed out")
    except Exception as exc:
        return FetchModelsResponse(models=[], error=str(exc))


async def _fetch_anthropic_models(api_key: str) -> FetchModelsResponse:
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get("https://api.anthropic.com/v1/models", headers=headers)
        if r.status_code in (401, 403):
            return FetchModelsResponse(models=[], error="Invalid API key")
        r.raise_for_status()
        data = r.json()
        raw_models = data.get("data", [])
        models = []
        for m in raw_models:
            mid = m.get("id", "")
            models.append(ProviderModel(
                id=mid,
                name=m.get("display_name", mid),
                supports_vision="claude-3" in mid or "claude-sonnet" in mid or "claude-opus" in mid,
                supports_thinking="claude-3-7" in mid or "claude-opus-4" in mid or "claude-sonnet-4" in mid,
            ))
        return FetchModelsResponse(models=models)
    except httpx.TimeoutException:
        return FetchModelsResponse(models=[], error="Request timed out")
    except Exception as exc:
        return FetchModelsResponse(models=[], error=str(exc))


async def _fetch_google_models(api_key: str) -> FetchModelsResponse:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
            )
        if r.status_code in (401, 403, 400):
            return FetchModelsResponse(models=[], error="Invalid API key")
        r.raise_for_status()
        data = r.json()
        raw_models = data.get("models", [])
        models = []
        for m in raw_models:
            mid = m.get("name", "").replace("models/", "")
            if not mid:
                continue
            disp = m.get("displayName", mid)
            methods = m.get("supportedGenerationMethods", [])
            if "generateContent" not in methods:
                continue
            models.append(ProviderModel(
                id=mid,
                name=disp,
                supports_vision="vision" in disp.lower() or "gemini" in mid.lower(),
            ))
        return FetchModelsResponse(models=models)
    except httpx.TimeoutException:
        return FetchModelsResponse(models=[], error="Request timed out")
    except Exception as exc:
        return FetchModelsResponse(models=[], error=str(exc))


async def _fetch_openrouter_models_public() -> list[ProviderModel]:
    """Fetch all OpenRouter models — public endpoint, no key needed."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get("https://openrouter.ai/api/v1/models")
        r.raise_for_status()
        data = r.json()
        raw = data.get("data", [])
        models = []
        for m in raw:
            mid = m.get("id", "")
            name = m.get("name", mid)
            pricing = m.get("pricing", {})
            arch = m.get("architecture", {})
            modalities = arch.get("input_modalities", [])
            models.append(ProviderModel(
                id=mid,
                name=name,
                supports_vision=_vision_from_modalities(modalities),
                is_free=_is_free_openrouter(pricing),
                description=m.get("description", ""),
            ))
        return sorted(models, key=lambda x: x.id)
    except Exception:
        return []


async def _fetch_provider_models(provider: str, api_key: str) -> FetchModelsResponse:
    if provider == "openai":
        return await _fetch_openai_models(api_key, "https://api.openai.com/v1")
    if provider == "anthropic":
        return await _fetch_anthropic_models(api_key)
    if provider == "google":
        return await _fetch_google_models(api_key)
    if provider == "groq":
        return await _fetch_openai_models(api_key, "https://api.groq.com/openai/v1")
    if provider == "deepseek":
        return await _fetch_openai_models(api_key, "https://api.deepseek.com/v1")
    if provider == "openrouter":
        models = await _fetch_openrouter_models_public()
        return FetchModelsResponse(models=models)
    if provider == "lmstudio":
        base_url = _LOCAL_PROVIDERS["lmstudio"]
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{base_url}/api/v0/models")
            r.raise_for_status()
            raw = r.json().get("data", [])
            models = []
            for m in raw:
                mid = m.get("id", "")
                mtype = m.get("type", "llm")
                # Skip embedding and reranker models — not chat models
                if mtype in ("embeddings", "reranker"):
                    continue
                models.append(ProviderModel(
                    id=mid,
                    name=mid,
                    supports_vision=mtype == "vlm",
                ))
            return FetchModelsResponse(models=models)
        except Exception as exc:
            return FetchModelsResponse(models=[], error=str(exc))
    if provider == "ollama":
        base_url = _LOCAL_PROVIDERS["ollama"]
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{base_url}/api/tags")
            r.raise_for_status()
            raw = r.json().get("models", [])
            models = [ProviderModel(id=m.get("name", ""), name=m.get("name", "")) for m in raw]
            return FetchModelsResponse(models=models)
        except Exception as exc:
            return FetchModelsResponse(models=[], error=str(exc))
    return FetchModelsResponse(models=[], error=f"Unknown provider: {provider}")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get(
    "/health",
    response_model=ProvidersHealthResponse,
    summary="Probe local provider health",
    description="Checks whether LM Studio and Ollama are reachable on their default ports.",
)
async def providers_health() -> ProvidersHealthResponse:
    lmstudio_result, ollama_result = await asyncio.gather(
        _probe_lmstudio(_LOCAL_PROVIDERS["lmstudio"]),
        _probe_ollama(_LOCAL_PROVIDERS["ollama"]),
    )
    return ProvidersHealthResponse(
        providers={
            "lmstudio": lmstudio_result,
            "ollama": ollama_result,
        }
    )


@router.post(
    "/test-key",
    response_model=TestKeyResponse,
    summary="Test a cloud provider API key",
    description="Makes a minimal authenticated request to verify the key. The key is never stored.",
)
async def test_provider_key(req: TestKeyRequest) -> TestKeyResponse:
    return await _test_cloud_key(req.provider, req.api_key)


@router.post(
    "/fetch-models",
    response_model=FetchModelsResponse,
    summary="Fetch live model list from a provider",
    description="Retrieves available models from the given provider using the supplied API key. The key is never stored.",
)
async def fetch_provider_models(req: FetchModelsRequest) -> FetchModelsResponse:
    return await _fetch_provider_models(req.provider, req.api_key)


@router.get(
    "/openrouter-models",
    response_model=OpenRouterModelsResponse,
    summary="Fetch OpenRouter model catalog",
    description="Returns the full OpenRouter model list. Public endpoint, no API key required.",
)
async def get_openrouter_models() -> OpenRouterModelsResponse:
    models = await _fetch_openrouter_models_public()
    return OpenRouterModelsResponse(models=models)


# ── Test-chat (streaming) ─────────────────────────────────────────────────────

class TestChatRequest(BaseModel):
    provider: str = Field(..., description="Provider id")
    api_key: str = Field(..., description="API key — never stored")
    model: str = Field(..., description="Model ID (e.g. 'qwen/qwen3.6-plus:free')")
    message: str = Field(default="Reply with the word PONG in all caps.", description="Test message to send")


_PROVIDER_CHAT_URLS: dict[str, str] = {
    "openai": "https://api.openai.com/v1/chat/completions",
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    "deepseek": "https://api.deepseek.com/v1/chat/completions",
    "lmstudio": f"http://{_LOCAL_HOST}:1234/v1/chat/completions",
    "ollama": f"http://{_LOCAL_HOST}:11434/v1/chat/completions",
}


async def _openai_chat_completions_stream(
    url: str, api_key: str, model: str, message: str, extra_headers: dict | None = None,
) -> StreamingResponse:
    """Stream a chat completions response from an OpenAI-compatible endpoint."""
    headers: dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)

    body = {
        "model": model,
        "messages": [{"role": "user", "content": message}],
        "stream": True,
        "max_tokens": 150,
    }

    async def _stream():
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", url, headers=headers, json=body) as r:
                    r.raise_for_status()
                    async for line in r.aiter_lines():
                        line = line.strip()
                        if not line or line == "data: [DONE]":
                            break
                        if line.startswith("data: "):
                            try:
                                chunk = json.loads(line[6:])
                                delta = chunk.get("choices", [{}])[0].get("delta", {})
                                if "reasoning_content" in delta:
                                    yield f"data: {json.dumps({'type': 'reasoning', 'content': delta['reasoning_content']})}\n\n"
                                if "content" in delta:
                                    yield f"data: {json.dumps({'type': 'content', 'content': delta['content']})}\n\n"
                            except (json.JSONDecodeError, (KeyError, IndexError, TypeError)):
                                pass
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.post(
    "/test-chat",
    summary="Test a provider model with live streaming chat",
    description=(
        "Sends a small test message to the provider's chat API and streams back the response. "
        "Useful to verify that both the API key and the specific model are working. The key is never stored."
    ),
)
async def test_provider_chat(req: TestChatRequest) -> StreamingResponse:
    provider = req.provider.lower()
    model = req.model

    # Anthropic uses a different API shape
    if provider == "anthropic":
        return await _anthropic_chat_stream(req)

    # OpenAI-compatible providers
    url = _PROVIDER_CHAT_URLS.get(provider)
    if url is None:
        url = provider  # treat as custom base URL ending
        if not url.endswith("/chat/completions"):
            url = url.rstrip("/") + "/v1/chat/completions"

    extra_headers: dict[str, str] | None = None
    if provider == "google":
        # Google Gemini uses /v1beta/models/{model}:streamGenerateContent
        return await _google_chat_stream(req)

    return await _openai_chat_completions_stream(url, req.api_key, model, req.message, extra_headers)


async def _anthropic_chat_stream(req: TestChatRequest) -> StreamingResponse:
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": req.api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    body = {
        "model": req.model,
        "messages": [{"role": "user", "content": req.message}],
        "stream": True,
        "max_tokens": 150,
    }

    async def _stream():
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", url, headers=headers, json=body) as r:
                    r.raise_for_status()
                    buffer = ""
                    async for chunk in r.aiter_text():
                        buffer += chunk
                        while "\n" in buffer:
                            line, buffer = buffer.split("\n", 1)
                            line = line.strip()
                            if not line or line == "event: done":
                                continue
                            if line.startswith("data: "):
                                try:
                                    ev = json.loads(line[6:])
                                    if ev.get("type") == "content_block_delta":
                                        text = ev.get("delta", {}).get("text", "")
                                        if text:
                                            yield f"data: {json.dumps({'type': 'content', 'content': text})}\n\n"
                                except (json.JSONDecodeError, (KeyError, TypeError)):
                                    pass
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


async def _google_chat_stream(req: TestChatRequest) -> StreamingResponse:
    # Google Gemini uses a different streaming endpoint
    model_id = req.model.replace("models/", "") if req.model.startswith("models/") else req.model
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:streamGenerateContent?key={req.api_key}"
    headers = {"Content-Type": "application/json"}
    body = {
        "contents": [{"role": "user", "parts": [{"text": req.message}]}],
    }

    async def _stream():
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", url, headers=headers, json=body) as r:
                    r.raise_for_status()
                    buffer = ""
                    async for chunk in r.aiter_text():
                        buffer += chunk
                        while "\n" in buffer:
                            line, buffer = buffer.split("\n", 1)
                            line = line.strip()
                            if line.startswith("data: "):
                                try:
                                    ev = json.loads(line[6:])
                                    for part in ev.get("candidates", [{}])[0].get("content", {}).get("parts", []):
                                        text = part.get("text", "")
                                        if text:
                                            yield f"data: {json.dumps({'type': 'content', 'content': text})}\n\n"
                                except (json.JSONDecodeError, (KeyError, TypeError, IndexError)):
                                    pass
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")
