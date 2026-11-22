import type { Settings } from '../types'
import { setLang } from './i18n'

export const THEMES: { id: string; dark: boolean }[] = [
  { id: 'system', dark: false },
  { id: 'light', dark: false },
  { id: 'dark', dark: true },
  { id: 'paper', dark: false },
  { id: 'solarized-light', dark: false },
  { id: 'solarized-dark', dark: true },
  { id: 'nord', dark: true },
  { id: 'dracula', dark: true },
  { id: 'gruvbox', dark: true },
]

export const DEFAULT_SETTINGS: Settings = {
  language: 'zh',
  theme: 'system',
  customCss: '',
  uiFont: '',
  textFont: '',
  monoFont: '',
  uiFontSize: 13,
  fontSize: 16,
  lineHeight: 1.7,
  readableWidth: 780,
  defaultMode: 'edit',
  autosave: true,
  showLineNumbers: false,
  showToolbar: true,
  dailyFolder: '日记',
  dailyFormat: 'YYYY-MM-DD',
  dailyTemplate: '# {{date:YYYY年M月D日 ddd}}\n\n',
  newNoteFolder: '',
  attachmentFolder: 'attachments',
  gitAutoSyncMinutes: 0,
  gitPullOnOpen: true,
  gitCommitMessage: 'vault backup: {{date:YYYY-MM-DD HH:mm:ss}}',
  sidebarWidth: 260,
}

const SYS_UI = `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
const SYS_MONO = `"JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, Consolas, "Noto Sans Mono CJK SC", monospace`
const q = (f: string) => (f ? `"${f.replace(/"/g, '')}", ` : '')

export function resolvedTheme(theme: string) {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applySettings(s: Settings) {
  setLang(s.language)
  const root = document.documentElement
  const theme = resolvedTheme(s.theme)
  root.dataset.theme = theme
  root.dataset.dark = String(THEMES.find((t) => t.id === theme)?.dark ?? false)
  const v = root.style
  v.setProperty('--font-ui', q(s.uiFont) + SYS_UI)
  v.setProperty('--font-text', q(s.textFont) + (s.uiFont ? q(s.uiFont) : '') + SYS_UI)
  v.setProperty('--font-mono', q(s.monoFont) + SYS_MONO)
  v.setProperty('--ui-size', s.uiFontSize + 'px')
  v.setProperty('--text-size', s.fontSize + 'px')
  v.setProperty('--line-height', String(s.lineHeight))
  v.setProperty('--readable-width', s.readableWidth > 0 ? s.readableWidth + 'px' : 'none')
  v.setProperty('--sidebar-width', s.sidebarWidth + 'px')

  let style = document.getElementById('custom-css') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'custom-css'
    document.head.appendChild(style)
  }
  style.textContent = s.customCss
}

/** 渲染模板中的 {{date:FMT}} / {{title}} */
export function renderTemplate(tpl: string, vars: { title?: string; date?: Date }, fmt: (d: Date, f: string) => string) {
  const d = vars.date ?? new Date()
  return tpl
    .replace(/\{\{date(?::([^}]+))?\}\}/g, (_m, f) => fmt(d, f || 'YYYY-MM-DD'))
    .replace(/\{\{time\}\}/g, fmt(new Date(), 'HH:mm'))
    .replace(/\{\{title\}\}/g, vars.title ?? '')
}
