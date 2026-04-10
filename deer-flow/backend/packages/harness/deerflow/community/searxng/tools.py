import json
import logging
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any

import httpx
from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT

from deerflow.agents.thread_state import ThreadState
from deerflow.config import get_app_config
from deerflow.config.tool_config import ToolConfig
from deerflow.sandbox.tools import (
    VIRTUAL_PATH_PREFIX,
    get_thread_data,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# URL guardrails (SSRF prevention, private IP blocking, scheme checks)
# ---------------------------------------------------------------------------

ALLOWED_SCHEMES = {"http", "https"}
_BLOCKED_HOSTS = {
    "localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal",
}
_DANGEROUS_SUFFIXES = (
    ".local", ".internal", ".test", ".example", ".localhost",
)
_CLOUD_METADATA = {
    "metadata.google.internal", "169.254.169.254",
    "metadatapath", "router.local",
}
_MAX_REDIRECTS = 6
_MAX_RESPONSE_BYTES = 500_000  # 500 KB raw HTML cap
_WORKSPACE_DIR = "web_fetched"  # subdirectory inside thread workspace

# Browser-realistic headers used for all outbound fetches.
# A generic bot UA is immediately flagged by Cloudflare / WAF — use Chrome on Windows.
_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Cache-Control": "max-age=0",
}

# Fallback UA used on 403 retry (Firefox on macOS -- different fingerprint)
_FALLBACK_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) "
        "Gecko/20100101 Firefox/125.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
}

# HTTP status codes that indicate the server is actively blocking bots.
# On these we retry once with the fallback UA; if still blocked, report clearly.
_BOT_BLOCKED_STATUSES = {403, 429, 406, 503}


def _validate_url(raw: str) -> str | None:
    """Return error message on rejection, None on success."""
    url = (raw or "").strip()
    if not url:
        return "Error: URL is empty or whitespace"

    try:
        scheme = url.split(":", 1)[0].lower()
    except ValueError:
        return f"Error: Cannot parse URL scheme from '{url}'"
    if scheme not in ALLOWED_SCHEMES:
        return f"Error: Denied -- unsafe scheme '{scheme}'. Only http/https allowed."

    try:
        parsed = httpx.URL(url)
    except Exception as exc:
        return f"Error: Invalid URL -- {exc}"

    host = (parsed.host or "").lower()
    if not host:
        return "Error: URL has no host component"
    if host in _BLOCKED_HOSTS:
        return f"Error: Denied -- internal host '{host}' is not accessible."
    if any(host.endswith(s) for s in _DANGEROUS_SUFFIXES):
        return f"Error: Denied -- internal TLD '{host}' is not accessible."
    if host in _CLOUD_METADATA:
        return f"Error: Denied -- cloud metadata endpoint '{host}'"
    if host.startswith("10.") or host.startswith("192.168."):
        return f"Error: Denied -- private network IP '{host}'"

    return None


def _safe_content_type(ct: str) -> bool:
    """Return True only for content types that contain parseable text/HTML/JSON."""
    c = ct.lower().split(";")[0].strip()  # strip charset/params
    _SAFE_TYPES = {
        "text/html",
        "application/xhtml+xml",
        "application/json",
        "text/plain",
        "text/xml",
        "application/xml",
        "application/atom+xml",
        "application/rss+xml",
        "application/ld+json",
    }
    if c in _SAFE_TYPES:
        return True
    # Allow any text/* subtype but NOT binary application/* like octet-stream, pdf, zip, etc.
    return c.startswith("text/")


def _extract_domain(url: str) -> str:
    try:
        return (httpx.URL(url).host or "").replace(".", "_")[:64]
    except Exception:
        return "site"


