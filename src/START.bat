@echo off
chcp 65001 >nul
title Econova Show - Chế độ Lập trình (Hot Reload)

cd /d "%~dp0"

echo.
echo ============================================
echo   ECONOVA SHOW - CHE DO LAP TRINH (HOT RELOAD)
echo ============================================
echo.
echo Đang khoi dong ung dung...
echo Giao dien se tu dong lam moi khi ban luu file HTML/JS/CSS.
echo Neu ban sua server.js, ung dung se tu khoi dong lai.
echo.

echo Dang don dep cac tien trinh cu (neu co)...
taskkill /F /IM node.exe >nul 2>&1

if not exist node_modules (
    echo Dang cai dat thu vien lan dau, vui long cho...
    call npm install
    echo.
)

call npm run dev
