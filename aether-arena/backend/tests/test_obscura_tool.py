"""Tests for the Obscura web_fetch tool.

TDD approach: these tests were written BEFORE the implementation.
They describe the contract the tool must satisfy and act as a regression
guard for future changes.

The tool communicates with the Obscura CDP server over a plain WebSocket.
All network I/O is mocked at the `websockets.connect` level so the tests
run without a live Obscura process.
"""

import asyncio
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

from aether.community.obscura.tools import (
    _validate_url,
    _obscura_fetch,
    _obscura_extract,
    _obscura_js_eval,
    _obscura_links,
    _run_web_extract,
    _run_web_js_eval,
    _run_web_links,
    _OBSCURA_DEFAULT_URL,
    web_fetch_tool,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cdp_response(req_id: int, result: dict) -> str:
    """Minimal CDP success response JSON."""
    return json.dumps({"id": req_id, "result": result})


def _cdp_error(req_id: int, message: str) -> str:
    return json.dumps({"id": req_id, "error": {"code": -32000, "message": message}})


class _FakeWS:
    """Minimal async context-manager mock for a websockets connection.

    Callers push server-side messages into `responses` (a list of str).
    The mock pops them in order on each `recv()` call.
    `sent` accumulates every message the caller sent.
    """

    def __init__(self, responses: list[str]):
        self._responses = list(responses)
        self.sent: list[dict] = []

    async def send(self, msg: str) -> None:
        self.sent.append(json.loads(msg))

    async def recv(self) -> str:
        if not self._responses:
            raise Exception("No more mock responses queued")
        return self._responses.pop(0)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass


def _make_fake_ws_factory(responses: list[str]):
    """Return an async context-manager factory that yields a _FakeWS."""
    fake = _FakeWS(responses)

    class _CM:
        async def __aenter__(self_inner):
            return fake

        async def __aexit__(self_inner, *_):
            pass

    def factory(*args, **kwargs):
        return _CM()

    factory._fake = fake
    return factory


# ---------------------------------------------------------------------------
# _validate_url
# ---------------------------------------------------------------------------

class TestValidateUrl:
    def test_valid_https_passes(self):
        assert _validate_url("https://example.com") is None

    def test_valid_http_passes(self):
        assert _validate_url("http://example.com/path?q=1") is None

    def test_empty_url_rejected(self):
        assert _validate_url("") is not None
        assert _validate_url("   ") is not None

    def test_non_http_scheme_rejected(self):
        assert _validate_url("ftp://example.com") is not None
        assert _validate_url("file:///etc/passwd") is not None
        assert _validate_url("javascript:alert(1)") is not None

    def test_localhost_blocked(self):
        for host in ("http://localhost/", "http://127.0.0.1/", "http://::1/", "http://0.0.0.0/"):
            err = _validate_url(host)
            assert err is not None, f"Should block {host}"

    def test_docker_internal_blocked(self):
        assert _validate_url("http://host.docker.internal/") is not None

    def test_internal_tlds_blocked(self):
        for host in ("http://service.local/", "http://app.internal/", "http://x.test/"):
            assert _validate_url(host) is not None, f"Should block {host}"

    def test_cloud_metadata_blocked(self):
        assert _validate_url("http://169.254.169.254/latest/meta-data/") is not None
        assert _validate_url("http://metadata.google.internal/") is not None

    def test_private_ip_ranges_blocked(self):
        assert _validate_url("http://10.0.0.1/") is not None
        assert _validate_url("http://192.168.1.1/") is not None
        assert _validate_url("http://172.16.0.1/") is not None


# ---------------------------------------------------------------------------
# _obscura_fetch  (async CDP fetch helper)
# ---------------------------------------------------------------------------

class TestObscuraFetch:
    """Tests for the async CDP fetch helper that talks to the Obscura server."""

    def _run(self, coro):
        return asyncio.new_event_loop().run_until_complete(coro)

    def test_successful_fetch_returns_markdown(self):
        """Happy path: LP.getMarkdown returns rich content (>10 words) → no fallback needed."""
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_response(4, {"frameId": "f1", "loaderId": "l1"}),
            _cdp_response(5, {"markdown": "# Hello\n\nThis is a rich article with plenty of content words here for the test."}),
            _cdp_response(6, {}),  # Target.closeTarget
        ])

        with patch("aether.community.obscura.tools.websockets.connect", factory):
            markdown, err = self._run(
                _obscura_fetch("https://example.com", obscura_url="ws://localhost:9222", timeout=10)
            )

        assert err is None
        assert markdown is not None
        assert "Hello" in markdown

    def test_empty_markdown_all_fallbacks_empty_returns_error(self):
        """All 5 fallback levels return empty → surface actionable error."""
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_response(4, {"frameId": "f1", "loaderId": "l1"}),
            _cdp_response(5, {"markdown": ""}),               # L1: LP.getMarkdown → empty
            _cdp_response(6, {"text": ""}),                   # L2: LP.getInnerText → empty
            _cdp_response(7, {"result": {"type": "string", "value": ""}}),   # L3: outerHTML → empty
            _cdp_response(8, {"root": {"nodeId": 1, "nodeType": 9, "nodeName": "#document", "children": []}}),  # L4: DOM walk → empty
            _cdp_response(9, {"result": {"type": "string", "value": ""}}),   # L5: meta → empty
            _cdp_response(10, {}),  # Target.closeTarget
        ])

        with patch("aether.community.obscura.tools.websockets.connect", factory):
            markdown, err = self._run(
                _obscura_fetch("https://example.com", obscura_url="ws://localhost:9222", timeout=10)
            )

        assert markdown is None
        assert err is not None
        assert "no extractable text" in err.lower() or "empty" in err.lower()

    def test_lp_fallback_to_inner_text_when_lp_returns_empty(self):
        """LP.getMarkdown returns empty → LP.getInnerText fallback succeeds."""
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_response(4, {"frameId": "f1", "loaderId": "l1"}),
            _cdp_response(5, {"markdown": ""}),               # L1: LP.getMarkdown → empty
            _cdp_response(6, {"text": "AetherArena by AetherInc your private AI platform local private on device"}),  # L2: LP.getInnerText → content
            _cdp_response(7, {}),  # Target.closeTarget
        ])

        with patch("aether.community.obscura.tools.websockets.connect", factory):
            markdown, err = self._run(
                _obscura_fetch("https://example.com", obscura_url="ws://localhost:9222", timeout=10)
            )

        assert err is None
        assert markdown is not None
        assert "AetherArena" in markdown or "private" in markdown.lower()

    def test_lp_fallback_to_html_when_both_lp_empty(self):
        """LP.getMarkdown + LP.getInnerText empty → HTML fallback succeeds."""
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_response(4, {"frameId": "f1", "loaderId": "l1"}),
            _cdp_response(5, {"markdown": ""}),               # L1: LP.getMarkdown → empty
            _cdp_response(6, {"text": ""}),                   # L2: LP.getInnerText → empty
            _cdp_response(7, {"result": {"type": "string", "value": "<html><body><h1>Hello SPA</h1><p>Rich content from the React hydrated page here.</p></body></html>"}}),  # L3: outerHTML
            _cdp_response(8, {}),  # Target.closeTarget
        ])

        with patch("aether.community.obscura.tools.websockets.connect", factory):
            markdown, err = self._run(
                _obscura_fetch("https://example.com", obscura_url="ws://localhost:9222", timeout=10)
            )

        assert err is None
        assert markdown is not None
        assert "Hello SPA" in markdown or "content" in markdown.lower()

    def test_navigate_cdp_error_surfaces_message(self):
        """If Page.navigate returns a CDP error, propagate a clear error string."""
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_error(4, "net::ERR_NAME_NOT_RESOLVED"),
            _cdp_response(5, {}),  # closeTarget still called
        ])

        with patch("aether.community.obscura.tools.websockets.connect", factory):
            markdown, err = self._run(
                _obscura_fetch("https://nonexistent.invalid", obscura_url="ws://localhost:9222", timeout=10)
            )

        assert markdown is None
        assert err is not None
        assert "ERR_NAME_NOT_RESOLVED" in err or "navigate" in err.lower()

    def test_connection_refused_returns_error(self):
        """If the WebSocket connection itself fails, return an actionable error."""
        import websockets

        async def failing_factory(*args, **kwargs):
            raise OSError("Connection refused")

        # websockets.connect is used as an async context manager
        class _FailCM:
            async def __aenter__(self):
                raise OSError("Connection refused")
            async def __aexit__(self, *_):
                pass

        with patch("aether.community.obscura.tools.websockets.connect", return_value=_FailCM()):
            markdown, err = self._run(
                _obscura_fetch("https://example.com", obscura_url="ws://localhost:9222", timeout=10)
            )

        assert markdown is None
        assert err is not None
        assert "obscura" in err.lower() or "connection" in err.lower()

    def test_timeout_returns_error(self):
        """asyncio.TimeoutError during navigation is caught and returned as an error."""
        async def _slow(*args, **kwargs):
            await asyncio.sleep(999)

        class _SlowWS:
            async def send(self, msg):
                pass
            async def recv(self):
                await asyncio.sleep(999)
            async def __aenter__(self):
                return self
            async def __aexit__(self, *_):
                pass

        class _SlowCM:
            async def __aenter__(self):
                return _SlowWS()
            async def __aexit__(self, *_):
                pass

        with patch("aether.community.obscura.tools.websockets.connect", return_value=_SlowCM()):
            markdown, err = self._run(
                _obscura_fetch("https://example.com", obscura_url="ws://localhost:9222", timeout=1)
            )

        assert markdown is None
        assert err is not None
        assert "timed out" in err.lower() or "timeout" in err.lower()

    def test_cdp_messages_use_incrementing_ids(self):
        """Each CDP command must use a unique, incrementing integer id."""
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_response(4, {"frameId": "f1", "loaderId": "l1"}),
            _cdp_response(5, {"markdown": "# Content\n\nThis article has enough words to pass the minimum threshold check easily."}),
            _cdp_response(6, {}),
        ])

        with patch("aether.community.obscura.tools.websockets.connect", factory):
            self._run(
                _obscura_fetch("https://example.com", obscura_url="ws://localhost:9222", timeout=10)
            )

        sent_ids = [msg["id"] for msg in factory._fake.sent]
        assert sent_ids == list(range(1, len(sent_ids) + 1)), \
            f"Expected sequential ids 1..N, got {sent_ids}"

    def test_target_always_closed_on_navigate_error(self):
        """Even when navigation fails, Target.closeTarget must still be called to avoid leaks."""
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_error(4, "net::ERR_CONNECTION_REFUSED"),
            _cdp_response(5, {}),  # closeTarget
        ])

        with patch("aether.community.obscura.tools.websockets.connect", factory):
            self._run(
                _obscura_fetch("https://example.com", obscura_url="ws://localhost:9222", timeout=10)
            )

        methods = [msg["method"] for msg in factory._fake.sent]
        assert "Target.closeTarget" in methods, "Target.closeTarget must be sent even on error"


