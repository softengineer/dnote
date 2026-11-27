# DNotes

A lightweight Markdown notes / journal app (Electron + Vite + React) that keeps only the essentials: notes, daily journal, browsing, search, and Git sync.

## Features

- **Vault**: any folder can be a vault, and notes are plain `.md` files; recent vaults list, vault switching, multiple windows
- **Tabs**: click replaces the current tab, Ctrl/middle-click opens a new tab; drag to reorder, context menu, Ctrl+Shift+T reopens closed tabs, session restored automatically
- **Markdown**: CodeMirror 6 editor (syntax highlighting in code blocks, `[[` autocompletion, pasted/dropped images saved to the attachments folder automatically); edit / split (synced scrolling) / reading views; supports `[[wikilink]]`, `![[image]]`, task lists (checkable directly in reading view), tables, frontmatter
- **Journal**: Ctrl+Shift+D opens today's journal entry, browse entries in the calendar panel, configurable file name format and template
- **Search**: full-text + file name search, with case-sensitive / regex options; Ctrl+O fuzzy quick open / create
- **Git**: init, set remote, commit, pull (rebase + autostash), push, one-click sync, scheduled auto-sync, auto-pull on open, commit history and file version history; clone a remote repository directly as a vault. Sync conflicts are resolved automatically (Markdown/text files are union-merged; anything still conflicting keeps the remote version and saves the local one as a conflict copy)
- **Languages**: UI available in Simplified Chinese (default) and English; switch instantly in Settings → Appearance → Interface language
- **Themes**: follow system / Light / Dark / Paper / Solarized / Nord / Dracula / Gruvbox, plus custom CSS to override variables
- **Fonts**: separate UI, body, and monospace fonts (system fonts are listed); adjustable font size / line height / line width, Ctrl+= / Ctrl+- for quick zoom

Git authentication uses your system git config directly (SSH key / credential helper) — if you can push from the command line, it works.

## Development

```bash
npm install
npm run dev          # Vite + Electron with hot reload
npm run build        # type check + build the frontend to dist/
npm start            # run the built app
npm run dist         # build installers (electron-builder, output to release/)
./deploy.sh          # Linux: build the AppImage, install to ~/Apps/DNotes.AppImage, and install the CLI (--skip-build to skip building, --cli-only to install only the CLI, --no-cli to skip the CLI)
.\deploy.ps1         # Windows: build, install to %LOCALAPPDATA%\Programs\DNotes with a Start Menu shortcut, and install the CLI to ~\.local\bin\dnote.exe (-SkipBuild, -CliOnly, -NoCli)
```

`npm run dev` runs with `--no-sandbox` by default (development only, to avoid the chrome-sandbox permission error on Linux).
If `npm start` on Linux fails with `chrome-sandbox ... must be owned by root and has mode 4755`, run this once (redo it after every reinstall of electron):

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

## Command line

`cli/` contains the `dnote` command written in Go (`./deploy.sh` installs it to `~/.local/bin/dnote`, or run `cd cli && go build -o ~/.local/bin/dnote .`):

```bash
dnote <filename> [--vault <path>]             # show a note: matched by file name, ignoring directories, .md optional; all matches are shown
dnote --search <keyword> [--vault <path>]     # search the vault (case-insensitive), output as path:line: content
dnote <filename> --search <keyword>           # search only within the matching notes
```

Without `--vault`, it uses the known vault containing the current directory, otherwise the vault DNotes last opened (read from the app's `config.json`, e.g. `~/.config/dnotes/config.json`). If there is no exact file name match, it falls back to substring matching.

## Structure

```
electron/main.cjs     main process: vault/file I/O (restricted to the vault), file watching, full-text search, Git, font list
electron/preload.cjs  exposes window.api via contextBridge
src/App.tsx           app state: tabs, sidebar, shortcuts, autosave, Git sync
src/components/       Editor / Preview / FileTree / SearchPanel / CalendarPanel / GitPanel / TabBar / QuickSwitcher / SettingsModal
src/styles/themes.css themes (CSS variables)
```

Settings are stored in `config.json` in Electron's userData directory; no config files are written into the vault.
