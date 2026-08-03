@echo off
title Bridge (feat) - validacao
cd /d C:\dev\gt-feat
echo ============================================================
echo   BRIDGE (feat) - build de validacao
echo   Sincroniza a feat LIMPA (sem WIP do Orion/Confucius)
echo ============================================================
echo.
echo [1/3] Sincronizando a feat mais recente...
git fetch origin
git reset --hard origin/feat/bridge-email-client
echo.
echo [2/3] Conferindo dependencias...
call pnpm install
echo.
echo [3/3] Iniciando o Bridge (feat)...
echo   (a PRIMEIRA vez compila o Rust - pode levar alguns minutos)
echo   IMPORTANTE: feche o seu atalho de dev normal antes - ambos usam a porta 1420.
echo.
call pnpm tauri dev
echo.
echo (App encerrado. Feche esta janela.)
pause
