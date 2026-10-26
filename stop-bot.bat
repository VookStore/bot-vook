@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================================
echo   VOOK STORE BOT - PARADA
echo ==========================================================
echo.

REM Para SOMENTE o processo vook-store-bot.
REM Nunca use "pm2 kill" aqui: isso derrubaria todos os outros
REM processos PM2 desta maquina.
call npx --yes pm2 stop vook-store-bot
if errorlevel 1 (
    echo.
    echo [AVISO] O processo "vook-store-bot" nao estava em execucao.
    echo.
    pause
    exit /b 0
)

call npx --yes pm2 save

echo.
echo ==========================================================
echo   Vook Store Bot parado.
echo   Para remover da lista do PM2: npx pm2 delete vook-store-bot
echo ==========================================================
echo.
pause
endlocal
