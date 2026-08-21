@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 tools\server.py
  goto :end
)

where python >nul 2>nul
if %errorlevel% equ 0 (
  python tools\server.py
  goto :end
)

echo Python 3 non e installato.
echo Scaricalo da https://www.python.org/downloads/ selezionando "Add Python to PATH".
pause

:end
endlocal
