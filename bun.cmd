@echo off
set BUN_PATH=%USERPROFILE%\AppData\Local\Kiro-Cli\bun
if not exist "%BUN_PATH%" (
    echo ERROR: bun not found. Install bun from https://bun.sh
    exit /b 1
)
REM Create a .exe copy so Windows recognizes it as executable.
REM Original bun binary has no extension, causing "Open with" dialog.
if not exist "%BUN_PATH%.exe" (
    copy /y "%BUN_PATH%" "%BUN_PATH%.exe" >nul
)
"%BUN_PATH%.exe" %*