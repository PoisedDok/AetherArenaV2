from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from aether.tools.builtins.render_html_tool import _slug, render_html_tool


def _make_runtime(thread_id: str, outputs_dir: Path) -> MagicMock:
    runtime = MagicMock()
    runtime.context = {"thread_id": thread_id}
    return runtime


def _invoke(html: str, title: str, tmp_path: Path, thread_id: str = "test-thread", css: str = "", js: str = ""):
    with patch("aether.tools.builtins.render_html_tool.get_paths") as mock_get_paths:
        paths = MagicMock()
        paths.sandbox_outputs_dir.return_value = tmp_path / "outputs"
        mock_get_paths.return_value = paths

        runtime = _make_runtime(thread_id, tmp_path / "outputs")
        result = render_html_tool.invoke(
            {"html": html, "title": title, "css": css, "js": js},
            config={"configurable": {"thread_id": thread_id, "langgraph_runtime": runtime}},
        )
    return result


class TestSlug:
    def test_basic(self):
        assert _slug("My UI Panel") == "my-ui-panel"

    def test_special_chars(self):
        assert _slug("Hello! World?") == "hello-world"

    def test_truncate(self):
        long = "a" * 50
        assert len(_slug(long)) <= 32


class TestRenderHtmlTool:
    def test_tool_name(self):
        assert render_html_tool.name == "render_html"

    def test_returns_url(self, tmp_path):
        with patch("aether.tools.builtins.render_html_tool.get_paths") as mock_get_paths:
            paths = MagicMock()
            outputs = tmp_path / "outputs"
            paths.sandbox_outputs_dir.return_value = outputs
            mock_get_paths.return_value = paths

            runtime = MagicMock()
            runtime.context = {"thread_id": "test-thread"}

            from langchain_core.messages import ToolMessage
            from langgraph.types import Command

            result = render_html_tool.func(
                runtime=runtime,
                html="<p>Hello</p>",
                title="My UI",
                tool_call_id="call-1",
                css="",
                js="",
            )

            assert isinstance(result, Command)
            msgs = result.update["messages"]
            assert len(msgs) == 1
            url = msgs[0].content
            assert url.startswith("/api/threads/test-thread/artifacts/mnt/user-data/outputs/_ui/")
            assert url.endswith(".html")

    def test_writes_valid_html(self, tmp_path):
        with patch("aether.tools.builtins.render_html_tool.get_paths") as mock_get_paths:
            paths = MagicMock()
            outputs = tmp_path / "outputs"
            paths.sandbox_outputs_dir.return_value = outputs
            mock_get_paths.return_value = paths

            runtime = MagicMock()
            runtime.context = {"thread_id": "t1"}

            result = render_html_tool.func(
                runtime=runtime,
                html="<p>Test</p>",
                title="Test Panel",
                tool_call_id="call-2",
                css="body{color:red}",
                js="console.log('hi')",
            )

            url = result.update["messages"][0].content
            filename = url.split("/")[-1]
            written = (outputs / "_ui" / filename).read_text()

            assert "<!doctype html>" in written
            assert "<p>Test</p>" in written
            assert "body{color:red}" in written
            assert "console.log('hi')" in written
            assert "window.__aether" in written
            assert "ResizeObserver" in written

    def test_css_with_braces_does_not_crash(self, tmp_path):
        """CSS with {} must not break the template (was a str.format() bug)."""
        with patch("aether.tools.builtins.render_html_tool.get_paths") as mock_get_paths:
            paths = MagicMock()
            paths.sandbox_outputs_dir.return_value = tmp_path / "outputs"
            mock_get_paths.return_value = paths

            runtime = MagicMock()
            runtime.context = {"thread_id": "t2"}

            result = render_html_tool.func(
                runtime=runtime,
                html="<div>test</div>",
                title="CSS Test",
                tool_call_id="call-4",
                css="body { color: red; margin: 0; } .cls { font-size: 14px; }",
                js="if (true) { console.log('hello'); }",
            )

            url = result.update["messages"][0].content
            assert url.startswith("/api/threads/t2/artifacts/")
            filename = url.split("/")[-1]
            written = (tmp_path / "outputs" / "_ui" / filename).read_text()
            assert "body { color: red;" in written
            assert "console.log('hello')" in written

    def test_missing_thread_id(self, tmp_path):
        runtime = MagicMock()
        runtime.context = {}

        result = render_html_tool.func(
            runtime=runtime,
            html="<p>x</p>",
            title="x",
            tool_call_id="call-3",
        )
        assert "Error" in result.update["messages"][0].content
