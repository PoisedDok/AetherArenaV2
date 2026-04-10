"""Smart extractive summarizer for large tool outputs.

Pipeline: Gate → Sentence-split (NLTK) → LexRank score (sumy) → Select top-N.

- Gate: content that fits within the token budget is returned verbatim (zero loss).
- Sentence splitting: NLTK sent_tokenize with offset tracking.
- Scoring: LexRank (Erkan & Radev, 2004) via sumy — graph centrality over
  TF-IDF cosine similarity.  Code content uses head/tail extraction instead.
- Selection: top-N sentences reassembled in document order, with [SKIPPED SECTION]
  markers between gaps so the agent can see where content was omitted.
- Fallback: if sumy/NLTK are unavailable, content is truncated with a clear note.

Used by read_file, web_fetch, and the conversation compact engine.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# One-time setup guards
# ---------------------------------------------------------------------------

_NLTK_CHECKED = False
_SUMY_AVAILABLE: bool | None = None
_TIKTOKEN_ENC = None

_MIN_SENTENCE_CHARS = 20
_MAX_LEXRANK_CHARS = 100_000  # above this, use head/tail instead (O(N²) guard)
_CHARS_PER_TOKEN = 4

_BIB_MARKER_RE = re.compile(
    r"(?:In\s+Proceedings|arXiv\s+preprint|arXiv:|arXiv\.org|"
    r"URL\s+https?://|doi\.org/|IEEE/CVF|ACM\s+Conference|International\s+Conference)",
    re.IGNORECASE,
)

_CODE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".c", ".cpp", ".h",
    ".cs", ".go", ".rs", ".rb", ".php", ".css", ".json", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".sh", ".bash", ".sql", ".r", ".swift",
    ".kt", ".scala", ".lua", ".pl", ".csv", ".tsv",
}


# ---------------------------------------------------------------------------
# Lazy initialisation helpers
# ---------------------------------------------------------------------------

def _get_tiktoken_enc():
    global _TIKTOKEN_ENC
    if _TIKTOKEN_ENC is not None:
        return _TIKTOKEN_ENC
    try:
        import tiktoken
        _TIKTOKEN_ENC = tiktoken.get_encoding("cl100k_base")
    except Exception:
        _TIKTOKEN_ENC = False  # sentinel: tiktoken unavailable
    return _TIKTOKEN_ENC


def estimate_tokens(text: str) -> int:
    """Estimate token count. Uses tiktoken when available, falls back to char/4."""
    enc = _get_tiktoken_enc()
    if enc and enc is not False:
        try:
            return len(enc.encode(text))
        except Exception:
            pass
    return max(1, len(text) // _CHARS_PER_TOKEN)


def _check_sumy() -> bool:
    global _SUMY_AVAILABLE
    if _SUMY_AVAILABLE is not None:
        return _SUMY_AVAILABLE
    try:
        import sumy  # noqa: F401
        _SUMY_AVAILABLE = True
    except ImportError:
        logger.warning("sumy not installed — doc summarization will truncate. Run: uv add sumy")
        _SUMY_AVAILABLE = False
    return _SUMY_AVAILABLE


def _ensure_nltk_data() -> None:
    """Ensure NLTK punkt tokenizer data is present. Runs at most once per process."""
    global _NLTK_CHECKED
    if _NLTK_CHECKED:
        return
    _NLTK_CHECKED = True
    try:
        import nltk

        def _has(path: str) -> bool:
            try:
                nltk.data.find(path)
                return True
            except LookupError:
                return False

        if _has("tokenizers/punkt_tab/english/") or _has("tokenizers/punkt/english.pickle"):
            return

        for resource in ("punkt_tab", "punkt"):
            try:
                nltk.download(resource, quiet=True)
            except Exception:
                continue
            if _has("tokenizers/punkt_tab/english/") or _has("tokenizers/punkt/english.pickle"):
                return
    except Exception as e:
        logger.warning("NLTK setup failed: %s", e)


def _patch_sumy_tokenizer() -> None:
    """Make sumy compatible with NLTK punkt_tab (newer NLTK versions)."""
    try:
        from sumy.nlp import tokenizers as sumy_tokenizers
        if getattr(sumy_tokenizers.Tokenizer, "_aether_punkt_patch", False):
            return

        original = sumy_tokenizers.Tokenizer._get_sentence_tokenizer

        def _patched(self, language):
            try:
                return original(self, language)
            except LookupError as err:
                try:
                    from nltk.tokenize import PunktTokenizer
                    return PunktTokenizer(language)
                except Exception:
                    raise err

        sumy_tokenizers.Tokenizer._get_sentence_tokenizer = _patched
        sumy_tokenizers.Tokenizer._aether_punkt_patch = True  # type: ignore[attr-defined]
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Noise filtering
# ---------------------------------------------------------------------------

def _is_noise_sentence(sent: str) -> bool:
    if len(sent) < _MIN_SENTENCE_CHARS:
        return True
    if not any(c.isalpha() for c in sent):
        return True
    if re.match(r"^(\d{1,4}|[ivxlcdm]+)\.?$", sent, re.IGNORECASE):
        return True
    if ("http://" in sent or "https://" in sent) and len(sent.split()) <= 3:
        return True
    if len(_BIB_MARKER_RE.findall(sent)) >= 2:
        return True
    return False


# ---------------------------------------------------------------------------
# Sentence splitting with offset tracking
# ---------------------------------------------------------------------------

def _split_sentences_with_offsets(text: str) -> list[tuple[str, int, int]]:
    """Split text into (sentence, start_char, end_char) tuples via NLTK."""
    _ensure_nltk_data()
    import nltk

    try:
        raw_sents = nltk.sent_tokenize(text, language="english")
    except LookupError:
        from nltk.tokenize import PunktTokenizer
        raw_sents = PunktTokenizer("english").tokenize(text)

    result: list[tuple[str, int, int]] = []
    search_from = 0
    for sent in raw_sents:
        sent = sent.strip()
        if not sent:
            continue
        pos = text.find(sent, search_from)
        if pos == -1:
            pos = text.find(sent)
        if pos == -1:
            continue
        end = pos + len(sent)
        if not _is_noise_sentence(sent):
            result.append((sent, pos, end))
        search_from = pos + 1
    return result


# ---------------------------------------------------------------------------
# LexRank selection
# ---------------------------------------------------------------------------

def _lexrank_select(full_text: str, all_sents: list[tuple[str, int, int]], n_sentences: int) -> set[int]:
    """Return indices of top-N sentences by LexRank score."""
    try:
        _ensure_nltk_data()
        _patch_sumy_tokenizer()
        from sumy.nlp.tokenizers import Tokenizer
        from sumy.parsers.plaintext import PlaintextParser
        from sumy.summarizers.lex_rank import LexRankSummarizer

        parser = PlaintextParser.from_string(full_text, Tokenizer("english"))
        summarizer = LexRankSummarizer()
        scored_sents = summarizer(parser.document, n_sentences)
        # Map scored sentence strings back to offset-tracked indices
        scored_texts = {str(s) for s in scored_sents}
        selected: set[int] = set()
        for i, (s_text, _, _) in enumerate(all_sents):
            if s_text in scored_texts:
                selected.add(i)
        # If mapping mismatch, fall back to lead-N
        if not selected:
            return set(range(min(n_sentences, len(all_sents))))
        return selected
    except Exception as e:
        logger.warning("LexRank failed, using lead-N: %s", e)
        return set(range(min(n_sentences, len(all_sents))))


# ---------------------------------------------------------------------------
# Head/tail extraction for code
# ---------------------------------------------------------------------------

def _extract_code_head_tail(text: str, name: str, max_tokens: int, target_sentences: int) -> str:
    max_chars = max_tokens * _CHARS_PER_TOKEN
    lines = text.splitlines()
    total = len(lines)
    head_n = min(target_sentences * 2, total)
    tail_n = min(target_sentences, total)

    if head_n + tail_n >= total:
        return text

    head = lines[:head_n]
    tail = lines[total - tail_n:]
    body = "\n".join(head) + "\n\n... [SKIPPED SECTION] ...\n\n" + "\n".join(tail)
    if len(body) > max_chars:
        half = max_chars // 2
        body = body[:half] + "\n\n... [TRUNCATED] ...\n\n" + body[-half:]
    return body


# ---------------------------------------------------------------------------
# Core extraction
# ---------------------------------------------------------------------------

def _smart_extract(
    text: str,
    max_tokens: int,
    target_sentences: int,
    is_code: bool = False,
) -> tuple[str, bool]:
    """Run the Gate → Split → Score → Select pipeline.

    Returns (extracted_text, was_summarized).
    """
    token_count = estimate_tokens(text)
    if token_count <= max_tokens:
        return text, False

    if is_code or len(text) > _MAX_LEXRANK_CHARS:
        return _extract_code_head_tail(text, "content", max_tokens, target_sentences), True

    all_sents = _split_sentences_with_offsets(text)
    if not all_sents:
        # No sentences parseable — fall back to char truncation
        truncated = text[: max_tokens * _CHARS_PER_TOKEN]
        return truncated, True

    n = len(all_sents)
    target = min(target_sentences, n)
    selected_indices = _lexrank_select(text, all_sents, target)

    parts: list[str] = []
    prev = -1
    for idx in sorted(selected_indices):
        if prev != -1 and idx > prev + 1:
            parts.append("\n... [SKIPPED SECTION] ...\n")
        parts.append(all_sents[idx][0])
        prev = idx

    return " ".join(parts), True


# ---------------------------------------------------------------------------
# Config resolution
# ---------------------------------------------------------------------------

def _get_config_values(token_threshold: int | None, max_sentences: int | None) -> tuple[int, int]:
    default_threshold = 2000
    default_sentences = 10
    try:
        from deerflow.config.doc_summarization_config import get_doc_summarization_config
        cfg = get_doc_summarization_config()
        if not cfg.enabled:
            return 10_000_000, default_sentences
        return (
            token_threshold if token_threshold is not None else cfg.token_threshold,
            max_sentences if max_sentences is not None else cfg.max_sentences,
        )
    except Exception:
        return (
            token_threshold if token_threshold is not None else default_threshold,
            max_sentences if max_sentences is not None else default_sentences,
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def maybe_summarize(
    content: str,
    source: str,
    source_type: str = "file",
    token_threshold: int | None = None,
    max_sentences: int | None = None,
) -> str:
    """Summarize content if it exceeds the token threshold.

    Returns the original content unchanged if under threshold.
    If over threshold, runs the LexRank pipeline and wraps the result with
    metadata so the agent knows it received a summary and how to get more.

    Args:
        content: Raw text from a tool.
        source: File path or URL — used in the summary header.
        source_type: "file" or "url" — controls the read-more hint.
        token_threshold: Override config threshold.
        max_sentences: Override config sentence count.
    """
    if not content or not content.strip():
        return content

    threshold, sentences = _get_config_values(token_threshold, max_sentences)

    token_count = estimate_tokens(content)
    if token_count <= threshold:
        return content

    # Detect if content looks like code
    is_code = any(source.endswith(ext) for ext in _CODE_EXTENSIONS) if source else False

    if not _check_sumy():
        # sumy unavailable — truncate with note
        approx_chars = threshold * _CHARS_PER_TOKEN
        truncated = content[:approx_chars]
        hint = (
            f'Use read_file path="{source}" with start_line/end_line to read sections.'
            if source_type == "file"
            else f'Re-fetch "{source}" with a more focused query.'
        )
        return (
            f'[CONTENT_TRUNCATED source="{source}" original_tokens={token_count} shown_tokens_approx={threshold}]\n'
            f"Content exceeds {threshold} tokens. {hint}\n\n"
            f"{truncated}\n"
            f"[END_TRUNCATED]"
        )

    try:
        extracted, was_summarized = _smart_extract(content, threshold, sentences, is_code=is_code)

        if not was_summarized:
            return content

        if not extracted or not extracted.strip():
            return content

        total_lines = content.count("\n") + 1
        summary_tokens = estimate_tokens(extracted)
        ratio = round(summary_tokens / token_count, 2)

        if source_type == "file":
            read_hint = f'Use read_file path="{source}" with start_line/end_line to read specific sections.'
        else:
            read_hint = f'Re-fetch "{source}" with a more focused query, or request specific sections.'

        skipped_count = content.count("[SKIPPED SECTION]") if "[SKIPPED SECTION]" in extracted else 0
        skipped_note = f" ({skipped_count} section(s) skipped)" if skipped_count else ""

        return (
            f'[DOC_SUMMARY source="{source}" total_lines={total_lines} '
            f"original_tokens={token_count} summary_tokens={summary_tokens} ratio={ratio}{skipped_note}]\n"
            f"NOTE: Document exceeded {threshold} tokens. Extractive summary (LexRank) shown — "
            f"most informative sentences preserved in document order.\n"
            f"To read full content: {read_hint}\n\n"
            f"{extracted}\n\n"
            f"[END_DOC_SUMMARY]"
        )
    except Exception as e:
        logger.warning("Summarization failed for source=%s: %s", source, e)
        return content


def summarize_messages_with_sumy(messages_text: str, target_sentences: int = 15) -> str:
    """Summarize a block of conversation messages using LexRank (no LLM needed).

    Used as fallback in the compact engine when no LLM is configured.
    Designed for conversation text: each speaker turn is treated as a sentence
    group, and LexRank surfaces the most information-dense exchanges.

    Args:
        messages_text: Pre-formatted conversation text (role: content lines).
        target_sentences: Number of sentences to extract.

    Returns:
        Extractive summary string, or original text if summarization fails.
    """
    if not messages_text or not messages_text.strip():
        return messages_text

    if not _check_sumy():
        # Return head/tail of conversation as fallback
        lines = messages_text.splitlines()
        if len(lines) <= 40:
            return messages_text
        head = lines[:20]
        tail = lines[-20:]
        return "\n".join(head) + "\n\n... [earlier conversation omitted] ...\n\n" + "\n".join(tail)

    try:
        all_sents = _split_sentences_with_offsets(messages_text)
        if not all_sents or len(all_sents) <= target_sentences:
            return messages_text

        selected_indices = _lexrank_select(messages_text, all_sents, target_sentences)

        parts: list[str] = []
        prev = -1
        for idx in sorted(selected_indices):
            if prev != -1 and idx > prev + 1:
                parts.append("\n[...earlier exchange omitted...]\n")
            parts.append(all_sents[idx][0])
            prev = idx

        return "\n".join(parts)
    except Exception as e:
        logger.warning("Conversation sumy summarization failed: %s", e)
        return messages_text
