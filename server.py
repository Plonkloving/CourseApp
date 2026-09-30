from __future__ import annotations

import json
import os
import socket
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
DATA_FILE = ROOT / "data" / "schedule.json"
AI_CONFIG_FILE = ROOT / "data" / "ai_config.json"
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


def load_ai_config() -> dict:
    try:
        data = json.loads(AI_CONFIG_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_ai_config(config: dict) -> None:
    AI_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = AI_CONFIG_FILE.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(AI_CONFIG_FILE)
    try:
        os.chmod(AI_CONFIG_FILE, 0o600)
    except OSError:
        pass


def public_ai_config() -> dict:
    config = load_ai_config()
    return {
        "ok": True,
        "preset": config.get("preset", "custom"),
        "baseUrl": config.get("baseUrl", ""),
        "model": config.get("model", ""),
        "temperature": config.get("temperature", 1),
        "maxTokens": config.get("maxTokens", 4096),
        "hasKey": bool(config.get("apiKey")),
    }


def normalize_ai_endpoint(base: str, path: str) -> str:
    cleaned = str(base or "").strip().rstrip("/")
    if not cleaned:
        raise ValueError("接口地址为空")
    if not cleaned.lower().startswith(("http://", "https://")):
        cleaned = "https://" + cleaned
    if cleaned.endswith("/chat/completions") or cleaned.endswith("/models"):
        return cleaned
    return cleaned + "/" + path


def validate_ai_target(base: str) -> str:
    target = normalize_ai_endpoint(base, "chat/completions")
    parsed = urlparse(target)
    host = (parsed.hostname or "").lower()
    private = host in {"localhost", "127.0.0.1"} or host.endswith(".local") or host.startswith(("192.168.", "10."))
    if not private and parsed.hostname and parsed.hostname.startswith("172."):
        try:
            second = int(host.split(".")[1])
            private = 16 <= second <= 31
        except (IndexError, ValueError):
            private = False
    if parsed.scheme != "https" and not private:
        raise ValueError("仅允许 HTTPS 接口或局域网 HTTP 地址")
    return target


class CourseHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-cache")
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
        if path == "/api/ai/config":
            self.send_json(public_ai_config())
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/ai/chat":
            self.proxy_ai_chat()
            return
        if path == "/api/ai/models":
            self.proxy_ai_models()
            return
        self.send_json({"error": "接口不存在"}, 404)

    def proxy_ai_chat(self) -> None:
        try:
            payload = self.read_ai_body()
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.send_json({"error": f"请求体不合法：{exc}"}, 400)
            return
        config = load_ai_config()
        if not config.get("baseUrl") or not config.get("model") or not config.get("apiKey"):
            self.send_json({"error": "尚未配置模型：请先在 AI 设置中填写接口地址、模型名称和 API Key"}, 400)
            return
        target = validate_ai_target(str(config["baseUrl"]))
        payload["model"] = str(config["model"])
        payload.setdefault("max_tokens", int(config.get("maxTokens") or 4096))
        thinking = payload.pop("thinking", None) or {}
        if thinking.get("type") != "enabled" and config.get("temperature") not in (None, 1):
            payload["temperature"] = float(config["temperature"])
        request = urllib.request.Request(
            target,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "Authorization": "Bearer " + str(config["apiKey"]),
            },
        )
        try:
            upstream = urllib.request.urlopen(request, timeout=120)
        except urllib.error.HTTPError as exc:
            detail = exc.read(4096).decode("utf-8", "replace")
            self.send_json({"error": f"服务商返回 HTTP {exc.code}：{detail[:400]}"}, 502)
            return
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            self.send_json({"error": f"无法连接模型服务商：{exc}"}, 502)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        total = 0
        try:
            while True:
                chunk = upstream.read(1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > 2_000_000:
                    raise ValueError("响应超过 2 MB 上限")
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (OSError, ValueError) as exc:
            print(f"AI 代理中断：{exc}", file=sys.stderr)
            return
        finally:
            upstream.close()

    def proxy_ai_models(self) -> None:
        try:
            self.read_ai_body()
            config = load_ai_config()
            if not config.get("baseUrl") or not config.get("apiKey"):
                self.send_json({"error": "尚未配置接口地址或 API Key"}, 400)
                return
            target = normalize_ai_endpoint(str(config["baseUrl"]), "models")
            request = urllib.request.Request(
                target,
                method="GET",
                headers={"Accept": "application/json", "Authorization": "Bearer " + str(config["apiKey"])},
            )
            with urllib.request.urlopen(request, timeout=30) as upstream:
                data = upstream.read(65536)
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.send_json({"error": f"请求体不合法：{exc}"}, 400)
            return
        except urllib.error.HTTPError as exc:
            detail = exc.read(4096).decode("utf-8", "replace")
            self.send_json({"error": f"服务商返回 HTTP {exc.code}：{detail[:400]}"}, 502)
            return
        except (urllib.error.URLError, OSError, TimeoutError, ValueError) as exc:
            self.send_json({"error": f"获取模型列表失败：{exc}"}, 502)
            return
        self.send_json({"ok": True, "data": json.loads(data.decode("utf-8", "replace")).get("data", [])})

    def read_ai_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 200_000:
            raise ValueError("请求体大小不合法")
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("请求体格式不合法")
        return payload

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/state":
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
            return
        if path == "/api/ai/config":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 64_000:
                    raise ValueError("数据大小不合法")
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("数据格式不合法")
                config = load_ai_config()
                for field in ("preset", "baseUrl", "model", "temperature", "maxTokens"):
                    if field in payload:
                        config[field] = payload[field]
                if "apiKey" in payload:
                    key = str(payload["apiKey"])
                    if key == "-":
                        config.pop("apiKey", None)
                    elif key.strip():
                        config["apiKey"] = key.strip()
                if not str(config.get("baseUrl", "")).strip():
                    self.send_json({"error": "接口地址不能为空"}, 400)
                    return
                validate_ai_target(str(config["baseUrl"]))
                save_ai_config(config)
                self.send_json(public_ai_config())
            except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                self.send_json({"error": str(exc)}, 400)
            return
        self.send_json({"error": "接口不存在"}, 404)


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
