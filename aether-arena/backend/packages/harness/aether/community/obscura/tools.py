"""Obscura web tools: web_fetch, web_extract, web_js_eval, web_links.

Fetches and analyses web pages via the Obscura headless browser CDP server
(self-hosted, Apache-2.0, zero cloud dependencies). Obscura renders JavaScript,
applies TLS fingerprint impersonation and tracker blocking in stealth mode.

Architecture fit:
  - SearXNG handles search  → finds URLs
  - Obscura handles fetch   → renders pages stealthily
  Both are self-hosted; neither requires cloud API keys.

Config wiring (config.yaml):
  - name: web_fetch
    use: aether.community.obscura.tools:web_fetch_tool
    timeout: 15          # seconds per fetch
    url: $OBSCURA_URL    # resolved from env; default http://127.0.0.1:9222

Environment variable:
  OBSCURA_URL — base URL of the Obscura CDP HTTP server, e.g. http://obscura:9222
  The tool converts this to a WebSocket URL automatically using httpx.URL parsing.

CDP flow (shared by all tools via _cdp_page context manager):
  1. Target.createTarget  → get targetId
  2. Target.attachToTarget → get sessionId
  3. Page.enable
  4. Page.navigate        (waitUntil: load)
  --- tool-specific CDP calls happen here ---
  5. Target.closeTarget   (always — no context leaks)

Security:
  - URL validated at Python boundary before any CDP call (SSRF guardrails)
  - Obscura container runs as non-root user (see obscura/Dockerfile)
  - CDP port 9222 is internal-only; never routed through nginx
  - Target always closed in finally block even on error
"""

import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import websockets
from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT
from markdownify import markdownify as _markdownify

