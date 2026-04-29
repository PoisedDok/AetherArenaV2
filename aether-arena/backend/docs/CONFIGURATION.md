# Configuration Guide

This guide explains how to configure AetherArena for your environment.

## Config Versioning

`config.example.yaml` contains a `config_version` field that tracks schema changes. When the example version is higher than your local `config.yaml`, the application emits a startup warning:

```
WARNING - Your config.yaml (version 0) is outdated — the latest version is 1.
Run `make config-upgrade` to merge new fields into your config.
```

- **Missing `config_version`** in your config is treated as version 0.
- Run `make config-upgrade` to auto-merge missing fields (your existing values are preserved, a `.bak` backup is created).
- When changing the config schema, bump `config_version` in `config.example.yaml`.

## Configuration Sections

### Models

AetherArena is designed to run local models on your own hardware. Any OpenAI-compatible server works — no API keys leave your machine.

#### Local providers (recommended)

**Aether Inference** — AetherArena's personal on-device inference engine (port 7090):

```yaml
models:
  - name: aether
    display_name: Aether Inference
    use: aether.models.patched_openai:PatchedChatOpenAI
    model: local-model
    api_key: aether
    base_url: http://localhost:7090/v1
    max_tokens: 8192
    temperature: 0.7
    supports_thinking: true
    supports_vision: true
```

**Ollama** — pull and run open-weight models locally (port 11434):

```yaml
models:
  - name: ollama-llama3
    display_name: Llama 3 (Ollama)
    use: aether.models.patched_openai:PatchedChatOpenAI
    model: llama3
    api_key: ollama
    base_url: http://localhost:11434/v1
    max_tokens: 4096
    temperature: 0.7
```

**LM Studio** — load any GGUF model via a local server (port 1234):

```yaml
models:
  - name: lmstudio
    display_name: LM Studio
    use: aether.models.patched_openai:PatchedChatOpenAI
    model: local-model
    api_key: lmstudio
    base_url: http://localhost:1234/v1
    max_tokens: 4096
    temperature: 0.7
    supports_thinking: true
    supports_vision: true
```

All three providers appear in Settings with a live health dot — no config beyond `base_url` is required.

**Thinking models**: set `supports_thinking: true` and optionally configure `when_thinking_enabled` for providers that need extra body params:

```yaml
models:
  - name: qwen-thinking
    display_name: Qwen3 (thinking)
    use: aether.models.patched_openai:PatchedChatOpenAI
    model: qwen3
    api_key: ollama
    base_url: http://localhost:11434/v1
    supports_thinking: true
```

#### Optional: cloud or remote models

Any OpenAI-compatible remote endpoint works the same way — add `base_url` and an `api_key` referencing an environment variable:

```yaml
models:
  - name: remote-example
    display_name: My Remote Model
    use: aether.models.patched_openai:PatchedChatOpenAI
    model: model-id
    api_key: $MY_API_KEY
    base_url: https://my-provider.com/v1
    max_tokens: 8192
```

Cloud models are entirely optional. AetherArena runs fully offline without them.

### Tool Groups

Organize tools into logical groups:

```yaml
tool_groups:
  - name: web          # Web browsing and search
  - name: file:read    # Read-only file operations
  - name: file:write   # Write file operations
  - name: bash         # Shell command execution
```

### Tools

Configure specific tools available to the agent:

```yaml
tools:
  - name: web_search
    group: web
    use: aether.community.tavily.tools:web_search_tool
    max_results: 5
    # api_key: $TAVILY_API_KEY  # Optional
```

**Built-in Tools**:
- `web_search` - Search the web (Tavily)
- `web_fetch` - Fetch web pages (Jina AI)
- `ls` - List directory contents
- `read_file` - Read file contents
- `write_file` - Write file contents
- `str_replace` - String replacement in files
- `bash` - Execute bash commands

### Sandbox

AetherArena supports multiple sandbox execution modes. Configure your preferred mode in `config.yaml`:

**Local Execution** (runs sandbox code directly on the host machine):
```yaml
sandbox:
   use: aether.sandbox.local:LocalSandboxProvider # Local execution
```

**Docker Execution** (runs sandbox code in isolated Docker containers):
```yaml
sandbox:
   use: aether.community.aio_sandbox:AioSandboxProvider # Docker-based sandbox
```

