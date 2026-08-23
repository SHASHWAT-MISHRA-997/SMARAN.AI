@echo off
REM SMARAN.AI Windows Host Telemetry Bridge Runner
REM Runs the telemetry bridge natively on Windows for REAL hardware metrics

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0\run-host-telemetry.ps1" %*