#!/usr/bin/env python3
"""Server locale senza dipendenze per FantaPol."""

from __future__ import annotations

import argparse
import http.server
import os
import pathlib
import socket
import sys
import threading
import time
import urllib.parse
import webbrowser


ROOT = pathlib.Path(__file__).resolve().parent.parent


class FantaPolServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], handler: type[http.server.BaseHTTPRequestHandler]):
        super().__init__(address, handler)
        self.last_heartbeat = time.monotonic()
        self.page_seen = False
        self.page_closed = False


class Handler(http.server.SimpleHTTPRequestHandler):
    server: FantaPolServer

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _heartbeat(self) -> None:
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        self.server.last_heartbeat = time.monotonic()
        self.server.page_seen = True
        self.server.page_closed = "closed" in query
        self.send_response(204)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self) -> None:
        if urllib.parse.urlsplit(self.path).path == "/heartbeat.php":
            self._heartbeat()
            return
        super().do_GET()

    def do_POST(self) -> None:
        if urllib.parse.urlsplit(self.path).path == "/heartbeat.php":
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length:
                self.rfile.read(length)
            self._heartbeat()
            return
        self.send_error(405, "Metodo non consentito")

    def log_message(self, fmt: str, *args: object) -> None:
        if not self.path.startswith("/heartbeat.php"):
            super().log_message(fmt, *args)


def watchdog(server: FantaPolServer) -> None:
    while True:
        time.sleep(2)
        idle = time.monotonic() - server.last_heartbeat
        if (server.page_closed and idle > 2) or (server.page_seen and idle > 65):
            print("\nFantaPol chiuso: arresto del server locale.")
            server.shutdown()
            return


def main() -> int:
    parser = argparse.ArgumentParser(description="Avvia FantaPol nel browser.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    try:
        server = FantaPolServer((args.host, args.port), Handler)
    except OSError as error:
        print(f"Impossibile usare {args.host}:{args.port}: {error}", file=sys.stderr)
        return 1

    url = f"http://{args.host}:{args.port}/index.html?v=18"
    threading.Thread(target=watchdog, args=(server,), daemon=True).start()
    print(f"FantaPol è disponibile su {url}")
    print("Chiudi la scheda del browser oppure premi Ctrl+C per fermare il server.")
    if not args.no_browser:
        threading.Timer(0.35, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nArresto di FantaPol.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
