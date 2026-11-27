// DNotes — Electron 主进程
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu, nativeTheme, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fss = require('node:fs')
const { pathToFileURL } = require('node:url')
const chokidar = require('chokidar')
const { simpleGit } = require('simple-git')

const isDev = process.argv.includes('--dev')
const DEV_URL = 'http://127.0.0.1:5173'
const IGNORED_DIRS = new Set(['.git', '.dnotes', '.obsidian', '.trash', 'node_modules'])
const MD_EXT = /\.(md|markdown)$/i

// ---------------------------------------------------------------- 单实例
// 同一时间只允许一个 DNotes 进程：再次启动时把已有窗口调到前台，然后自己退出。
// 开发模式（--dev）不加锁，避免已安装的 DNotes 开着时无法启动调试。
if (!isDev && !app.requestSingleInstanceLock()) {
  app.exit(0)
}
app.on('second-instance', () => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(-1)
  if (!win) { if (app.isReady()) createWindow(); return }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

// 从桌面/AppImage 启动时拿不到 ~/.zshrc 等里 export 的变量（如 DOTNET_ROOT、PATH），
// 导致 git 凭据助手（git-credential-manager 等）运行失败。启动时从用户的交互式登录 shell 导入环境：
// 只补充缺失的变量，PATH 取并集。
function importShellEnv() {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL || '/bin/sh'
  const mark = '__DNOTES_ENV__'
  try {
    const out = require('node:child_process').execFileSync(
      shell, ['-ilc', `printf '${mark}'; env -0; printf '${mark}'`],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } })
    const body = out.split(mark)[1]
    if (!body) return
    for (const entry of body.split('\0')) {
      const i = entry.indexOf('=')
      if (i <= 0) continue
      const k = entry.slice(0, i), v = entry.slice(i + 1)
      if (k === 'PATH') {
        const parts = [...(process.env.PATH || '').split(':'), ...v.split(':')].filter(Boolean)
        process.env.PATH = [...new Set(parts)].join(':')
      } else if (!(k in process.env)) {
        process.env[k] = v
      }
    }
  } catch { /* shell 不可用或超时则保持原环境 */ }
}
importShellEnv()

process.env.GIT_TERMINAL_PROMPT = '0' // 不允许 git 卡在交互式密码输入

protocol.registerSchemesAsPrivileged([
  { scheme: 'dnote', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

// ---------------------------------------------------------------- 配置持久化
const configPath = () => path.join(app.getPath('userData'), 'config.json')
let config = { vaults: [], lastVault: null, settings: {}, sessions: {} }
function loadConfig() {
  try { config = { ...config, ...JSON.parse(fss.readFileSync(configPath(), 'utf8')) } } catch { /* 首次运行 */ }
}
let saveTimer = null
function saveConfig() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    fss.mkdirSync(path.dirname(configPath()), { recursive: true })
    fss.writeFileSync(configPath(), JSON.stringify(config, null, 2))
  }, 200)
}

// ---------------------------------------------------------------- 主进程文案（跟随设置里的界面语言）
const MSG = {
  zh: { noVault: '尚未打开 vault', outside: '路径越界: ', badRegex: '正则表达式无效: ', noRemote: '未配置远程仓库', noDir: '目录不存在: ', exists: '目标已存在: ', pickVault: '选择或新建 vault 文件夹', conflictCopy: '冲突副本', detached: '当前不在任何分支上（可能有未完成的 rebase），已停止推送' },
  en: { noVault: 'No vault is open', outside: 'Path is outside the vault: ', badRegex: 'Invalid regular expression: ', noRemote: 'No remote repository configured', noDir: 'Directory does not exist: ', exists: 'Target already exists: ', pickVault: 'Choose or create a vault folder', conflictCopy: 'conflict copy', detached: 'Not on any branch (an unfinished rebase?); push stopped' },
}
const m = (k) => (MSG[config.settings?.language] ?? MSG.zh)[k]

// ---------------------------------------------------------------- 每窗口 vault 状态
/** @type {Map<number, {root: string|null, watcher: any, win: BrowserWindow}>} */
const windows = new Map()
const stateOf = (e) => windows.get(e.sender.id)
function rootOf(e) {
  const s = stateOf(e)
  if (!s || !s.root) throw new Error(m('noVault'))
  return s.root
}
/** 把 vault 内相对路径解析成绝对路径，拒绝越界 */
function resolveIn(root, rel = '') {
  const abs = path.resolve(root, rel)
  const r = path.relative(root, abs)
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error(m('outside') + rel)
  return abs
}
const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/')