def _do_fetch(url: str, timeout: int, headers: dict, verify: bool = True) -> tuple[str | None, int | None, str | None]:
    """Low-level fetch. Returns (body, status_code, error_message). Exactly one of body/error is set."""
    try:
        with httpx.Client(
            follow_redirects=True,
            max_redirects=_MAX_REDIRECTS,
            headers=headers,
            timeout=timeout,
            verify=verify,
        ) as client:
            resp = client.get(url)
            if resp.status_code >= 400:
                return None, resp.status_code, f"HTTP {resp.status_code} from {resp.url}"
            ct = resp.headers.get("content-type", "")
            if not _safe_content_type(ct):
                return None, resp.status_code, f"unsafe content-type '{ct}'"
            n = len(resp.content)
            body = resp.content[:_MAX_RESPONSE_BYTES].decode("utf-8", errors="replace") if n > _MAX_RESPONSE_BYTES else resp.text
            return body, resp.status_code, None
    except httpx.TooManyRedirects:
        return None, None, f"too many redirects ({_MAX_REDIRECTS} max)"
    except httpx.ReadTimeout:
        return None, None, f"timed out after {timeout}s"
    except httpx.RequestError as exc:
        return None, None, str(exc)
    except Exception as exc:
        return None, None, str(exc)


def _fetch_html(url: str, timeout: int) -> tuple[str | None, str | None]:
    """Fetch raw HTML from a URL. Returns (html_or_none, error_or_none).

    Strategy:
    1. Try with Chrome browser headers (realistic UA reduces bot-detection blocks)
    2. On SSL error → retry without cert verification
    3. On bot-block status (403/429/406/503) → retry with Firefox UA
    4. Still blocked → return actionable error message
    """
    body, status, err = _do_fetch(url, timeout, _BROWSER_HEADERS, verify=True)

    if err and ("SSL" in err or "CERTIFICATE" in err.upper()):
        logger.warning("SSL error for %s, retrying without verification", url)
        body, status, err = _do_fetch(url, timeout, _BROWSER_HEADERS, verify=False)

    if err and status in _BOT_BLOCKED_STATUSES:
        logger.info("HTTP %s for %s with Chrome UA, retrying with Firefox UA", status, url)
        body, status, err = _do_fetch(url, timeout, _FALLBACK_HEADERS, verify=True)
        if err and ("SSL" in err or "CERTIFICATE" in err.upper()):
            body, status, err = _do_fetch(url, timeout, _FALLBACK_HEADERS, verify=False)

    if err:
        if status in _BOT_BLOCKED_STATUSES:
            return None, (
                f"HTTP {status} from {url}: the site is actively blocking automated access "
                f"(bot protection / WAF). Try web_search to find cached or summarized content instead."
            )
        return None, err

    return body, None


def _fetch_html_no_verify(url: str, timeout: int) -> tuple[str | None, str | None]:
    """Kept for external callers; wraps _do_fetch without SSL verification."""
    body, _status, err = _do_fetch(url, timeout, _BROWSER_HEADERS, verify=False)
    return body, err