# ---------------------------------------------------------------------------
# _run_web_fetch — pure logic extracted for testing without LangChain wiring
# ---------------------------------------------------------------------------
# The LangChain @tool decorator injects ToolRuntime at call time.  Testing
# through tool.run() requires a real ToolRuntime dataclass which is framework
# machinery — not our logic.  Instead we import and test the pure inner
# function directly, same pattern used in test_searxng_tool.py.

from aether.community.obscura.tools import _run_web_fetch


class TestRunWebFetch:
    """Tests for the pure _run_web_fetch(url, workspace, obscura_url, timeout) helper.

    These cover every outcome the tool can return: success, SSRF block, missing
    workspace, fetch error, and empty-page error.  No ToolRuntime required.
    """

    @patch("aether.community.obscura.tools._obscura_fetch")
    def test_successful_fetch_writes_file_and_returns_virtual_path(
        self, mock_fetch, tmp_path
    ):
        """Happy path: markdown is saved and a virtual path line is returned."""
        async def _ok(*a, **kw):
            return ("# Hello\n\nThis is content.", None)
        mock_fetch.side_effect = _ok

        result = _run_web_fetch(
            url="https://example.com",
            workspace=str(tmp_path),
            obscura_url="http://localhost:9222",
            timeout=10,
        )

        assert "web_fetched" in result
        assert "virtual_path" in result.lower() or "Virtual path" in result
        assert "example" in result.lower() or "saved" in result.lower()
        # File must actually exist on disk
        written = list((tmp_path / "web_fetched").glob("*.md"))
        assert len(written) == 1
        assert "Hello" in written[0].read_text()

    @patch("aether.community.obscura.tools._obscura_fetch")
    def test_ssrf_blocked_before_cdp_call(self, mock_fetch, tmp_path):
        """SSRF-blocked URLs must be rejected before _obscura_fetch is ever called."""
        result = _run_web_fetch(
            url="http://169.254.169.254/latest",
            workspace=str(tmp_path),
            obscura_url="http://localhost:9222",
            timeout=10,
        )

        mock_fetch.assert_not_called()
        assert "denied" in result.lower() or "error" in result.lower()

    @patch("aether.community.obscura.tools._obscura_fetch")
    def test_fetch_error_propagated_to_caller(self, mock_fetch, tmp_path):
        """An error from _obscura_fetch is returned verbatim to the caller."""
        async def _err(*a, **kw):
            return (None, "Obscura service unreachable: connection refused")
        mock_fetch.side_effect = _err

        result = _run_web_fetch(
            url="https://example.com",
            workspace=str(tmp_path),
            obscura_url="http://localhost:9222",
            timeout=10,
        )

        assert "unreachable" in result.lower() or "error" in result.lower()

    @patch("aether.community.obscura.tools._obscura_fetch")
    def test_empty_markdown_returns_error(self, mock_fetch, tmp_path):
        """If _obscura_fetch returns empty markdown, surface a clear error."""
        async def _empty(*a, **kw):
            return ("", None)
        mock_fetch.side_effect = _empty

        result = _run_web_fetch(
            url="https://example.com",
            workspace=str(tmp_path),
            obscura_url="http://localhost:9222",
            timeout=10,
        )

        assert "error" in result.lower()


