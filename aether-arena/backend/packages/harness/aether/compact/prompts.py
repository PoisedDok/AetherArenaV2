"""Compact prompts for aether-arena conversation summarization.

Intentionally plain-text: no XML tags, no NO_TOOLS preamble.
Local/small models (Ministral-3B, etc.) produce empty output when the
system prompt contains XML angle-bracket tags, because their tokenizer
re-interprets them as control tokens and emits EOS immediately.
"""


BASE_COMPACT_PROMPT = """Summarize the conversation below into a concise context summary.

Cover these points:
- What the user was trying to accomplish
- Key findings, decisions, or results from the conversation
- Any code, files, or important details that were produced
- Where things currently stand / what is left unfinished

Guidelines:
- Write in plain prose, or use bullet points for lists of items
- Be concise — aim for 20-30% of the original length
- Do NOT reproduce large blocks of conversation text verbatim
- Do NOT call any tools — produce only a text summary{custom_instructions_section}"""


def build_compact_prompt(custom_instructions: str | None = None) -> str:
    """Build the full compact system prompt with optional custom instructions."""
    custom_section = ""
    if custom_instructions and custom_instructions.strip():
        custom_section = f"\n\nAdditional instructions: {custom_instructions.strip()}"
    return BASE_COMPACT_PROMPT.format(custom_instructions_section=custom_section)


def extract_summary_from_response(response: str) -> str:
    """Extract summary text from the compact model response.

    For models that DO emit XML tags, extract the <summary> block.
    For models that emit plain prose (the common case), return as-is.
    Falls back to the full stripped response if no tags are found.
    """
    if "<summary>" in response and "</summary>" in response:
        start = response.index("<summary>") + len("<summary>")
        end = response.index("</summary>")
        return response[start:end].strip()
    # Strip <analysis> block if present, return the rest
    if "<analysis>" in response and "</analysis>" in response:
        end_analysis = response.index("</analysis>") + len("</analysis>")
        return response[end_analysis:].strip()
    return response.strip()
