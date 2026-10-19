@echo off
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.example.cmd_bridge" /f
echo Unregistered.
pause
