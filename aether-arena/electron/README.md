# AetherArena v2 Desktop (Electron wrapper)

A minimal Electron shell that loads the web UI from `http://localhost:2026`. It does not bundle or replace the backend.

## License

**MIT** — see [LICENSE](../LICENSE).

## Prerequisites

1. **Stack running** (Docker or local `make` flow) so `http://localhost:2026` responds.
   ```bash
   cd /path/to/aether-arena
   make docker-start
   ```

2. **Node.js 18+** and npm

## Installation

From the project root:

```bash
make desktop-install
```

Or manually:

```bash
cd electron
npm install
```

## Usage

### Development

```bash
# Terminal 1: start backend / unified proxy
make docker-start

# Terminal 2: desktop shell
make desktop-dev
```

### Production build

```bash
make desktop-build
make desktop-build-mac
make desktop-build-win
make desktop-build-linux
```

Artifacts: `electron/dist/`.

## How it works

```
┌─────────────────────────────────────┐
│     AetherArena v2 (Electron)       │
│         BrowserWindow               │
└──────────────────┬──────────────────┘
                   │ loads
                   ▼
        http://localhost:2026
                   │
┌──────────────────┴──────────────────┐
│   Backend (nginx + gateway + app)     │
└─────────────────────────────────────┘
```

- No backend spawning from Electron (you start Docker/Makefile separately).
- External links open in the system browser.

## Troubleshooting

### "Waiting for backend..."

Start the stack (`make docker-start` or your usual command).

### Blank screen

```bash
curl http://localhost:2026/health
```

Expect `{"status":"healthy"}` (or equivalent).

## Note on repo layout

The repository directory is still named `aether-arena` for compatibility with existing scripts and Python imports (`aether-arena` package).
