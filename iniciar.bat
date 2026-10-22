@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Kontar - servidor local
echo.
echo  Iniciando o Kontar em http://localhost:3000
echo  (deixe esta janela aberta enquanto usa o app; feche-a para parar)
echo.
start "" cmd /c "timeout /t 5 >nul & start http://localhost:3000"
npx -y serve -l 3000 .
echo.
echo  O servidor parou. Se apareceu erro acima, tire um print e mande para o Claude.
pause
