@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

REM ==========================================================
REM  Este script serve tanto para INICIAR quanto para ATUALIZAR
REM  o bot, e por isso ele para o processo antes de qualquer
REM  outra coisa.
REM
REM  O motivo e concreto: um bot em execucao mantem aberto o
REM  arquivo query_engine-windows.dll.node, e o Windows nao deixa
REM  o "prisma generate" sobrescrever um arquivo em uso. O erro
REM  que aparecia era EPERM no meio do passo 2, com o script
REM  abortando antes de compilar e de reiniciar.
REM ==========================================================

echo ==========================================================
echo   VOOK STORE BOT - INICIALIZACAO
echo ==========================================================
echo.

if not exist ".env" (
    echo [ERRO] Arquivo .env nao encontrado.
    echo        Copie o .env.example para .env e preencha os valores.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [1/6] Instalando dependencias...
    call npm install
    if errorlevel 1 (
        echo [ERRO] Falha ao instalar as dependencias.
        pause
        exit /b 1
    )
) else (
    echo [1/6] Dependencias ja instaladas.
)

REM O ecosystem.config.js aponta error_file/out_file para logs\, e o PM2 nao
REM cria a pasta sozinho. Aqui tambem fica o registro da conta que subiu o bot.
if not exist "logs" mkdir "logs"

REM ==========================================================
REM  O PM2 e conferido ANTES de qualquer coisa que mude o disco.
REM
REM  No Windows o PM2 conversa com o daemon por um pipe de nome GLOBAL
REM  (\\.\pipe\rpc.sock). Se o daemon dono do pipe pertence a outra conta
REM  do Windows, este processo leva EPERM e nao consegue nem falar com
REM  ele nem criar o proprio — cada conta tem seu pm2_home, mas o pipe e
REM  um so para a maquina inteira.
REM
REM  Sem esta checagem o script seguia adiante: compilava, registrava os
REM  comandos no Discord e so morria no passo final. Resultado, o Discord
REM  ficava com a lista NOVA e o processo em execucao com o codigo VELHO.
REM
REM  QUAL conta e a certa NAO esta escrito aqui. Uma versao anterior
REM  afirmava uma conta fixa, deduzida pela pasta do projeto — e errou: o
REM  bot rodava pela outra. A conta certa e a que subiu o bot por ultimo,
REM  e o script registra isso em logs\conta-do-pm2.txt a cada subida.
REM  Pelas contas de usuario comum, o Windows nao revela o dono de um
REM  processo de outra conta, entao o registro e a unica fonte confiavel.
REM ==========================================================
echo [2/6] Verificando o PM2 e parando o bot...
call npx --yes pm2 ping >"%TEMP%\vook-pm2-ping.txt" 2>&1
if errorlevel 1 (
    echo.
    echo [ERRO] Nao foi possivel falar com o PM2.
    echo.
    echo        Resposta do PM2:
    type "%TEMP%\vook-pm2-ping.txt"
    echo.
    echo        Voce esta rodando como: %USERNAME%
    if exist "logs\conta-do-pm2.txt" (
        echo        Ultima subida bem-sucedida foi pela conta:
        type "logs\conta-do-pm2.txt"
    ) else (
        echo        Nao ha registro de qual conta subiu o bot.
    )
    echo.
    echo        No Windows o PM2 usa um pipe unico para a maquina toda. Se a
    echo        resposta acima fala em EPERM, o bot esta rodando pelo PM2 de
    echo        OUTRA conta do Windows, e so ela consegue para-lo e reinicia-lo.
    echo        Rode este script logado nessa conta.
    echo.
    echo        Nada foi alterado: o script parou antes de compilar ou de
    echo        registrar comandos.
    echo.
    pause
    exit /b 1
)

REM O "delete" remove o processo da lista do PM2 em vez de so parar:
REM assim o "pm2 start" do passo 6 sempre recria a partir do
REM ecosystem.config.js atual.
REM
REM A saida fica VISIVEL de proposito. A versao anterior a engolia com
REM ">nul 2>&1" para nao poluir a primeira execucao — e com isso "nao
REM havia processo para remover" e "o remove falhou" viravam a mesma
REM coisa na tela.
call npx --yes pm2 delete vook-store-bot

REM Folga para o Windows liberar o arquivo do engine do Prisma. O PM2
REM pode levar ate kill_timeout (15s) para encerrar graciosamente, e o
REM handle so cai quando o processo morre de fato.
timeout /t 3 /nobreak >nul

REM Nao chama "prisma generate" direto: o script decide se a geracao e
REM necessaria (schema inalterado dispensa) e, quando for, confere se o
REM engine esta livre ANTES de tentar — trocando o EPERM cru por uma
REM mensagem que diz o que fazer.
echo [3/6] Verificando o Prisma Client...
call node scripts/prisma-generate.mjs
if errorlevel 1 (
    echo.
    echo [ERRO] Nao foi possivel preparar o Prisma Client.
    echo.
    pause
    exit /b 1
)

echo [4/6] Compilando o TypeScript...
call npm run build
if errorlevel 1 (
    echo [ERRO] Falha na compilacao. Corrija os erros antes de iniciar.
    pause
    exit /b 1
)

REM Registra os comandos DEPOIS do build e ANTES de subir o processo.
REM
REM Fora daqui, isto ja custou uma investigacao: os comandos foram
REM publicados a partir de um build novo enquanto o processo seguia com
REM o codigo antigo carregado, e o autocomplete respondia vazio sem
REM registrar nada em log. Mantendo os dois no mesmo script, o que o
REM Discord conhece e o que o processo executa nunca divergem.
REM
REM Falha aqui NAO aborta: o bot ainda sobe e funciona com os comandos
REM que ja estavam registrados.
echo [5/6] Registrando os comandos no Discord...
call npm run deploy:commands
if errorlevel 1 (
    echo [AVISO] Falha ao registrar os comandos. O bot vai subir mesmo assim,
    echo         mas com a lista de comandos anterior.
)

echo [6/6] Iniciando o processo no PM2...
call npx --yes pm2 start ecosystem.config.js
if errorlevel 1 (
    echo [ERRO] Falha ao iniciar no PM2.
    pause
    exit /b 1
)

call npx --yes pm2 save

REM So depois de subir de fato: e esta conta que, dai em diante, consegue
REM falar com o daemon. E o que o passo 2 mostra quando outra conta falha.
>"logs\conta-do-pm2.txt" echo %USERNAME%

echo.
echo ==========================================================
echo   Vook Store Bot iniciado pela conta %USERNAME%.
echo   Logs em tempo real: npx pm2 logs vook-store-bot
echo ==========================================================
echo.
pause
endlocal
