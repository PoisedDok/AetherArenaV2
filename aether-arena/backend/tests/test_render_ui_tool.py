from aether.tools.builtins.render_ui_tool import render_ui_tool


def test_render_ui_returns_ui_rendered_prefix():
    result = render_ui_tool.invoke({"url": "https://example.com/app", "title": "My App"})
    assert result.startswith("UI_RENDERED: ")
    assert "https://example.com/app" in result


def test_render_ui_tool_name():
    assert render_ui_tool.name == "render_ui"
