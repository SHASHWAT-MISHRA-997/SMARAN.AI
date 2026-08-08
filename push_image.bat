@echo off
title GMR AI — Build and Push to Docker Hub
echo ===================================================
echo           GMR AI - DOCKER DEPLOYMENT v2.2
echo ===================================================
echo.
echo This script will build the latest unified web container
echo and push it directly to your Docker Hub repository.
echo.
echo STEP 1: Authenticating with Docker Hub...
docker login
if %ERRORLEVEL% neq 0 (
    echo.
    echo [X] Docker Hub authentication failed or was cancelled.
    echo     Please make sure you have a Docker Hub account.
    echo.
    pause
    exit /b
)

echo.
echo STEP 2: Building production Docker image (frontend + backend)...
docker build -t shashwatmishra062/smaran-ai:latest .
if %ERRORLEVEL% neq 0 (
    echo.
    echo [X] Docker image build failed.
    echo.
    pause
    exit /b
)

echo.
echo STEP 3: Pushing image to Docker Hub (shashwatmishra062/smaran-ai:latest)...
docker push shashwatmishra062/smaran-ai:latest
if %ERRORLEVEL% neq 0 (
    echo.
    echo [X] Pushing image failed.
    echo.
    pause
    exit /b
)

echo.
echo ===================================================
echo [OK] SUCCESS! Image successfully updated on Docker Hub.
echo     Your clients/owners can now run SMARAN-LAUNCHER.exe
echo     without needing any source code files on their systems.
echo ===================================================
echo.
pause
