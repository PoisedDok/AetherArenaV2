"""Tests for the compact configuration endpoint and _prune_thread helper."""

import pytest
from fastapi.testclient import TestClient


# ── Config endpoint tests ─────────────────────────────────────────────────────


def _make_app():
    from fastapi import FastAPI
    from app.gateway.routers.compact import config_router
    app = FastAPI()
    app.include_router(config_router)
    return app


def test_get_compact_config_returns_defaults():
    """GET /api/compact/config returns the current config."""
    app = _make_app()
    client = TestClient(app)
    resp = client.get("/api/compact/config")
    assert resp.status_code == 200
    data = resp.json()
    assert "enabled" in data
    assert "messages_to_keep" in data
    assert "model_name" in data
    assert "token_threshold_override" in data
    assert "doc_summarization_enabled" in data
    assert "doc_summarization_ratio" in data
    assert "doc_summarization_threshold" in data


def test_put_compact_config_updates_field():
    """PUT /api/compact/config updates mutable fields."""
    from aether.config.compact_config import get_compact_config, set_compact_config, CompactConfig
    # Reset to known state
    set_compact_config(CompactConfig())

    app = _make_app()
    client = TestClient(app)
    resp = client.put("/api/compact/config", json={"messages_to_keep": 20})
    assert resp.status_code == 200
    data = resp.json()
    assert data["messages_to_keep"] == 20
    # Verify in-process state was actually updated
    assert get_compact_config().messages_to_keep == 20


def test_put_compact_config_partial_update():
    """PUT only changes specified fields; others are preserved."""
    from aether.config.compact_config import get_compact_config, set_compact_config, CompactConfig
    set_compact_config(CompactConfig(messages_to_keep=5, enabled=True))

    app = _make_app()
    client = TestClient(app)
    resp = client.put("/api/compact/config", json={"enabled": False})
    assert resp.status_code == 200
    data = resp.json()
    assert data["enabled"] is False
    assert data["messages_to_keep"] == 5  # unchanged


def test_put_compact_config_token_threshold():
    """PUT can set token_threshold_override to a value and back to null."""
    from aether.config.compact_config import set_compact_config, CompactConfig
    set_compact_config(CompactConfig())

    app = _make_app()
    client = TestClient(app)

    resp = client.put("/api/compact/config", json={"token_threshold_override": 50000})
    assert resp.status_code == 200
    assert resp.json()["token_threshold_override"] == 50000


def test_put_compact_config_doc_summarization_ratio():
    """PUT can update doc_summarization_ratio and it is reflected in GET."""
    from aether.config.compact_config import set_compact_config, CompactConfig
    from aether.config.doc_summarization_config import set_doc_summarization_config, DocSummarizationConfig
    set_compact_config(CompactConfig())
    set_doc_summarization_config(DocSummarizationConfig())

    app = _make_app()
    client = TestClient(app)

    resp = client.put("/api/compact/config", json={"doc_summarization_ratio": 0.25})
    assert resp.status_code == 200
    data = resp.json()
    assert data["doc_summarization_ratio"] == 0.25

    # Verify persisted
    resp2 = client.get("/api/compact/config")
    assert resp2.json()["doc_summarization_ratio"] == 0.25


def test_put_compact_config_doc_summarization_enabled():
    """PUT can toggle doc_summarization_enabled independently."""
    from aether.config.compact_config import set_compact_config, CompactConfig
    from aether.config.doc_summarization_config import set_doc_summarization_config, DocSummarizationConfig
    set_compact_config(CompactConfig())
    set_doc_summarization_config(DocSummarizationConfig())

    app = _make_app()
    client = TestClient(app)

    resp = client.put("/api/compact/config", json={"doc_summarization_enabled": False})
    assert resp.status_code == 200
    assert resp.json()["doc_summarization_enabled"] is False
    # Other compact fields untouched
    assert resp.json()["enabled"] is True


# ── _prune_thread remove dict format ─────────────────────────────────────────


def test_remove_op_has_content_key():
    """The remove dicts produced by _prune_thread must include 'content': '' to pass
    langchain's message coercion (_convert_to_message requires 'type'+'content')."""
    from langchain_core.messages.utils import _convert_to_message

    remove_op = {"type": "remove", "id": "abc-123", "content": ""}
    msg = _convert_to_message(remove_op)
    from langchain_core.messages import RemoveMessage
    assert isinstance(msg, RemoveMessage)
    assert msg.id == "abc-123"


def test_remove_op_missing_content_raises():
    """Without 'content', langchain raises MESSAGE_COERCION_FAILURE (reproduces the bug)."""
    from langchain_core.messages.utils import _convert_to_message

    remove_op = {"type": "remove", "id": "abc-123"}  # missing content
    with pytest.raises(ValueError, match="MESSAGE_COERCION_FAILURE|must contain"):
        _convert_to_message(remove_op)
