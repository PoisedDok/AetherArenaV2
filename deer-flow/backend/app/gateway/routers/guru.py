"""
Guru companion reaction endpoint.

Receives a last-AI-text + system prompt from the frontend and calls a
configurable model (defaults to the first model in config) with max_tokens=80
to generate a short 1-sentence reaction from Guru's perspective, plus a
movement cue that drives the sprite animation.

The model is kept server-side so API keys are never exposed to the browser.
The caller can request a specific model by config name (e.g. a small 2B SLM).
"""

import logging
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deerflow.config import get_app_config
from deerflow.models import create_chat_model

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/guru", tags=["guru"])

VALID_MOVES = frozenset({
    "idle", "walk-left", "walk-right", "jump", "spin", "shake", "bounce", "peek",
})


class GuruReactRequest(BaseModel):
    last_ai_text: str = Field(..., description="The last AI response text to react to")
    system: str = Field(..., description="System prompt with companion personality")
    model_name: str | None = Field(
        default=None,
        description="Config model name to use. null = use first available model.",
    )


class GuruReactResponse(BaseModel):
    reaction: str = Field(..., description="1-sentence reaction from Guru")
    move: str = Field(default="idle", description="Sprite move: idle|walk-left|walk-right|jump|spin|shake|bounce|peek")


def _parse_move(text: str) -> tuple[str, str]:
    """
    Extract MOVE:<name> tag from LLM output.
    Returns (reaction_text_without_tag, move_name).
    Falls back to 'idle' if no valid move found.
    If the tag is the ONLY content, returns a fallback reaction.
    """
    m = re.search(r'\bMOVE:([\w-]+)\b', text, re.IGNORECASE)
    if m:
        move = m.group(1).lower()
        if move not in VALID_MOVES:
            move = "idle"
        # Strip the tag from visible text
        clean = re.sub(r'\s*MOVE:[\w-]+\b', '', text, flags=re.IGNORECASE).strip()
        # If stripping left the text empty, synthesize a minimal reaction
        if not clean:
            clean = "Watching."
        return clean, move
    return text, "idle"


@router.post(
    "/react",
    response_model=GuruReactResponse,
    summary="Generate Guru Reaction",
    description="Generate a short companion reaction to the last AI message, plus a movement cue.",
)
async def guru_react(request: GuruReactRequest) -> GuruReactResponse:
    """
    Proxies a small LLM call to generate a Guru companion reaction + movement.

    Uses the model specified by `model_name` (a config key), or falls back to
    the first configured model. Capped at 80 output tokens for speed/cost.
    """
    if not request.last_ai_text.strip():
        raise HTTPException(status_code=400, detail="last_ai_text is required")

    # Resolve model — prefer the requested model, fall back to default
    model_name: str | None = request.model_name
    if not model_name:
        try:
            config = get_app_config()
            if config.models:
                model_name = config.models[0].name
        except Exception:
            model_name = None

    try:
        model = create_chat_model(name=model_name, thinking_enabled=False)
    except Exception as e:
        logger.warning("Guru: failed to create model %s: %s", model_name, e)
        try:
            model = create_chat_model(thinking_enabled=False)
        except Exception as e2:
            logger.error("Guru: no model available: %s", e2)
            raise HTTPException(status_code=503, detail="No model available for Guru reactions")

    from langchain_core.messages import HumanMessage, SystemMessage  # type: ignore[import-untyped]

    # Inject move instructions into the system prompt
    move_instructions = (
        "\n\nAfter your reaction, append exactly one move tag on the same line: "
        "MOVE:<name> where <name> is one of: idle, walk-left, walk-right, jump, spin, shake, bounce, peek. "
        "Choose the move that matches the emotional tone of your reaction:\n"
        "- walk-left / walk-right: wandering, thinking, casual observation\n"
        "- jump: excited, surprised, great news\n"
        "- spin: confused, chaotic, mind-blown\n"
        "- shake: disagreeing, skeptical, 'nope'\n"
        "- bounce: happy, encouraging, playful\n"
        "- peek: curious, cautious, intrigued\n"
        "- idle: neutral, calm, just watching\n"
        "Example output: 'Bold choice. MOVE:shake'"
    )
    augmented_system = request.system + move_instructions

    messages = [
        SystemMessage(content=augmented_system),
        HumanMessage(content=request.last_ai_text[:1200]),
    ]

    try:
        # max_tokens=40 — reaction (3-8 words) + MOVE tag
        bounded = model.bind(max_tokens=40)  # type: ignore[attr-defined]
        result = await bounded.ainvoke(messages)
        raw_text = str(result.content).strip()

        # Parse move tag out first
        reaction_text, move = _parse_move(raw_text)

        # Strip to first sentence/clause only
        first = re.split(r'[.!?\n]', reaction_text)[0].strip()
        m_term = re.search(r'[.!?]', reaction_text)
        terminator = m_term.group(0) if m_term else '.'
        reaction_out = (first + terminator) if first else reaction_text[:40]

        # Final safety net: ensure non-empty reaction
        if not reaction_out or not reaction_out.strip():
            # Use first 3 words of raw text as absolute fallback
            words = raw_text.split()
            reaction_out = ' '.join(words[:3]) + '.'

        return GuruReactResponse(reaction=reaction_out, move=move)
    except Exception as e:
        logger.warning("Guru reaction failed: %s", e)
        raise HTTPException(status_code=500, detail="Guru reaction generation failed")
