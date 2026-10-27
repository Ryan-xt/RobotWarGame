#!/usr/bin/env bash
# 双击（或在终端里 ./start.sh）即可玩。第一次会自动装依赖。
cd "$(dirname "$0")" || exit 1

echo
echo "  ================================"
echo "   废土过载 OVERLOAD - 本地服务器"
echo "  ================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  [!] 没有找到 Node.js。"
  echo "  请先到 https://nodejs.org/ 下载 LTS 版本装好，然后关掉终端重开。"
  exit 1
fi
echo "  Node 版本: $(node -v)"

if [ ! -f package.json ]; then
  echo "  [!] 这个文件夹里没有 package.json —— 多半是在压缩包里直接点了 start.sh，"
  echo "  请先把 zip 完整解压到一个普通文件夹再运行。"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo
  echo "  第一次运行，正在安装依赖（只需要一次，可能一两分钟）…"
  npm install --no-audit --no-fund || {
    echo "  [!] 依赖安装失败：检查网络（要能访问 registry.npmjs.org）和文件夹权限。"
    exit 1
  }
fi

echo "  正在构建前端…"
npm run build || {
  echo "  [!] 构建失败。删掉 node_modules 再运行一次试试。"
  exit 1
}

echo
echo "  启动服务器；服务器真的起来之后会自动打开浏览器。"
echo "  关掉这个终端 = 关掉服务器。"
echo
# 由服务器自己在 listen 成功后再打开浏览器——先开浏览器再启动服务器，
# 第一局看到的就是 "localhost 拒绝连接"。
OPEN_BROWSER=1 exec npm start
