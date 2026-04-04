import json
import os
from typing import Any

import httpx
from langchain.tools import tool

from deerflow.config import get_app_config
from deerflow.config.tool_config import ToolConfig


def _tool_extra(config: ToolConfig | None) -> dict[str, Any]:
    if config is None:
        return {}
    extra = getattr(config, "model_extra", None)
    return dict(extra) if extra else {}


def _get_searxng_url() -> str:
    config = get_app_config().get_tool_config("web_search")
    extra = _tool_extra(config)
    if "url" in extra and extra.get("url"):
        return str(extra["url"])
    return os.environ.get("SEARXNG_URL", "http://127.0.0.1:2030")


@tool("web_search", parse_docstring=True)
def web_search_tool(query: str) -> str:
    """Search the web using SearXNG (self-hosted).

    Args:
        query: The query to search for.
    """
    config = get_app_config().get_tool_config("web_search")
    extra = _tool_extra(config)
    max_results = 8
    if "max_results" in extra:
        max_results = int(extra["max_results"])

    url = f"{_get_searxng_url().rstrip('/')}/search"
    try:
        resp = httpx.get(
            url,
            params={"q": query, "format": "json"},
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)

    raw = data.get("results") or []
    results = []
    for r in raw[:max_results]:
        if not isinstance(r, dict):
            continue
        entry: dict[str, str] = {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "snippet": r.get("content", ""),
        }
        # SearXNG includes img_src for image-category results
        if r.get("img_src"):
            entry["img_src"] = r["img_src"]
        if r.get("thumbnail_src"):
            entry["thumbnail_src"] = r["thumbnail_src"]
        results.append(entry)
    return json.dumps(results, indent=2, ensure_ascii=False)
