#!/usr/bin/env python3
"""
Servidor HTTPS local para Dronigest
Necesario para instalar la PWA en Android (requiere HTTPS)

Uso: python servidor-https.py [puerto]

En Android:
1. Ejecuta este script en tu PC
2. Abre Chrome en tu movil
3. Navega a https://[IP-de-tu-PC]:8443
4. Acepta el certificado autofirmado
5. Chrome mostrara "Instalar app" o ve a Menu > Instalar app
"""
import http.server
import ssl
import os
import sys
import socket
import subprocess
import webbrowser
import threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
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
    
    # Crear config temporal con SAN para que Firefox/Chrome acepten el cert
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

def main():
    ip = get_local_ip()
    
    print()
    print("  ==========================================")
    print("   DRONIGEST - Servidor HTTPS Local")
    print("  ==========================================")
    print()
    
    generate_cert()
    
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    handler = http.server.SimpleHTTPRequestHandler
    httpd = http.server.HTTPServer(('0.0.0.0', PORT), handler)
    
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(CERT_FILE, KEY_FILE)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    
    print(f"  Servidor HTTPS activo en:")
    print()
    print(f"    Local:    https://localhost:{PORT}")
    print(f"    Red:      https://{ip}:{PORT}")
    print()
    print("  Para instalar en Android:")
    print(f"  1. Abre Chrome en tu movil")
    print(f"  2. Ve a: https://{ip}:{PORT}")
    print(f"  3. Acepta el certificado (Avanzado > Continuar)")
    print(f"  4. Chrome mostrara 'Instalar app'")
    print(f"     o ve a Menu (3 puntos) > Instalar app")
    print()
    print("  Presiona Ctrl+C para detener el servidor")
    print()
    
    threading.Timer(1.0, lambda: webbrowser.open(f'https://localhost:{PORT}')).start()
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Servidor detenido.")
        httpd.shutdown()

if __name__ == '__main__':
    main()
