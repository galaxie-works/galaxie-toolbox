@echo off
title GALAXIE Toolbox (teste)
cd /d "C:\dev\galaxie-toolbox"
set CI=true
echo ============================================================
echo   GALAXIE Toolbox - APP DE TESTE (build de desenvolvimento)
echo ============================================================
echo.
echo   Compilando e abrindo o app com o codigo mais recente...
echo   MANTENHA esta janela aberta enquanto usa o app.
echo   Fechar esta janela encerra o app de teste.
echo.
rem #163: libera a porta 1420 caso um vite/tauri anterior tenha ficado preso.
echo   Liberando a porta 1420 (se estiver presa)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue | Select-Object -Expand OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
echo.
call pnpm tauri dev
echo.
echo *** O app de teste foi encerrado. ***
echo Se houve erro acima, tire um print e me mande.
pause
