@echo off
rem Registers the native messaging host with Microsoft Edge for the current user.
set "KEY=HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.example.cmd_bridge"
reg add "%KEY%" /ve /t REG_SZ /d "%~dp0com.example.cmd_bridge.json" /f
if errorlevel 1 (
  echo Registration failed.
) else (
  echo Registered. Restart Edge, then click the CMD Bridge toolbar button.
)
where python >nul 2>nul || echo WARNING: python was not found on PATH. Install Python 3 and tick "Add python.exe to PATH".
pause
