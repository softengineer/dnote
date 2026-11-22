import { useState } from 'react'
import { FolderOpen, GitBranch, X, NotebookPen } from 'lucide-react'
import type { VaultInfo } from '../types'
import { prompt, toast } from './Dialog'
import { t } from '../lib/i18n'

interface Props {
  vaults: VaultInfo[]
  onOpen: (path: string) => void
  onForget: (path: string) => void
  onCloned: (v: VaultInfo) => void
}

export default function Welcome({ vaults, onOpen, onForget, onCloned }: Props) {
  const [busy, setBusy] = useState(false)

  const pick = async () => {
    const p = await window.api.pickVault()
    if (p) onOpen(p)
  }
  const clone = async () => {
    const url = await prompt(t('cloneTitle'), '', t('clonePlaceholder'))
    if (!url) return
    const parent = await window.api.pickVault()
    if (!parent) return
    setBusy(true)
    try { onCloned(await window.api.cloneVault(url, parent)) } catch (e) { toast(t('cloneFailed', { err: (e as Error).message }), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="logo"><NotebookPen size={40} /></div>
        <h1>DNotes</h1>
        <p className="sub">{t('tagline')}</p>
        <div className="welcome-actions">
          <button className="btn primary big" onClick={pick}><FolderOpen size={16} /> {t('openVault')}</button>
          <button className="btn big" disabled={busy} onClick={clone}><GitBranch size={16} /> {busy ? t('cloning') : t('cloneVault')}</button>
        </div>
        {vaults.length > 0 && (
          <div className="recent">
            <div className="recent-title">{t('recentVaults')}</div>
            {vaults.map((v) => (
              <div key={v.path} className="recent-item" onClick={() => onOpen(v.path)}>
                <div><div className="name">{v.name}</div><div className="path">{v.path}</div></div>
                <button className="icon-btn" title={t('removeFromList')} onClick={(e) => { e.stopPropagation(); onForget(v.path) }}><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
