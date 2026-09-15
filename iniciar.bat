@echo off
title Dronigest
cd /d "%~dp0"
echo Iniciando Dronigest...

REM Try Python first
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" "http://localhost:8082"
    python -m http.server 8082
    exit /b
)

where python3 >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" "http://localhost:8082"
    python3 -m http.server 8082
    exit /b
)

REM Try Node
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" "http://localhost:8082"
    npx serve -l 8082 .
    exit /b
)

REM Fallback to browser
start index.html
