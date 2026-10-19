@echo off
rem Edge launches this file. Errors from Python go to host.log next to this file.
setlocal
set "LOG=%~dp0host.log"
echo [%date% %time%] host launched >>"%LOG%"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -u "%~dp0cmd_host.py" %* 2>>"%LOG%"
) else (
  python -u "%~dp0cmd_host.py" %* 2>>"%LOG%"
)
echo [%date% %time%] host exited with code %errorlevel% >>"%LOG%"
