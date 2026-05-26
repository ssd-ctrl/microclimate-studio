@echo off
cd /d "C:\Users\SydneyDeVille\Documents\Codex\2026-05-26\we"
start "microclimate-server" /min cmd /c "node local-server.js"
timeout /t 2 /nobreak >nul
start "" "http://localhost:4173"
