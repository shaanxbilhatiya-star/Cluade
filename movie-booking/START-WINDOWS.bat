@echo off
echo ====================================
echo   CineBook - Movie Booking System
echo ====================================
echo.
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo ERROR: Node.js not found. Please install Node.js from https://nodejs.org
  pause
  exit /b 1
)
echo Installing dependencies...
call npm install
echo.
echo Starting server...
echo.
echo  User Portal  ->  http://localhost:3000
echo  Admin Panel  ->  http://localhost:3000/admin
echo.
start "" http://localhost:3000
node server.js
pause
