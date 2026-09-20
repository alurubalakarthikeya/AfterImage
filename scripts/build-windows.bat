@echo off
setlocal enabledelayedexpansion

REM ---------------------------------------------------------------------------
REM Build the Windows installer, correctly.
REM
REM `npm run tauri build` on its own fails on a machine where Git for Windows'
REM `link.exe` sits earlier on PATH than MSVC's, and on a machine where the
REM MSVC/SDK environment (LIB, INCLUDE) has not been set. Both are fixed by
REM sourcing vcvars64.bat first, which is what this script does.
REM
REM Usage:  scripts\build-windows.bat          (release installer)
REM         scripts\build-windows.bat --debug  (fast debug build, no installer)
REM ---------------------------------------------------------------------------

set "VCVARS="
for %%P in (
  "%ProgramFiles%\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
  "%ProgramFiles%\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
  "%ProgramFiles%\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
  "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
) do if exist "%%~P" set "VCVARS=%%~P"

if not defined VCVARS (
  echo.
  echo Could not find vcvars64.bat.
  echo Open the Visual Studio Installer, choose Modify, and tick
  echo "Desktop development with C++" including a Windows 10/11 SDK.
  echo.
  exit /b 1
)

echo [build] using %VCVARS%
call "%VCVARS%" >nul || exit /b 1

REM Make sure the directory that will receive the installer exists.
cd /d "%~dp0.."

if "%~1"=="--check" (
  echo [build] cargo check
  cargo check --manifest-path src-tauri\Cargo.toml || exit /b 1
  exit /b 0
)

if "%~1"=="--debug" (
  echo [build] cargo build ^(debug^)
  cargo build --manifest-path src-tauri\Cargo.toml || exit /b 1
  echo [build] done: src-tauri\target\debug\AfterImage.exe
  exit /b 0
)

echo [build] npm run tauri build
call npm run tauri build || exit /b 1

echo.
echo [build] Installer written under src-tauri\target\release\bundle\nsis\
