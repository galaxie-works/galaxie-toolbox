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
call pnpm tauri dev
echo.
echo *** O app de teste foi encerrado. ***
echo Se houve erro acima, tire um print e me mande.
pause
