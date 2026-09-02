@echo off
setlocal
cd /d "%~dp0"
title Aeon FRONG-WETH Protocol Integration
node epoch-keeper\approve-frong-integration.mjs
echo.
pause
endlocal