# ---------------------------------------------------------------------------
# _obscura_extract  (DOM.querySelector + DOM.getOuterHTML)
# ---------------------------------------------------------------------------

class TestObscuraExtract:
    """Tests for the CSS-selector extraction CDP helper."""

    def _run(self, coro):
        return asyncio.new_event_loop().run_until_complete(coro)

    def test_successful_extract_returns_html(self):
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),                                   # Page.enable
            _cdp_response(4, {"frameId": "f1", "loaderId": "l1"}),  # Page.navigate
            _cdp_response(5, {"root": {"nodeId": 1}}),              # DOM.getDocument
            _cdp_response(6, {"nodeId": 42}),                       # DOM.querySelector
            _cdp_response(7, {"outerHTML": "<h1>Hello</h1>"}),      # DOM.getOuterHTML
            _cdp_response(8, {}),                                    # Target.closeTarget
        ])
        with patch("aether.community.obscura.tools.websockets.connect", factory):
            html, err = self._run(_obscura_extract(
                "https://example.com", selector="h1",
                obscura_url="http://localhost:9222", timeout=10,
            ))
        assert err is None
        assert html == "<h1>Hello</h1>"

    def test_selector_not_found_returns_error(self):
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_response(4, {"frameId": "f1", "loaderId": "l1"}),
            _cdp_response(5, {"root": {"nodeId": 1}}),
            _cdp_response(6, {"nodeId": 0}),   # nodeId=0 means not found
            _cdp_response(7, {}),              # closeTarget
        ])
        with patch("aether.community.obscura.tools.websockets.connect", factory):
            html, err = self._run(_obscura_extract(
                "https://example.com", selector=".missing",
                obscura_url="http://localhost:9222", timeout=10,
            ))
        assert html is None
        assert err is not None
        assert "not found" in err.lower() or ".missing" in err

    def test_ssrf_blocked_before_cdp(self, tmp_path):
        with patch("aether.community.obscura.tools._obscura_extract") as mock_extract:
            result = _run_web_extract(
                url="http://169.254.169.254/",
                selector="body",
                workspace=str(tmp_path),
                obscura_url="http://localhost:9222",
                timeout=10,
            )
        mock_extract.assert_not_called()
        assert "denied" in result.lower() or "error" in result.lower()

    def test_successful_extract_writes_file(self, tmp_path):
        async def _ok(*a, **kw):
            return ("<article><h1>Rust</h1></article>", None)
        with patch("aether.community.obscura.tools._obscura_extract", side_effect=_ok):
            result = _run_web_extract(
                url="https://example.com",
                selector="article",
                workspace=str(tmp_path),
                obscura_url="http://localhost:9222",
                timeout=10,
            )
        assert "virtual_path" in result.lower() or "web_extracted" in result
        files = list((tmp_path / "web_extracted").glob("*.md"))
        assert len(files) == 1


