#!/usr/bin/env bash
# 构建 DNotes 的 Linux AppImage，安装到 ~/Apps/DNotes.AppImage，
# 注册桌面启动项；如果 DNotes 正在运行，则重启为新版本。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

usage() {
  cat <<USAGE
用法: ./deploy.sh [选项]
  （无选项）     打包 AppImage 并安装，同时安装 CLI
  --skip-build   跳过打包，直接安装 release/ 下最新的 AppImage（同时安装 CLI）
  --cli-only     只编译并安装 CLI 到 ~/.local/bin/dnote
  --no-cli       不安装 CLI
USAGE
}

SKIP_BUILD=0 CLI_ONLY=0 NO_CLI=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --cli-only)   CLI_ONLY=1 ;;
    --no-cli)     NO_CLI=1 ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "deploy: unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done
if (( CLI_ONLY && NO_CLI )); then
  echo "deploy: --cli-only 和 --no-cli 不能同时使用" >&2; exit 2
fi

# 命令行工具 dnote（Go），装到 ~/.local/bin
CLI_DEST="${HOME}/.local/bin/dnote"
install_cli() {
  if ! command -v go >/dev/null 2>&1; then
    echo "deploy: go not found, cannot build CLI" >&2
    return 1
  fi
  mkdir -p "$(dirname "${CLI_DEST}")"
  # 先编译到临时文件再改名，避免覆盖正在运行的二进制时出错
  (cd "${ROOT}/cli" && go build -o "${CLI_DEST}.tmp" .)
  mv -f "${CLI_DEST}.tmp" "${CLI_DEST}"
  echo "deploy: installed CLI -> ${CLI_DEST}"
}

if (( CLI_ONLY )); then
  install_cli
  exit 0
fi

if (( ! SKIP_BUILD )); then
  npm run dist:linux
fi

APPIMAGE="$(ls -t release/DNotes-*.AppImage 2>/dev/null | head -1 || true)"
if [[ -z "${APPIMAGE}" || ! -f "${APPIMAGE}" ]]; then
  echo "deploy: no release/DNotes-*.AppImage found after build" >&2
  exit 1
fi

APPS_DIR="${HOME}/Apps"
DEST="${APPS_DIR}/DNotes.AppImage"   # 固定文件名，升级时直接覆盖，桌面启动项无需改动
# 只匹配 argv[0] 是 AppImage 本身，或 AppImage 挂载出来的 dnotes 主程序的进程，
# 避免误杀命令行里恰好包含这些路径的其他进程（编辑器、shell 等）
PATTERNS=(
  "^${DEST//./\\.}( |\$)"
  "^/tmp/\\.mount_DNotes[^/ ]*/dnotes( |\$)"
)

dnotes_running() {
  local p
  for p in "${PATTERNS[@]}"; do pgrep -f "$p" >/dev/null 2>&1 && return 0; done
  return 1
}

signal_dnotes() {
  local p
  for p in "${PATTERNS[@]}"; do pkill "-$1" -f "$p" 2>/dev/null || true; done
}

stop_dnotes() {
  signal_dnotes TERM
  for _ in $(seq 1 20); do dnotes_running || return 0; sleep 0.3; done
  signal_dnotes KILL
  sleep 0.3
}

was_running=0
if dnotes_running; then
  was_running=1
  echo "deploy: stopping running DNotes…"
  stop_dnotes
fi

mkdir -p "${APPS_DIR}"
# 先复制到临时文件再改名，避免覆盖过程中留下半个文件
cp -f "${APPIMAGE}" "${DEST}.tmp"
chmod +x "${DEST}.tmp"
mv -f "${DEST}.tmp" "${DEST}"
echo "deploy: installed ${APPIMAGE} -> ${DEST}"

if (( ! NO_CLI )); then
  install_cli || echo "deploy: skipping CLI" >&2
fi

# 图标：装到用户图标主题目录，桌面启动项通过 Icon=dnotes 引用
ICON_DIR="${HOME}/.local/share/icons/hicolor/512x512/apps"
mkdir -p "${ICON_DIR}"
cp -f "${ROOT}/build/icon.png" "${ICON_DIR}/dnotes.png"
gtk-update-icon-cache -q -t "${HOME}/.local/share/icons/hicolor" >/dev/null 2>&1 || true

# 桌面启动项（应用菜单里可以搜到 DNotes）
DESKTOP_DIR="${HOME}/.local/share/applications"
mkdir -p "${DESKTOP_DIR}"
cat > "${DESKTOP_DIR}/dnotes.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=DNotes
Comment=Markdown notes & journal
Exec="${DEST}" %U
Icon=dnotes
Terminal=false
Categories=Office;
StartupWMClass=dnotes
DESKTOP
update-desktop-database "${DESKTOP_DIR}" >/dev/null 2>&1 || true

if (( was_running )); then
  echo "deploy: starting DNotes…"
  nohup "${DEST}" </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi
