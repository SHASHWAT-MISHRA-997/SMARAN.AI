@echo off
title GMR AI — Push to GitHub
color 0B
echo.
echo ==============================================
echo       GREY MATTER AI — GitHub Push Helper
echo ==============================================
echo.
echo Your local files are clean and committed!
echo.
echo We need to push the code to:
echo   https://github.com/SHASHWAT-MISHRA-997/IMP.git
echo.
echo If you get a permission error, please generate a Personal Access Token (PAT) 
echo from GitHub Settings -> Developer settings -> Personal access tokens.
echo.
set /p username="Enter your GitHub Username (e.g. SHASHWAT-MISHRA-997): "
set /p pat="Enter your GitHub Personal Access Token (PAT): "
echo.
echo Pushing codebase...
git remote remove origin >nul 2>&1
git remote add origin "https://%username%:%pat%@github.com/SHASHWAT-MISHRA-997/IMP.git"
git push -u origin main --force
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Push failed. Please verify your credentials or PAT scopes.
) else (
    echo.
    echo [OK] Code successfully pushed to GitHub!
)
pause