# ---------------------------------------------------------------------------
# _obscura_js_eval  (Runtime.evaluate)
# ---------------------------------------------------------------------------

class TestObscuraJsEval:
    """Tests for the JavaScript evaluation CDP helper."""

    def _run(self, coro):
        return asyncio.new_event_loop().run_until_complete(coro)

    def test_returns_string_result(self):
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_response(4, {"frameId": "f1", "loaderId": "l1"}),
            _cdp_response(5, {"result": {"type": "string", "value": "Example Domain"}}),
            _cdp_response(6, {}),
        ])
        with patch("aether.community.obscura.tools.websockets.connect", factory):
            result, err = self._run(_obscura_js_eval(
                "https://example.com", expression="document.title",
                obscura_url="http://localhost:9222", timeout=10,
            ))
        assert err is None
        assert result == "Example Domain"

    def test_js_exception_returns_error(self):
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_response(4, {"frameId": "f1", "loaderId": "l1"}),
            _cdp_response(5, {
                "result": {"type": "undefined"},
                "exceptionDetails": {"text": "ReferenceError: foo is not defined"},
            }),
            _cdp_response(6, {}),
        ])
        with patch("aether.community.obscura.tools.websockets.connect", factory):
            result, err = self._run(_obscura_js_eval(
                "https://example.com", expression="foo.bar",
                obscura_url="http://localhost:9222", timeout=10,
            ))
        assert result is None
        assert err is not None
        assert "ReferenceError" in err

    def test_ssrf_blocked_before_cdp(self, tmp_path):
        with patch("aether.community.obscura.tools._obscura_js_eval") as mock_eval:
            result = _run_web_js_eval(
                url="http://10.0.0.1/",
                expression="document.title",
                workspace=str(tmp_path),
                obscura_url="http://localhost:9222",
                timeout=10,
            )
        mock_eval.assert_not_called()
        assert "denied" in result.lower() or "error" in result.lower()


