"""Patched ChatOpenAI that extracts reasoning_content from various formats.

Many OpenAI-compatible APIs (LM Studio, vLLM, etc.) return reasoning content in
different formats that standard ``langchain_openai.ChatOpenAI`` ignores:

- ``reasoning_content`` field in streaming delta (LM Studio, Qwen)
- Standard ``reasoning_content`` field in final response
- Inline ``...\n<think>`` or ``<thinking>`` tags in content

This adapter extracts reasoning from supported formats and maps them into
``additional_kwargs.reasoning_content`` which AetherArena's frontend expects.
"""

from __future__ import annotations

import re
from typing import Any

from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_openai import ChatOpenAI
from langchain_openai.chat_models.base import (
    _convert_delta_to_message_chunk,
    _create_usage_metadata,
)

# Regex for inline think tags (case-insensitive, non-greedy)
_THINK_TAG_RE = re.compile(r"<think(?:ing)?\b[^>]*>(.*?)<\/(?:think|thinking)>", re.DOTALL | re.IGNORECASE)


def _extract_inline_reasoning(content: str) -> tuple[str, str | None]:
    """Extract reasoning from inline think tags.

    Returns:
        Tuple of (cleaned_content, reasoning_or_None)
    """
    reasoning_parts: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        reasoning = match.group(1).strip()
        if reasoning:
            reasoning_parts.append(reasoning)
        return ""

    cleaned = _THINK_TAG_RE.sub(_replace, content).strip()
    reasoning = "\n\n".join(reasoning_parts) if reasoning_parts else None
    return cleaned, reasoning


def _with_reasoning_content(
    message: AIMessage,
    reasoning: str | None,
) -> AIMessage:
    """Add or merge reasoning_content into message's additional_kwargs."""
    if not reasoning:
        return message

    additional_kwargs = dict(message.additional_kwargs)
    existing = additional_kwargs.get("reasoning_content")

    # Merge with existing reasoning if present
    if isinstance(existing, str) and existing.strip():
        # Avoid duplicates
        if reasoning.strip() not in existing:
            merged = f"{existing}\n\n{reasoning}"
        else:
            merged = existing
    else:
        merged = reasoning

    additional_kwargs["reasoning_content"] = merged
    return message.model_copy(update={"additional_kwargs": additional_kwargs})


def _with_reasoning_content_chunk(
    message_chunk: AIMessageChunk,
    reasoning: str,
) -> AIMessageChunk:
    """Add reasoning_content to message chunk for streaming."""
    additional_kwargs = dict(message_chunk.additional_kwargs)
    existing = additional_kwargs.get("reasoning_content")
    # Accumulate streaming reasoning
    additional_kwargs["reasoning_content"] = (
        f"{existing}{reasoning}" if isinstance(existing, str) else reasoning
    )
    return message_chunk.model_copy(update={"additional_kwargs": additional_kwargs})


class PatchedChatOpenAI(ChatOpenAI):
    """ChatOpenAI adapter that extracts reasoning from various formats.

    Supports:
    - ``reasoning_content`` field in streaming delta (LM Studio, Qwen)
    - Standard ``reasoning_content`` field in final response
    - Inline ``<think>`` or ``<thinking>`` tags in content
    """

    def _convert_chunk_to_generation_chunk(
        self,
        chunk: dict,
        default_chunk_class: type,
        base_generation_info: dict | None,
    ) -> ChatGenerationChunk | None:
        """Process streaming chunk with reasoning extraction from delta."""
        if chunk.get("type") == "content.delta":
            return None

        token_usage = chunk.get("usage")
        choices = chunk.get("choices", []) or chunk.get("chunk", {}).get("choices", [])
        usage_metadata = (
            _create_usage_metadata(token_usage, chunk.get("service_tier"))
            if token_usage
            else None
        )

        if len(choices) == 0:
            generation_chunk = ChatGenerationChunk(
                message=default_chunk_class(content="", usage_metadata=usage_metadata),
                generation_info=base_generation_info,
            )
            if self.output_version == "v1":
                generation_chunk.message.content = []
                generation_chunk.message.response_metadata["output_version"] = "v1"
            return generation_chunk

        choice = choices[0]
        delta = choice.get("delta")
        if delta is None:
            return None

        message_chunk = _convert_delta_to_message_chunk(delta, default_chunk_class)
        generation_info = {**base_generation_info} if base_generation_info else {}

        if finish_reason := choice.get("finish_reason"):
            generation_info["finish_reason"] = finish_reason
            if model_name := chunk.get("model"):
                generation_info["model_name"] = model_name
            if system_fingerprint := chunk.get("system_fingerprint"):
                generation_info["system_fingerprint"] = system_fingerprint
            if service_tier := chunk.get("service_tier"):
                generation_info["service_tier"] = service_tier

        logprobs = choice.get("logprobs")
        if logprobs:
            generation_info["logprobs"] = logprobs

        # Extract reasoning_content from delta (LM Studio streaming format)
        reasoning = delta.get("reasoning_content")
        if reasoning and isinstance(message_chunk, AIMessageChunk):
            message_chunk = _with_reasoning_content_chunk(message_chunk, reasoning)

        return ChatGenerationChunk(
            message=message_chunk,
            generation_info=generation_info or None,
        )

    def _create_chat_result(
        self,
        response: dict | Any,
        generation_info: dict | None = None,
    ) -> ChatResult:
        """Create chat result with reasoning extraction."""
        result = super()._create_chat_result(response, generation_info)

        # Get raw response as dict
        if hasattr(response, "model_dump"):
            response_dict = response.model_dump()
        elif isinstance(response, dict):
            response_dict = response
        else:
            response_dict = {}

        choices = response_dict.get("choices", [])

        generations: list[ChatGeneration] = []
        for index, generation in enumerate(result.generations):
            message = generation.message

            if isinstance(message, AIMessage):
                updated_message = message
                content = message.content if isinstance(message.content, str) else None

                # 1. Extract inline <think> tags from content
                cleaned_content = content
                inline_reasoning = None
                if isinstance(content, str):
                    cleaned_content, inline_reasoning = _extract_inline_reasoning(content)

                # 2. Extract reasoning_content field from API response
                api_reasoning = None
                if index < len(choices):
                    choice = choices[index]
                    if isinstance(choice, dict):
                        choice_message = choice.get("message", {})
                        if isinstance(choice_message, dict):
                            # Check for reasoning_content field (Qwen, LM Studio, etc.)
                            api_reasoning = choice_message.get("reasoning_content")

                # 3. Merge reasoning sources (API field takes precedence over inline)
                final_reasoning = api_reasoning if api_reasoning else inline_reasoning

                # 4. Update message if needed
                if cleaned_content is not None and cleaned_content != message.content:
                    updated_message = updated_message.model_copy(update={"content": cleaned_content})

                if final_reasoning:
                    updated_message = _with_reasoning_content(updated_message, final_reasoning)

                generation = ChatGeneration(
                    message=updated_message,
                    generation_info=generation.generation_info,
                )

            generations.append(generation)

        return ChatResult(generations=generations, llm_output=result.llm_output)
