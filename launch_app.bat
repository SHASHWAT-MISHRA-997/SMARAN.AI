@echo off
title SMARAN.AI — Offline System Launcher
color 0A
cls
echo.
echo ====================================================================
echo    SMARAN.AI - SYSTEM INITIALIZATION AND DEPLOYMENT
echo ====================================================================
echo.
echo [1/3] Checking python environment...
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not in PATH. Please install Python.
    pause
    exit /b 1
)

echo [2/3] Running Hardware Profiler & Auto-Bootstrapper...
python bootstrapper.py
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Bootstrapper script execution failed.
    pause
    exit /b 1
)

echo [3/3] Deploying Local Containers via Docker Compose...
docker-compose up -d --build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to start Docker Compose. Check if Docker Desktop is running.
    pause
    exit /b 1
)

echo.
echo ====================================================================
echo    🟢 SMARAN.AI IS ONLINE!
echo    Access console at: http://localhost:3003
echo ====================================================================
echo.
pause
