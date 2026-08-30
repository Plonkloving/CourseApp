from __future__ import annotations

import json
import os
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
DATA_FILE = ROOT / "data" / "schedule.json"
HOST = "0.0.0.0"
PORT = 8765
EMPTY_STATE = {
    "version": 2,
    "semester": {
        "name": "课程表",
        "weekOneStart": "2026-08-31",
        "classStartDate": "2026-08-31",
        "totalWeeks": 19,
        "campus": "",
    },
    "periods": [],
    "sessions": [],
}


def local_network_urls() -> list[str]:
    addresses: set[str] = set()
    try:
        for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = item[4][0]
            if not address.startswith(("127.", "169.254.")):
                addresses.add(address)
    except OSError:
        pass
    return [f"http://{address}:{PORT}" for address in sorted(addresses)]


class CourseHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/state":
            try:
                payload = json.loads(DATA_FILE.read_text(encoding="utf-8")) if DATA_FILE.exists() else EMPTY_STATE
                self.send_json(payload)
            except (OSError, json.JSONDecodeError) as exc:
                self.send_json({"error": f"无法读取课程数据：{exc}"}, 500)
            return
        if path == "/api/info":
            self.send_json({"lanUrls": local_network_urls(), "port": PORT})
            return
        super().do_GET()

    def do_PUT(self) -> None:
        if urlparse(self.path).path != "/api/state":
            self.send_json({"error": "接口不存在"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 2_000_000:
                raise ValueError("数据大小不合法")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            validate_state(payload)
            temporary = DATA_FILE.with_suffix(".json.tmp")
            temporary.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            temporary.replace(DATA_FILE)
            self.send_json({"ok": True})
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            self.send_json({"error": str(exc)}, 400)


def validate_state(state: object) -> None:
    if not isinstance(state, dict) or not isinstance(state.get("sessions"), list):
        raise ValueError("课程数据结构不合法")
    semester = state.get("semester")
    if not isinstance(semester, dict) or not isinstance(semester.get("weekOneStart"), str) or not isinstance(semester.get("classStartDate"), str):
        raise ValueError("教学日期结构不合法")
    if len(state["sessions"]) > 500:
        raise ValueError("课程条目过多")
    required = {"id", "name", "day", "periodStart", "periodEnd", "weeks", "location"}
    for index, session in enumerate(state["sessions"], start=1):
        if not isinstance(session, dict) or not required.issubset(session):
            raise ValueError(f"第 {index} 条课程缺少必要字段")
        day = session["day"]
        start = session["periodStart"]
        end = session["periodEnd"]
        weeks = session["weeks"]
        if not isinstance(day, int) or day < 1 or day > 7:
            raise ValueError(f"第 {index} 条课程的星期不合法")
        if not isinstance(start, int) or not isinstance(end, int) or start < 1 or end > 13 or start > end:
            raise ValueError(f"第 {index} 条课程的节次不合法")
        if not isinstance(weeks, list) or not weeks or any(not isinstance(w, int) or w < 1 or w > 30 for w in weeks):
            raise ValueError(f"第 {index} 条课程的周次不合法")


def main() -> int:
    url = f"http://127.0.0.1:{PORT}"
    try:
        server = ThreadingHTTPServer((HOST, PORT), CourseHandler)
    except OSError:
        webbrowser.open(url)
        return 0

    if os.environ.get("COURSE_APP_NO_BROWSER") != "1":
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