from aether.agents.thread_state import ThreadState
from aether.config import get_app_config
from aether.config.tool_config import ToolConfig
from aether.sandbox.tools import (
    VIRTUAL_PATH_PREFIX,
    get_thread_data,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Defaults — env var / config overrides these; never hardcode in call sites
# ---------------------------------------------------------------------------

_OBSCURA_DEFAULT_URL = "http://127.0.0.1:9222"  # local dev fallback

# ---------------------------------------------------------------------------
# SSRF guardrails — identical ruleset to searxng/tools.py
# ---------------------------------------------------------------------------

_ALLOWED_SCHEMES = {"http", "https"}
_BLOCKED_HOSTS = {
    "localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal",
}
_DANGEROUS_SUFFIXES = (".local", ".internal", ".test", ".example", ".localhost")
_CLOUD_METADATA = {
    "metadata.google.internal", "169.254.169.254",
    "metadatapath", "router.local",
}


def _validate_url(raw: str) -> str | None:
    """Return an error message if the URL is rejected, None if safe.

    Checks scheme whitelist, blocked hosts, internal TLDs, cloud metadata
    endpoints, and RFC 1918 private IP ranges.
    """
    url = (raw or "").strip()
    if not url:
        return "Error: URL is empty or whitespace."

    scheme = url.split(":", 1)[0].lower()
    if scheme not in _ALLOWED_SCHEMES:
        return f"Error: Denied — unsafe scheme '{scheme}'. Only http/https are allowed."

    try:
        parsed = httpx.URL(url)
    except Exception as exc:
        return f"Error: Invalid URL — {exc}"

    host = (parsed.host or "").lower()
    if not host:
        return "Error: URL has no host component."
    if host in _BLOCKED_HOSTS:
        return f"Error: Denied — internal host '{host}' is not accessible."
    if any(host.endswith(s) for s in _DANGEROUS_SUFFIXES):
        return f"Error: Denied — internal TLD '{host}' is not accessible."
    if host in _CLOUD_METADATA:
        return f"Error: Denied — cloud metadata endpoint '{host}'."
    # RFC 1918 private ranges
    if (
        host.startswith("10.")
        or host.startswith("192.168.")
        or _is_rfc1918_172(host)
    ):
        return f"Error: Denied — private network address '{host}'."

    return None


def _is_rfc1918_172(host: str) -> bool:
    """Return True for 172.16.0.0/12 addresses (172.16.x.x – 172.31.x.x)."""
    if not host.startswith("172."):
        return False
    parts = host.split(".")
    if len(parts) < 2:
        return False
    try:
        second = int(parts[1])
        return 16 <= second <= 31
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# CDP helpers
# ---------------------------------------------------------------------------

def _build_ws_url(base_url: str) -> str:
    """Convert an HTTP base URL to its WebSocket CDP endpoint.

    Uses httpx.URL for proper parsing instead of string replacement.
    Preserves host, port, and any path prefix.

    Example: http://obscura:9222  →  ws://obscura:9222/devtools/browser
    """
    parsed = httpx.URL(base_url.rstrip("/"))
    ws_scheme = "wss" if parsed.scheme == "https" else "ws"
    host = parsed.host
    port = parsed.port
    host_part = f"{host}:{port}" if port else host
    return f"{ws_scheme}://{host_part}/devtools/browser"


def _cdp_msg(cmd_id: int, method: str, params: dict, session_id: str | None = None) -> str:
    msg: dict[str, Any] = {"id": cmd_id, "method": method, "params": params}
    if session_id:
        msg["sessionId"] = session_id
    return json.dumps(msg)


def _extract_domain(url: str) -> str:
    try:
        return (httpx.URL(url).host or "").replace(".", "_")[:64]
    except Exception:
        return "site"


def _html_to_md(html: str) -> str:
    """Convert HTML to markdown via markdownify. Falls back to raw HTML on error."""
    try:
        return _markdownify(html, heading_style="ATX").strip() or html
    except Exception:
        return html


# ---------------------------------------------------------------------------
# Shared CDP session context manager — one implementation, used by all tools
# ---------------------------------------------------------------------------

@asynccontextmanager
async def _cdp_page(url: str, *, obscura_url: str, timeout: int):
    """Async context manager: connect, create target, navigate, yield, close.

    Opens a WebSocket to the Obscura CDP server, creates a fresh browser tab,
    navigates to `url`, then yields `(send_recv, session_id)` for the caller
    to issue tool-specific CDP commands. Always closes the target on exit.

    Propagates:
      OSError          — WebSocket connection failed (Obscura not running)
      RuntimeError     — CDP command returned an error response
      asyncio.TimeoutError — a CDP recv timed out
    """
    ws_url = _build_ws_url(obscura_url)
    cmd_id = 0
    target_id: str | None = None

    def _next_id() -> int:
        nonlocal cmd_id
        cmd_id += 1
        return cmd_id

    async with websockets.connect(ws_url, open_timeout=timeout) as ws:

        async def send_recv(method: str, params: dict, sid: str | None = None) -> dict:
            """Send a CDP command; drain messages until the matching response arrives."""
            mid = _next_id()
            await ws.send(_cdp_msg(mid, method, params, session_id=sid))
            # Obscura emits lifecycle events before command responses — drain up to
            # 512 messages to find the one with the matching id. Complex SPAs (React,
            # Next.js) fire many network/frame/lifecycle events before the navigate
            # response arrives; 64 was too low for real-world pages.
            for _ in range(512):
                raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                msg = json.loads(raw)
                if msg.get("id") == mid:
                    if "error" in msg:
                        raise RuntimeError(
                            f"CDP error for {method}: "
                            f"{msg['error'].get('message', str(msg['error']))}"
                        )
                    return msg.get("result", {})
            raise RuntimeError(f"No CDP response for {method} (id={mid})")

        try:
            # 1. Open a fresh browser target (tab)
            res = await send_recv("Target.createTarget", {"url": "about:blank"})
            target_id = res["targetId"]

            # 2. Attach to get a session handle
            res = await send_recv("Target.attachToTarget", {"targetId": target_id, "flatten": True})
            session_id = res["sessionId"]

            # 3. Enable Page domain events
            await send_recv("Page.enable", {}, sid=session_id)

            # 4. Navigate — networkidle0 waits for all in-flight network requests to settle
            # (up to 5 s after load), which gives SPAs time to complete async data fetches.
            await send_recv("Page.navigate", {"url": url, "waitUntil": "networkidle0"}, sid=session_id)

            yield send_recv, session_id

        finally:
            # Always close the target — never leak browser contexts
            if target_id:
                try:
                    close_id = _next_id()
                    await ws.send(_cdp_msg(close_id, "Target.closeTarget", {"targetId": target_id}))
                    await asyncio.wait_for(ws.recv(), timeout=3)
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Config helpers — follow exact patterns from searxng/tools.py
# ---------------------------------------------------------------------------

def _tool_extra(config: ToolConfig | None) -> dict[str, Any]:
    if config is None:
        return {}
    extra = getattr(config, "model_extra", None)
    return dict(extra) if extra else {}


def _get_obscura_url() -> str:
    """Resolve Obscura base URL from tool config, then env var, then default.

    Priority matches how SearXNG resolves SEARXNG_URL:
      1. config.yaml  web_fetch.url  (supports $ENV_VAR substitution)
      2. OBSCURA_URL  environment variable
      3. _OBSCURA_DEFAULT_URL  (local dev fallback: http://127.0.0.1:9222)
    """
    config = get_app_config().get_tool_config("web_fetch")
    extra = _tool_extra(config)
    if extra.get("url"):
        return str(extra["url"])
    return os.environ.get("OBSCURA_URL", _OBSCURA_DEFAULT_URL)


# ---------------------------------------------------------------------------
# tool: web_fetch — full page → markdown
# ---------------------------------------------------------------------------

async def _obscura_fetch(
    url: str,
    *,
    obscura_url: str,
    timeout: int,
) -> tuple[str | None, str | None]:
    """Fetch a URL via Obscura CDP. Returns (markdown, None) or (None, error).

    All I/O is async. Called via asyncio.run() from the synchronous tool wrapper.
    """
    try:
        async with _cdp_page(url, obscura_url=obscura_url, timeout=timeout) as (send_recv, session_id):
            # ── Level 1: LP.getMarkdown ──────────────────────────────────────────────
            # Obscura's built-in readability extractor (now with SPA fallbacks in Rust).
            # Level A (Rust): semantic HTML → clean markdown.
            # Level B (Rust): DOM text-node walker, skips scripts.
            # Level C (Rust): RSC flight data (__next_f) + __NEXT_DATA__ extraction.
            res = await send_recv("LP.getMarkdown", {}, sid=session_id)
            markdown = res.get("markdown", "").strip()

            if not markdown or len(markdown.split()) < 10:
                # ── Level 2: LP.getInnerText ─────────────────────────────────────────
                # New Obscura command: walks the DOM tree and returns visible text only
                # (excludes <script>/<style> content, unlike browser's non-standard innerText).
                res = await send_recv("LP.getInnerText", {}, sid=session_id)
                inner = res.get("text", "").strip()
                if inner and len(inner.split()) > len(markdown.split()):
                    markdown = inner

            if not markdown or len(markdown.split()) < 10:
                # ── Level 3: full-page HTML → markdownify ────────────────────────────
                # Handles SPAs that rendered traditional DOM elements. Markdownify
                # strips scripts/styles and converts remaining HTML to readable markdown.
                res = await send_recv("Runtime.evaluate", {
                    "expression": "document.documentElement.outerHTML",
                    "returnByValue": True,
                }, sid=session_id)
                html = (res.get("result", {}) or {}).get("value", "").strip()
                if html:
                    converted = _html_to_md(html)
                    if converted and len(converted.split()) > len(markdown.split()):
                        markdown = converted

            if not markdown or len(markdown.split()) < 10:
                # ── Level 4: DOM tree walk via CDP ───────────────────────────────────
                # Walk the Obscura DOM node tree directly. Works even when JavaScript
                # properties like childNodes are broken — reads the internal Rust DOM.
                doc = await send_recv("DOM.getDocument", {"depth": -1}, sid=session_id)
                root = doc.get("root", {}) or {}
                _SKIP_TAGS = {"script", "style", "noscript", "head", "meta", "link"}

                def _walk(node: dict, texts: list) -> None:
                    if not node:
                        return
                    if node.get("nodeType") == 3:  # text node
                        val = (node.get("nodeValue") or "").strip()
                        if len(val) > 2 and any(c.isalpha() for c in val):
                            texts.append(val)
                        return
                    tag = (node.get("localName") or node.get("nodeName") or "").lower()
                    if tag in _SKIP_TAGS:
                        return
                    for child in (node.get("children") or []):
                        _walk(child, texts)

                texts: list = []
                _walk(root, texts)
                dom_text = "\n".join(texts).strip()
                if dom_text and len(dom_text.split()) > len(markdown.split()):
                    markdown = dom_text

            if not markdown or len(markdown.split()) < 5:
                # ── Level 5: meta tags + JSON-LD ─────────────────────────────────────
                # Pure metadata extraction — always available regardless of JS rendering.
                _JS_META = r"""(function(){
  var out=[];
  var t=document.title; if(t) out.push('# '+t);
  var metas={description:1,'og:title':1,'og:description':1,'og:site_name':1,'twitter:description':1};
  document.querySelectorAll('meta').forEach(function(m){
    var n=m.getAttribute('name')||m.getAttribute('property')||'';
    var c=m.getAttribute('content')||'';
    if(metas[n]&&c) out.push(n+': '+c);
  });
  document.querySelectorAll('script[type="application/ld+json"]').forEach(function(s){
    try{
      var d=JSON.parse(s.textContent);
      if(d.description) out.push('Description: '+d.description);
      if(d.name&&d.description) out.push('Organization: '+d.name);
      if(Array.isArray(d['@graph'])) d['@graph'].forEach(function(n){
        if(n.description) out.push((n['@type']||'Item')+': '+n.description);
      });
    }catch(e){}
  });
  return out.join('\n\n');
})()"""
                res = await send_recv("Runtime.evaluate", {
                    "expression": _JS_META,
                    "returnByValue": True,
                }, sid=session_id)
                meta_text = ((res.get("result", {}) or {}).get("value") or "").strip()
                if meta_text:
                    markdown = meta_text

            if not markdown or not markdown.strip():
                return None, (
                    f"Error: Page returned no extractable text for {url}. "
                    "The page may require authentication or render entirely in canvas/WebGL."
                )
            return markdown, None
    except asyncio.TimeoutError:
        return None, (
            f"Error: Timed out after {timeout}s fetching {url} via Obscura. "
            "The page is too slow, requires authentication, or actively blocks automated access. "
            "Try: (1) web_search for cached/summarized content about this topic, "
            "(2) web_extract with a specific CSS selector on a lighter page, "
            "(3) bash with curl for plain JSON APIs that don't need JS rendering."
        )
    except RuntimeError as exc:
        return None, f"Error: {exc}"
    except OSError as exc:
        return None, (
            f"Error: Cannot connect to Obscura CDP server at {obscura_url} — {exc}. "
            "Ensure the obscura service is running (check: docker compose ps)."
        )
    except Exception as exc:
        return None, f"Error: Obscura connection failed — {exc}"


def _http_fallback_fetch(url: str, timeout: int) -> tuple[str | None, str | None]:
    """Plain HTTP fetch fallback (no JS rendering) via markitdown.

    Used when Obscura times out or is unavailable. Works for static pages,
    RSS feeds, plain-text APIs, and sites that don't require JavaScript.
    Returns (markdown, None) or (None, error).
    """
    try:
        from aether.community.searxng.tools import _fetch_html, _html_to_md as _searxng_html_to_md
        html, err = _fetch_html(url, timeout)
        if err:
            return None, err
        if not html or not html.strip():
            return None, f"Error: Page returned no content for {url}."
        md = _searxng_html_to_md(html)
        return (md if md and md.strip() else None), (None if md and md.strip() else f"Error: No extractable text at {url}.")
    except Exception as exc:
        return None, f"HTTP fallback failed: {exc}"


def _run_web_fetch(url: str, workspace: str, obscura_url: str, timeout: int) -> str:
    """Pure inner function: validate URL, call CDP, write file, return result string.

    Extracted from the LangChain tool so it can be unit-tested without a
    live ToolRuntime.  All logic lives here; the @tool wrapper below only
    resolves runtime context and config then delegates.
    """
    # 1. SSRF guardrails — must run before any network call
    err = _validate_url(url)
    if err:
        return err

    # 2. CDP fetch — asyncio.run() is safe: LangGraph invokes tools from threads
    markdown, fetch_err = asyncio.run(
        _obscura_fetch(url, obscura_url=obscura_url, timeout=timeout)
    )

    # 3. HTTP fallback when Obscura times out (static pages, JSON APIs, slow-rendering sites)
    if fetch_err and fetch_err.startswith("Error: Timed out"):
        logger.info("Obscura timed out for %s, trying plain HTTP fallback", url)
        fallback_md, fallback_err = _http_fallback_fetch(url, min(timeout, 10))
        if fallback_md and fallback_md.strip():
            markdown = fallback_md
            fetch_err = None  # fallback succeeded
        else:
            # Return original Obscura timeout error (more informative)
            return fetch_err

    if fetch_err:
        return fetch_err
    if not markdown or not markdown.strip():
        return f"Error: Page has no extractable text: {url}"

    # 3. Write to thread workspace
    domain = _extract_domain(url)
    fname = f"{domain}_{uuid.uuid4().hex[:8]}.md"
    out_dir = Path(workspace) / "web_fetched"
    out_dir.mkdir(parents=True, exist_ok=True)
    md_file = out_dir / fname

    try:
        md_file.write_text(markdown, encoding="utf-8")
    except OSError as exc:
        return f"Error: Failed to write markdown file — {exc}"

    virtual_md_path = f"{VIRTUAL_PATH_PREFIX}/workspace/web_fetched/{fname}"
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


@tool("web_fetch", parse_docstring=True)
def web_fetch_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    url: str,
) -> str:
    """Fetch a web page using a stealth headless browser, convert to markdown, and save to the thread workspace.

    Uses **Obscura** — a self-hosted Rust headless browser with anti-fingerprinting
    and tracker blocking. Renders JavaScript-heavy pages and bypasses WAF/bot-detection
    that blocks plain HTTP fetches. Zero cloud dependencies.

    **IMPORTANT**: The fetched page is SAVED as a .md file — do NOT try to dump the
    full content into context. Use the `read_file` tool with the returned `virtual_path`
    to read specific sections when needed.

    Only fetch EXACT URLs that come from the user or from `web_search`.
    This tool cannot access authenticated or login-walled content.
    Do NOT add www. to URLs that do not already have it.
    URL must include the scheme: `https://example.com` is valid; `example.com` is not.

    Args:
        url: The URL to fetch and render.
    """
    thread_data = get_thread_data(runtime)
    if thread_data is None:
        return "Error: Thread data not available. Ensure the agent is running within a thread context."
    workspace = thread_data.get("workspace_path")
    if not workspace:
        return "Error: workspace_path not found in thread data."

    extra = _tool_extra(get_app_config().get_tool_config("web_fetch"))
    timeout = int(extra.get("timeout", 15))
    obscura_url = _get_obscura_url()

    return _run_web_fetch(url=url, workspace=workspace, obscura_url=obscura_url, timeout=timeout)


