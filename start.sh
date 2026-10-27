#!/usr/bin/env bash
# 双击（或在终端里 ./start.sh）即可玩。第一次会自动装依赖。
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js。请先安装 https://nodejs.org/ 的 LTS 版本，然后重新运行。"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "第一次运行，正在安装依赖（只需要一次，大约一分钟）…"
  npm install
fi

URL="http://localhost:3000"
echo "启动中：$URL   （Ctrl+C 停止服务器）"
if command -v open >/dev/null 2>&1; then
  (sleep 1; open "$URL" >/dev/null 2>&1 || true) &
elif command -v xdg-open >/dev/null 2>&1; then
  (sleep 1; xdg-open "$URL" >/dev/null 2>&1 || true) &
fi

exec npm start