async function setVault(state, root) {
  if (state.watcher) { await state.watcher.close(); state.watcher = null }
  state.root = root
  if (!root) return
  const name = path.basename(root)
  config.vaults = [{ path: root, name, lastOpened: Date.now() }, ...config.vaults.filter((v) => v.path !== root)].slice(0, 20)
  config.lastVault = root
  saveConfig()
  state.win.setTitle(`${name} — DNotes`)

  let pending = new Set()
  let timer = null
  state.watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p) => p.split(path.sep).some((seg) => IGNORED_DIRS.has(seg)),
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  })
  state.watcher.on('all', (_evt, p) => {
    pending.add(toRel(root, p))
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!state.win.isDestroyed()) state.win.webContents.send('vault:changed', [...pending])
      pending = new Set()
    }, 250)
  })
}

// ---------------------------------------------------------------- 窗口
function createWindow(vaultPath) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: 'DNotes',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  const state = { root: null, watcher: null, win, pendingVault: vaultPath ?? null }
  const id = win.webContents.id
  windows.set(id, state)
  win.on('closed', () => {
    state.watcher?.close()
    windows.delete(id)
  })
  // 外链统一交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (ev, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith('file:')
    if (!allowed) {
      ev.preventDefault()
      if (/^https?:|^mailto:/.test(url)) shell.openExternal(url)
    }
  })
  win.webContents.on('before-input-event', (_ev, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) win.webContents.toggleDevTools()
    if (input.type === 'keyDown' && input.key === 'F5' && isDev) win.webContents.reload()
  })
  if (isDev) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  return win
}

// ---------------------------------------------------------------- 文件系统
async function readTree(root, dir = root) {
  let entries = []
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }
  const nodes = []
  for (const ent of entries) {
    if (ent.name.startsWith('.') || IGNORED_DIRS.has(ent.name)) continue
    const abs = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      nodes.push({ name: ent.name, path: toRel(root, abs), type: 'dir', children: await readTree(root, abs) })
    } else if (ent.isFile()) {
      let mtime = 0
      try { mtime = (await fs.stat(abs)).mtimeMs } catch {}
      nodes.push({ name: ent.name, path: toRel(root, abs), type: 'file', mtime })
    }
  }
  nodes.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'zh-CN', { numeric: true })))
  return nodes
}

async function* walkMarkdown(root, dir = root) {
  let entries = []
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || IGNORED_DIRS.has(ent.name)) continue
    const abs = path.join(dir, ent.name)
    if (ent.isDirectory()) yield* walkMarkdown(root, abs)
    else if (MD_EXT.test(ent.name)) yield abs
  }
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

async function search(root, query, opts = {}) {
  const { matchCase = false, regex = false, limit = 200 } = opts
  if (!query) return []
  let re
  try { re = new RegExp(regex ? query : escapeRegExp(query), matchCase ? 'g' : 'gi') } catch (err) { throw new Error(m('badRegex') + err.message) }
  const results = []
  for await (const abs of walkMarkdown(root)) {
    const rel = toRel(root, abs)
    const nameHit = (re.lastIndex = 0, re.test(path.basename(rel)))
    let text
    try { text = await fs.readFile(abs, 'utf8') } catch { continue }
    const lines = text.split(/\r?\n/)
    const matches = []
    for (let i = 0; i < lines.length && matches.length < 20; i++) {
      re.lastIndex = 0
      const m = re.exec(lines[i])
      if (m) {
        const line = lines[i]
        const start = Math.max(0, m.index - 40)
        matches.push({
          line: i + 1,
          text: (start > 0 ? '…' : '') + line.slice(start, m.index + m[0].length + 80),
          col: m.index - start + (start > 0 ? 1 : 0),
          len: m[0].length,
        })
      }
    }
    if (nameHit || matches.length) results.push({ path: rel, nameHit, matches })
    if (results.length >= limit) break
  }
  results.sort((a, b) => Number(b.nameHit) - Number(a.nameHit) || b.matches.length - a.matches.length)
  return results
}