# ---------------------------------------------------------------------------
# tool: web_extract — pull a specific CSS selector from a rendered page
# ---------------------------------------------------------------------------

async def _obscura_extract(
    url: str,
    selector: str,
    *,
    obscura_url: str,
    timeout: int,
) -> tuple[str | None, str | None]:
    """Extract outerHTML of a CSS selector from a rendered page. Returns (html, error).

    CDP sequence (after shared navigate):
      DOM.getDocument   → root nodeId
      DOM.querySelector → element nodeId (0 = not found)
      DOM.getOuterHTML  → raw HTML string
    """
    try:
        async with _cdp_page(url, obscura_url=obscura_url, timeout=timeout) as (send_recv, session_id):
            doc = await send_recv("DOM.getDocument", {"depth": 1}, sid=session_id)
            root_id = doc.get("root", {}).get("nodeId", 1)

            res = await send_recv("DOM.querySelector", {"nodeId": root_id, "selector": selector}, sid=session_id)
            node_id = res.get("nodeId", 0)
            if not node_id:
                return None, f"Error: Selector '{selector}' not found on {url}."

            res = await send_recv("DOM.getOuterHTML", {"nodeId": node_id}, sid=session_id)
            html = res.get("outerHTML", "").strip()
            if not html:
                return None, f"Error: Selector '{selector}' matched but returned empty content."
            return html, None
    except asyncio.TimeoutError:
        return None, f"Error: Timed out after {timeout}s extracting '{selector}' from {url}."
    except RuntimeError as exc:
        return None, f"Error: {exc}"
    except OSError as exc:
        return None, f"Error: Cannot connect to Obscura at {obscura_url} — {exc}. Check: docker compose ps"
    except Exception as exc:
        return None, f"Error: Obscura connection failed — {exc}"


