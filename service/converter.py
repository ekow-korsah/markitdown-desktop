"""Thin wrapper around Microsoft's markitdown.

Two jobs:

1. Own the single ``MarkItDown`` instance and expose file/URL conversion.
2. Translate markitdown's exceptions into ``{kind, message, hint}`` dicts that the
   UI can show verbatim. The renderer must never have to display a traceback.

Everything here runs on the single worker thread owned by ``main.py``. The
``MarkItDown`` instance is therefore confined to one thread and needs no locking.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlparse

# Extensions markitdown can handle with the extras we bundle
# (pdf, docx, pptx, xlsx, xls, youtube-transcription).
# Shared with the renderer via the `formats` RPC method so the file picker,
# the drop zone and the backend all agree on one list.
SUPPORTED_EXTENSIONS: dict[str, list[str]] = {
    "Documents": ["pdf", "docx", "pptx", "xlsx", "xls", "epub"],
    "Web & data": ["html", "htm", "csv", "json", "xml"],
    "Notes & code": ["txt", "md", "markdown", "rst", "ipynb"],
    "Images": ["jpg", "jpeg", "png"],
    "Archives": ["zip"],
    "Mail": ["msg"],
}

ALL_EXTENSIONS: list[str] = sorted(
    {ext for group in SUPPORTED_EXTENSIONS.values() for ext in group}
)

# Files above this size are rejected up front rather than hanging the queue.
MAX_FILE_BYTES = 512 * 1024 * 1024  # 512 MB

# (connect, read) seconds. markitdown's own session passes no timeout at all, so
# without this a slow or hanging host would block the queue indefinitely.
HTTP_TIMEOUT = (10, 60)

# markitdown defaults to the python-requests User-Agent, which Wikipedia,
# Cloudflare-fronted sites and most news sites reject outright with 403. A
# normal browser UA is the difference between "paste a link" working on the real
# web and failing on a large share of it.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


class ConversionError(Exception):
    """A conversion failure already translated into UI-ready form."""

    def __init__(self, kind: str, message: str, hint: str = "") -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.hint = hint

    def to_dict(self) -> dict[str, str]:
        return {"kind": self.kind, "message": self.message, "hint": self.hint}


@dataclass
class ConversionResult:
    markdown: str
    title: Optional[str]
    source: str
    source_kind: str  # "file" | "url"
    duration_ms: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "markdown": self.markdown,
            "title": self.title,
            "source": self.source,
            "sourceKind": self.source_kind,
            "durationMs": self.duration_ms,
            "chars": len(self.markdown),
        }


class Converter:
    """Lazily-initialised holder for the MarkItDown instance.

    Construction is deferred because importing markitdown pulls in magika (which
    loads an ONNX model) plus pandas — together several seconds. Deferring keeps
    process startup instant; ``warm_up()`` pays the cost in the background so the
    first real conversion doesn't.
    """

    def __init__(self) -> None:
        self._md: Any = None

    def warm_up(self) -> None:
        self._ensure()

    def _ensure(self) -> Any:
        if self._md is None:
            # Imported here, not at module scope, so startup stays fast and an
            # install problem surfaces as a clean error rather than a crash.
            from markitdown import MarkItDown

            self._md = MarkItDown(
                enable_plugins=False,
                requests_session=_build_session(),
            )
        return self._md

    # ---------------------------------------------------------------- files

    def convert_file(self, path: str) -> ConversionResult:
        if not path:
            raise ConversionError("bad_request", "No file path was provided.")

        expanded = os.path.abspath(os.path.expanduser(path))

        if not os.path.exists(expanded):
            raise ConversionError(
                "not_found",
                f"Can't find {os.path.basename(expanded)}.",
                "The file may have been moved, renamed or deleted since it was added.",
            )
        if os.path.isdir(expanded):
            raise ConversionError(
                "is_directory",
                f"{os.path.basename(expanded)} is a folder, not a file.",
                "Open the folder and drop the files inside it instead.",
            )

        size = os.path.getsize(expanded)
        if size == 0:
            raise ConversionError(
                "empty_file",
                f"{os.path.basename(expanded)} is empty.",
                "There's no content to convert.",
            )
        if size > MAX_FILE_BYTES:
            raise ConversionError(
                "too_large",
                f"{os.path.basename(expanded)} is {_human_size(size)}, which is too large.",
                f"The limit is {_human_size(MAX_FILE_BYTES)}.",
            )

        started = time.monotonic()
        try:
            result = self._ensure().convert_local(expanded)
        except Exception as exc:  # noqa: BLE001 - deliberately broad, mapped below
            raise _translate(exc, os.path.basename(expanded), is_url=False) from exc

        return ConversionResult(
            markdown=result.markdown,
            title=result.title,
            source=expanded,
            source_kind="file",
            duration_ms=int((time.monotonic() - started) * 1000),
        )

    # ----------------------------------------------------------------- urls

    def convert_url(self, url: str) -> ConversionResult:
        url = (url or "").strip()
        if not url:
            raise ConversionError("bad_request", "No URL was provided.")

        # Accept "example.com/page" the way a browser address bar would.
        if "://" not in url:
            url = "https://" + url

        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise ConversionError(
                "bad_url",
                f"{parsed.scheme}: links aren't supported.",
                "Paste a web address starting with http:// or https://.",
            )
        if not parsed.netloc:
            raise ConversionError(
                "bad_url",
                "That doesn't look like a web address.",
                "Paste a full link, for example https://example.com/article.",
            )

        started = time.monotonic()
        try:
            result = self._ensure().convert_uri(url)
        except Exception as exc:  # noqa: BLE001 - deliberately broad, mapped below
            raise _translate(exc, url, is_url=True) from exc

        return ConversionResult(
            markdown=result.markdown,
            title=result.title,
            source=url,
            source_kind="url",
            duration_ms=int((time.monotonic() - started) * 1000),
        )


# ------------------------------------------------------------------ session


def _build_session() -> Any:
    """A requests session that behaves like a browser and always times out.

    Supplying our own session means we lose markitdown's default Accept header,
    so it's reproduced here - some servers (Cloudflare's markdown-for-agents)
    serve clean Markdown directly when asked, which beats converting their HTML.
    """
    import requests

    class _TimeoutSession(requests.Session):
        def request(self, *args: Any, **kwargs: Any) -> Any:
            kwargs.setdefault("timeout", HTTP_TIMEOUT)
            return super().request(*args, **kwargs)

    session = _TimeoutSession()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/markdown, text/html;q=0.9, text/plain;q=0.8, */*;q=0.1",
            "Accept-Language": "en-US,en;q=0.9",
        }
    )
    return session


# -------------------------------------------------------------- translation


def _translate(exc: Exception, label: str, *, is_url: bool) -> ConversionError:
    """Map an arbitrary exception onto a message worth showing a person."""
    # Import inside the function: if markitdown itself failed to import, we still
    # want to produce a sane error rather than raising ImportError from a handler.
    try:
        from markitdown import (
            FileConversionException,
            MissingDependencyException,
            UnsupportedFormatException,
        )
    except Exception:  # pragma: no cover - only when the bundle is broken
        return ConversionError(
            "internal",
            "The conversion engine failed to load.",
            "Reinstalling the app should fix this.",
        )

    if isinstance(exc, ConversionError):
        return exc

    if isinstance(exc, UnsupportedFormatException):
        return ConversionError(
            "unsupported_format",
            f"{label} isn't a format MarkItDown can read.",
            "Supported types include PDF, Word, PowerPoint, Excel, HTML, CSV, JSON, "
            "XML, EPUB, images and ZIP archives.",
        )

    if isinstance(exc, MissingDependencyException):
        return ConversionError(
            "missing_dependency",
            f"Support for this file type isn't included in this build.",
            str(exc).strip() or "A converter this file needs wasn't bundled.",
        )

    if isinstance(exc, FileConversionException):
        # FileConversionException carries the per-converter attempts; the last
        # underlying error is far more useful than the wrapper's own message.
        detail = _last_attempt_detail(exc)
        return ConversionError(
            "conversion_failed",
            f"Couldn't convert {label}.",
            detail or "The file may be corrupt, password-protected, or an unusual variant.",
        )

    # Network problems only make sense to report for URLs.
    name = type(exc).__name__
    if is_url and name in {
        "ConnectionError",
        "Timeout",
        "ConnectTimeout",
        "ReadTimeout",
        "TooManyRedirects",
        "SSLError",
    }:
        return ConversionError(
            "network_error",
            "Couldn't reach that page.",
            "Check the link and your internet connection, then try again.",
        )

    if is_url and name == "HTTPError":
        status = getattr(getattr(exc, "response", None), "status_code", None)
        messages = {
            401: ("That page requires signing in.", "MarkItDown can only read pages that are publicly accessible."),
            403: ("That site refused the request.", "Some sites block automated access. Try saving the page as HTML or PDF and dropping the file in instead."),
            404: ("That page doesn't exist.", "Check the link for typos."),
            429: ("That site is rate-limiting us.", "Wait a minute and try again."),
        }
        if status in messages:
            message, hint = messages[status]
            return ConversionError("network_error", message, hint)
        if status and status >= 500:
            return ConversionError(
                "network_error",
                "That site is having problems right now.",
                f"It returned a {status} error. Try again later.",
            )
        return ConversionError(
            "network_error",
            "That page couldn't be fetched.",
            str(exc).strip() or "The site returned an error.",
        )

    if isinstance(exc, PermissionError):
        return ConversionError(
            "permission_denied",
            f"macOS wouldn't let the app read {label}.",
            "Grant access in System Settings → Privacy & Security → Files and Folders, "
            "or move the file somewhere else and try again.",
        )

    if isinstance(exc, ValueError):
        return ConversionError(
            "bad_request",
            f"Couldn't process {label}.",
            str(exc).strip(),
        )

    return ConversionError(
        "unexpected",
        f"Something went wrong converting {label}.",
        f"{name}: {exc}".strip(),
    )


def _last_attempt_detail(exc: Exception) -> str:
    """Pull the underlying error out of a FileConversionException's attempts."""
    attempts = getattr(exc, "attempts", None) or []
    for attempt in reversed(attempts):
        exc_info = getattr(attempt, "exc_info", None)
        if exc_info and len(exc_info) >= 2 and exc_info[1] is not None:
            inner = exc_info[1]
            text = str(inner).strip()
            if text:
                return f"{type(inner).__name__}: {text}"
    return str(exc).strip()


def _human_size(num_bytes: int) -> str:
    size = float(num_bytes)
    for unit in ("bytes", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "bytes" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"
