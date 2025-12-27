@echo off
setlocal

REM One-click launcher for local-agent-cockpit (Windows)
REM Example:
REM   scripts\up.cmd --port 18787 --host 127.0.0.1 --allowed-roots "C:\projects;D:\work"

set SCRIPT_DIR=%~dp0
node "%SCRIPT_DIR%up.js" %*

