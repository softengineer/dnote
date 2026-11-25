import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Files, Search, CalendarDays, GitBranch, Settings as SettingsIcon, FolderSync, ArrowUpDown, PanelLeft } from 'lucide-react'
import type { GitStatus, Settings, TreeNode, VaultInfo, ViewMode } from './types'
import { DEFAULT_SETTINGS, applySettings, renderTemplate } from './lib/settings'
import { formatDate } from './lib/date'
import { basename, dirname, fileUrl, isImage, isMarkdown, join, relative, sanitizeName, stem } from './lib/paths'
import { wordCount } from './lib/markdown'
import FormatToolbar from './components/FormatToolbar'
import type { EditorView } from '@codemirror/view'
import Editor from './components/Editor'
import Preview from './components/Preview'
import FileTree from './components/FileTree'
import SearchPanel from './components/SearchPanel'
import CalendarPanel from './components/CalendarPanel'
import GitPanel from './components/GitPanel'
import TabBar from './components/TabBar'
import QuickSwitcher from './components/QuickSwitcher'
import SettingsModal from './components/SettingsModal'
import Welcome from './components/Welcome'
import { DialogHost, ToastHost, confirm, prompt, toast } from './components/Dialog'
import { setLang, t } from './lib/i18n'
const tr = t

type SideView = 'files' | 'search' | 'calendar' | 'git'
interface Tab {
  id: string
  path: string
  kind: 'md' | 'image' | 'history'
  content: string
  saved: string
  version: number
  mode: ViewMode
  jump?: { line: number; nonce: number }
  syncLine?: number
  title?: string
}

let tabSeq = 0
const newId = () => 't' + ++tabSeq
const errMsg = (e: unknown) => String((e as Error)?.message ?? e)

