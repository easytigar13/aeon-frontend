@echo off
setlocal
cd /d "%~dp0"
title Aeon FRONG Oracle USD Repair
node epoch-keeper\preflight-frong-oracle-feed.mjs
if errorlevel 1 goto :fail
echo.
node epoch-keeper\repair-frong-oracle-feed.mjs
if errorlevel 1 goto :fail
echo.
echo FRONG oracle repair completed and verified.
pause
exit /b 0
:fail
echo.
echo FRONG oracle repair stopped. No further action was taken.
pause
exit /b 1
