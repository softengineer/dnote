export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  mtime?: number
  children?: TreeNode[]
}

export interface VaultInfo { path: string; name: string; lastOpened?: number }

export interface SearchMatch { line: number; text: string; col: number; len: number }
export interface SearchResult { path: string; nameHit: boolean; matches: SearchMatch[] }

export interface GitStatus {
  isRepo: boolean
  branch?: string
  tracking?: string | null
  ahead?: number
  behind?: number
  conflicted?: string[]
  files?: { path: string; index: string; working: string }[]
  remote?: { name: string; url: string } | null
}
export interface GitCommit { hash: string; date: string; message: string; author: string }

export type ViewMode = 'edit' | 'preview' | 'split'

export interface Settings {
  language: 'zh' | 'en'
  theme: string
  customCss: string
  uiFont: string
  textFont: string
  monoFont: string
  uiFontSize: number
  fontSize: number
  lineHeight: number
  readableWidth: number // 0 = 不限制
  defaultMode: ViewMode
  autosave: boolean
  showLineNumbers: boolean
  showToolbar: boolean
  vimMode?: boolean
  dailyFolder: string
  dailyFormat: string
  dailyTemplate: string
  newNoteFolder: string
  attachmentFolder: string
  gitAutoSyncMinutes: number
  gitPullOnOpen: boolean
  gitCommitMessage: string
  sidebarWidth: number
}

export interface MenuItem { id?: string; label?: string; enabled?: boolean; type?: 'separator' }

export interface Api {
  init(): Promise<{ settings: Partial<Settings>; vaults: VaultInfo[]; vault: string | null; platform: string }>
  saveSettings(s: Settings): Promise<void>
  getSession(vault: string): Promise<Session | null>
  saveSession(vault: string, s: Session): Promise<void>
  listFonts(): Promise<string[]>
  popupMenu(items: MenuItem[]): Promise<string | null>
  openExternal(url: string): Promise<void>
  reveal(rel: string): Promise<void>
  openPath(rel: string): Promise<void>

  pickVault(): Promise<string | null>
  openVault(p: string): Promise<VaultInfo>
  closeVault(): Promise<void>
  forgetVault(p: string): Promise<VaultInfo[]>
  newWindow(p?: string): Promise<void>
  cloneVault(url: string, parent: string): Promise<VaultInfo>

  tree(): Promise<TreeNode[]>
  read(rel: string): Promise<string>
  exists(rel: string): Promise<boolean>
  write(rel: string, content: string): Promise<void>
  writeBinary(rel: string, bytes: Uint8Array): Promise<string>
  create(rel: string, content?: string): Promise<string>
  mkdir(rel: string): Promise<string>
  rename(from: string, to: string): Promise<string>
  trash(rel: string): Promise<void>
  search(q: string, opts?: { matchCase?: boolean; regex?: boolean }): Promise<SearchResult[]>

  git: {
    status(): Promise<GitStatus>
    init(): Promise<GitStatus>
    setRemote(url: string): Promise<GitStatus>
    commit(msg?: string): Promise<GitStatus>
    pull(): Promise<GitStatus>
    push(): Promise<GitStatus>
    sync(msg?: string): Promise<GitStatus>
    log(file?: string): Promise<GitCommit[]>
    show(hash: string, file: string): Promise<string>
    abortRebase(): Promise<GitStatus>
  }
  onVaultChanged(cb: (paths: string[]) => void): () => void
}

export interface Session { tabs: { path: string; mode: ViewMode }[]; active: string | null; sidebar?: string }

declare global {
  interface Window { api: Api }
}