**Docker Execution with Kubernetes** (runs sandbox code in Kubernetes pods via provisioner service):

This mode runs each sandbox in an isolated Kubernetes Pod on your **host machine's cluster**. Requires Docker Desktop K8s, OrbStack, or similar local K8s setup.

```yaml
sandbox:
   use: aether.community.aio_sandbox:AioSandboxProvider
   provisioner_url: http://provisioner:8002
```

When using Docker development (`make docker-start`), AetherArena starts the `provisioner` service only if this provisioner mode is configured. In local or plain Docker sandbox modes, `provisioner` is skipped.

See [Provisioner Setup Guide](docker/provisioner/README.md) for detailed configuration, prerequisites, and troubleshooting.

Choose between local execution or Docker-based isolation:

**Option 1: Local Sandbox** (default, simpler setup):
```yaml
sandbox:
  use: aether.sandbox.local:LocalSandboxProvider
```

**Option 2: Docker Sandbox** (isolated, more secure):
```yaml
sandbox:
  use: aether.community.aio_sandbox:AioSandboxProvider
  port: 8080
  auto_start: true
  container_prefix: aether-arena-sandbox

  # Optional: Additional mounts
  mounts:
    - host_path: /path/on/host
      container_path: /path/in/container
      read_only: false
```

### Skills

Configure the skills directory for specialized workflows:

```yaml
skills:
  # Host path (optional, default: ../skills)
  path: /custom/path/to/skills

  # Container mount path (default: /mnt/skills)
  container_path: /mnt/skills
```

**How Skills Work**:
- Skills are stored in `aether-arena/skills/{public,custom}/`
- Each skill has a `SKILL.md` file with metadata
- Skills are automatically discovered and loaded
- Available in both local and Docker sandbox via path mapping

### Title Generation

Automatic conversation title generation:

```yaml
title:
  enabled: true
  max_words: 6
  max_chars: 60
  model_name: null  # Use first model in list
```

## Environment Variables

AetherArena supports environment variable substitution using the `$` prefix in `config.yaml`:

```yaml
models:
  - api_key: $MY_API_KEY  # Reads from environment at startup
```

**Common variables**:
- `AETHER_ARENA_CONFIG_PATH` — custom config file path
- `AETHER_ARENA_HOME` — runtime data directory
- `SEARXNG_URL` — self-hosted SearXNG URL for web search
- `TAVILY_API_KEY` — Tavily search API key (alternative to SearXNG)

Local providers (Aether Inference, Ollama, LM Studio) don't require any API key variables — the `api_key` field in their config is just a placeholder string.

## Configuration Location

The configuration file should be placed in the **project root directory** (`aether-arena/config.yaml`), not in the backend directory.

## Configuration Priority

AetherArena searches for configuration in this order:

1. Path specified in code via `config_path` argument
2. Path from `AETHER_ARENA_CONFIG_PATH` environment variable
3. `config.yaml` in current working directory (typically `backend/` when running)
4. `config.yaml` in parent directory (project root: `aether-arena/`)

## Best Practices

1. **Place `config.yaml` in project root** - Not in `backend/` directory
2. **Never commit `config.yaml`** - It's already in `.gitignore`
3. **Use environment variables for secrets** - Don't hardcode API keys
4. **Keep `config.example.yaml` updated** - Document all new options
5. **Test configuration changes locally** - Before deploying
6. **Use Docker sandbox for production** - Better isolation and security

## Troubleshooting

### "Config file not found"
- Ensure `config.yaml` exists in the **project root** directory (`aether-arena/config.yaml`)
- The backend searches parent directory by default, so root location is preferred
- Alternatively, set `AETHER_ARENA_CONFIG_PATH` environment variable to custom location

### "Invalid API key"
- Verify environment variables are set correctly
- Check that `$` prefix is used for env var references

### "Skills not loading"
- Check that `aether-arena/skills/` directory exists
- Verify skills have valid `SKILL.md` files
- Check `skills.path` configuration if using custom path

### "Docker sandbox fails to start"
- Ensure Docker is running
- Check port 8080 (or configured port) is available
- Verify Docker image is accessible

## Examples

See `config.example.yaml` for complete examples of all configuration options.