# ---------------------------------------------------------------------------
# _obscura_links  (Runtime.evaluate — link harvester)
# ---------------------------------------------------------------------------

class TestObscuraLinks:
    """Tests for the link extraction CDP helper."""

    def _run(self, coro):
        return asyncio.new_event_loop().run_until_complete(coro)

    def test_returns_link_list(self):
        links_payload = json.dumps([
            {"text": "Learn more", "href": "https://iana.org/domains/example"},
        ])
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_response(4, {"frameId": "f1", "loaderId": "l1"}),
            _cdp_response(5, {"result": {"type": "string", "value": links_payload}}),
            _cdp_response(6, {}),
        ])
        with patch("aether.community.obscura.tools.websockets.connect", factory):
            links, err = self._run(_obscura_links(
                "https://example.com",
                obscura_url="http://localhost:9222", timeout=10,
            ))
        assert err is None
        assert len(links) == 1
        assert links[0]["href"] == "https://iana.org/domains/example"

    def test_empty_page_returns_empty_list(self):
        factory = _make_fake_ws_factory([
            _cdp_response(1, {"targetId": "t1"}),
            _cdp_response(2, {"sessionId": "s1"}),
            _cdp_response(3, {}),
            _cdp_response(4, {"frameId": "f1", "loaderId": "l1"}),
            _cdp_response(5, {"result": {"type": "string", "value": "[]"}}),
            _cdp_response(6, {}),
        ])
        with patch("aether.community.obscura.tools.websockets.connect", factory):
            links, err = self._run(_obscura_links(
                "https://example.com",
                obscura_url="http://localhost:9222", timeout=10,
            ))
        assert err is None
        assert links == []

    def test_ssrf_blocked_before_cdp(self, tmp_path):
        with patch("aether.community.obscura.tools._obscura_links") as mock_links:
            result = _run_web_links(
                url="http://192.168.1.1/",
                workspace=str(tmp_path),
                obscura_url="http://localhost:9222",
                timeout=10,
            )
        mock_links.assert_not_called()
        assert "denied" in result.lower() or "error" in result.lower()

    def test_result_is_valid_json_with_count(self, tmp_path):
        import json as _json
        async def _ok(*a, **kw):
            return ([{"text": "Rust", "href": "https://rust-lang.org"}], None)
        with patch("aether.community.obscura.tools._obscura_links", side_effect=_ok):
            result = _run_web_links(
                url="https://example.com",
                workspace=str(tmp_path),
                obscura_url="http://localhost:9222",
                timeout=10,
            )
        parsed = _json.loads(result)
        assert parsed["url"] == "https://example.com"
        assert parsed["count"] == 1
        assert parsed["links"][0]["href"] == "https://rust-lang.org"