async function uniquePath(abs) {
  if (!fss.existsSync(abs)) return abs
  const { dir, name, ext } = path.parse(abs)
  for (let i = 1; ; i++) {
    const p = path.join(dir, `${name} ${i}${ext}`)
    if (!fss.existsSync(p)) return p
  }
}

// ---------------------------------------------------------------- Git
function git(root) { return simpleGit({ baseDir: root, maxConcurrentProcesses: 1, timeout: { block: 60_000 } }) }

async function gitStatus(root) {
  const g = git(root)
  const isRepo = await g.checkIsRepo('root').catch(() => false)
  if (!isRepo) return { isRepo: false }
  const st = await g.status()
  const remotes = await g.getRemotes(true)
  const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
  return {
    isRepo: true,
    branch: st.current,
    tracking: st.tracking,
    ahead: st.ahead,
    behind: st.behind,
    conflicted: st.conflicted,
    files: st.files.map((f) => ({ path: f.path, index: f.index, working: f.working_dir })),
    remote: origin ? { name: origin.name, url: origin.refs.push || origin.refs.fetch } : null,
  }
}

async function ensureCommitted(g, message) {
  await g.add(['-A'])
  const st = await g.status()
  if (st.staged.length || st.files.length) {
    await g.commit(message || `vault backup: ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
    return true
  }
  return false
}

async function hasUpstream(g) {
  try { await g.raw(['rev-parse', '--abbrev-ref', '@{u}']); return true } catch { return false }
}

async function gitPath(g, root, p) { return path.resolve(root, (await g.raw(['rev-parse', '--git-path', p])).trim()) }

// 文本笔记用 union 合并：两边改动的行都保留，不产生冲突标记。
// 写在 .git/info/attributes（仅本地生效，不进入仓库内容）
const UNION_ATTRS = ['*.md merge=union', '*.markdown merge=union', '*.txt merge=union']
async function ensureUnionMerge(g, root) {
  const f = await gitPath(g, root, 'info/attributes')
  const cur = await fs.readFile(f, 'utf8').catch(() => '')
  const lines = cur.split(/\r?\n/)
  const missing = UNION_ATTRS.filter((l) => !lines.includes(l))
  if (!missing.length) return
  await fs.mkdir(path.dirname(f), { recursive: true })
  await fs.writeFile(f, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n')
}

async function rebaseInProgress(g, root) {
  for (const p of ['rebase-merge', 'rebase-apply']) if (fss.existsSync(await gitPath(g, root, p))) return true
  return false
}

async function stageBlob(g, stage, rel) {
  try { return await g.showBuffer([`:${stage}:${rel}`]) } catch { return null }
}

// rebase 过程中自动解决冲突：远程版本保留在原路径，本地版本另存为“冲突副本”，不丢任何内容
async function autoResolveRebase(g, root) {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`
  for (let round = 0; round < 200 && (await rebaseInProgress(g, root)); round++) {
    const conflicted = (await g.status()).conflicted
    for (const rel of conflicted) {
      const abs = resolveIn(root, rel)
      const upstream = await stageBlob(g, 2, rel) // rebase 中 stage 2 = 上游（远程）
      const local = await stageBlob(g, 3, rel) // stage 3 = 正在重放的本地提交
      await fs.mkdir(path.dirname(abs), { recursive: true })
      if (upstream && local) {
        await fs.writeFile(abs, upstream)
        const { dir, name, ext } = path.parse(abs)
        await fs.writeFile(await uniquePath(path.join(dir, `${name} (${m('conflictCopy')} ${stamp})${ext}`)), local)
      } else if (upstream || local) {
        await fs.writeFile(abs, upstream || local) // 一边删除一边修改：保留修改
      } else {
        await fs.rm(abs, { force: true })
      }
    }
    await g.add(['-A'])
    try {
      // 先自己提交（沿用原提交信息），rebase --continue 就不会再打开编辑器
      if ((await g.status()).staged.length) await g.raw(['commit', '--no-edit', '--no-verify'])
      await g.raw(['rebase', '--continue'])
    } catch (err) {
      const st = await g.status()
      if (st.conflicted.length) continue // 下一个提交又冲突，继续处理
      if (!st.files.length && (await rebaseInProgress(g, root))) await g.raw(['rebase', '--skip']).catch(() => {}) // 解决后为空提交
      else throw err
    }
  }
}

async function pullRebase(g, root) {
  await ensureUnionMerge(g, root)
  try {
    await g.pull(['--rebase', '--autostash'])
  } catch (err) {
    if (!(await rebaseInProgress(g, root))) throw err
    await autoResolveRebase(g, root)
  }
}

async function gitPull(g, root) {
  const remotes = await g.getRemotes()
  if (!remotes.length) throw new Error(m('noRemote'))
  if (await hasUpstream(g)) {
    await pullRebase(g, root)
  } else {
    const branch = (await g.status()).current
    await g.fetch()
    const remoteBranches = await g.branch(['-r'])
    if (remoteBranches.all.includes(`origin/${branch}`)) {
      await g.raw(['branch', `--set-upstream-to=origin/${branch}`, branch])
      await pullRebase(g, root)
    }
  }
}

async function gitPush(g) {
  const remotes = await g.getRemotes()
  if (!remotes.length) throw new Error(m('noRemote'))
  if ((await g.status()).detached) throw new Error(m('detached')) // 不在分支上（如 rebase 未完成），不能推送 "HEAD"
  if (await hasUpstream(g)) await g.push()
  else await g.push(['-u', 'origin', (await g.status()).current])
}

const gitOps = {
  status: (root) => gitStatus(root),
  init: async (root) => {
    const g = git(root)
    await g.init(['-b', 'main'])
    const gi = path.join(root, '.gitignore')
    if (!fss.existsSync(gi)) await fs.writeFile(gi, '.DS_Store\n.trash/\n.dnotes/workspace.json\n')
    return gitStatus(root)
  },
  setRemote: async (root, url) => {
    const g = git(root)
    const remotes = await g.getRemotes()
    if (remotes.some((r) => r.name === 'origin')) await g.remote(['set-url', 'origin', url])
    else await g.addRemote('origin', url)
    return gitStatus(root)
  },
  commit: async (root, message) => { await ensureCommitted(git(root), message); return gitStatus(root) },
  pull: async (root) => {
    const g = git(root)
    if (await rebaseInProgress(g, root)) await autoResolveRebase(g, root) // 上次遗留的冲突
    await gitPull(g, root)
    return gitStatus(root)
  },
  push: async (root) => { await gitPush(git(root)); return gitStatus(root) },
  sync: async (root, message) => {
    const g = git(root)
    if (await rebaseInProgress(g, root)) await autoResolveRebase(g, root) // 上次遗留的冲突
    await ensureCommitted(g, message)
    if ((await g.getRemotes()).length) {
      await gitPull(g, root)
      await gitPush(g)
    }
    return gitStatus(root)
  },
  log: async (root, file) => {
    const opts = { maxCount: 50 }
    if (file) opts.file = file
    const l = await git(root).log(opts)
    return l.all.map((c) => ({ hash: c.hash, date: c.date, message: c.message, author: c.author_name }))
  },
  show: async (root, hash, file) => git(root).show([`${hash}:${file}`]),
  abortRebase: async (root) => { await git(root).rebase(['--abort']).catch(() => {}); return gitStatus(root) },
}

// ---------------------------------------------------------------- IPC
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    try { return { ok: true, data: await fn(e, ...args) } } catch (err) { return { ok: false, error: String(err?.message ?? err) } }
  })
}

