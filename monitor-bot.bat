@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

:menu
cls
echo ==========================================================
echo   VOOK STORE BOT - MONITORAMENTO
echo ==========================================================
echo.
echo   [1] Status do processo
echo   [2] Logs em tempo real
echo   [3] Ultimas 100 linhas de log
echo   [4] Painel de monitoramento (CPU / memoria)
echo   [5] Reiniciar o bot
echo   [6] Somente erros
echo   [0] Sair
echo.
set /p opcao="Escolha uma opcao: "

if "%opcao%"=="1" goto status
if "%opcao%"=="2" goto logs
if "%opcao%"=="3" goto tail
if "%opcao%"=="4" goto monit
if "%opcao%"=="5" goto restart
if "%opcao%"=="6" goto erros
if "%opcao%"=="0" goto fim
goto menu

:status
echo.
call npx --yes pm2 describe vook-store-bot
echo.
pause
goto menu

:logs
echo.
echo Pressione CTRL+C para voltar ao menu.
call npx --yes pm2 logs vook-store-bot
goto menu

:tail
echo.
call npx --yes pm2 logs vook-store-bot --lines 100 --nostream
echo.
pause
goto menu

:monit
call npx --yes pm2 monit
goto menu

:restart
echo.
call npx --yes pm2 restart vook-store-bot
echo.
pause
goto menu

:erros
echo.
call npx --yes pm2 logs vook-store-bot --err --lines 100 --nostream
echo.
pause
goto menu

:fim
endlocal
