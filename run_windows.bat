@echo off
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo.
  echo A .env file was created. Set SECRET_KEY and ADMIN_PASSWORD before continuing.
  notepad .env
  echo Save the file, close Notepad, then press any key to continue.
  pause >nul
)
if not exist .venv py -m venv .venv
call .venv\Scripts\activate.bat
py -m pip install -r requirements.txt
if errorlevel 1 (
  echo Dependency installation failed. Check your Python installation and internet connection.
  pause
  exit /b 1
)
py app.py
pause
