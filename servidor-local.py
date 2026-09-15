#!/usr/bin/env python3
"""
Servidor local de Dronigest (HTTP solo, IPv4 + IPv6).
Sustituye a 'python -m http.server' para que 'localhost' funcione
tanto si el navegador lo resuelve a 127.0.0.1 como a ::1.

Uso: python servidor-local.py [puerto]
"""
import http.server
import os
import socket
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8082


class DualStackServer(socketserver.TCPServer):
    address_family = socket.AF_INET6
    allow_reuse_address = True

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except OSError:
            pass
        super().server_bind()


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


os.chdir(os.path.dirname(os.path.abspath(__file__)))

try:
    httpd = DualStackServer(('::', PORT), QuietHandler)
except OSError:
    httpd = socketserver.TCPServer(('0.0.0.0', PORT), QuietHandler)

print(f"Dronigest activo en http://localhost:{PORT}")
httpd.serve_forever()