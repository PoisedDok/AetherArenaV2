"""Tests for SearXNG web_search tool."""

import json
import os
from unittest.mock import MagicMock, patch

from deerflow.community.searxng.tools import web_search_tool


class TestSearxngWebSearchTool:
    @patch("deerflow.community.searxng.tools.get_app_config")
    @patch("deerflow.community.searxng.tools.httpx.get")
    def test_success_normalizes_results(self, mock_get, mock_get_config):
        cfg = MagicMock()
        cfg.get_tool_config.return_value = MagicMock(
            model_extra={
                "url": "http://searxng:8080",
                "max_results": 2,
            }
        )
        mock_get_config.return_value = cfg

        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {
            "results": [
                {"title": "A", "url": "https://a", "content": "snippet a"},
                {"title": "B", "url": "https://b", "content": "snippet b"},
            ]
        }
        mock_get.return_value = mock_resp

        out = web_search_tool.run("test query")
        data = json.loads(out)
        assert len(data) == 2
        assert data[0]["title"] == "A"
        assert data[0]["snippet"] == "snippet a"

        mock_get.assert_called_once()
        args, kwargs = mock_get.call_args
        assert kwargs["params"] == {"q": "test query", "format": "json"}

    @patch.dict(os.environ, {"SEARXNG_URL": "http://127.0.0.1:2030"}, clear=False)
    @patch("deerflow.community.searxng.tools.get_app_config")
    @patch("deerflow.community.searxng.tools.httpx.get")
    def test_falls_back_to_env_without_tool_url(self, mock_get, mock_get_config):
        cfg = MagicMock()
        cfg.get_tool_config.return_value = None
        mock_get_config.return_value = cfg

        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"results": []}
        mock_get.return_value = mock_resp

        web_search_tool.run("q")
        mock_get.assert_called_once()
        args, kwargs = mock_get.call_args
        assert args[0] == "http://127.0.0.1:2030/search"

    @patch("deerflow.community.searxng.tools.get_app_config")
    @patch("deerflow.community.searxng.tools.httpx.get")
    def test_http_error_returns_error_json(self, mock_get, mock_get_config):
        cfg = MagicMock()
        cfg.get_tool_config.return_value = MagicMock(model_extra={"url": "http://x"})
        mock_get_config.return_value = cfg

        import httpx

        mock_get.side_effect = httpx.HTTPError("failed")

        out = web_search_tool.run("q")
        data = json.loads(out)
        assert "error" in data