def _run_web_extract(url: str, selector: str, workspace: str, obscura_url: str, timeout: int) -> str:
    """SSRF-validate → CDP extract → convert HTML→markdown → write file → return path."""
    err = _validate_url(url)
    if err:
        return err

    html, fetch_err = asyncio.run(_obscura_extract(url, selector, obscura_url=obscura_url, timeout=timeout))
    if fetch_err:
        return fetch_err
    if not html or not html.strip():
        return f"Error: No content from selector '{selector}' at {url}."

    markdown = _html_to_md(html)

    safe_sel = selector.replace(" ", "_").replace("#", "id_").replace(".", "cls_")[:32]
    fname = f"{_extract_domain(url)}_{safe_sel}_{uuid.uuid4().hex[:6]}.md"
    out_dir = Path(workspace) / "web_extracted"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / fname).write_text(markdown, encoding="utf-8")

    virtual_path = f"{VIRTUAL_PATH_PREFIX}/workspace/web_extracted/{fname}"
    return (
        f"Selector extracted and saved as markdown.\n\n"
        f"**Selector**: `{selector}`\n"
        f"**File**: `{fname}`\n"
        f"**Size**: {len(markdown):,} chars, {len(markdown.split()):,} words\n"
        f"**URL**: {url}\n"
        f"**Virtual path**: `{virtual_path}`\n\n"
        f"Use `read_file` with the virtual path to read the content.\n"
    )


