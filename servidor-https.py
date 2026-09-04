#!/usr/bin/env python3
"""
Servidor local para Dronigest
- HTTP en localhost (sin certificado, sin avisos)
- HTTPS en red local (para instalar PWA en Android)

Uso: python servidor-https.py [puerto]

En Android:
1. Ejecuta este script en tu PC
2. Abre Chrome en tu movil
3. Navega a https://[IP-de-tu-PC]:8443
4. Acepta el certificado autofirmado
5. Chrome mostrara "Instalar app"
"""
import http.server
import ssl
import os
import sys
import socket
import subprocess
import time
import threading

HTTP_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
HTTPS_PORT = HTTP_PORT + 363
CERT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.cert')
CERT_FILE = os.path.join(CERT_DIR, 'dronigest.pem')
KEY_FILE = os.path.join(CERT_DIR, 'dronigest.key')

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

def generate_cert():
    os.makedirs(CERT_DIR, exist_ok=True)
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        return

    print("  Generando certificado SSL autofirmado...")
    ip = get_local_ip()

    cfg = os.path.join(CERT_DIR, 'openssl.cnf')
    with open(cfg, 'w') as f:
        f.write(f"""[req]
distinguished_name = req_dn
x509_extensions = v3_req
prompt = no

[req_dn]
CN = localhost
O = Dronigest
C = ES

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
IP.3 = {ip}
""")

    subprocess.run([
        'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
        '-keyout', KEY_FILE, '-out', CERT_FILE,
        '-days', '365', '-nodes',
        '-config', cfg
    ], capture_output=True)

    os.remove(cfg)

    if not os.path.exists(CERT_FILE):
        print("  ERROR: No se pudo generar el certificado.")
        print("  Instala openssl o crea el certificado manualmente.")
        sys.exit(1)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

def start_http(directory):
    httpd = http.server.HTTPServer(('127.0.0.1', HTTP_PORT), QuietHandler)
    httpd.serve_forever()

def start_https(directory, ip):
    httpd = http.server.HTTPServer(('0.0.0.0', HTTPS_PORT), QuietHandler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(CERT_FILE, KEY_FILE)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    httpd.serve_forever()

def main():
    ip = get_local_ip()

    print()
    print("  ==========================================")
    print("   DRONIGEST - Servidor Local")
    print("  ==========================================")
    print()

    generate_cert()

    directory = os.path.dirname(os.path.abspath(__file__))
    os.chdir(directory)

    http_thread = threading.Thread(target=start_http, args=(directory,), daemon=True)
    http_thread.start()

    https_thread = threading.Thread(target=start_https, args=(directory, ip), daemon=True)
    https_thread.start()

    print(f"  Servidor activo:")
    print()
    print(f"    Navegador (PC):  http://localhost:{HTTP_PORT}")
    print(f"    Red (Android):   https://{ip}:{HTTPS_PORT}")
    print()
    print("  Para instalar en Android:")
    print(f"  1. Abre Chrome en tu movil")
    print(f"  2. Ve a: https://{ip}:{HTTPS_PORT}")
    print(f"  3. Acepta el certificado (Avanzado > Continuar)")
    print(f"  4. Chrome mostrara 'Instalar app'")
    print(f"     o ve a Menu (3 puntos) > Instalar app")
    print()
    print("  Presiona Ctrl+C para detener el servidor")
    print()

    time.sleep(1)
    try:
        subprocess.Popen(['xdg-open', f'http://localhost:{HTTP_PORT}'])
    except Exception:
        try:
            subprocess.Popen(['gio', 'open', f'http://localhost:{HTTP_PORT}'])
        except Exception:
            try:
                subprocess.Popen(['firefox', f'http://localhost:{HTTP_PORT}'])
            except Exception:
                print(f"  Abre manualmente: http://localhost:{HTTP_PORT}")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n  Servidor detenido.")
        sys.exit(0)

if __name__ == '__main__':
    main()
