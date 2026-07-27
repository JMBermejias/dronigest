#!/bin/bash
clear
echo ""
echo "  ========================================"
echo "   DRONIGEST - Instalador Automatico"
echo "   Gestion de Actividades de Drones"
echo "  ========================================"
echo ""

cd "$(dirname "$0")"

# Check for Python
if command -v python3 &> /dev/null; then
    SERVER="python3"
    ARGS="-m http.server 8080"
    echo "  Python3 encontrado."
elif command -v python &> /dev/null; then
    SERVER="python"
    ARGS="-m http.server 8080"
    echo "  Python encontrado."
elif command -v node &> /dev/null; then
    SERVER="npx"
    ARGS="serve -l 8080 ."
    echo "  Node.js encontrado."
elif command -v php &> /dev/null; then
    SERVER="php"
    ARGS="-S localhost:8080"
    echo "  PHP encontrado."
else
    echo "  [!] No se encontro un servidor web compatible."
    echo "  Instala Python, Node.js o PHP."
    echo ""
    echo "  Alternativa: Abre index.html en tu navegador."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open index.html
    elif command -v xdg-open &> /dev/null; then
        xdg-open index.html
    fi
    exit 1
fi

if [ ! -f "index.html" ]; then
    echo "  [ERROR] No se encuentra index.html"
    exit 1
fi

echo ""
echo "  Iniciando servidor local..."
echo ""

# Open browser
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "http://localhost:8080"
elif command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:8080"
elif command -v sensible-browser &> /dev/null; then
    sensible-browser "http://localhost:8080"
fi

echo "  ========================================"
echo "  Dronigest en: http://localhost:8080"
echo "  Para instalar como App, usa el boton"
echo "  'Instalar App' en la barra superior."
echo "  Ctrl+C para cerrar el servidor."
echo "  ========================================"
echo ""

$SERVER $ARGS
