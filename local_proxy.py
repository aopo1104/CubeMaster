import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests


BASE_API = "https://api.cubemaster.net"
HOST = "127.0.0.1"
PORT = 8000
WEB_FILE = Path(__file__).with_name("frontend_mock.html")


def pick_token(query: dict[str, list[str]], body: dict | None, headers) -> str:
    token = ""
    if "token" in query and query["token"]:
        token = query["token"][0]
    if not token and isinstance(body, dict):
        token = str(body.get("token", ""))
    if not token:
        token = headers.get("X-TokenID", "")
    if not token:
        token = os.getenv("CUBEMASTER_TOKEN", "")
    return token


def forward(method: str, path: str, token: str, params=None, payload=None) -> tuple[int, dict | str]:
    if not token:
        return HTTPStatus.BAD_REQUEST, {"error": "Missing token. Provide token query param, X-TokenID header, or CUBEMASTER_TOKEN env var."}

    headers = {"TokenID": token}
    response = requests.request(
        method=method,
        url=f"{BASE_API}{path}",
        headers=headers,
        params=params,
        json=payload,
        timeout=40,
    )

    content_type = response.headers.get("Content-Type", "")
    if "application/json" in content_type:
        try:
            return response.status_code, response.json()
        except ValueError:
            return response.status_code, {"raw": response.text}
    return response.status_code, response.text


class ProxyHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-TokenID")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html: str):
        data = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-TokenID")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if parsed.path == "/" or parsed.path == "/index.html":
            if WEB_FILE.exists():
                self._send_html(WEB_FILE.read_text(encoding="utf-8"))
            else:
                self._send_html("<h1>frontend_mock.html not found</h1>")
            return

        if parsed.path == "/api/health":
            self._send_json(200, {"ok": True, "api": BASE_API})
            return

        if parsed.path == "/api/check-token":
            token = pick_token(query, None, self.headers)
            limit = int(query.get("limit", ["1"])[0])
            status, body = forward("GET", "/Loads", token, params={"limit": limit})
            self._send_json(status, body)
            return

        if parsed.path == "/api/loads":
            token = pick_token(query, None, self.headers)
            limit = int(query.get("limit", ["1"])[0])
            status, body = forward("GET", "/Loads", token, params={"limit": limit})
            self._send_json(status, body)
            return

        if parsed.path.startswith("/api/loads/"):
            token = pick_token(query, None, self.headers)
            load_id = parsed.path.split("/api/loads/", 1)[1]
            status, body = forward("GET", f"/Loads/{load_id}", token)
            self._send_json(status, body)
            return

        self._send_json(404, {"error": "Not Found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_len) if content_len else b"{}"

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON body"})
            return

        query = parse_qs(parsed.query)

        if parsed.path == "/api/loads":
            token = pick_token(query, payload, self.headers)
            status, body = forward("POST", "/Loads", token, payload=payload)
            self._send_json(status, body)
            return

        self._send_json(404, {"error": "Not Found"})


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), ProxyHandler)
    print(f"Local proxy running at http://{HOST}:{PORT}")
    print("Endpoints: /api/health, /api/check-token, /api/loads, /api/loads/{id}")
    server.serve_forever()
