# AetherArena v2

**AetherArena v2** is a privacy-first personal AI assistant platform built by [PoisedDok](https://github.com/PoisedDok). Your assistant runs locally — on your hardware, with your models, under your control. No data leaves your machine unless you choose it to.

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](./aether-arena/LICENSE)
[![Python](https://img.shields.io/badge/Python-3.12%2B-3776AB?logo=python&logoColor=white)](./aether-arena/backend/pyproject.toml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](./aether-arena/Makefile)

---

## What it is

AetherArena knows you. It builds a persistent memory of your preferences, context, and work style across every conversation — so the more you use it, the more it feels like yours. It can browse the web, write and run code, manage files, generate documents, and handle long-running tasks autonomously. Everything runs locally or in a self-hosted Docker container you control.

- **Private by default** — your conversations and memory stay on your machine
- **Personalised** — long-term memory that grows with you across sessions
- **Capable** — real tools: web search, code execution, file system, sandboxed runtime
- **Local-first models** — runs on Aether Inference, Ollama, LM Studio, or any OpenAI-compatible local server. No data sent to the cloud unless you explicitly add a remote model.

---

## What's here

```
AetherArenaV2/
├── aether-arena/        ← Main application (backend, frontend, skills, docker)
├── Experiments/         ← Scratch space and exploratory work
└── project/             ← Project planning and notes
```

| Directory | What it is |
|---|---|
| `backend/` | LangGraph agent runtime + FastAPI gateway |
| `frontend/` | Next.js 16 web UI |
| `electron/` | Desktop app (macOS / Windows / Linux) |
| `skills/` | Built-in and custom assistant skills |
| `docker/` | Docker Compose configs |
| `scripts/` | Dev tooling |

---

## Quick start

```bash
git clone https://github.com/PoisedDok/AetherArenaV2.git
cd AetherArenaV2/aether-arena

make config     # generate config.yaml and .env from templates
# edit config.yaml — add at least one model
make install    # install backend + frontend deps
make dev        # start all services
```

Open **http://localhost:2026**.

Full setup guide → [`aether-arena/README.md`](./aether-arena/README.md)

---

## Aether Inference

**Aether Inference** is AetherArena's personal on-device inference engine — a modular, OpenAI-compatible inference server that runs on your hardware on port `7090`. It's the default and recommended provider: everything stays on your machine, no account required.

Configure it in `config.yaml`:

```yaml
- name: aether
  display_name: Aether Inference
  use: aether.models.patched_openai:PatchedChatOpenAI
  model: local-model
  api_key: aether
  base_url: http://localhost:7090/v1
  max_tokens: 8192
  supports_thinking: true
  supports_vision: true
```

It appears as its own **Aether Inference** tab in Settings with a live health indicator — same as Ollama and LM Studio but for your own engine. Ollama (port 11434) and LM Studio (port 1234) are also supported out of the box.

---

## Desktop app

The Electron wrapper loads the web UI from `localhost:2026`. Native vibrancy on macOS, acrylic on Windows. No login screen — authentication is bypassed in desktop mode automatically.

```bash
make desktop-dev   # requires backend running via make dev
```

---

## License

BUSL-1.1 — free for personal, non-commercial, and development use. Converts to Apache 2.0 on 2029-11-21. See [`aether-arena/LICENSE`](./aether-arena/LICENSE) for full terms and commercial licensing contact.

---

## Acknowledgments

AetherArena v2 is a fork of **[DeerFlow](https://github.com/bytedance/deer-flow)** by ByteDance (MIT). The core architecture — LangGraph agent system, middleware chain, sandbox execution, MCP integration, skills framework — was built by the DeerFlow team and its community. We forked it and built our own platform on top.
