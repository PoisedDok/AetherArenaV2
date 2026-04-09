"""Tests for interrupted_response injection into the system prompt.

When a user stops an AI stream mid-response and sends a follow-up,
the frontend passes the partial AI text as `interrupted_response` via
config["configurable"]. The backend must inject it into the system prompt
so the model has full context of what it had already said.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from deerflow.agents.lead_agent.prompt import apply_prompt_template


# ---------------------------------------------------------------------------
# apply_prompt_template unit tests
# ---------------------------------------------------------------------------


def test_no_interrupted_response_omits_section():
    """When interrupted_response is None, no <interrupted_response> tag appears."""
    prompt = apply_prompt_template()
    assert "<interrupted_response>" not in prompt


def test_interrupted_response_injected_into_prompt():
    """When interrupted_response is provided, it appears in the system prompt."""
    partial = "Here is what I had started saying about photons:"
    prompt = apply_prompt_template(interrupted_response=partial)
    assert "<interrupted_response>" in prompt
    assert partial in prompt
    assert "</interrupted_response>" in prompt


def test_interrupted_response_empty_string_omits_section():
    """Empty string is treated the same as None — no injection."""
    prompt = apply_prompt_template(interrupted_response="")
    assert "<interrupted_response>" not in prompt


def test_interrupted_response_multiline():
    """Multi-line partial AI text is preserved verbatim."""
    partial = "Line one.\nLine two.\nLine three with **markdown**."
    prompt = apply_prompt_template(interrupted_response=partial)
    assert partial in prompt


def test_interrupted_response_with_subagent_enabled():
    """interrupted_response injection works alongside subagent mode."""
    partial = "I was researching this topic..."
    prompt = apply_prompt_template(subagent_enabled=True, interrupted_response=partial)
    assert "<interrupted_response>" in prompt
    assert partial in prompt
    assert "SUBAGENT MODE" in prompt


def test_interrupted_response_position_before_critical_reminders():
    """The interrupted_response section appears before <critical_reminders>."""
    partial = "I had just started answering..."
    prompt = apply_prompt_template(interrupted_response=partial)
    interrupted_idx = prompt.index("<interrupted_response>")
    critical_idx = prompt.index("<critical_reminders>")
    assert interrupted_idx < critical_idx, (
        "interrupted_response section should appear before critical_reminders"
    )


# ---------------------------------------------------------------------------
# Helper to build a minimal test AppConfig
# ---------------------------------------------------------------------------

def _make_test_app_cfg():
    from deerflow.config.app_config import AppConfig
    from deerflow.config.model_config import ModelConfig
    from deerflow.config.sandbox_config import SandboxConfig

    model_cfg = ModelConfig(
        name="test-model",
        display_name="Test",
        description=None,
        use="langchain_openai:ChatOpenAI",
        model="gpt-4o",
        supports_thinking=False,
        supports_vision=False,
    )
    return AppConfig(
        models=[model_cfg],
        sandbox=SandboxConfig(use="deerflow.sandbox.local:LocalSandboxProvider"),
    )


def _run_make_lead_agent(config: dict, captured_kwargs: dict) -> None:
    """Invoke make_lead_agent with all heavy dependencies mocked out."""
    app_cfg = _make_test_app_cfg()
    mock_agent = MagicMock()
    mock_model = MagicMock()

    def mock_apply(*args, **kwargs):
        captured_kwargs.update(kwargs)
        return "mock system prompt"

    with (
        patch("deerflow.agents.lead_agent.agent.apply_prompt_template", side_effect=mock_apply),
        patch("deerflow.agents.lead_agent.agent.get_app_config", return_value=app_cfg),
        patch("deerflow.agents.lead_agent.agent.create_chat_model", return_value=mock_model),
        # get_available_tools / setup_agent are lazy-imported inside the function body
        patch("deerflow.tools.get_available_tools", return_value=[]),
        patch("deerflow.tools.builtins.setup_agent", MagicMock()),
        patch("deerflow.agents.lead_agent.agent._build_middlewares", return_value=[]),
        patch("deerflow.agents.lead_agent.agent.create_agent", return_value=mock_agent),
        patch("deerflow.agents.lead_agent.agent.load_agent_config", return_value=None),
    ):
        from deerflow.agents.lead_agent.agent import make_lead_agent
        make_lead_agent(config)


# ---------------------------------------------------------------------------
# make_lead_agent integration tests
# ---------------------------------------------------------------------------


def test_make_lead_agent_reads_interrupted_response_from_cfg():
    """make_lead_agent reads interrupted_response from config["configurable"]
    and passes it to apply_prompt_template."""
    partial_text = "I was explaining how photons interact with matter..."
    captured: dict = {}

    _run_make_lead_agent(
        {
            "configurable": {
                "interrupted_response": partial_text,
                "model_name": "test-model",
                "thinking_enabled": False,
                "subagent_enabled": False,
            }
        },
        captured,
    )

    assert "interrupted_response" in captured, (
        "apply_prompt_template must receive interrupted_response kwarg"
    )
    assert captured["interrupted_response"] == partial_text


def test_make_lead_agent_interrupted_response_none_when_absent():
    """When interrupted_response is absent from cfg, None is passed to apply_prompt_template."""
    captured: dict = {}

    _run_make_lead_agent(
        {
            "configurable": {
                "model_name": "test-model",
                "thinking_enabled": False,
                "subagent_enabled": False,
            }
        },
        captured,
    )

    assert captured.get("interrupted_response") is None
