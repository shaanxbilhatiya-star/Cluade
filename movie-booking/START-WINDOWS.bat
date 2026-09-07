@echo off
title CineFlex Movie Booking System
cd /d "%~dp0"

echo.
echo   ================================================
echo    CineFlex - Movie Ticket Booking System
echo   ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js was not found on this machine.
  echo.
  echo   Install it from https://nodejs.org  ^(version 18 or newer^),
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo   Starting the server...
echo.
echo   Customer app :  http://localhost:3000/
echo   Admin panel  :  http://localhost:3000/admin/
echo.
echo   Keep this window open while you use the app.
echo   Press Ctrl+C to stop the server.
echo.

start "" http://localhost:3000/
node server.js

echo.
echo   Server stopped.
pause
