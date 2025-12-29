@echo off
setlocal

REM One-click launcher for auto_codex (Windows)
REM Example:
REM   scripts\up.cmd --port 18787 --host 127.0.0.1 --allowed-roots "E:\projects;E:\sjt\others"

set SCRIPT_DIR=%~dp0
node "%SCRIPT_DIR%up.js" %*

