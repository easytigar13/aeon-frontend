@echo off
setlocal
cd /d "%~dp0"
title Aeon Retire Legacy Fee-Broken Gauges
node epoch-keeper\retire-legacy-fee-broken-gauges.mjs
echo.
pause
endlocal
