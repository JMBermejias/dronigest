@echo off
title Dronigest - Instalador
color 0B
cls
echo.
echo  ========================================
echo   DRONIGEST - Instalador Automatico
echo   Gestion de Actividades de Drones
echo  ========================================
echo.
echo  Selecciona el modo:
echo.
echo  [1] Abrir en PC (navegador local)
echo  [2] Servidor HTTPS para Android
echo.
set /p MODO="Selecciona (1 o 2): "

if "%MODO%"=="2" goto :android

:pc
echo.
echo [1/3] Verificando requisitos...
echo.

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo   Python encontrado.
    goto :start_pc
)

where python3 >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo   Python3 encontrado.
    goto :start_pc
)

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo   Node.js encontrado.
    goto :start_pc
)

where php >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo   PHP encontrado.
    goto :start_pc
)

echo.
echo   [!] No se encontro servidor compatible.
echo   Abre index.html directamente en tu navegador.
echo.
pause
start index.html
exit /b

:start_pc
echo.
echo [2/3] Iniciando servidor...
echo.
start "" "http://localhost:8080"
echo [3/3] Dronigest en: http://localhost:8080
echo.
echo   Para instalar como App en PC: clic en "Instalar App"
echo   Para instalar en Android: reinicia y opcion 2
echo.
if "%MODO%"=="" (
    python -m http.server 8080 2>nul || python3 -m http.server 8080 2>nul || npx serve -l 8080 . 2>nul
)
exit /b

:android
echo.
echo  ========================================
echo   DRONIGEST - Servidor HTTPS para Android
echo  ========================================
echo.
echo  Pasos para instalar en tu movil:
echo  1. Anota la IP que se muestra abajo
echo  2. Abre Chrome en tu Android
echo  3. Ve a https://[IP]:8443
echo  4. Acepta el certificado
echo  5. Menu (3 puntos) ^> Instalar app
echo.

python servidor-https.py 8443
if %ERRORLEVEL% NEQ 0 (
    python3 servidor-https.py 8443
)
pause
