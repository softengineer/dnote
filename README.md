# DNotes

轻量级 Markdown 笔记 / 日记应用（Electron + Vite + React），只保留核心功能：笔记、日记、浏览、搜索、Git 同步。

## 功能

- **Vault**：任意文件夹即 vault，笔记就是普通 `.md` 文件；最近打开列表、切换 vault、多窗口
- **标签页**：单击替换当前标签、Ctrl/中键点击新标签；拖拽排序、右键菜单、Ctrl+Shift+T 恢复关闭的标签、会话自动恢复
- **Markdown**：CodeMirror 6 编辑器（代码块语法高亮、`[[` 自动补全、粘贴/拖入图片自动存入附件目录）；编辑 / 分屏（滚动同步）/ 阅读三种视图；支持 `[[wikilink]]`、`![[图片]]`、任务列表（可在阅读视图直接勾选）、表格、frontmatter
- **日记**：Ctrl+Shift+D 打开今日日记，日历面板浏览，文件名格式与模板可配置
- **搜索**：全文 + 文件名搜索，支持区分大小写 / 正则；Ctrl+O 模糊快速打开 / 新建
- **Git**：初始化、设置远程、提交、拉取（rebase + autostash）、推送、一键同步、定时自动同步、打开时自动拉取、查看提交历史和文件历史版本；从远程仓库直接克隆为 vault
- **多语言**：界面支持简体中文（默认）和 English，设置 → 外观 → 界面语言，即时切换
- **主题**：跟随系统 / 明亮 / 暗黑 / 纸张 / Solarized / Nord / Dracula / Gruvbox，可写自定义 CSS 覆盖变量
- **字体**：界面、正文、等宽字体分别可选（列出系统字体），字号 / 行高 / 行宽可调，Ctrl+= / Ctrl+- 快速缩放

Git 认证直接使用系统 git 配置（SSH key / credential helper），命令行能 push 即可。

## 开发

```bash
npm install
npm run dev          # Vite + Electron 热更新
npm run build        # 类型检查 + 构建前端到 dist/
npm start            # 运行构建后的版本
npm run dist         # 打包安装包（electron-builder，输出到 release/）
./deploy.sh           # 打包 AppImage 并安装到 ~/Apps/DNotes.AppImage，同时安装 CLI（--skip-build 跳过打包，--cli-only 只装 CLI，--no-cli 不装 CLI）
```

`npm run dev` 默认带 `--no-sandbox`（仅开发用，规避 Linux 上 chrome-sandbox 权限报错）。
`npm start` 若在 Linux 报 `chrome-sandbox ... must be owned by root and has mode 4755`，执行一次（每次重装 electron 后需重做）：

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

## 命令行

`cli/` 下是 Go 写的 `dnote` 命令（`./deploy.sh` 会装到 `~/.local/bin/dnote`，或 `cd cli && go build -o ~/.local/bin/dnote .`）：

```bash
dnote <文件名> [--vault <路径>]             # 显示笔记内容：按文件名匹配，忽略目录，.md 可省略；多个匹配全部显示
dnote --search <关键词> [--vault <路径>]    # 在 vault 中搜索（不区分大小写），输出 路径:行号: 内容
dnote <文件名> --search <关键词>            # 只在匹配的笔记中搜索
```

未指定 `--vault` 时，优先使用当前目录所在的已知 vault，否则使用 DNotes 最后打开的 vault（读取 `~/.config/dnotes/config.json`）。没有精确的文件名匹配时退化为包含匹配。

## 结构

```
electron/main.cjs     主进程：vault/文件读写（限制在 vault 内）、文件监听、全文搜索、Git、字体列表
electron/preload.cjs  contextBridge 暴露 window.api
src/App.tsx           应用状态：标签页、侧边栏、快捷键、自动保存、Git 同步
src/components/       Editor / Preview / FileTree / SearchPanel / CalendarPanel / GitPanel / TabBar / QuickSwitcher / SettingsModal
src/styles/themes.css 主题（CSS 变量）
```

配置保存在 Electron userData 目录的 `config.json`，vault 内不写入任何配置文件。
