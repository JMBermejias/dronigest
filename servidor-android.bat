@echo off
title Dronigest - Servidor HTTPS para Android
color 0B
cls
echo.
echo  =========================================
echo   DRONIGEST - Servidor HTTPS para Android
echo  =========================================
echo.
echo  Este servidor genera un certificado SSL
echo  para poder instalar la PWA en Android.
echo.
echo  Pasos para instalar en Android:
echo  1. Ejecuta este script en tu PC
echo  2. Abre Chrome en tu movil
echo  3. Ve a la URL que se muestra abajo
echo  4. Acepta el certificado
echo  5. Menu (3 puntos) &gt; Instalar app
echo.

python servidor-https.py 8443
if %ERRORLEVEL% NEQ 0 (
    python3 servidor-https.py 8443
)
pause
