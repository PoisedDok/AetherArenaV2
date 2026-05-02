import re
import time
from typing import Annotated

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command
from langgraph.typing import ContextT

from aether.agents.thread_state import ThreadState
from aether.config.paths import get_paths

_TEMPLATE = """\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px; font-family: system-ui, sans-serif; }
  __CSS__
</style>
</head>
<body>
__HTML__
<script>
window.__aether = {
  send: function(type, payload) {
    parent.postMessage({ __aether: true, type: type, payload: payload }, "*");
  }
};
const __ro = new ResizeObserver(function() {
  parent.postMessage({ __aether: true, type: "resize", payload: { height: document.body.scrollHeight } }, "*");
});
__ro.observe(document.body);
__JS__
</script>
</body>
</html>
"""


def _slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower())[:32].strip("-")


@tool("render_html", parse_docstring=True)
def render_html_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    html: str,
    title: str,
    tool_call_id: Annotated[str, InjectedToolCallId],
    css: str = "",
    js: str = "",
) -> Command:
    """Generate and display an interactive HTML panel inline in the chat thread.

    Writes a self-contained HTML document to the thread artifact store and
    returns the URL at which it can be loaded in the inline iframe.

    Use when you need to render a chart, form, data visualization, or other
    interactive UI directly in the conversation. The panel is sandboxed from
    the host page.

    Args:
        html: The HTML body content (do NOT include <html>/<body> wrappers).
        title: Short label (3-5 words) shown above the panel.
        css: Optional CSS to inject in a <style> tag.
        js: Optional JavaScript to inject in a <script> tag.
    """
    thread_id = runtime.context.get("thread_id") if runtime.context else None
    if not thread_id:
        return Command(
            update={"messages": [ToolMessage("Error: thread_id not available", tool_call_id=tool_call_id)]}
        )

    try:
        outputs_dir = get_paths().sandbox_outputs_dir(thread_id)
        ui_dir = outputs_dir / "_ui"
        ui_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{_slug(title)}_{int(time.time() * 1000)}.html"
        content = (
            _TEMPLATE
            .replace("__HTML__", html)
            .replace("__CSS__", css)
            .replace("__JS__", js)
        )
        (ui_dir / filename).write_text(content, encoding="utf-8")

        url = f"/api/threads/{thread_id}/artifacts/mnt/user-data/outputs/_ui/{filename}"
        return Command(
            update={"messages": [ToolMessage(url, tool_call_id=tool_call_id)]}
        )
    except Exception as exc:
        return Command(
            update={"messages": [ToolMessage(f"Error: {exc}", tool_call_id=tool_call_id)]}
        )