@tool("web_extract", parse_docstring=True)
def web_extract_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    url: str,
    selector: str,
) -> str:
    """Extract a specific element from a rendered web page by CSS selector and save as markdown.

    Faster than `web_fetch` when you only need one section of a page — only the
    matched element is extracted, not the whole document. JavaScript is fully
    rendered before extraction.

    Use when you know the CSS selector for the content you need:
    "article" for news body, "#main" for main content, ".price" for a price,
    "table" for tabular data, "nav" for navigation links.

    Args:
        url: The URL to load. Must include scheme (https://...).
        selector: CSS selector for the element to extract (e.g. "article", "#content", "table.results").
    """
    thread_data = get_thread_data(runtime)
    if thread_data is None:
        return "Error: Thread data not available."
    workspace = thread_data.get("workspace_path")
    if not workspace:
        return "Error: workspace_path not found in thread data."

    extra = _tool_extra(get_app_config().get_tool_config("web_extract"))
    timeout = int(extra.get("timeout", 15))
    return _run_web_extract(url=url, selector=selector, workspace=workspace,
                            obscura_url=_get_obscura_url(), timeout=timeout)


# ---------------------------------------------------------------------------
# tool: web_js_eval — run JavaScript on a rendered page, return the result
# ---------------------------------------------------------------------------

