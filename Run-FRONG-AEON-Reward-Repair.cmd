@echo off
setlocal
cd /d "%~dp0"
title Aeon FRONG-AEON Voter Reward Repair
node epoch-keeper\repair-frong-aeon-rewards.mjs
echo.
pause
endlocal
