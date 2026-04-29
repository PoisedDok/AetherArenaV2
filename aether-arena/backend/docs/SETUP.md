# Setup Guide

Quick setup instructions for AetherArena.

## Configuration Setup

AetherArena uses a YAML configuration file that should be placed in the **project root directory**.

### Steps

1. **Navigate to project root**:
   ```bash
   cd /path/to/aether-arena
   ```

2. **Copy example configuration**:
   ```bash
   cp config.example.yaml config.yaml
   ```

3. **Point at your local model**:
   ```bash
   # Edit config.yaml and set base_url for your local provider:
   # Aether Inference: http://localhost:7090/v1
   # Ollama:           http://localhost:11434/v1
   # LM Studio:        http://localhost:1234/v1
   vim config.yaml  # or your preferred editor
   ```

4. **Verify configuration**:
   ```bash
   cd backend
   python -c "from aether.config import get_app_config; print('✓ Config loaded:', get_app_config().models[0].name)"
   ```

## Important Notes

- **Location**: `config.yaml` should be in `aether-arena/` (project root), not `aether-arena/backend/`
- **Git**: `config.yaml` is automatically ignored by git (contains secrets)
- **Priority**: If both `backend/config.yaml` and `../config.yaml` exist, backend version takes precedence

## Configuration File Locations

The backend searches for `config.yaml` in this order:

1. `AETHER_ARENA_CONFIG_PATH` environment variable (if set)
2. `backend/config.yaml` (current directory when running from backend/)
3. `aether-arena/config.yaml` (parent directory - **recommended location**)

**Recommended**: Place `config.yaml` in project root (`aether-arena/config.yaml`).

## Sandbox Setup (Optional but Recommended)

If you plan to use Docker/Container-based sandbox (configured in `config.yaml` under `sandbox.use: aether.community.aio_sandbox:AioSandboxProvider`), it's highly recommended to pre-pull the container image:

```bash
# From project root
make setup-sandbox
```

**Why pre-pull?**
- The sandbox image (~500MB+) is pulled on first use, causing a long wait
- Pre-pulling provides clear progress indication
- Avoids confusion when first using the agent

If you skip this step, the image will be automatically pulled on first agent execution, which may take several minutes depending on your network speed.

## Troubleshooting

### Config file not found

```bash
# Check where the backend is looking
cd aether-arena/backend
python -c "from aether.config.app_config import AppConfig; print(AppConfig.resolve_config_path())"
```

If it can't find the config:
1. Ensure you've copied `config.example.yaml` to `config.yaml`
2. Verify you're in the correct directory
3. Check the file exists: `ls -la ../config.yaml`

### Permission denied

```bash
chmod 600 ../config.yaml  # Protect sensitive configuration
```

## See Also

- [Configuration Guide](docs/CONFIGURATION.md) - Detailed configuration options
- [Architecture Overview](CLAUDE.md) - System architecture
