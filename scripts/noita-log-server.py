#!/usr/bin/env python3
# ── Noita 原型操作日志接收器(部署在 8.162.5.160,/opt/yql/noita-log/server.py,systemd noita-log.service)──
# 前端 POST JSON → 按 天/会话 追加到 logs/YYYYMMDD/<session>.jsonl;GET /list 看最近文件;GET /get?f=... 取文件。
# 经 nginx(ai-device-nginx 容器)反代:https://update.cocoaihj.com/updatesoft/noita-log/  →  http://172.18.0.1:8787/
# 只依赖标准库(服务器是 Python 3.6)。
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs

ROOT = os.environ.get("NOITA_LOG_DIR", "/opt/yql/noita-log/logs")
MAX_BODY = 2 * 1024 * 1024
SAFE = re.compile(r"^[A-Za-z0-9_\-]{4,64}$")


class H(BaseHTTPRequestHandler):
    server_version = "noita-log/1"

    def _hdr(self, code=200, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()

    def do_OPTIONS(self):
        self._hdr(204)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path.rstrip("/") in ("", "/health"):
            self._hdr(); self.wfile.write(b'{"ok":true}'); return
        if u.path.rstrip("/") == "/list":
            out = []
            for day in sorted(os.listdir(ROOT), reverse=True)[:7] if os.path.isdir(ROOT) else []:
                d = os.path.join(ROOT, day)
                for f in sorted(os.listdir(d), key=lambda x: os.path.getmtime(os.path.join(d, x)), reverse=True)[:50]:
                    p = os.path.join(d, f)
                    out.append({"f": day + "/" + f, "size": os.path.getsize(p), "mtime": int(os.path.getmtime(p))})
            self._hdr(); self.wfile.write(json.dumps(out).encode()); return
        if u.path.rstrip("/") == "/get":
            f = (q.get("f") or [""])[0]
            if not re.match(r"^\d{8}/[A-Za-z0-9_\-]+\.jsonl$", f):
                self._hdr(400); self.wfile.write(b'{"err":"bad f"}'); return
            p = os.path.join(ROOT, f)
            if not os.path.exists(p):
                self._hdr(404); self.wfile.write(b'{"err":"nf"}'); return
            self._hdr(200, "text/plain; charset=utf-8")
            with open(p, "rb") as fh:
                self.wfile.write(fh.read())
            return
        self._hdr(404); self.wfile.write(b'{"err":"nf"}')

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            self._hdr(413); self.wfile.write(b'{"err":"size"}'); return
        raw = self.rfile.read(n)
        try:
            body = json.loads(raw.decode("utf8"))
        except Exception:
            self._hdr(400); self.wfile.write(b'{"err":"json"}'); return
        sid = str(body.get("session", ""))
        if not SAFE.match(sid):
            self._hdr(400); self.wfile.write(b'{"err":"session"}'); return
        day = time.strftime("%Y%m%d")
        d = os.path.join(ROOT, day)
        os.makedirs(d, exist_ok=True)
        rec = {"t": int(time.time()), "ip": self.headers.get("X-Real-IP") or self.client_address[0], **body}
        with open(os.path.join(d, sid + ".jsonl"), "a", encoding="utf8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._hdr(); self.wfile.write(b'{"ok":true}')

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))


class TS(ThreadingMixIn, HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    os.makedirs(ROOT, exist_ok=True)
    print("noita-log on", port, "->", ROOT)
    TS(("0.0.0.0", port), H).serve_forever()
