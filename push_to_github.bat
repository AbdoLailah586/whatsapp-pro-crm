@echo off
setlocal enabledelayedexpansion
title GitHub Auto Push - WhatsApp Pro CRM
color 0B

cd /d "%~dp0"

echo ========================================================
echo        WhatsApp Pro CRM - GitHub Quick Sync
echo ========================================================
echo.

echo [1/3] Adding modified and new files...
git add .

echo.
set "commit_msg="
set /p "commit_msg=Enter commit message (or press Enter for auto-date): "
if not defined commit_msg (
    set "commit_msg=Update: %date% %time%"
)

echo.
echo [2/3] Committing changes: "!commit_msg!"...
git commit -m "!commit_msg!"

echo.
echo [3/3] Pushing to GitHub (origin main)...
git push origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo  [SUCCESS] All changes pushed to GitHub successfully!
    echo ========================================================
) else (
    echo.
    echo ========================================================
    echo  [ERROR] Push failed. Please check your internet or git status.
    echo ========================================================
)

echo.
pause
endlocal
