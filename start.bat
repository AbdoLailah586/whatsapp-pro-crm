@echo off
setlocal
title WhatsApp Pro CRM
color 0A

cd /d "%~dp0"

echo ========================================================
echo    WhatsApp Pro CRM  -  Dashboard
echo ========================================================
echo.

REM ---- read PORT from .env if present, else default 5000 ----
set "PORT=5000"
if exist ".env" (
    for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
        if /i "%%A"=="PORT" set "PORT=%%B"
    )
)

if not exist node_modules (
    echo [1/3] Installing dependencies... this may take a minute.
    call npm install
    echo.
)

echo [2/3] Starting server on port %PORT% ...

REM ---- open the browser ONLY after the server is actually listening ----
REM ---- (the old script opened it immediately and showed a connection error) ----
start "" powershell -NoProfile -WindowStyle Hidden -Command ^
 "for($i=0;$i -lt 90;$i++){ try{ $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',%PORT%); $c.Close(); Start-Sleep -Milliseconds 400; Start-Process ('http://localhost:%PORT%'); break } catch { Start-Sleep -Milliseconds 700 } }"

echo [3/3] Server logs below.
echo ========================================================
echo    Dashboard: http://localhost:%PORT%
echo    Press Ctrl + C to stop.
echo.
echo    First load after a UI update?  Press Ctrl + Shift + R
echo    in the browser to bypass the cache.
echo ========================================================
echo.

node src/index.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ==== The server stopped with an error ^(code %ERRORLEVEL%^) ====
    echo Check the messages above.
    pause
)

endlocal
