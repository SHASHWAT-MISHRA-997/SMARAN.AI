@echo off
title GREYMATTER.AI Launcher
echo ========================================================
echo   GREYMATTER.AI - Enterprise AI Local Deployment Node
echo ========================================================
echo [1/2] Running host hardware dynamic profiling...
python boot_manager.py
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Hardware profiling failed. Check python installation.
    pause
    exit /b %ERRORLEVEL%
)

echo [2/2] Booting local Docker services...
docker compose up --build -d
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker compose failed to boot. Make sure Docker Desktop is running.
    pause
    exit /b %ERRORLEVEL%
)

echo ========================================================
echo   GREYMATTER.AI Platform is ONLINE
echo   - Frontend: http://localhost:3000
echo   - Backend:  http://localhost:8080
echo   - n8n:      http://localhost:5678
echo ========================================================
pause
