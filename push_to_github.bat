@echo off
chcp 65001 >nul
title 🚀 GitHub Auto Push - WhatsApp Pro CRM
color 0B

echo ========================================================
echo        🚀 WhatsApp Pro CRM - GitHub Quick Sync
echo ========================================================
echo.

echo 📦 [1/3] Adding modified and new files...
git add .

echo.
set /p commit_msg="📝 Enter commit message (or press Enter for auto-date): "
if "%commit_msg%"=="" (
    for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
    set commit_msg=Update: %date% %time%
)

echo.
echo 💾 [2/3] Committing changes: "%commit_msg%"...
git commit -m "%commit_msg%"

echo.
echo 🌐 [3/3] Pushing to GitHub (origin main)...
git push origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo  ✅ SUCCESS: All changes pushed to GitHub successfully!
    echo ========================================================
) else (
    echo.
    echo ========================================================
    echo  ❌ ERROR: Push failed. Please check your internet or git status.
    echo ========================================================
)

echo.
pause