# Absolute maximum expression length — prevents accidentally sending megabytes
_MAX_JS_EXPR_LEN = 4_000


async def _obscura_js_eval(
    url: str,
    expression: str,
    *,
    obscura_url: str,
    timeout: int,
) -> tuple[str | None, str | None]:
    """Evaluate JS on a rendered page. Returns (result_string, error).

    CDP sequence (after shared navigate):
      Runtime.evaluate → result value or exceptionDetails
    """
    try:
        async with _cdp_page(url, obscura_url=obscura_url, timeout=timeout) as (send_recv, session_id):
            res = await send_recv("Runtime.evaluate", {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": True,
            }, sid=session_id)

            if "exceptionDetails" in res:
                exc_text = res["exceptionDetails"].get("text") or str(res["exceptionDetails"])
                return None, f"Error: JavaScript exception — {exc_text}"

            val = res.get("result", {}).get("value")
            if val is None:
                val = res.get("result", {}).get("description", "undefined")
            return str(val), None
    except asyncio.TimeoutError:
        return None, f"Error: Timed out after {timeout}s evaluating JS on {url}."
    except RuntimeError as exc:
        return None, f"Error: {exc}"
    except OSError as exc:
        return None, f"Error: Cannot connect to Obscura at {obscura_url} — {exc}. Check: docker compose ps"
    except Exception as exc:
        return None, f"Error: Obscura connection failed — {exc}"