function registerIpc() {
  // --- app / 配置
  handle('app:init', (e) => {
    const s = stateOf(e)
    const v = s.pendingVault ?? s.root ?? config.lastVault
    s.pendingVault = null
    return { settings: config.settings, vaults: config.vaults, vault: v && fss.existsSync(v) ? v : null, platform: process.platform }
  })
  handle('settings:save', (_e, settings) => { config.settings = settings; saveConfig() })
  handle('session:get', (_e, vault) => config.sessions[vault] ?? null)
  handle('session:save', (_e, vault, sess) => { config.sessions[vault] = sess; saveConfig() })
  handle('fonts:list', async () => {
    const { getFonts } = require('font-list')
    const fonts = await getFonts({ disableQuoting: true })
    return [...new Set(fonts.map((f) => f.replace(/^"|"$/g, '')))].sort((a, b) => a.localeCompare(b))
  })
  handle('menu:popup', (e, items) => new Promise((resolve) => {
    let picked = null
    const build = (list) => list.map((it) => it.type === 'separator'
      ? { type: 'separator' }
      : { label: it.label, enabled: it.enabled !== false, ...(it.checked != null ? { type: 'checkbox', checked: !!it.checked } : {}), click: () => { picked = it.id } })
    Menu.buildFromTemplate(build(items)).popup({
      window: BrowserWindow.fromWebContents(e.sender),
      callback: () => setTimeout(() => resolve(picked), 0),
    })
  }))
  handle('shell:openExternal', (_e, url) => { if (/^https?:|^mailto:/.test(url)) shell.openExternal(url) })
  handle('shell:reveal', (e, rel) => shell.showItemInFolder(resolveIn(rootOf(e), rel)))
  handle('shell:openPath', (e, rel) => shell.openPath(resolveIn(rootOf(e), rel)))

  // --- vault
  handle('vault:pick', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: m('pickVault'), properties: ['openDirectory', 'createDirectory'],
    })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('vault:open', async (e, root) => {
    if (!fss.existsSync(root) || !fss.statSync(root).isDirectory()) throw new Error(m('noDir') + root)
    await setVault(stateOf(e), root)
    return { path: root, name: path.basename(root) }
  })
  handle('vault:close', async (e) => { await setVault(stateOf(e), null); config.lastVault = null; saveConfig() })
  handle('vault:forget', (_e, root) => { config.vaults = config.vaults.filter((v) => v.path !== root); saveConfig(); return config.vaults })
  handle('vault:newWindow', (_e, root) => { createWindow(root ?? null) })
  handle('vault:clone', async (e, url, parent) => {
    const name = url.replace(/\.git$/, '').split(/[/:]/).pop() || 'vault'
    const target = await uniquePath(path.join(parent, name))
    await simpleGit().clone(url, target)
    await setVault(stateOf(e), target)
    return { path: target, name: path.basename(target) }
  })

  // --- fs
  handle('fs:tree', (e) => readTree(rootOf(e)))
  handle('fs:read', (e, rel) => fs.readFile(resolveIn(rootOf(e), rel), 'utf8'))
  handle('fs:exists', (e, rel) => fss.existsSync(resolveIn(rootOf(e), rel)))
  handle('fs:write', async (e, rel, content) => {
    const abs = resolveIn(rootOf(e), rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
  })
  handle('fs:writeBinary', async (e, rel, bytes) => {
    const root = rootOf(e)
    const abs = await uniquePath(resolveIn(root, rel))
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, Buffer.from(bytes))
    return toRel(root, abs)
  })
  handle('fs:create', async (e, rel, content = '') => {
    const root = rootOf(e)
    const abs = await uniquePath(resolveIn(root, rel))
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' })
    return toRel(root, abs)
  })
  handle('fs:mkdir', async (e, rel) => {
    const root = rootOf(e)
    const abs = await uniquePath(resolveIn(root, rel))
    await fs.mkdir(abs, { recursive: true })
    return toRel(root, abs)
  })
  handle('fs:rename', async (e, from, to) => {
    const root = rootOf(e)
    const src = resolveIn(root, from)
    const dst = resolveIn(root, to)
    if (src === dst) return to
    if (fss.existsSync(dst) && src.toLowerCase() !== dst.toLowerCase()) throw new Error(m('exists') + to)
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.rename(src, dst)
    return toRel(root, dst)
  })
  handle('fs:trash', async (e, rel) => {
    const abs = resolveIn(rootOf(e), rel)
    try { await shell.trashItem(abs) } catch { await fs.rm(abs, { recursive: true, force: true }) }
  })
  handle('search:run', (e, query, opts) => search(rootOf(e), query, opts))

  // --- git
  for (const [name, fn] of Object.entries(gitOps)) handle('git:' + name, (e, ...args) => fn(rootOf(e), ...args))
}

// ---------------------------------------------------------------- 启动
app.whenReady().then(() => {
  loadConfig()
  // dnote://f/<绝对路径>：在预览中加载 vault 里的本地图片
  protocol.handle('dnote', (req) => {
    const u = new URL(req.url)
    const abs = path.resolve(decodeURIComponent(u.pathname))
    const inVault = [...windows.values()].some((s) => s.root && !path.relative(s.root, abs).startsWith('..'))
    if (!inVault) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(abs).toString())
  })
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({ responseHeaders: { ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: dnote: https: http:; font-src 'self' data:"] } })
    })
  }
  registerIpc()
  // 仅保留基础菜单（macOS 需要 Edit 菜单才能复制粘贴），去掉默认的缩放快捷键，交给应用自己处理字号
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
    : null)
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
