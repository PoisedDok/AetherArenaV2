"""Smart extractive summarizer for large tool outputs.

Pipeline: Gate → Sentence-split (NLTK) → LexRank score (sumy) → Select top-N.

- Gate: content that fits within the token budget is returned verbatim (zero loss).
- Sentence splitting: NLTK sent_tokenize with offset tracking.
- Scoring: LexRank (Erkan & Radev, 2004) via sumy — graph centrality over
  TF-IDF cosine similarity.  Code content uses head/tail extraction instead.
- Selection: sentences are selected until the target token ratio is reached.
  n_sentences = max(min_sentences, int(token_count * target_ratio / avg_tokens_per_sent))
  This keeps ~15–20% of the original by default, proportional to document size.
- Gaps between selected sentences are marked with [SKIPPED SECTION] so the
  agent can see where content was omitted.
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
# Raise ceiling — large docs up to ~400k chars (~100k tokens) still use LexRank.
# Head/tail fallback only kicks in beyond this.
_MAX_LEXRANK_CHARS = 400_000
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

def _extract_code_head_tail(text: str, name: str, max_tokens: int, n_sentences: int) -> str:
    max_chars = max_tokens * _CHARS_PER_TOKEN
    lines = text.splitlines()
    total = len(lines)
    head_n = min(n_sentences * 2, total)
    tail_n = min(n_sentences, total)

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
# Config resolution
# ---------------------------------------------------------------------------

def _get_summarization_params(
    token_threshold: int | None,
    target_ratio: float | None,
) -> tuple[int, float, int]:
    """Returns (threshold, target_ratio, min_sentences)."""
    default_threshold = 2000
    default_ratio = 0.175
    default_min_sentences = 15
    try:
        from aether.config.doc_summarization_config import get_doc_summarization_config
        cfg = get_doc_summarization_config()
        if not cfg.enabled:
            return 10_000_000, default_ratio, default_min_sentences
        return (
            token_threshold if token_threshold is not None else cfg.token_threshold,
            target_ratio if target_ratio is not None else cfg.target_ratio,
            cfg.min_sentences,
        )
    except Exception:
        return (
            token_threshold if token_threshold is not None else default_threshold,
            target_ratio if target_ratio is not None else default_ratio,
            default_min_sentences,
        )


# ---------------------------------------------------------------------------
# Core extraction
# ---------------------------------------------------------------------------

def _smart_extract(
    text: str,
    max_tokens: int,
    target_ratio: float = 0.175,
    min_sentences: int = 15,
    is_code: bool = False,
) -> tuple[str, bool]:
    """Run the Gate → Split → Score → Select pipeline.

    Derives n_sentences from target_ratio × document size so the summary
    always retains roughly target_ratio of the source tokens regardless of
    document length.

    Returns (extracted_text, was_summarized).
    """
    token_count = estimate_tokens(text)
    if token_count <= max_tokens:
        return text, False

    if is_code or len(text) > _MAX_LEXRANK_CHARS:
        # Estimate n_sentences for head/tail as well
        n_est = max(min_sentences, int(token_count * target_ratio / max(1, token_count / max(1, text.count(".") + 1))))
        return _extract_code_head_tail(text, "content", max_tokens, n_est), True

    all_sents = _split_sentences_with_offsets(text)
    if not all_sents:
        # No sentences parseable — fall back to char truncation
        truncated = text[: max_tokens * _CHARS_PER_TOKEN]
        return truncated, True

    n = len(all_sents)

    # Derive sentence count from ratio: how many sentences ≈ target_ratio of tokens
    target_tokens = int(token_count * target_ratio)
    avg_tokens_per_sent = token_count / n
    n_sentences = max(min_sentences, int(target_tokens / max(1.0, avg_tokens_per_sent)))
    n_sentences = min(n_sentences, n)

    selected_indices = _lexrank_select(text, all_sents, n_sentences)

    parts: list[str] = []
    prev = -1
    for idx in sorted(selected_indices):
        if prev != -1 and idx > prev + 1:
            parts.append("\n... [SKIPPED SECTION] ...\n")
        parts.append(all_sents[idx][0])
        prev = idx

    return " ".join(parts), True


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def maybe_summarize(
    content: str,
    source: str,
    source_type: str = "file",
    token_threshold: int | None = None,
    target_ratio: float | None = None,
) -> str:
    """Summarize content if it exceeds the token threshold.

    Returns the original content unchanged if under threshold.
    If over threshold, runs the LexRank pipeline and wraps the result with
    metadata so the agent knows it received a summary and how to get more.

    The number of sentences extracted is derived from target_ratio × document
    size so the summary retains roughly that fraction of the source tokens
    (default ~17.5%, i.e. the best 15–20% of the document).

    Args:
        content: Raw text from a tool.
        source: File path or URL — used in the summary header.
        source_type: "file" or "url" — controls the read-more hint.
        token_threshold: Override config threshold (tokens).
        target_ratio: Override config ratio (0.0–1.0).
    """
    if not content or not content.strip():
        return content

    threshold, ratio, min_sentences = _get_summarization_params(token_threshold, target_ratio)

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
            f'Use read_file path="{source}" with start_line/end_line to read a section, '
            f'or raw=True to read the complete document.'
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
        extracted, was_summarized = _smart_extract(content, threshold, target_ratio=ratio, min_sentences=min_sentences, is_code=is_code)

        if not was_summarized:
            return content

        if not extracted or not extracted.strip():
            return content

        total_lines = content.count("\n") + 1
        summary_tokens = estimate_tokens(extracted)
        actual_ratio = round(summary_tokens / token_count, 2)

        if source_type == "file":
            read_hint = (
                f'Use read_file path="{source}" with start_line/end_line to read a specific section '
                f'(e.g. start_line=1 end_line=100), or raw=True to read the complete document without summarization.'
            )
        else:
            read_hint = f'Re-fetch "{source}" with a more focused query, or request specific sections.'

        skipped_count = extracted.count("[SKIPPED SECTION]")
        skipped_note = f" ({skipped_count} section(s) skipped)" if skipped_count else ""

        return (
            f'[DOC_SUMMARY source="{source}" total_lines={total_lines} '
            f"original_tokens={token_count} summary_tokens={summary_tokens} ratio={actual_ratio}{skipped_note}]\n"
            f"NOTE: Document exceeded {threshold} tokens. Extractive summary (LexRank) shown — "
            f"best ~{int(ratio * 100)}% of content preserved in document order.\n"
            f"To read more: {read_hint}\n\n"
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
