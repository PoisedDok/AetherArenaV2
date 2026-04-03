"""Tests for the /api/providers router."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from app.gateway.routers.providers import (
    _probe_lmstudio,
    _probe_ollama,
    _test_cloud_key,
)


def _run(coro):
    return asyncio.run(coro)


def _make_mock_client(response):
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = AsyncMock(return_value=response)
    return mock_client


# ── Local provider probes ─────────────────────────────────────────────────────

def test_probe_lmstudio_reachable():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"data": [{"id": "model-a"}, {"id": "model-b"}]}

    with patch("app.gateway.routers.providers.httpx.AsyncClient", return_value=_make_mock_client(mock_response)):
        result = _run(_probe_lmstudio("http://localhost:1234"))

    assert result.reachable is True
    assert result.model_count == 2
    assert result.url == "http://localhost:1234"


def test_probe_lmstudio_unreachable():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = AsyncMock(side_effect=Exception("Connection refused"))

    with patch("app.gateway.routers.providers.httpx.AsyncClient", return_value=mock_client):
        result = _run(_probe_lmstudio("http://localhost:1234"))

    assert result.reachable is False
    assert result.model_count == 0


def test_probe_ollama_reachable():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"models": [{"name": "llama3"}, {"name": "mistral"}]}

    with patch("app.gateway.routers.providers.httpx.AsyncClient", return_value=_make_mock_client(mock_response)):
        result = _run(_probe_ollama("http://localhost:11434"))

    assert result.reachable is True
    assert result.model_count == 2


def test_probe_ollama_unreachable():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = AsyncMock(side_effect=Exception("Connection refused"))

    with patch("app.gateway.routers.providers.httpx.AsyncClient", return_value=mock_client):
        result = _run(_probe_ollama("http://localhost:11434"))

    assert result.reachable is False


# ── Cloud key tests ───────────────────────────────────────────────────────────

def test_cloud_key_valid_openai():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"data": [{"id": "gpt-4o"}, {"id": "gpt-3.5-turbo"}]}

    with patch("app.gateway.routers.providers.httpx.AsyncClient", return_value=_make_mock_client(mock_response)):
        result = _run(_test_cloud_key("openai", "sk-valid-key"))

    assert result.valid is True
    assert result.error is None
    assert result.models_count == 2


def test_cloud_key_invalid_401():
    mock_response = MagicMock()
    mock_response.status_code = 401

    with patch("app.gateway.routers.providers.httpx.AsyncClient", return_value=_make_mock_client(mock_response)):
        result = _run(_test_cloud_key("openai", "sk-bad-key"))

    assert result.valid is False
    assert result.error == "Invalid API key"


def test_cloud_key_unknown_provider():
    result = _run(_test_cloud_key("unknown_provider", "some-key"))
    assert result.valid is False
    assert "Unknown provider" in (result.error or "")


def test_cloud_key_timeout():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timed out"))

    with patch("app.gateway.routers.providers.httpx.AsyncClient", return_value=mock_client):
        result = _run(_test_cloud_key("anthropic", "sk-ant-key"))

    assert result.valid is False
    assert "timed out" in (result.error or "").lower()


def test_cloud_key_anthropic_uses_x_api_key_header():
    """Anthropic uses x-api-key header, not Authorization: Bearer."""
    captured_headers: dict = {}
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"models": []}

    async def fake_get(url, headers=None):
        captured_headers.update(headers or {})
        return mock_response

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = fake_get

    with patch("app.gateway.routers.providers.httpx.AsyncClient", return_value=mock_client):
        _run(_test_cloud_key("anthropic", "sk-ant-testkey"))

    assert "x-api-key" in captured_headers
    assert captured_headers["x-api-key"] == "sk-ant-testkey"
    assert "Authorization" not in captured_headers


def test_cloud_key_google_uses_query_param():
    """Google uses ?key= query param, not an Authorization header."""
    captured_urls: list = []
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = []

    async def fake_get(url, headers=None):
        captured_urls.append(url)
        return mock_response

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = fake_get

    with patch("app.gateway.routers.providers.httpx.AsyncClient", return_value=mock_client):
        _run(_test_cloud_key("google", "AIza-testkey"))

    assert len(captured_urls) == 1
    assert "key=AIza-testkey" in captured_urls[0]
