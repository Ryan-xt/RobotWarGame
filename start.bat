@echo off
chcp 65001 >nul
title 废土过载 OVERLOAD
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没有找到 Node.js。
  echo   请先到 https://nodejs.org/ 下载 LTS 版本，一路下一步安装好，
  echo   然后再双击一次本文件。
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo 第一次运行，正在安装依赖（只需要一次，大约一分钟）...
  call npm install
  if errorlevel 1 (
    echo.
    echo   依赖安装失败。请检查网络后重新双击本文件。
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   正在构建并启动游戏，浏览器会自动打开 http://localhost:3000
echo   关掉这个黑窗口就等于关掉服务器。
echo.
start "" http://localhost:3000
call npm start
pause
