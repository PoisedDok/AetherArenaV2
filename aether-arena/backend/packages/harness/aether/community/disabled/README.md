# Disabled: Cloud-Dependent Providers

These packages require third-party cloud API keys and are incompatible with
AetherArena's local-first, privacy-owned architecture. They are retained here
for reference only and are **not loaded by any active configuration**.

| Package    | Cloud Service     | Why disabled                              |
|------------|-------------------|-------------------------------------------|
| `tavily`   | Tavily API        | Cloud search service, requires API key    |
| `firecrawl`| Firecrawl API     | Cloud scraping service, requires API key  |
| `jina_ai`  | Jina AI Reader    | Cloud reader API                          |
| `infoquest`| BytePlus/ByteDance| Chinese cloud service, requires API key   |

**Do not re-enable** these by adding them to `config.yaml` unless you have
explicitly opted out of the local-first requirement and accept the privacy
trade-offs of sending URLs and content to third-party services.

The active web stack is:
- **Search**: SearXNG (self-hosted, `aether.community.searxng.tools:web_search_tool`)
- **Fetch**: Obscura (self-hosted headless browser, `aether.community.obscura.tools:web_fetch_tool`)
