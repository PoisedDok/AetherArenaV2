from langchain.tools import tool


@tool("render_ui", parse_docstring=True)
def render_ui_tool(url: str, title: str) -> str:
    """Render an interactive UI panel inline in the chat thread.

    Use when you want to surface a live interactive interface directly in the
    conversation. The panel renders as an iframe sandboxed from the host page.
    Only use with HTTPS URLs or absolute paths served by the backend.

    Args:
        url: HTTPS URL or absolute path (/api/...) of the UI resource to render.
        title: Short label (3-5 words) shown above the panel.
    """
    return f"UI_RENDERED: {url}"
