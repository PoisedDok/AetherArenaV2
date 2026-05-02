import os
from dataclasses import dataclass, field


@dataclass
class UiTrustConfig:
    trusted_origins: list[str] = field(default_factory=list)
    strict_mode: bool = True


_instance: UiTrustConfig | None = None


def get_ui_trust_config() -> UiTrustConfig:
    global _instance
    if _instance is None:
        raw = os.environ.get("UI_TRUSTED_ORIGINS", "")
        origins = [o.strip() for o in raw.split(",") if o.strip()]
        _instance = UiTrustConfig(trusted_origins=origins)
    return _instance


def reset_ui_trust_config() -> None:
    """Reset singleton — for testing only."""
    global _instance
    _instance = None
