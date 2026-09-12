#!/usr/bin/env python3
"""Smoke-test the sidecar over its real stdio protocol.

Run against the dev service:
    ./scripts/test-sidecar.py

Run against the PyInstaller build (this is the one that catches missing data
files such as magika's ONNX model):
    ./scripts/test-sidecar.py --binary service/dist/markitdown-service/markitdown-service

Add --network to also exercise URL and YouTube conversion.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "assets" / "fixtures"

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


class Client:
    def __init__(self, cmd: list[str], cwd: Path) -> None:
        self.proc = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.responses: dict[str, dict] = {}
        self.events: list[dict] = []
        self.lock = threading.Condition()
        self.stderr_lines: list[str] = []
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()
        self._next_id = 0

    def _read_stdout(self) -> None:
        assert self.proc.stdout
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                # A non-JSON line on stdout means something polluted the protocol
                # channel - exactly the failure the stdout swap is meant to prevent.
                with self.lock:
                    self.events.append({"event": "PROTOCOL_POLLUTION", "raw": line[:300]})
                    self.lock.notify_all()
                continue
            with self.lock:
                if "result" in msg or "error" in msg:
                    self.responses[str(msg.get("id", ""))] = msg
                else:
                    self.events.append(msg)
                self.lock.notify_all()

    def _read_stderr(self) -> None:
        assert self.proc.stderr
        for line in self.proc.stderr:
            self.stderr_lines.append(line.rstrip())

    def call(self, method: str, params: dict | None = None, timeout: float = 120.0) -> dict:
        self._next_id += 1
        req_id = str(self._next_id)
        payload = {"id": req_id, "method": method, "params": params or {}}
        assert self.proc.stdin
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

        deadline = time.monotonic() + timeout
        with self.lock:
            while req_id not in self.responses:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(f"{method} timed out after {timeout}s")
                self.lock.wait(remaining)
            return self.responses.pop(req_id)

    def wait_for_event(self, name: str, timeout: float = 90.0) -> dict | None:
        deadline = time.monotonic() + timeout
        with self.lock:
            while True:
                for ev in self.events:
                    if ev.get("event") == name:
                        return ev
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self.lock.wait(remaining)

    def close(self) -> None:
        try:
            assert self.proc.stdin
            self.proc.stdin.close()
            self.proc.wait(timeout=10)
        except Exception:
            self.proc.kill()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", help="path to the packaged sidecar binary")
    parser.add_argument("--network", action="store_true", help="also test URL conversion")
    args = parser.parse_args()

    if args.binary:
        cmd = [str(Path(args.binary).resolve())]
        label = "packaged binary"
    else:
        cmd = [str(ROOT / "service" / ".venv" / "bin" / "python"), "main.py"]
        label = "dev service"

    print(f"{DIM}Testing {label}: {' '.join(cmd)}{RESET}\n")
    client = Client(cmd, cwd=ROOT / "service")

    passed, failed, warned = 0, 0, 0

    def ok(name: str, detail: str = "") -> None:
        nonlocal passed
        passed += 1
        print(f"  {GREEN}PASS{RESET}  {name} {DIM}{detail}{RESET}")

    def warn(name: str, detail: str = "") -> None:
        nonlocal warned
        warned += 1
        print(f"  {YELLOW}WARN{RESET}  {name} {DIM}{detail}{RESET}")

    def bad(name: str, detail: str = "") -> None:
        nonlocal failed
        failed += 1
        print(f"  {RED}FAIL{RESET}  {name} {DIM}{detail}{RESET}")

    # --- startup ---------------------------------------------------------
    print("Startup")
    ready = client.wait_for_event("ready", timeout=30)
    ok("ready event", f"pid {ready.get('pid')}") if ready else bad("ready event", "never arrived")

    t0 = time.monotonic()
    warm = client.wait_for_event("warm", timeout=120)
    if warm and not warm.get("failed"):
        ok("engine warm-up", f"{time.monotonic() - t0:.1f}s")
    elif warm:
        bad("engine warm-up", "reported failure - see stderr")
    else:
        bad("engine warm-up", "timed out")

    r = client.call("ping")
    ok("ping", r.get("result", {}).get("version", "")) if "result" in r else bad("ping", str(r))

    r = client.call("formats")
    n = len(r.get("result", {}).get("all", []))
    ok("formats", f"{n} extensions") if n > 10 else bad("formats", str(r))

    # --- files -----------------------------------------------------------
    print("\nFile conversion")
    for name in [
        "sample.pdf", "sample.docx", "sample.pptx", "sample.xlsx",
        "sample.html", "sample.csv", "sample.json", "sample.xml",
        "sample.txt", "sample.png", "sample.zip",
    ]:
        path = FIXTURES / name
        if not path.exists():
            warn(name, "fixture missing")
            continue
        try:
            r = client.call("convert_file", {"path": str(path)})
        except TimeoutError as exc:
            bad(name, str(exc))
            continue
        if "error" in r:
            bad(name, f"{r['error']['kind']}: {r['error']['message']} {r['error'].get('hint','')}")
        else:
            res = r["result"]
            chars = res["chars"]
            detail = f"{chars} chars, {res['durationMs']}ms"
            # An image with no LLM configured yields only EXIF, often nothing.
            if chars == 0 and name != "sample.png":
                warn(name, "converted but produced no markdown")
            else:
                ok(name, detail)

    # --- error handling --------------------------------------------------
    print("\nError handling (should fail gracefully, never with a traceback)")
    cases = [
        ("missing file", {"path": str(FIXTURES / "nope.pdf")}, "not_found"),
        ("a folder", {"path": str(FIXTURES)}, "is_directory"),
        ("empty path", {"path": ""}, "bad_request"),
    ]
    for label_, params, expected in cases:
        r = client.call("convert_file", params)
        if "error" not in r:
            bad(label_, "unexpectedly succeeded")
        elif r["error"]["kind"] != expected:
            warn(label_, f"got kind={r['error']['kind']}, expected {expected}")
        else:
            ok(label_, r["error"]["message"])

    r = client.call("convert_url", {"url": "ftp://example.com/x"})
    if "error" in r and r["error"]["kind"] == "bad_url":
        ok("bad URL scheme", r["error"]["message"])
    else:
        bad("bad URL scheme", str(r)[:120])

    # --- network ---------------------------------------------------------
    if args.network:
        print("\nURL conversion (network)")
        for label_, url in [
            ("web page", "https://example.com"),
            ("wikipedia", "https://en.wikipedia.org/wiki/Markdown"),
            ("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ]:
            try:
                r = client.call("convert_url", {"url": url}, timeout=90)
            except TimeoutError as exc:
                bad(label_, str(exc))
                continue
            if "error" in r:
                warn(label_, f"{r['error']['kind']}: {r['error']['message']}")
            else:
                ok(label_, f"{r['result']['chars']} chars — {(r['result'].get('title') or '')[:40]}")

    # --- protocol integrity ----------------------------------------------
    print("\nProtocol integrity")
    pollution = [e for e in client.events if e.get("event") == "PROTOCOL_POLLUTION"]
    if pollution:
        bad("stdout kept clean", f"{len(pollution)} non-JSON line(s), e.g. {pollution[0]['raw'][:80]}")
    else:
        ok("stdout kept clean", "all stdout lines were valid JSON")

    client.close()

    print(f"\n{GREEN}{passed} passed{RESET}, {YELLOW}{warned} warned{RESET}, {RED}{failed} failed{RESET}")
    if failed and client.stderr_lines:
        print(f"\n{DIM}--- sidecar stderr (last 30 lines) ---{RESET}")
        print("\n".join(client.stderr_lines[-30:]))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
