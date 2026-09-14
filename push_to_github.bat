@echo off
setlocal enabledelayedexpansion
title GitHub Quick Sync - WhatsApp Pro CRM
color 0B

cd /d "%~dp0"

echo ========================================================
echo        WhatsApp Pro CRM - GitHub Quick Sync
echo ========================================================
echo Repository: https://github.com/AbdoLailah586/whatsapp-pro-crm
echo.

:: 1. Check Git installation
where git >nul 2>&1
if !ERRORLEVEL! NEQ 0 (
    color 0C
    echo [ERROR] Git is not installed or not found in system PATH.
    echo Please install Git from: https://git-scm.com/
    goto END
)

:: 2. Stage changes and check if anything changed
echo [1/3] Scanning for local changes...
git add .
git diff --cached --quiet
if !ERRORLEVEL! NEQ 0 (
    echo.
    echo [*] Detected modified or new files.
    set "commit_msg="
    set /p "commit_msg=Enter commit message (or press Enter for auto-date): "
    if not defined commit_msg set "commit_msg=Update: %date% %time%"
    if "!commit_msg!"=="" set "commit_msg=Update: %date% %time%"
    if "!commit_msg!"==" " set "commit_msg=Update: %date% %time%"
    if "!commit_msg!"=="  " set "commit_msg=Update: %date% %time%"
    echo.
    echo Committing changes: "!commit_msg!"...
    git commit -m "!commit_msg!"
    if !ERRORLEVEL! NEQ 0 (
        color 0C
        echo.
        echo [ERROR] Commit failed.
        goto END
    )
) else (
    echo [*] No new or modified files to commit.
)

:: 3. Pull latest changes from remote to prevent push rejection
echo.
echo [2/3] Checking for updates from GitHub...
git pull --rebase origin main
if !ERRORLEVEL! NEQ 0 (
    echo [!] Warning: Rebase encountered an issue or remote is currently unreachable.
)

:: 4. Check if there are any commits to push
set "UNPUSHED=0"
for /f %%c in ('git rev-list --count origin/main..HEAD 2^>nul') do set "UNPUSHED=%%c"

if "!UNPUSHED!"=="0" (
    color 0A
    echo.
    echo ========================================================
    echo  [UP-TO-DATE] Everything is already synchronized with GitHub!
    echo  Repository: https://github.com/AbdoLailah586/whatsapp-pro-crm
    echo ========================================================
    goto END
)

:: 5. Push to GitHub
echo.
echo [3/3] Pushing !UNPUSHED! commit(s) to GitHub (origin main)...
git push origin main

if !ERRORLEVEL! EQU 0 (
    color 0A
    echo.
    echo ========================================================
    echo  [SUCCESS] All changes pushed to GitHub successfully!
    echo  Repository: https://github.com/AbdoLailah586/whatsapp-pro-crm
    echo ========================================================
) else (
    color 0C
    echo.
    echo ========================================================
    echo  [ERROR] Push failed.
    echo.
    echo  Possible solutions:
    echo   1. Check your internet connection.
    echo   2. Run 'git pull origin main' manually if there are conflicts.
    echo   3. Verify your GitHub login/credentials.
    echo ========================================================
)

:END
echo.
pause
endlocal