def _html_to_md(html: str) -> str:
    """Convert HTML into markdown via markitdown (same engine as uploaded PDF/DOCX/PPTX/XLSX).

    markitdown accepts a file path or URL, not raw HTML, so we write to a
    temporary .html file and convert -- identical to the uploads pipeline.
    """
    try:
        from markitdown import MarkItDown
    except ImportError as exc:
        raise RuntimeError(f"markitdown is not installed: {exc}")

    with tempfile.NamedTemporaryFile(suffix=".html", mode="wb", delete=False) as tf:
        tf.write(html.encode("utf-8"))
        tf.flush()
        md = MarkItDown()
        result = md.convert(tf.name)
    return result.text_content


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# tool: web_search (SearXNG meta-search)
# ---------------------------------------------------------------------------

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
        max_results = max(1, int(extra["max_results"]))

    try:
        resp = httpx.get(
            f"{_get_searxng_url().rstrip('/')}/search",
            params={"q": query, "format": "json"},
            timeout=15.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)

    results = []
    for r in (data.get("results") or [])[:max_results]:
        if not isinstance(r, dict):
            continue
        entry = {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "snippet": r.get("content", ""),
        }
        if r.get("img_src"):
            entry["img_src"] = r["img_src"]
        if r.get("thumbnail_src"):
            entry["thumbnail_src"] = r["thumbnail_src"]
        results.append(entry)
    return json.dumps(results, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# tool: web_fetch -- self-hosted, markitdown-converted, workspace-saved
# ---------------------------------------------------------------------------

@tool("web_fetch", parse_docstring=True)
def web_fetch_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    url: str,
) -> str:
    """Fetch a web page, convert to markdown, and save to the thread workspace.

    Uses the **same markitdown conversion pipeline** that uploaded documents
    (PDF, PPTX, DOCX, XLSX) go through -- zero cloud dependencies.

    **IMPORTANT**: The fetched page is SAVED as a .md file. Do NOT try to
    dump the full content into context. Instead, use the `read_file` tool
    with the returned `virtual_path` to read specific sections when needed.

    Only fetch EXACT URLs that come from the user or from `web_search`.
    This tool cannot access authenticated or login-walled content.
    Do NOT add www. to URLs that do not already have it.
    URL must include the scheme: `https://example.com` is valid; `example.com` is not.

    Args:
        url: The URL to fetch and scrape.
    """
    # 1. Validate URL (SSRF guardrails)
    err = _validate_url(url)
    if err:
        return err

    # 2. Resolve thread data (requires agent running in thread context)
    thread_data = get_thread_data(runtime)
    if thread_data is None:
        return "Error: Thread data not available. Ensure the agent is running within a thread context."

    workspace = thread_data.get("workspace_path")
    if not workspace:
        return "Error: workspace_path not found in thread data."

    # 3. Determine timeout from tool config
    extra = _tool_extra(get_app_config().get_tool_config("web_fetch"))
    timeout = int(extra.get("timeout", 10))

    # 4. Fetch HTML
    html, fetch_err = _fetch_html(url, timeout)
    if fetch_err:
        # Return the error directly -- _fetch_html already formats actionable messages
        # for bot-blocked sites (403/429) with guidance to use web_search instead.
        return fetch_err
    if not html or not html.strip():
        return f"Error: Page returned no content for {url}. The page may require JavaScript or authentication."

    # 5. Convert to markdown (markitdown engine -- same pipeline as uploaded docs)
    try:
        markdown = _html_to_md(html)
    except Exception as e:
        logger.error("markitdown conversion failed for %s: %s", url, e)
        return f"Conversion error: {e}"
    if not markdown or not markdown.strip():
        return f"Error: Page has no extractable text: {url}"

    # 6. Save .md to thread workspace subdirectory
    domain = _extract_domain(url)
    fname = f"{domain}_{uuid.uuid4().hex[:8]}.md"
    out_dir = Path(workspace) / _WORKSPACE_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    md_file_path = out_dir / fname

    try:
        md_file_path.write_text(markdown, encoding="utf-8")
    except OSError as e:
        return f"Error: Failed to write markdown file: {e}"

    # The workspace directory is shared between the gateway and the sandbox container
    # (via host volume mounts). No additional sandbox sync is needed.

    virtual_md_path = f"{VIRTUAL_PATH_PREFIX}/workspace/{_WORKSPACE_DIR}/{fname}"

    # 7. Return compact reference -- LLM uses read_file on demand
    char_count = len(markdown)
    word_count = len(markdown.split())
    line_count = markdown.count("\n") + 1

    return (
        f"Web page fetched and saved as markdown.\n\n"
        f"**File**: `{fname}`\n"
        f"**Size**: {char_count:,} chars, {word_count:,} words, {line_count:,} lines\n"
        f"**URL**: {url}\n"
        f"**Virtual path**: `{virtual_md_path}`\n\n"
        f"**Next steps**: Use the `read_file` tool with the virtual path above to read "
        f"specific sections when you need details. Do NOT dump the entire file into context.\n"
    )
