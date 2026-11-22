# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

DNotes: a lightweight Markdown notes/journal desktop app (Electron + Vite + React 19 + TypeScript, CodeMirror 6, markdown-it). Code comments and README are in Chinese; follow that convention.

## Commands

```bash
npm run dev          # Vite (127.0.0.1:5173, strictPort) + Electron with --dev --no-sandbox, hot reload
npm run typecheck    # tsc --noEmit — the only static check; there is no linter and no test suite
npm run build        # typecheck + vite build to dist/
npm start            # run the built app (electron .)
npm run dist         # electron-builder installers to release/ (dist:linux = AppImage only)
./deploy.sh          # build AppImage, install to ~/Apps/DNotes.AppImage, register .desktop, build CLI to ~/.local/bin/dnote, restart if running (--skip-build to reuse release/, --cli-only, --no-cli)
./deploy.sh --cli-only   # build + install only the Go CLI (cd cli && go vet ./... to check)
```

If `npm start` on Linux fails with `chrome-sandbox ... must be owned by root and has mode 4755`:
`sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox` (redo after reinstalling electron).

## Architecture

**Process split.** All filesystem, git, search, and config work happens in the main process (`electron/main.cjs`, CommonJS). The renderer (`src/`) is sandboxed (`contextIsolation`, `sandbox: true`, no node) and only talks to main via `window.api`, exposed in `electron/preload.cjs` and typed in `src/types.ts` (`Api` interface, `declare global`).

**Adding an IPC call** requires touching three places in sync: `handle('channel', fn)` in `registerIpc()` in main.cjs, the `call('channel', ...)` wrapper in preload.cjs, and the `Api` type in `src/types.ts`. The `handle` helper wraps results as `{ok, data}` / `{ok:false, error}`; preload's `call` unwraps and rethrows, so renderer code just awaits and catches `Error`.

**Per-window vault state.** Multiple windows are supported; main keeps `windows: Map<webContents.id, {root, watcher, win}>`. Handlers get the vault via `rootOf(e)`. Every renderer-supplied path is vault-relative (forward slashes) and must go through `resolveIn(root, rel)`, which rejects paths escaping the vault. A chokidar watcher per window debounces changes and pushes `vault:changed` (list of rel paths) to the renderer. `IGNORED_DIRS` (`.git`, `.dnotes`, `.obsidian`, `.trash`, `node_modules`) are excluded from the tree/watch/search.

**Config.** Persisted only in Electron `userData/config.json` (`vaults`, `lastVault`, `settings`, `sessions` keyed by vault path) with debounced writes. Nothing is written into the vault itself. App is single-instance except in `--dev` mode.

**Git.** Uses `simple-git` with the system git config (SSH keys / credential helpers); `GIT_TERMINAL_PROMPT=0` so git never blocks on prompts. Pull is rebase + autostash; `sync` = commit → pull → push.

**Local images.** A privileged `dnote://` protocol (`dnote://f/<abs path>`, built by `fileUrl()` in `src/lib/paths.ts`) serves vault files to the preview. The CSP is set in main.cjs; DOMPurify in `src/lib/markdown.ts` must allow the `dnote:` scheme and custom `data-*` attributes.

**Renderer.**
- `src/App.tsx` is the central state holder: tabs, sidebar panels, keyboard shortcuts, autosave, session restore, git auto-sync. Components in `src/components/` are mostly presentational and receive callbacks from App.
- `src/lib/markdown.ts`: markdown-it instance with custom plugins — `[[wikilink#heading|alias]]` / `![[embed]]`, highlight marks, task lists (clickable in preview), `data-line` source mapping (used for editor/preview scroll sync), heading ids. Output is sanitized with DOMPurify.
- `src/lib/settings.ts`: `DEFAULT_SETTINGS`, theme list, and `applySettings()` which applies settings as CSS variables; themes live in `src/styles/themes.css`.

**i18n.** `src/lib/i18n.ts`: `zh` is the base dictionary; `en` must define every key (enforced by types), so add new strings to both. Use `t(key, vars)`. Main process has its own small `MSG` table in main.cjs for error strings, selected by `config.settings.language`.

**CLI (`cli/`, Go, stdlib only).** Standalone `dnote` binary that reads vault files directly, not through Electron. It finds the default vault by reading the app's `config.json` (`os.UserConfigDir()/dnotes` or `/DNotes`): known vault containing cwd, else `lastVault`. Its `ignoredDirs` / markdown-extension rules mirror `IGNORED_DIRS` / `MD_EXT` in main.cjs — keep them in sync.