def _run_web_js_eval(url: str, expression: str, workspace: str, obscura_url: str, timeout: int) -> str:
    """SSRF-validate → guard expression length → CDP eval → return result."""
    err = _validate_url(url)
    if err:
        return err

    if len(expression) > _MAX_JS_EXPR_LEN:
        return f"Error: JavaScript expression too long ({len(expression)} chars, max {_MAX_JS_EXPR_LEN})."

    result, eval_err = asyncio.run(_obscura_js_eval(url, expression, obscura_url=obscura_url, timeout=timeout))
    if eval_err:
        return eval_err

    return (
        f"JavaScript evaluated successfully.\n\n"
        f"**Expression**: `{expression[:120]}{'...' if len(expression) > 120 else ''}`\n"
        f"**URL**: {url}\n"
        f"**Result**:\n```\n{result}\n```\n"
    )


@tool("web_js_eval", parse_docstring=True)
def web_js_eval_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    url: str,
    expression: str,
) -> str:
    """Evaluate a JavaScript expression on a fully rendered web page and return the result.

    The page loads completely (including all JavaScript) before the expression runs.
    Use for reading dynamic values, computed state, or data that only exists after
    JavaScript execution — things `web_fetch` and `web_extract` cannot reach.

    Examples:
      - `document.title` → page title
      - `document.querySelectorAll('a').length` → number of links
      - `document.querySelector('.price').textContent.trim()` → a specific text value
      - `JSON.stringify([...document.querySelectorAll('h2')].map(h=>h.textContent))` → all headings as JSON

    Args:
        url: The URL to load. Must include scheme (https://...).
        expression: JavaScript expression to evaluate. Must return a JSON-serialisable value.
    """
    thread_data = get_thread_data(runtime)
    if thread_data is None:
        return "Error: Thread data not available."
    workspace = thread_data.get("workspace_path")
    if not workspace:
        return "Error: workspace_path not found in thread data."

    extra = _tool_extra(get_app_config().get_tool_config("web_js_eval"))
    timeout = int(extra.get("timeout", 15))
    return _run_web_js_eval(url=url, expression=expression, workspace=workspace,
                            obscura_url=_get_obscura_url(), timeout=timeout)


