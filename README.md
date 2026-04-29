# AetherArena v2

**AetherArena v2** is a personal, modular super-agent harness built by [PoisedDok](https://github.com/PoisedDok). Run powerful AI agents locally or in Docker — with sandboxed execution, long-term memory, skills, sub-agent orchestration, and a desktop app. Fully open, fully yours.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./aether-arena/LICENSE)
[![Python](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)](./aether-arena/backend/pyproject.toml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](./aether-arena/Makefile)

---

## What's here

```
AetherArenaV2/
├── aether-arena/        ← Main application (backend, frontend, skills, docker)
├── Experiments/         ← Scratch space and exploratory work
└── project/             ← Project planning and notes
```

Everything that matters lives in [`aether-arena/`](./aether-arena/). That is the monorepo containing:

| Directory | What it is |
|---|---|
| `backend/` | LangGraph agent runtime + FastAPI gateway |
| `frontend/` | Next.js 16 web UI |
| `electron/` | Desktop wrapper (macOS / Windows / Linux) |
| `skills/` | Built-in and custom agent skills |
| `docker/` | Docker Compose configs for dev and production |
| `scripts/` | Dev tooling — health checks, config bootstrap, OAuth helpers |

---

## Quick start

```bash
git clone https://github.com/PoisedDok/AetherArenaV2.git
cd AetherArenaV2/aether-arena

make config     # generate config.yaml and .env from templates
# edit config.yaml — add at least one model + API key
make install    # install backend + frontend deps
make dev        # start all services
```

Open **http://localhost:2026**.

For Docker, MCP servers, IM channels, sandbox modes, and the embedded Python client — see the full docs inside [`aether-arena/README.md`](./aether-arena/README.md).

---

## Architecture in one line

```
Browser / Desktop → nginx :2026 → Next.js frontend + LangGraph agent server + FastAPI gateway
```

The agent has a real filesystem (sandboxed), persistent memory, progressively-loaded skills, and can spawn parallel sub-agents for complex work.

---

## Aether Inference

AetherArena ships with **Aether Inference** as a first-class local provider — a personal modular inference engine (OpenAI-compatible) running on port `7090`. Configure it in `config.yaml`:

```yaml
- name: aether
  display_name: Aether Inference
  use: aether.models.patched_openai:PatchedChatOpenAI
  model: local-model
  base_url: http://localhost:7090/v1
```

It appears as its own provider tab in Settings with a live health indicator, no different from Ollama or LM Studio.

---

## Desktop app

The Electron wrapper in `electron/` loads the web UI from `localhost:2026`. On macOS it uses native vibrancy; on Windows it uses acrylic. No login required in desktop mode — authentication is automatically bypassed.

To run it:

```bash
make desktop-dev   # requires backend already running via make dev
```

---

## License

MIT — see [`aether-arena/LICENSE`](./aether-arena/LICENSE).

---

## Acknowledgments

AetherArena v2 is a fork of **[DeerFlow](https://github.com/bytedance/deer-flow)** by ByteDance (MIT). The foundational architecture — LangGraph agent system, middleware chain, sandbox execution, MCP integration, skills framework — was built by the DeerFlow team and its 80+ contributors. We forked it, rebranded it, and built our own roadmap on top.
