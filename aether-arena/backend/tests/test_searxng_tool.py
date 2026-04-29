"""Tests for SearXNG web_search and web_fetch tools."""

import json
import os
from unittest.mock import MagicMock, call, patch

import httpx

from aether.community.searxng.tools import (
    _BROWSER_HEADERS,
    _FALLBACK_HEADERS,
    _do_fetch,
    _fetch_html,
    web_search_tool,
)


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
        assert kwargs["params"] == {"q": "test query", "format": "json", "language": "en"}

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

        mock_get.side_effect = httpx.HTTPError("failed")

        out = web_search_tool.run("q")
        data = json.loads(out)
        assert "error" in data


# ---------------------------------------------------------------------------
# Tests for _do_fetch and _fetch_html retry logic
# ---------------------------------------------------------------------------

def _make_mock_response(status_code: int, text: str = "<html>hello</html>", content_type: str = "text/html") -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.url = f"https://example.com"
    resp.text = text
    resp.content = text.encode("utf-8")
    resp.headers = {"content-type": content_type}
    return resp


class TestDoFetch:
    """Unit tests for the low-level _do_fetch helper."""

    @patch("deerflow.community.searxng.tools.httpx.Client")
    def test_success_returns_body(self, mock_client_cls):
        mock_resp = _make_mock_response(200, text="<html>ok</html>")
        mock_client = MagicMock()
        mock_client.get.return_value = mock_resp
        mock_client_cls.return_value.__enter__ = lambda s: mock_client
        mock_client_cls.return_value.__exit__ = MagicMock(return_value=False)

        body, status, err = _do_fetch("https://example.com", 10, _BROWSER_HEADERS)

        assert body == "<html>ok</html>"
        assert status == 200
        assert err is None

    @patch("deerflow.community.searxng.tools.httpx.Client")
    def test_400_returns_error_with_status(self, mock_client_cls):
        mock_resp = _make_mock_response(403, text="Forbidden")
        mock_client = MagicMock()
        mock_client.get.return_value = mock_resp
        mock_client_cls.return_value.__enter__ = lambda s: mock_client
        mock_client_cls.return_value.__exit__ = MagicMock(return_value=False)

        body, status, err = _do_fetch("https://example.com", 10, _BROWSER_HEADERS)

        assert body is None
        assert status == 403
        assert "403" in err

    @patch("deerflow.community.searxng.tools.httpx.Client")
    def test_timeout_returns_error(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.ReadTimeout("timed out")
        mock_client_cls.return_value.__enter__ = lambda s: mock_client
        mock_client_cls.return_value.__exit__ = MagicMock(return_value=False)

        body, status, err = _do_fetch("https://example.com", 5, _BROWSER_HEADERS)

        assert body is None
        assert status is None
        assert "timed out" in err

    @patch("deerflow.community.searxng.tools.httpx.Client")
    def test_unsafe_content_type_blocked(self, mock_client_cls):
        # MagicMock .headers must behave like a dict for .get() calls
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.url = "https://example.com"
        mock_resp.text = "<html>hello</html>"
        mock_resp.content = b"<html>hello</html>"
        mock_resp.headers = {"content-type": "application/octet-stream"}

        mock_client = MagicMock()
        mock_client.get.return_value = mock_resp
        mock_client_cls.return_value.__enter__ = lambda s: mock_client
        mock_client_cls.return_value.__exit__ = MagicMock(return_value=False)

        body, status, err = _do_fetch("https://example.com", 10, _BROWSER_HEADERS)

        assert body is None
        assert "unsafe content-type" in err


class TestFetchHtml:
    """Tests for the _fetch_html retry orchestration."""

    @patch("deerflow.community.searxng.tools._do_fetch")
    def test_success_on_first_attempt(self, mock_do_fetch):
        mock_do_fetch.return_value = ("<html>ok</html>", 200, None)

        body, err = _fetch_html("https://example.com", 10)

        assert body == "<html>ok</html>"
        assert err is None
        assert mock_do_fetch.call_count == 1
        # Should use browser headers by default
        assert mock_do_fetch.call_args[0][2] is _BROWSER_HEADERS

    @patch("deerflow.community.searxng.tools._do_fetch")
    def test_retries_with_fallback_ua_on_403(self, mock_do_fetch):
        """On 403, _fetch_html must retry with the Firefox fallback UA."""
        mock_do_fetch.side_effect = [
            (None, 403, "HTTP 403 from https://example.com"),  # first: Chrome blocked
            ("<html>ok</html>", 200, None),                    # second: Firefox ok
        ]

        body, err = _fetch_html("https://example.com", 10)

        assert body == "<html>ok</html>"
        assert err is None
        assert mock_do_fetch.call_count == 2
        # Second call must use fallback headers
        second_call_headers = mock_do_fetch.call_args_list[1][0][2]
        assert second_call_headers is _FALLBACK_HEADERS

    @patch("deerflow.community.searxng.tools._do_fetch")
    def test_retries_with_fallback_ua_on_429(self, mock_do_fetch):
        """429 rate-limit also triggers fallback retry."""
        mock_do_fetch.side_effect = [
            (None, 429, "HTTP 429 from https://example.com"),
            ("<html>ok</html>", 200, None),
        ]

        body, err = _fetch_html("https://example.com", 10)

        assert body == "<html>ok</html>"
        assert err is None

    @patch("deerflow.community.searxng.tools._do_fetch")
    def test_actionable_error_when_both_uas_blocked(self, mock_do_fetch):
        """If both Chrome and Firefox UA are blocked, return an actionable message."""
        mock_do_fetch.side_effect = [
            (None, 403, "HTTP 403 from https://ndtv.com"),
            (None, 403, "HTTP 403 from https://ndtv.com"),
        ]

        body, err = _fetch_html("https://ndtv.com", 10)

        assert body is None
        assert err is not None
        assert "403" in err
        assert "web_search" in err  # actionable: tells LLM what to do next

    @patch("deerflow.community.searxng.tools._do_fetch")
    def test_ssl_error_retries_without_verification(self, mock_do_fetch):
        """SSL errors on first attempt should trigger a no-verify retry."""
        mock_do_fetch.side_effect = [
            (None, None, "SSL: CERTIFICATE_VERIFY_FAILED"),
            ("<html>ok</html>", 200, None),
        ]

        body, err = _fetch_html("https://example.com", 10)

        assert body == "<html>ok</html>"
        assert err is None
        assert mock_do_fetch.call_count == 2
        # Second call must pass verify=False as a keyword argument
        _, kwargs = mock_do_fetch.call_args_list[1]
        assert kwargs.get("verify") is False

    @patch("deerflow.community.searxng.tools._do_fetch")
    def test_non_blocked_error_returned_directly(self, mock_do_fetch):
        """Non-4xx errors (network failures) should not trigger retry, returned as-is."""
        mock_do_fetch.return_value = (None, None, "Connection refused")

        body, err = _fetch_html("https://example.com", 10)

        assert body is None
        assert err == "Connection refused"
        assert mock_do_fetch.call_count == 1  # no retry for network errors
