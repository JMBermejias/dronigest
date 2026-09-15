#!/bin/bash
# Dronigest - Lanzador local para Linux/macOS
# Arranca el servidor en segundo plano (no se detiene al cerrar la terminal),
# espera a que responda y abre el navegador.

clear
echo ""
echo "  ========================================"
echo "   DRONIGEST - Gestion de Actividades de Drones"
echo "  ========================================"
echo ""

cd "$(dirname "$0")"
PORT=8082
URL="http://localhost:$PORT"

# Si ya hay una instancia activa, solo la abrimos
if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo "  Dronigest ya está en marcha en: $URL"
    echo "  Abriendo el navegador..."
    echo ""
    xdg-open "$URL" 2>/dev/null || sensible-browser "$URL" 2>/dev/null || open "$URL" 2>/dev/null || true
    echo "  Para detener el servidor: pkill -f servidor-local.py"
    exit 0
fi

echo "  Iniciando servidor local en el puerto $PORT..."
echo ""

# Elegir un servidor
if command -v python3 &> /dev/null; then
    if [ -f "servidor-local.py" ]; then
        nohup python3 servidor-local.py "$PORT" > /dev/null 2>&1 &
    else
        nohup python3 -m http.server "$PORT" --bind 127.0.0.1 > /dev/null 2>&1 &
    fi
    echo "  Servidor: Python3"
elif command -v python &> /dev/null; then
    if [ -f "servidor-local.py" ]; then
        nohup python servidor-local.py "$PORT" > /dev/null 2>&1 &
    else
        nohup python -m http.server "$PORT" --bind 127.0.0.1 > /dev/null 2>&1 &
    fi
    echo "  Servidor: Python"
elif command -v node &> /dev/null; then
    nohup npx serve -l "$PORT" . > /dev/null 2>&1 &
    echo "  Servidor: Node.js"
elif command -v php &> /dev/null; then
    nohup php -S "localhost:$PORT" > /dev/null 2>&1 &
    echo "  Servidor: PHP"
else
    echo "  [!] No se encontro un servidor web compatible (Python, Node.js o PHP)."
    echo "  Instala uno de ellos o abre index.html directamente en el navegador."
    xdg-open index.html 2>/dev/null || open index.html 2>/dev/null || true
    exit 1
fi

# Esperar a que el servidor responda (max ~10s)
for i in $(seq 1 50); do
    if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
        break
    fi
    sleep 0.2
done

if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo ""
    echo "  ========================================"
    echo "  Dronigest en: $URL"
    echo "  Para instalar como App, usa el boton"
    echo "  'Instalar App' en la barra superior."
    echo "  Para detener el servidor: pkill -f servidor-local.py"
    echo "  ========================================"
    echo ""
    xdg-open "$URL" 2>/dev/null || sensible-browser "$URL" 2>/dev/null || open "$URL" 2>/dev/null || true
else
    echo ""
    echo "  [ERROR] El servidor no ha podido iniciarse en el puerto $PORT."
    echo "  Comprueba que el puerto no este en uso:"
    echo "    ss -tlnp | grep $PORT"
    echo ""
    exit 1
fi