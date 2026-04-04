"""
Guru companion reaction endpoint.

Receives a last-AI-text + system prompt from the frontend and calls a
configurable model (defaults to the first model in config) with max_tokens=60
to generate a short 1-sentence reaction from Guru's perspective.

The model is kept server-side so API keys are never exposed to the browser.
The caller can request a specific model by config name (e.g. a small 2B SLM).
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deerflow.config import get_app_config
from deerflow.models import create_chat_model

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/guru", tags=["guru"])


class GuruReactRequest(BaseModel):
    last_ai_text: str = Field(..., description="The last AI response text to react to")
    system: str = Field(..., description="System prompt with companion personality")
    model_name: str | None = Field(
        default=None,
        description="Config model name to use. null = use first available model.",
    )


class GuruReactResponse(BaseModel):
    reaction: str = Field(..., description="1-sentence reaction from Guru")


@router.post(
    "/react",
    response_model=GuruReactResponse,
    summary="Generate Guru Reaction",
    description="Generate a short companion reaction to the last AI message.",
)
async def guru_react(request: GuruReactRequest) -> GuruReactResponse:
    """
    Proxies a small LLM call to generate a Guru companion reaction.

    Uses the model specified by `model_name` (a config key), or falls back to
    the first configured model. Capped at 60 output tokens for speed/cost.
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

    messages = [
        SystemMessage(content=request.system),
        HumanMessage(content=request.last_ai_text[:1200]),
    ]

    try:
        # max_tokens=20 forces brevity — Guru speaks in margin-note style (3-8 words)
        bounded = model.bind(max_tokens=20)  # type: ignore[attr-defined]
        result = await bounded.ainvoke(messages)
        reaction_text = str(result.content).strip()

        # Strip to first sentence/clause only — take whatever comes first
        import re
        first = re.split(r'[.!?\n]', reaction_text)[0].strip()
        # Determine original terminator to preserve it
        m = re.search(r'[.!?]', reaction_text)
        terminator = m.group(0) if m else '.'
        reaction_out = (first + terminator) if first else reaction_text[:40]

        return GuruReactResponse(reaction=reaction_out)
    except Exception as e:
        logger.warning("Guru reaction failed: %s", e)
        raise HTTPException(status_code=500, detail="Guru reaction generation failed")