# ---------------------------------------------------------------------------
# tool: web_links — extract all hyperlinks from a rendered page
# ---------------------------------------------------------------------------

# Runs inside the page's V8 context. Resolves relative hrefs to absolute URLs,
# deduplicates, and strips empty/mailto/javascript anchors.
_LINK_HARVEST_JS = r"""
(function(){
  var base=document.location.href,seen={},out=[];
  document.querySelectorAll('a[href]').forEach(function(a){
    var h=a.getAttribute('href')||'';
    if(!h||h==='#'||h.startsWith('mailto:')||h.startsWith('javascript:'))return;
    try{h=new URL(h,base).href}catch(e){return}
    if(seen[h])return;
    seen[h]=1;
    out.push({text:(a.textContent||a.title||'').trim().replace(/\s+/g,' ').slice(0,120),href:h});
  });
  return JSON.stringify(out);
})()
"""


async def _obscura_links(
    url: str,
    *,
    obscura_url: str,
    timeout: int,
) -> tuple[list | None, str | None]:
    """Extract all unique absolute links from a rendered page. Returns (links, error).

    CDP sequence (after shared navigate):
      Runtime.evaluate (JS link harvester) → JSON array of {text, href}
    """
    try:
        async with _cdp_page(url, obscura_url=obscura_url, timeout=timeout) as (send_recv, session_id):
            res = await send_recv("Runtime.evaluate", {
                "expression": _LINK_HARVEST_JS,
                "returnByValue": True,
            }, sid=session_id)

            if "exceptionDetails" in res:
                exc_text = res["exceptionDetails"].get("text", "unknown")
                return None, f"Error: Link extraction JS failed — {exc_text}"

            raw_val = res.get("result", {}).get("value", "[]")
            try:
                links = json.loads(raw_val)
            except (json.JSONDecodeError, TypeError):
                return None, f"Error: Could not parse link list: {raw_val!r}"
            return links, None
    except asyncio.TimeoutError:
        return None, f"Error: Timed out after {timeout}s extracting links from {url}."
    except RuntimeError as exc:
        return None, f"Error: {exc}"
    except OSError as exc:
        return None, f"Error: Cannot connect to Obscura at {obscura_url} — {exc}. Check: docker compose ps"
    except Exception as exc:
        return None, f"Error: Obscura connection failed — {exc}"


def _run_web_links(url: str, workspace: str, obscura_url: str, timeout: int) -> str:
    """SSRF-validate → CDP link harvest → return JSON string."""
    err = _validate_url(url)
    if err:
        return err

    links, fetch_err = asyncio.run(_obscura_links(url, obscura_url=obscura_url, timeout=timeout))
    if fetch_err:
        return fetch_err

    return json.dumps({"url": url, "count": len(links), "links": links}, indent=2, ensure_ascii=False)


@tool("web_links", parse_docstring=True)
def web_links_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    url: str,
) -> str:
    """Extract all hyperlinks from a rendered web page as structured JSON.

    JavaScript runs fully before extraction, so links added dynamically
    (React routers, lazy navs) are included. Returns JSON with each link's
    URL and anchor text.

    Use when you need to discover related pages, map a site's structure,
    find source articles, or build a list of URLs to fetch next.

    Args:
        url: The URL to load. Must include scheme (https://...).
    """
    thread_data = get_thread_data(runtime)
    if thread_data is None:
        return "Error: Thread data not available."
    workspace = thread_data.get("workspace_path")
    if not workspace:
        return "Error: workspace_path not found in thread data."

    extra = _tool_extra(get_app_config().get_tool_config("web_links"))
    timeout = int(extra.get("timeout", 15))
    return _run_web_links(url=url, workspace=workspace,
                          obscura_url=_get_obscura_url(), timeout=timeout)
