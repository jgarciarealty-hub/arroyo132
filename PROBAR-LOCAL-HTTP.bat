@echo off
rem Prueba local en contexto SEGURO (localhost): necesario para que el PIN con PBKDF2
rem (crypto.subtle) funcione. No uses file:// para probar el PIN moderno.
cd /d "%~dp0"
start "Arroyo 132 - servidor local" python -m http.server 8765 --bind 127.0.0.1
timeout /t 1 >nul
start "" http://127.0.0.1:8765/index.html
