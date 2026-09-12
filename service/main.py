"""MarkItDown Desktop sidecar.

Speaks newline-delimited JSON over stdin/stdout to the Electron main process.
One line in = one request; one or more lines out = progress plus a terminal
result or error. Deliberately not an HTTP server: binding a socket would make
macOS prompt about incoming network connections on first launch, which we don't
want in a "just works" download.

Threading model
---------------
The main thread does nothing but read stdin, so the app stays responsive to
``ping``/``cancel`` even mid-conversion. All conversion happens on a single
worker thread, which confines the MarkItDown instance to one thread and sidesteps
any thread-safety questions in the underlying converters.

stdout discipline
-----------------
stdout is the protocol channel. A stray ``print`` from any dependency would
corrupt the stream, so the real stdout is duplicated to a private handle and
``sys.stdout`` is repointed at stderr. Library output then becomes harmless log
noise instead of a protocol violation.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Optional

# --- Claim the real stdout before anything else can write to it -------------
_PROTOCOL_OUT = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", newline="\n")
sys.stdout = sys.stderr  # type: ignore[assignment]

from converter import (  # noqa: E402  (must follow the stdout swap)
    ALL_EXTENSIONS,
    SUPPORTED_EXTENSIONS,
    ConversionError,
    Converter,
)

SERVICE_VERSION = "1.0.0"

_write_lock = threading.Lock()
_converter = Converter()
_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="convert")
_inflight: dict[str, Future] = {}
_inflight_lock = threading.Lock()


def emit(payload: dict[str, Any]) -> None:
    """Write one protocol message. Safe to call from any thread."""
    line = json.dumps(payload, ensure_ascii=False)
    with _write_lock:
        try:
            _PROTOCOL_OUT.write(line + "\n")
            _PROTOCOL_OUT.flush()
        except (BrokenPipeError, ValueError):
            # Parent went away mid-write; nothing useful left to do.
            os._exit(0)


def log(message: str) -> None:
    print(f"[sidecar] {message}", file=sys.stderr, flush=True)


# ------------------------------------------------------------------ methods


def _handle_convert_file(req_id: str, params: dict[str, Any]) -> None:
    path = params.get("path")
    emit({"id": req_id, "event": "progress", "stage": "converting"})
    result = _converter.convert_file(path)
    emit({"id": req_id, "result": result.to_dict()})


def _handle_convert_url(req_id: str, params: dict[str, Any]) -> None:
    url = params.get("url")
    emit({"id": req_id, "event": "progress", "stage": "fetching"})
    result = _converter.convert_url(url)
    emit({"id": req_id, "result": result.to_dict()})


def _run_job(req_id: str, method: str, params: dict[str, Any]) -> None:
    """Execute one conversion on the worker thread, never raising."""
    try:
        if method == "convert_file":
            _handle_convert_file(req_id, params)
        else:
            _handle_convert_url(req_id, params)
    except ConversionError as exc:
        emit({"id": req_id, "error": exc.to_dict()})
    except Exception as exc:  # noqa: BLE001 - last line of defence
        log("unhandled error:\n" + traceback.format_exc())
        emit(
            {
                "id": req_id,
                "error": {
                    "kind": "unexpected",
                    "message": "Something went wrong during conversion.",
                    "hint": f"{type(exc).__name__}: {exc}",
                },
            }
        )
    finally:
        with _inflight_lock:
            _inflight.pop(req_id, None)


def _dispatch(request: dict[str, Any]) -> None:
    req_id = str(request.get("id", ""))
    method = request.get("method", "")
    params = request.get("params") or {}

    if method == "ping":
        emit({"id": req_id, "result": {"ok": True, "version": SERVICE_VERSION}})
        return

    if method == "formats":
        emit(
            {
                "id": req_id,
                "result": {"groups": SUPPORTED_EXTENSIONS, "all": ALL_EXTENSIONS},
            }
        )
        return

    if method == "cancel":
        target = str(params.get("target", ""))
        with _inflight_lock:
            future = _inflight.get(target)
        cancelled = bool(future and future.cancel())
        if cancelled:
            with _inflight_lock:
                _inflight.pop(target, None)
            emit({"id": target, "error": {"kind": "cancelled", "message": "Cancelled.", "hint": ""}})
        emit({"id": req_id, "result": {"cancelled": cancelled}})
        return

    if method == "shutdown":
        emit({"id": req_id, "result": {"ok": True}})
        raise SystemExit(0)

    if method in ("convert_file", "convert_url"):
        if not req_id:
            emit({"id": "", "error": {"kind": "bad_request", "message": "Request is missing an id.", "hint": ""}})
            return
        future = _pool.submit(_run_job, req_id, method, params)
        with _inflight_lock:
            _inflight[req_id] = future
        return

    emit(
        {
            "id": req_id,
            "error": {"kind": "unknown_method", "message": f"Unknown method: {method}", "hint": ""},
        }
    )


# --------------------------------------------------------------------- main


def main() -> int:
    emit({"event": "ready", "version": SERVICE_VERSION, "pid": os.getpid()})

    # Pay the markitdown/magika/pandas import cost up front on the worker thread
    # so the first real conversion feels immediate.
    def _warm() -> None:
        try:
            _converter.warm_up()
            emit({"event": "warm"})
        except Exception:  # noqa: BLE001
            log("warm-up failed:\n" + traceback.format_exc())
            emit({"event": "warm", "failed": True})

    _pool.submit(_warm)

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            log(f"ignoring malformed line: {line[:200]}")
            continue
        if not isinstance(request, dict):
            continue
        try:
            _dispatch(request)
        except SystemExit:
            break
        except Exception:  # noqa: BLE001
            log("dispatch error:\n" + traceback.format_exc())

    # stdin closed: the parent quit, so we should too.
    _pool.shutdown(wait=False, cancel_futures=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
