@echo off
setlocal EnableExtensions

if /i "%~1"=="__run__" goto run
if /i "%~1"=="__backend__" goto backend
if /i "%~1"=="__frontend__" goto frontend
if /i "%~1"=="--dry-run" goto dryrun

powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath $env:ComSpec -ArgumentList '/c','""%~f0"" __run__' -WindowStyle Hidden"
exit /b 0

:run
cd /d "%~dp0"

set "ROOT=%cd%"
set "BACKEND_DIR=%ROOT%\backend"
set "FRONTEND_DIR=%ROOT%\frontend"

call :checks || exit /b 1

start "Disco Backend" cmd /k ""%~f0" __backend__"
start "Disco Frontend" cmd /k ""%~f0" __frontend__"

start "" powershell -NoProfile -WindowStyle Hidden -Command "$ProgressPreference='SilentlyContinue'; $deadline=(Get-Date).AddSeconds(45); do { $backendOk=$false; $frontendOk=$false; try { $backendOk=((Invoke-WebRequest -UseBasicParsing 'http://localhost:4000/health').StatusCode -eq 200) } catch {}; try { $frontendOk=((Invoke-WebRequest -UseBasicParsing 'http://localhost:5173').StatusCode -ge 200) } catch {}; if ($backendOk -and $frontendOk) { Start-Process 'http://localhost:5173'; exit 0 }; Start-Sleep -Seconds 1 } while((Get-Date) -lt $deadline)"
exit /b 0

:backend
cd /d "%~dp0backend"
call :ensure_node_modules "%cd%" || goto fail
echo Demarrage du backend...
call npm start
goto end

:frontend
cd /d "%~dp0frontend"
call :ensure_node_modules "%cd%" || goto fail
echo Demarrage du frontend...
call npm run dev
goto end

:checks
if not exist "%BACKEND_DIR%\package.json" (
  echo [ERREUR] backend\package.json introuvable.
  pause
  exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
  echo [ERREUR] frontend\package.json introuvable.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js est introuvable dans le PATH.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] npm est introuvable dans le PATH.
  pause
  exit /b 1
)

if not exist "%BACKEND_DIR%\.env" (
  echo [ERREUR] backend\.env introuvable.
  echo Creez-le depuis backend\.env.example puis relancez.
  pause
  exit /b 1
)

exit /b 0

:ensure_node_modules
if exist "%~1\node_modules" exit /b 0

echo Installation des dependances dans %~1...
call npm install
if errorlevel 1 exit /b 1
exit /b 0

:fail
echo [ERREUR] Le demarrage a echoue.
pause
exit /b 1

:dryrun
cd /d "%~dp0"
set "ROOT=%cd%"
echo [DRY-RUN] Backend: cd /d "%ROOT%\backend" ^&^& if not exist node_modules call npm install ^&^& call npm start
echo [DRY-RUN] Frontend: cd /d "%ROOT%\frontend" ^&^& if not exist node_modules call npm install ^&^& call npm run dev
echo [DRY-RUN] Browser: attente de http://localhost:4000/health et http://localhost:5173 puis ouverture auto
exit /b 0

:end
exit /b %errorlevel%
