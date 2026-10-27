@echo off
chcp 65001 >nul
title 废土过载 OVERLOAD
cd /d "%~dp0"

echo.
echo   ================================
echo    废土过载 OVERLOAD - 本地服务器
echo   ================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [!] 没有找到 Node.js。
  echo.
  echo   请先到 https://nodejs.org/ 下载 LTS 版本，一路「下一步」装好，
  echo   然后把所有命令行窗口关掉，再双击一次本文件。
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo   Node 版本: %%v

if not exist "package.json" (
  echo   [!] 这个文件夹里没有 package.json。
  echo   多半是没有解压就直接在压缩包里点了 start.bat：
  echo   请把 zip 全部解压到一个普通文件夹（例如 D:\RobotWarGame）再运行。
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo   第一次运行，正在安装依赖（只需要一次，可能一两分钟）...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   [!] 依赖安装失败。常见原因：
    echo       - 网络不通或被公司代理挡住（需要能访问 registry.npmjs.org）
    echo       - 文件夹路径里有中文 / 空格 / 权限不足
    echo   换个普通路径重试，或换个网络。
    echo.
    pause
    exit /b 1
  )
)

echo   正在构建前端...（每次启动都会做，几秒钟）
call npm run build
if errorlevel 1 (
  echo.
  echo   [!] 构建失败。先删掉 node_modules 文件夹，再双击本文件重装一次。
  echo.
  pause
  exit /b 1
)

echo.
echo   启动服务器，**服务器真的起来之后**浏览器会自动打开。
echo   终端里会打印地址（端口被占用时会自动换一个，以打印的为准）。
echo   关掉这个窗口 = 关掉服务器；和朋友联机时把「局域网:」那行地址发给他。
echo.

set OPEN_BROWSER=1
call npm start

echo.
echo   服务器已停止。
pause
