@echo off
title ⚡ SOLANA QUANT ARENA v2 — CONTROL LOCAL
color 0B
echo ====================================================================
echo        ⚡ SOLANA QUANT ARENA v2 — INICIANDO SISTEMA ⚡
echo ====================================================================
echo.
cd /d "%~dp0server"

if not exist node_modules (
    echo [1/2] Instalando dependencias de Node.js...
    call npm install
)

echo [2/2] Abriendo Terminal Web en el navegador...
start http://localhost:8080

echo.
echo [OK] Servidor activo. Presiona Ctrl+C para detener.
echo ====================================================================
node server.js
pause