function flatten(nodes: TreeNode[], out: { path: string; mtime: number }[] = []) {
  for (const n of nodes) {
    if (n.type === 'dir') flatten(n.children ?? [], out)
    else out.push({ path: n.path, mtime: n.mtime ?? 0 })
  }
  return out
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  setLang(settings.language) // 渲染前同步切换语言，保证本次渲染即使用新语言
  const [vaults, setVaults] = useState<VaultInfo[]>([])
  const [vault, setVault] = useState<VaultInfo | null>(null)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [side, setSide] = useState<SideView>('files')
  const [sideHidden, setSideHidden] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [git, setGit] = useState<GitStatus | null>(null)
  const [gitBusy, setGitBusy] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [searchNonce, setSearchNonce] = useState(0)

  const [editorViews, setEditorViews] = useState<Record<string, EditorView>>({})
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const closedStack = useRef<string[]>([])
  const gitBusyRef = useRef<string | null>(null)

  const active = tabs.find((t) => t.id === activeId) ?? null

  // 当前文档变化时（打开/切换标签/恢复会话），展开文件树到该文件
  const activePath = active?.kind === 'history' ? null : active?.path ?? null
  useEffect(() => {
    if (!activePath) return
    const parts = dirname(activePath).split('/').filter(Boolean)
    if (!parts.length) return
    setExpanded((s) => {
      const dirs = parts.map((_, i) => parts.slice(0, i + 1).join('/'))
      if (dirs.every((d) => s.has(d))) return s
      const n = new Set(s); dirs.forEach((d) => n.add(d)); return n
    })
  }, [activePath])

  // ------------------------------------------------------------ 初始化 & 设置
  useEffect(() => {
    window.api.init().then(async (r) => {
      const s = { ...DEFAULT_SETTINGS, ...r.settings }
      setSettings(s)
      applySettings(s)
      setVaults(r.vaults)
      if (r.vault) await openVault(r.vault)
      setReady(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    applySettings(settings)
    if (!ready) return
    const t = setTimeout(() => window.api.saveSettings(settings), 300)
    return () => clearTimeout(t)
  }, [settings, ready])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = () => applySettings(settingsRef.current)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  // ------------------------------------------------------------ 文件索引
  const files = useMemo(() => flatten(tree), [tree])
  const mdFiles = useMemo(() => files.filter((f) => isMarkdown(f.path)), [files])
  const linkIndex = useMemo(() => {
    const byStem = new Map<string, string>()
    const byName = new Map<string, string>()
    const byPath = new Map<string, string>()
    for (const f of files) {
      byName.set(basename(f.path).toLowerCase(), f.path)
      byPath.set(f.path.toLowerCase(), f.path)
      if (isMarkdown(f.path)) {
        byPath.set(f.path.replace(/\.(md|markdown)$/i, '').toLowerCase(), f.path)
        if (!byStem.has(stem(f.path).toLowerCase())) byStem.set(stem(f.path).toLowerCase(), f.path)
      }
    }
    return { byStem, byName, byPath }
  }, [files])
  const linkIndexRef = useRef(linkIndex)
  linkIndexRef.current = linkIndex

  const resolveLink = useCallback((target: string): string | null => {
    const t = target.trim().replace(/^\//, '').toLowerCase()
    const { byStem, byName, byPath } = linkIndexRef.current
    return byPath.get(t) ?? byName.get(t) ?? byStem.get(t) ?? null
  }, [])

  const noteNamesRef = useRef<string[]>([])
  noteNamesRef.current = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of mdFiles) counts.set(stem(f.path), (counts.get(stem(f.path)) ?? 0) + 1)
    return mdFiles.map((f) => (counts.get(stem(f.path))! > 1 ? f.path.replace(/\.md$/i, '') : stem(f.path)))
  }, [mdFiles])
  const getNoteNames = useCallback(() => noteNamesRef.current, [])

  const refreshTree = useCallback(async () => {
    try { setTree(await window.api.tree()) } catch (e) { toast(errMsg(e), 'error') }
  }, [])

  const refreshGit = useCallback(async () => {
    try { setGit(await window.api.git.status()) } catch { setGit({ isRepo: false }) }
  }, [])

  // ------------------------------------------------------------ vault
  async function openVault(p: string) {
    try {
      await flushAll()
      const v = await window.api.openVault(p)
      setVault(v)
      setTabs([])
      setActiveId(null)
      setVaults((vs) => [v, ...vs.filter((x) => x.path !== v.path)])
      setTree(await window.api.tree())
      const st = await window.api.git.status().catch(() => ({ isRepo: false }) as GitStatus)
      setGit(st)
      const sess = await window.api.getSession(v.path)
      if (sess) {
        if (sess.sidebar) setSide(sess.sidebar as SideView)
        const restored: Tab[] = []
        for (const t of sess.tabs) {
          const tab = await loadTab(t.path, t.mode).catch(() => null)
          if (tab) restored.push(tab)
        }
        setTabs(restored)
        setActiveId(restored.find((t) => t.path === sess.active)?.id ?? restored[0]?.id ?? null)
      }
      if (st.isRepo && st.remote && settingsRef.current.gitPullOnOpen) runGit('pull', undefined, true)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  async function closeVault() {
    await flushAll()
    await window.api.closeVault()
    setVault(null)
    setTabs([])
    setTree([])
    setGit(null)
  }

  // 会话保存
  useEffect(() => {
    if (!vault) return
    const t = setTimeout(() => {
      window.api.saveSession(vault.path, {
        tabs: tabs.filter((x) => x.kind !== 'history').map((x) => ({ path: x.path, mode: x.mode })),
        active: tabs.find((x) => x.id === activeId)?.path ?? null,
        sidebar: side,
      })
    }, 500)
    return () => clearTimeout(t)
  }, [tabs, activeId, side, vault])

  // 外部文件变化
  useEffect(() => {
    if (!vault) return
    let gitTimer: ReturnType<typeof setTimeout>
    return window.api.onVaultChanged(async (paths) => {
      refreshTree()
      clearTimeout(gitTimer)
      gitTimer = setTimeout(refreshGit, 800)
      const changed = new Set(paths)
      for (const tab of tabsRef.current) {
        if (tab.kind !== 'md' || !changed.has(tab.path)) continue
        let text: string
        try { text = await window.api.read(tab.path) } catch { continue }
        if (text === tab.saved) continue
        if (tab.content !== tab.saved) { toast(t('externalConflict', { name: basename(tab.path) }), 'error'); continue }
        setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, content: text, saved: text, version: t.version + 1 } : t)))
      }
    })
  }, [vault, refreshTree, refreshGit])

  // ------------------------------------------------------------ 标签页
  async function loadTab(path: string, mode?: ViewMode): Promise<Tab> {
    if (isImage(path)) return { id: newId(), path, kind: 'image', content: '', saved: '', version: 0, mode: 'preview' }
    const text = await window.api.read(path)
    return { id: newId(), path, kind: 'md', content: text, saved: text, version: 0, mode: mode ?? settingsRef.current.defaultMode }
  }

  const updateTab = (id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) =>
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)))

  async function saveTab(id: string) {
    clearTimeout(saveTimers.current.get(id))
    saveTimers.current.delete(id)
    const tab = tabsRef.current.find((t) => t.id === id)
    if (!tab || tab.kind !== 'md' || tab.content === tab.saved) return
    const content = tab.content
    try {
      await window.api.write(tab.path, content)
      setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, saved: content } : t)))
    } catch (e) {
      toast(t('saveFailed', { err: errMsg(e) }), 'error')
    }
  }

  async function flushAll() {
    await Promise.all(tabsRef.current.filter((t) => t.content !== t.saved).map((t) => saveTab(t.id)))
  }

  const onEdit = (id: string, text: string) => {
    updateTab(id, { content: text })
    if (!settingsRef.current.autosave) return
    clearTimeout(saveTimers.current.get(id))
    saveTimers.current.set(id, setTimeout(() => saveTab(id), 1000))
  }

  async function openFile(path: string, opts: { newTab?: boolean; line?: number } = {}) {
    if (!isMarkdown(path) && !isImage(path)) return void window.api.openPath(path)
    const existing = tabsRef.current.find((t) => t.path === path && t.kind !== 'history')
    if (existing) {
      setActiveId(existing.id)
      if (opts.line) updateTab(existing.id, (t) => ({ jump: { line: opts.line!, nonce: Date.now() }, mode: t.mode === 'preview' ? 'edit' : t.mode }))
      return
    }
    let tab: Tab
    // 沿用当前标签的查看/编辑模式
    const curMd = tabsRef.current.find((t) => t.id === activeRef.current && t.kind === 'md')
    try { tab = await loadTab(path, curMd?.mode) } catch (e) { return toast(t('openFailed', { err: errMsg(e) }), 'error') }
    if (opts.line) { tab.jump = { line: opts.line, nonce: Date.now() }; if (tab.mode === 'preview') tab.mode = 'edit' }
    const cur = tabsRef.current.find((t) => t.id === activeRef.current)
    if (!opts.newTab && cur) {
      await saveTab(cur.id)
      setTabs((ts) => ts.map((t) => (t.id === cur.id ? tab : t)))
    } else {
      setTabs((ts) => {
        const i = ts.findIndex((t) => t.id === activeRef.current)
        const next = [...ts]
        next.splice(i + 1, 0, tab)
        return next
      })
    }
    setActiveId(tab.id)
  }

  async function closeTab(id: string) {
    const ts = tabsRef.current
    const i = ts.findIndex((t) => t.id === id)
    if (i < 0) return
    await saveTab(id)
    if (ts[i].kind !== 'history') closedStack.current.push(ts[i].path)
    const next = ts.filter((t) => t.id !== id)
    setTabs(next)
    if (activeRef.current === id) setActiveId(next[Math.min(i, next.length - 1)]?.id ?? null)
  }

  async function tabContext(id: string) {
    const tab = tabsRef.current.find((t) => t.id === id)!
    const r = await window.api.popupMenu([
      { id: 'close', label: t('close') }, { id: 'others', label: t('closeOthers') }, { id: 'right', label: t('closeRight') }, { id: 'all', label: t('closeAll') },
      { type: 'separator' }, { id: 'reveal', label: t('revealInFolder') }, { id: 'copy', label: t('copyPath') },
    ])
    const ts = tabsRef.current
    const keep = (pred: (t: Tab, i: number) => boolean) => {
      ts.forEach((t, i) => { if (!pred(t, i)) saveTab(t.id) })
      const next = ts.filter(pred)
      setTabs(next)
      if (!next.find((t) => t.id === activeRef.current)) setActiveId(next.at(-1)?.id ?? null)
    }
    const idx = ts.findIndex((t) => t.id === id)
    if (r === 'close') closeTab(id)
    else if (r === 'others') { keep((t) => t.id === id); setActiveId(id) }
    else if (r === 'right') keep((_t, i) => i <= idx)
    else if (r === 'all') keep(() => false)
    else if (r === 'reveal') window.api.reveal(tab.path)
    else if (r === 'copy') navigator.clipboard.writeText(tab.path)
  }

  const setMode = (mode: ViewMode) => active && updateTab(active.id, { mode })

  // ------------------------------------------------------------ 新建 / 日记 / 文件操作
  async function createNote(dir?: string, name?: string, content = '') {
    const folder = dir ?? settingsRef.current.newNoteFolder
    const n = name ?? (await prompt(t('newNote'), t('untitled')))
    if (!n) return
    try {
      const rel = await window.api.create(join(folder, sanitizeName(n).replace(/\.md$/i, '') + '.md'), content)
      await refreshTree()
      await openFile(rel, { newTab: true })
    } catch (e) { toast(errMsg(e), 'error') }
  }

  async function createFolder(dir: string) {
    const n = await prompt(t('newFolder'), t('newFolderName'))
    if (!n) return
    try {
      const rel = await window.api.mkdir(join(dir, sanitizeName(n)))
      await refreshTree()
      setExpanded((s) => new Set(s).add(dir).add(rel))
    } catch (e) { toast(errMsg(e), 'error') }
  }

  async function openDaily(d: Date) {
    const s = settingsRef.current
    const rel = join(s.dailyFolder, formatDate(d, s.dailyFormat) + '.md')
    try {
      if (!(await window.api.exists(rel))) {
        await window.api.create(rel, renderTemplate(s.dailyTemplate, { date: d, title: stem(rel) }, formatDate))
        await refreshTree()
      }
      await openFile(rel, { newTab: !tabsRef.current.find((t) => t.id === activeRef.current)?.path.startsWith(s.dailyFolder) })
    } catch (e) { toast(errMsg(e), 'error') }
  }

  function applyRename(from: string, to: string) {
    setTabs((ts) => ts.map((t) => {
      if (t.path === from) return { ...t, path: to }
      if (t.path.startsWith(from + '/')) return { ...t, path: to + t.path.slice(from.length) }
      return t
    }))
  }

  async function rename(node: TreeNode) {
    const isMd = node.type === 'file' && isMarkdown(node.name)
    const n = await prompt(t('rename'), isMd ? stem(node.name) : node.name)
    if (!n) return
    const to = join(dirname(node.path), sanitizeName(n) + (isMd && !/\.md$/i.test(n) ? '.md' : ''))
    await move(node.path, to)
  }

  async function move(from: string, to: string) {
    if (from === to) return
    if (to.startsWith(from + '/')) return toast(t('cannotMoveIntoSelf'), 'error')
    try {
      for (const t of tabsRef.current) if (t.path === from || t.path.startsWith(from + '/')) await saveTab(t.id)
      const final = await window.api.rename(from, to)
      applyRename(from, final)
      await refreshTree()
    } catch (e) { toast(errMsg(e), 'error') }
  }

  async function remove(node: TreeNode) {
    if (!(await confirm(t('delete'), t('confirmTrash', { path: node.path }), true))) return
    try {
      await window.api.trash(node.path)
      const gone = tabsRef.current.filter((t) => t.path === node.path || t.path.startsWith(node.path + '/'))
      if (gone.length) {
        const next = tabsRef.current.filter((t) => !gone.includes(t))
        setTabs(next)
        if (gone.some((t) => t.id === activeRef.current)) setActiveId(next.at(-1)?.id ?? null)
      }
      await refreshTree()
    } catch (e) { toast(errMsg(e), 'error') }
  }

  async function treeContext(node: TreeNode | null) {
    const dir = node ? (node.type === 'dir' ? node.path : dirname(node.path)) : ''
    const items = [
      { id: 'note', label: t('newNote') }, { id: 'folder', label: t('newFolder') },
      ...(node ? [
        { type: 'separator' as const },
        ...(node.type === 'file' ? [{ id: 'newtab', label: t('openInNewTab') }] : []),
        { id: 'rename', label: t('rename') }, { id: 'copy', label: t('copyPath') },
        { id: 'reveal', label: t('revealInFolder') }, { type: 'separator' as const }, { id: 'delete', label: t('delete') },
      ] : []),
    ]
    const r = await window.api.popupMenu(items)
    if (r === 'note') createNote(dir)
    else if (r === 'folder') createFolder(dir)
    else if (!node) return
    else if (r === 'newtab') openFile(node.path, { newTab: true })
    else if (r === 'rename') rename(node)
    else if (r === 'copy') navigator.clipboard.writeText(node.path)
    else if (r === 'reveal') window.api.reveal(node.path)
    else if (r === 'delete') remove(node)
  }

  // ------------------------------------------------------------ 编辑器辅助
  async function pasteFiles(tab: Tab, list: File[]) {
    const out: string[] = []
    for (const f of list) {
      const extn = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? f.type.split('/')[1] ?? 'bin').toLowerCase()
      const name = f.name && !/^image\.\w+$/.test(f.name) ? sanitizeName(f.name) : `Pasted image ${formatDate(new Date(), 'YYYYMMDDHHmmss')}.${extn}`
      try {
        const rel = await window.api.writeBinary(join(settingsRef.current.attachmentFolder, name), new Uint8Array(await f.arrayBuffer()))
        const link = relative(dirname(tab.path), rel).split('/').map(encodeURIComponent).join('/')
        out.push(f.type.startsWith('image/') || isImage(rel) ? `![](${link})` : `[${basename(rel)}](${link})`)
      } catch (e) { toast(errMsg(e), 'error') }
    }
    refreshTree()
    return out.length ? out.join('\n') : null
  }

  function toggleTask(tab: Tab, line: number, checked: boolean) {
    const lines = tab.content.split('\n')
    if (line < 0 || line >= lines.length) return
    lines[line] = lines[line].replace(/\[( |x|X)\]/, checked ? '[x]' : '[ ]')
    const text = lines.join('\n')
    updateTab(tab.id, (t) => ({ content: text, version: t.version + 1 }))
    clearTimeout(saveTimers.current.get(tab.id))
    saveTimers.current.set(tab.id, setTimeout(() => saveTab(tab.id), 300))
  }

  async function openLink(tab: Tab, target: string, o: { wiki: boolean; newTab: boolean }) {
    if (o.wiki) {
      const rel = resolveLink(target) ?? resolveLink(target + '.md')
      if (rel) return openFile(rel, { newTab: o.newTab })
      if (await confirm(t('noteNotExist'), t('createNoteConfirm', { name: target }))) {
        try {
          const created = await window.api.create(join(settingsRef.current.newNoteFolder, sanitizeName(target) + '.md'), '')
          await refreshTree()
          openFile(created, { newTab: o.newTab })
        } catch (e) { toast(errMsg(e), 'error') }
      }
      return
    }
    const rel = target.replace(/^\//, '')
    const candidate = (await window.api.exists(rel)) ? rel : (await window.api.exists(rel + '.md')) ? rel + '.md' : null
    if (candidate) openFile(candidate, { newTab: o.newTab })
    else toast(t('fileNotFound', { name: target }), 'error')
    void tab
  }

  async function showVersion(hash: string, path: string) {
    try {
      const text = await window.api.git.show(hash, path)
      const tab: Tab = { id: newId(), path, kind: 'history', content: text, saved: text, version: 0, mode: 'preview', title: `${basename(path)} @ ${hash.slice(0, 7)}` }
      setTabs((ts) => [...ts, tab])
      setActiveId(tab.id)
    } catch (e) { toast(errMsg(e), 'error') }
  }

  // ------------------------------------------------------------ Git
  const runGit = useCallback(async (op: 'sync' | 'pull' | 'push' | 'commit' | 'init' | 'refresh', msg?: string, quiet = false) => {
    if (gitBusyRef.current) return
    const opName = t(`gitOp_${op}`)
    gitBusyRef.current = opName
    setGitBusy(opName)
    try {
      if (op === 'sync' || op === 'commit' || op === 'push') await flushAll()
      const message = msg?.trim() || renderTemplate(settingsRef.current.gitCommitMessage, {}, formatDate)
      const g = window.api.git
      const st = op === 'refresh' ? await g.status() : op === 'init' ? await g.init() : op === 'commit' ? await g.commit(message)
        : op === 'sync' ? await g.sync(message) : op === 'pull' ? await g.pull() : await g.push()
      setGit(st)
      if (op !== 'refresh' && !quiet) toast(t('gitDone', { op: opName }))
      if (op === 'pull' || op === 'sync') refreshTree()
    } catch (e) {
      toast(t('gitFailed', { op: opName, err: errMsg(e) }), 'error')
      refreshGit()
    } finally {
      gitBusyRef.current = null
      setGitBusy(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshGit, refreshTree])

  useEffect(() => {
    const m = settings.gitAutoSyncMinutes
    if (!vault || !git?.isRepo || !m) return
    const t = setInterval(() => runGit('sync', undefined, true), m * 60_000)
    return () => clearInterval(t)
  }, [settings.gitAutoSyncMinutes, vault, git?.isRepo, runGit])

  // ------------------------------------------------------------ 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !vault) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      const cur = tabsRef.current.find((t) => t.id === activeRef.current)
      const run = (fn: () => void) => { e.preventDefault(); fn() }
      if (k === 's' && !e.shiftKey) run(() => cur && saveTab(cur.id))
      else if ((k === 'o' || k === 'p') && !e.shiftKey) run(() => setShowSwitcher(true))
      else if (k === 'n' && !e.shiftKey) run(() => createNote())
      else if (k === 'd' && e.shiftKey) run(() => openDaily(new Date()))
      else if (k === 'f' && e.shiftKey) run(() => { setSide('search'); setSideHidden(false); setSearchNonce((n) => n + 1) })
      else if (k === 'g' && e.shiftKey) run(() => runGit('sync'))
      else if (k === 'e' && !e.shiftKey) run(() => cur?.kind === 'md' && updateTab(cur.id, { mode: cur.mode === 'preview' ? 'edit' : 'preview' }))
      else if (k === 'w' && !e.shiftKey) run(() => cur && closeTab(cur.id))
      else if (k === 't' && e.shiftKey) run(() => { const p = closedStack.current.pop(); if (p) openFile(p, { newTab: true }) })
      else if (k === 'tab') run(() => {
        const ts = tabsRef.current
        if (!ts.length) return
        const i = ts.findIndex((t) => t.id === activeRef.current)
        setActiveId(ts[(i + (e.shiftKey ? -1 : 1) + ts.length) % ts.length].id)
      })
      else if (k === '\\') run(() => setSideHidden((h) => !h))
      else if (k === ',') run(() => setShowSettings(true))
      else if (k === '=' || k === '+') run(() => setSettings((s) => ({ ...s, fontSize: Math.min(40, s.fontSize + 1) })))
      else if (k === '-') run(() => setSettings((s) => ({ ...s, fontSize: Math.max(9, s.fontSize - 1) })))
      else if (k === '0') run(() => setSettings((s) => ({ ...s, fontSize: DEFAULT_SETTINGS.fontSize })))
      else if (/^[1-9]$/.test(k) && e.altKey === false) run(() => {
        const ts = tabsRef.current
        const t = k === '9' ? ts.at(-1) : ts[Number(k) - 1]
        if (t) setActiveId(t.id)
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 关闭窗口前保存
  useEffect(() => {
    const h = () => { flushAll() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  })

  // ------------------------------------------------------------ 侧边栏拖拽调宽
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = settings.sidebarWidth
    const move = (ev: MouseEvent) => setSettings((s) => ({ ...s, sidebarWidth: Math.min(600, Math.max(180, w0 + ev.clientX - x0)) }))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('resizing') }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ------------------------------------------------------------ 渲染
  if (!ready) return <div className="loading" />

  if (!vault) {
    return (
      <>
        <Welcome
          vaults={vaults}
          onOpen={openVault}
          onForget={async (p) => setVaults(await window.api.forgetVault(p))}
          onCloned={(v) => openVault(v.path)}
        />
        <DialogHost />
        <ToastHost />
      </>
    )
  }

  const sideButton = (v: SideView, Icon: typeof Files, title: string) => (
    <button
      className={`ribbon-btn ${side === v && !sideHidden ? 'active' : ''}`}
      title={title}
      onClick={() => {
        if (side === v) setSideHidden(!sideHidden)
        else { setSide(v); setSideHidden(false) }
        if (v === 'search') setSearchNonce((n) => n + 1)
        if (v === 'git') refreshGit()
      }}
    >
      <Icon size={19} />
      {v === 'git' && !!git?.files?.length && <span className="ribbon-badge">{git.files.length}</span>}
    </button>
  )

  const activeMd = active?.kind === 'md' ? active : null
  const words = activeMd ? wordCount(activeMd.content) : 0

  return (
    <div className="app">
      <div className="ribbon">
        {sideButton('files', Files, t('files'))}
        {sideButton('search', Search, t('search') + ' (Ctrl+Shift+F)')}
        {sideButton('calendar', CalendarDays, t('journal'))}
        {sideButton('git', GitBranch, t('gitSync'))}
        <div className="spacer" />
        <button className="ribbon-btn" title={t('switchVault')} onClick={async () => {
          const r = await window.api.popupMenu([
            ...vaults.filter((v) => v.path !== vault.path).slice(0, 8).map((v) => ({ id: 'open:' + v.path, label: v.name })),
            { type: 'separator' }, { id: 'pick', label: t('openOtherFolder') }, { id: 'window', label: t('openVaultInNewWindow') }, { id: 'close', label: t('closeVault') },
          ])
          if (!r) return
          if (r.startsWith('open:')) openVault(r.slice(5))
          else if (r === 'pick') { const p = await window.api.pickVault(); if (p) openVault(p) }
          else if (r === 'window') { const p = await window.api.pickVault(); if (p) window.api.newWindow(p) }
          else if (r === 'close') closeVault()
        }}><FolderSync size={19} /></button>
        <button className="ribbon-btn" title={t('settings') + ' (Ctrl+,)'} onClick={() => setShowSettings(true)}><SettingsIcon size={19} /></button>
      </div>

      {!sideHidden && (
        <aside className="sidebar">
          <div className="vault-name" title={vault.path}>{vault.name}</div>
          {side === 'files' && (
            <FileTree
              tree={tree}
              activePath={active?.path ?? null}
              onOpen={(p, nt) => openFile(p, { newTab: nt })}
              onContext={treeContext}
              onMove={(from, toDir) => move(from, join(toDir, basename(from)))}
              onNewNote={(d) => createNote(d)}
              onNewFolder={createFolder}
              expanded={expanded}
              setExpanded={setExpanded}
            />
          )}
          {side === 'search' && <SearchPanel focusNonce={searchNonce} onOpen={(p, line) => openFile(p, { line })} />}
          {side === 'calendar' && (
            <CalendarPanel tree={tree} dailyFolder={settings.dailyFolder} dailyFormat={settings.dailyFormat} activePath={active?.path ?? null}
              onOpenDay={openDaily} onOpen={(p) => openFile(p)} />
          )}
          {side === 'git' && (
            <GitPanel status={git} busy={gitBusy} run={(op, m) => runGit(op, m)} setStatus={setGit}
              onOpen={(p) => openFile(p)} activePath={activeMd?.path ?? null} onShowVersion={showVersion} />
          )}
          <div className="resizer" onMouseDown={startResize} />
        </aside>
      )}

      <main className="main">
        <TabBar
          tabs={tabs.map((t) => ({
            id: t.id, path: t.path, kind: t.kind, mode: t.mode, dirty: t.content !== t.saved,
            title: t.title ?? (t.kind === 'md' ? stem(t.path) : basename(t.path)),
          }))}
          active={activeId}
          onSelect={setActiveId}
          onClose={closeTab}
          onContext={tabContext}
          onReorder={(a, b) => setTabs((ts) => { const n = [...ts]; const [x] = n.splice(a, 1); n.splice(b, 0, x); return n })}
          onMode={setMode}
          onNew={() => createNote('')}
          gitRemote={!!git?.isRepo && !!git.remote}
          gitBusy={gitBusy}
          onPull={() => runGit('pull')}
          onPush={() => runGit('sync')}
        />
        <div className="content">
          {tabs.map((t) => (
            <div key={t.id + ':' + t.path} className={`pane mode-${t.mode}`} style={{ display: t.id === activeId ? undefined : 'none' }}>
              {t.kind === 'image' && <div className="image-view"><img src={fileUrl(vault.path, t.path)} alt={t.path} /></div>}
              {t.kind === 'history' && (
                <div className="preview-scroll"><div className="history-banner">{tr('historyReadonly')}</div>
                  <Preview content={t.content} notePath={t.path} vaultRoot={vault.path} resolveLink={resolveLink}
                    onOpen={(target, o) => openLink(t, target, o)} onToggleTask={() => {}} />
                </div>
              )}
              {t.kind === 'md' && (
                <>
                  {t.mode !== 'preview' && settings.showToolbar && <FormatToolbar view={editorViews[t.id] ?? null} />}
                  <div className="pane-body">
                  {t.mode !== 'preview' && (
                    <div className="editor-wrap">
                      <Editor
                        content={t.content}
                        version={t.version}
                        showLineNumbers={settings.showLineNumbers}
                        jump={t.jump}
                        getNoteNames={getNoteNames}
                        onChange={(text) => onEdit(t.id, text)}
                        onPasteFiles={(fs) => pasteFiles(t, fs)}
                        onScrollLine={t.mode === 'split' ? (line) => updateTab(t.id, { syncLine: line }) : undefined}
                        onReady={(v) => setEditorViews((m) => ({ ...m, [t.id]: v }))}
                        onEscape={() => updateTab(t.id, { mode: 'preview' })}
                      />
                    </div>
                  )}
                  {t.mode !== 'edit' && (
                    <div className="preview-scroll">
                      <Preview
                        content={t.content}
                        notePath={t.path}
                        vaultRoot={vault.path}
                        resolveLink={resolveLink}
                        onOpen={(target, o) => openLink(t, target, o)}
                        onToggleTask={(line, c) => toggleTask(t, line, c)}
                        syncLine={t.mode === 'split' ? t.syncLine : undefined}
                        onDblClick={t.mode === 'preview' ? (line) => updateTab(t.id, { mode: 'edit', ...(line != null && { jump: { line: line + 1, nonce: Date.now() } }) }) : undefined}
                      />
                    </div>
                  )}
                  </div>
                </>
              )}
            </div>
          ))}
          {!tabs.length && (
            <div className="empty-main">
              <div className="empty-actions">
                <button className="link-btn" onClick={() => createNote()}>{t('newNote')} <kbd>Ctrl+N</kbd></button>
                <button className="link-btn" onClick={() => setShowSwitcher(true)}>{t('openFile')} <kbd>Ctrl+O</kbd></button>
                <button className="link-btn" onClick={() => openDaily(new Date())}>{t('todayNote')} <kbd>Ctrl+Shift+D</kbd></button>
                <button className="link-btn" onClick={() => { setSide('search'); setSideHidden(false); setSearchNonce((n) => n + 1) }}>{t('search')} <kbd>Ctrl+Shift+F</kbd></button>
              </div>
            </div>
          )}
        </div>
        <footer className="statusbar">
          <button className="status-item" onClick={() => setSideHidden((h) => !h)} title={t('toggleSidebar') + ' (Ctrl+\\)'}><PanelLeft size={13} /></button>
          {active && <span className="status-item path">{active.path}</span>}
          <div className="spacer" />
          {activeMd && <span className="status-item">{activeMd.content !== activeMd.saved ? t('unsaved') : t('saved')}</span>}
          {activeMd && <span className="status-item">{t('wordStats', { words, chars: activeMd.content.length })}</span>}
          {git?.isRepo && (
            <button className="status-item git" title={t('clickToSync')} onClick={() => runGit('sync')}>
              <GitBranch size={13} /> {git.branch}
              {!!git.files?.length && <span> · {t('changesCount', { n: git.files.length })}</span>}
              {!!git.ahead && <span> ↑{git.ahead}</span>}
              {!!git.behind && <span> ↓{git.behind}</span>}
              <ArrowUpDown size={13} className={gitBusy ? 'spin' : ''} />
            </button>
          )}
        </footer>
      </main>

      {showSwitcher && (
        <QuickSwitcher
          files={files.filter((f) => isMarkdown(f.path) || isImage(f.path))}
          onPick={(p, nt) => openFile(p, { newTab: nt })}
          onCreate={(name) => createNote(undefined, name)}
          onClose={() => setShowSwitcher(false)}
        />
      )}
      {showSettings && <SettingsModal settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />}
      <DialogHost />
      <ToastHost />
    </div>
  )
}
