"""SLM-optimized compact prompts for deer-flow.

Adapted from Claude Code production prompts, simplified for smaller context
windows (4–32K) while preserving the critical NO_TOOLS preamble/trailer
pattern that prevents the compact model from attempting tool calls.
"""

NO_TOOLS_PREAMBLE = """CRITICAL INSTRUCTION: Respond with TEXT ONLY. Do NOT call any tools.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will fail the task.
- Your entire response must be plain text structured as <analysis> followed by <summary>.
"""

NO_TOOLS_TRAILER = """REMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block. Tool calls will be rejected."""

BASE_COMPACT_PROMPT = """You are summarizing a conversation between a user and an AI assistant. Your goal is to produce a concise but complete summary that allows the assistant to continue helping the user without losing important context.

Produce your response in exactly this format:

<analysis>
Brief internal analysis of what happened in the conversation (2-5 sentences). Not shown to the user.
</analysis>

<summary>
# Conversation Summary

## Intent
[The user's primary goal and any specific constraints or preferences they expressed. Include ALL user messages and requests.]

## Key Technical Concepts
[Technical terms, frameworks, APIs, data structures, or domain knowledge that appeared. Include version numbers, language choices, and architectural decisions.]

## Files and Changes
[Files read, created, or modified. Include paths and a brief note about what changed or was found in each.]

## Errors and Fixes
[Errors encountered and how they were resolved. Include error messages if they are specific and diagnostic.]

## Current Work and Next Steps
[What was being worked on at the end of the conversation. Any pending tasks, the last tool call result, and what the assistant should do next if the user resumes.]
</summary>

{custom_instructions_section}"""

PARTIAL_COMPACT_EARLIER_PROMPT = """You are summarizing the OLDER portion of a conversation. The newer portion will be preserved as-is and appended after your summary.

Produce your response in exactly this format:

<analysis>
Brief analysis of the older portion (2-3 sentences).
</analysis>

<summary>
# Earlier Conversation Summary

## Intent
[User's goal and requests from the summarized portion.]

## Key Technical Concepts
[Technical context from the summarized portion.]

## Files and Changes
[Files read/created/modified in the summarized portion.]

## Errors and Fixes
[Issues encountered and resolved in the summarized portion.]

## Context Handed Off
[What state was left at the boundary — what the agent was doing when this portion ends.]
</summary>

{custom_instructions_section}"""

PARTIAL_COMPACT_LATER_PROMPT = """You are summarizing the NEWER portion of a conversation. The older portion will be preserved as-is and prepended before your summary.

Produce your response in exactly this format:

<analysis>
Brief analysis of the newer portion (2-3 sentences).
</analysis>

<summary>
# Recent Conversation Summary

## Intent
[User's goal and requests from the summarized portion.]

## Key Technical Concepts
[Technical context from the summarized portion.]

## Files and Changes
[Files read/created/modified in the summarized portion.]

## Errors and Fixes
[Issues encountered and resolved in the summarized portion.]

## Current Work and Next Steps
[What was being worked on at the end — what the assistant should do next.]
</summary>

{custom_instructions_section}"""


def build_compact_prompt(custom_instructions: str | None = None) -> str:
    """Build the full compact prompt with optional custom instructions."""
    custom_section = ""
    if custom_instructions and custom_instructions.strip():
        custom_section = f"\n## Additional Instructions\n{custom_instructions.strip()}\n"
    return NO_TOOLS_PREAMBLE + "\n" + BASE_COMPACT_PROMPT.format(custom_instructions_section=custom_section) + "\n\n" + NO_TOOLS_TRAILER


def build_partial_compact_prompt(direction: str, custom_instructions: str | None = None) -> str:
    """Build the partial compact prompt for 'earlier' or 'later' direction."""
    custom_section = ""
    if custom_instructions and custom_instructions.strip():
        custom_section = f"\n## Additional Instructions\n{custom_instructions.strip()}\n"

    template = PARTIAL_COMPACT_EARLIER_PROMPT if direction == "earlier" else PARTIAL_COMPACT_LATER_PROMPT
    return NO_TOOLS_PREAMBLE + "\n" + template.format(custom_instructions_section=custom_section) + "\n\n" + NO_TOOLS_TRAILER


def extract_summary_from_response(response: str) -> str:
    """Extract the <summary> block from a compact model response.

    Strips the <analysis> block (internal reasoning) and returns only the
    <summary> content. Falls back to the full response if parsing fails.
    """
    if "<summary>" in response and "</summary>" in response:
        start = response.index("<summary>") + len("<summary>")
        end = response.index("</summary>")
        return response[start:end].strip()
    # Fallback: strip analysis block if present, return rest
    if "<analysis>" in response and "</analysis>" in response:
        end_analysis = response.index("</analysis>") + len("</analysis>")
        return response[end_analysis:].strip()
    return response.strip()
