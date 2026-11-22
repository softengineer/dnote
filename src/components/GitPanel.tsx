import { useEffect, useState } from 'react'
import { RefreshCw, Upload, Download, GitCommitHorizontal, ArrowUpDown, Link } from 'lucide-react'
import type { GitCommit, GitStatus } from '../types'
import { prompt, toast } from './Dialog'
import { locale, t } from '../lib/i18n'

interface Props {
  status: GitStatus | null
  busy: string | null
  run: (op: 'sync' | 'pull' | 'push' | 'commit' | 'init' | 'refresh', msg?: string) => Promise<void>
  setStatus: (s: GitStatus) => void
  onOpen: (path: string) => void
  activePath: string | null
  onShowVersion: (hash: string, path: string) => void
}

const label = (f: { index: string; working: string }) => {
  const c = (f.working.trim() || f.index.trim() || '?')
  return 'MADR?U'.includes(c) ? t(`gitSt_${c as 'M'}`) : c
}

export default function GitPanel({ status, busy, run, setStatus, onOpen, activePath, onShowVersion }: Props) {
  const [msg, setMsg] = useState('')
  const [log, setLog] = useState<GitCommit[]>([])
  const [logFile, setLogFile] = useState(false)

  useEffect(() => {
    if (!status?.isRepo) return
    window.api.git.log(logFile && activePath ? activePath : undefined).then(setLog).catch(() => setLog([]))
  }, [status, logFile, activePath])

  if (!status) return <div className="panel"><div className="panel-header"><span>Git</span></div><div className="empty">{t('loading')}</div></div>

  if (!status.isRepo) {
    return (
      <div className="panel">
        <div className="panel-header"><span>{t('gitSync')}</span></div>
        <div className="git-empty">
          <p>{t('gitNotRepo')}</p>
          <button className="btn primary" disabled={!!busy} onClick={() => run('init')}>{t('gitInit')}</button>
        </div>
      </div>
    )
  }

  const setRemote = async () => {
    const url = await prompt(t('gitSetRemoteTitle'), status.remote?.url ?? '', 'git@github.com:user/notes.git')
    if (!url) return
    try { setStatus(await window.api.git.setRemote(url)); toast(t('gitRemoteSet')) } catch (e) { toast(String((e as Error).message), 'error') }
  }

  const files = status.files ?? []
  return (
    <div className="panel">
      <div className="panel-header">
        <span>Git · {status.branch}</span>
        <div className="panel-actions">
          <button className="icon-btn" title={t('gitOp_refresh')} onClick={() => run('refresh')}><RefreshCw size={15} className={busy ? 'spin' : ''} /></button>
        </div>
      </div>
      <div className="git-remote" title={status.remote?.url}>
        <Link size={13} />
        <span className="url">{status.remote?.url ?? t('gitNoRemote')}</span>
        <button className="link-btn" onClick={setRemote}>{status.remote ? t('gitEdit') : t('gitSet')}</button>
      </div>
      {!!status.conflicted?.length && (
        <div className="git-conflict">
          {t('gitConflict')}
          <button className="link-btn" onClick={async () => setStatus(await window.api.git.abortRebase())}>{t('gitAbortMerge')}</button>
        </div>
      )}
      <div className="git-actions">
        <button className="btn primary" disabled={!!busy} onClick={() => run('sync', msg).then(() => setMsg(''))} title={t('gitSyncTip')}>
          <ArrowUpDown size={14} /> {t('gitOp_sync')}
        </button>
        <button className="btn" disabled={!!busy || !status.remote} onClick={() => run('pull')} title={t('gitPullTip')}>
          <Download size={14} /> {t('gitOp_pull')}{status.behind ? ` ${status.behind}` : ''}
        </button>
        <button className="btn" disabled={!!busy || !status.remote} onClick={() => run('push')} title={t('gitPushTip')}>
          <Upload size={14} /> {t('gitOp_push')}{status.ahead ? ` ${status.ahead}` : ''}
        </button>
      </div>
      <div className="git-commit">
        <input className="input" placeholder={t('gitCommitPlaceholder')} value={msg} onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && run('commit', msg).then(() => setMsg(''))} />
        <button className="icon-btn" disabled={!!busy || !files.length} title={t('gitCommitOnly')} onClick={() => run('commit', msg).then(() => setMsg(''))}><GitCommitHorizontal size={16} /></button>
      </div>
      {busy && <div className="git-busy">{t('gitBusy', { op: busy })}</div>}
      <div className="panel-subheader">{t('gitChanges', { n: files.length })}</div>
      <div className="list git-files">
        {files.map((f) => (
          <div key={f.path} className="list-item" onClick={() => onOpen(f.path)} title={f.path}>
            <span className="name">{f.path}</span>
            <span className={`badge b-${(f.working.trim() || f.index.trim() || 'q').replace('?', 'q')}`}>{label(f)}</span>
          </div>
        ))}
        {!files.length && <div className="empty">{t('gitClean')}</div>}
      </div>
      <div className="panel-subheader">
        {t('gitHistory')}
        <label className="check"><input type="checkbox" checked={logFile} onChange={(e) => setLogFile(e.target.checked)} /> {t('gitCurrentFileOnly')}</label>
      </div>
      <div className="list git-log">
        {log.map((c) => (
          <div key={c.hash} className="list-item log" title={`${c.hash}\n${c.author}`}
            onClick={() => logFile && activePath && onShowVersion(c.hash, activePath)}>
            <span className="msg">{c.message}</span>
            <span className="date">{new Date(c.date).toLocaleString(locale(), { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
        {!log.length && <div className="empty">{t('gitNoCommits')}</div>}
      </div>
    </div>
  )
}
