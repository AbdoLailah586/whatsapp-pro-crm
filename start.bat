@echo off
title WhatsApp AI Pro CRM
color 0A

echo ========================================================
echo       Starting WhatsApp AI Pro CRM Dashboard...
echo ========================================================
echo.

cd /d "%~dp0"

if not exist node_modules (
    echo [1/3] Installing dependencies...
    call npm install
    echo.
)

echo [2/3] Opening Dashboard in browser...
start http://localhost:3000

echo [3/3] Starting Server...
echo ========================================================
echo Server running at: http://localhost:3000
echo Press Ctrl + C to stop the server at any time.
echo ========================================================
echo.

node src/index.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo An error occurred while running the server.
    pause
)
