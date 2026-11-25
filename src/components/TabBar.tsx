import { useState } from 'react'
import { X, Pencil, Columns2, Plus, RefreshCw, Upload } from 'lucide-react'
import type { ViewMode } from '../types'
import { t } from '../lib/i18n'

export interface TabInfo { id: string; title: string; dirty: boolean; path: string; mode: ViewMode; kind: 'md' | 'image' | 'history' }

interface Props {
  tabs: TabInfo[]
  active: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onContext: (id: string) => void
  onReorder: (from: number, to: number) => void
  onMode: (mode: ViewMode) => void
  onNew: () => void
  // git 远程按钮：仅当 vault 是有 remote 的仓库时显示
  gitRemote?: boolean
  gitBusy?: string | null
  onPull?: () => void
  onPush?: () => void
}

export default function TabBar({ tabs, active, onSelect, onClose, onContext, onReorder, onMode, onNew, gitRemote, gitBusy, onPull, onPush }: Props) {
  const [drag, setDrag] = useState<number | null>(null)
  const cur = tabs.find((t) => t.id === active)
  return (
    <div className="tabbar">
      {/* 双击标签后的空白处 = 新建笔记 */}
      <div className="tabs" onDoubleClick={(e) => { if (e.target === e.currentTarget) onNew() }}>
        {tabs.map((t, i) => (
          <div
            key={t.id}
            className={`tab ${t.id === active ? 'active' : ''} ${t.dirty ? 'dirty' : ''}`}
            title={t.path}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (drag != null && drag !== i) onReorder(drag, i); setDrag(null) }}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(t.id) } }}
            onClick={() => onSelect(t.id)}
            onContextMenu={(e) => { e.preventDefault(); onContext(t.id) }}
          >
            <span className="tab-title">{t.title}</span>
            <button className="tab-close" onClick={(e) => { e.stopPropagation(); onClose(t.id) }}>
              <span className="dot" />
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="mode-switch">
        <button className="icon-btn" title={t('newNote')} onClick={onNew}><Plus size={15} /></button>
        {gitRemote && (<>
          <button className="icon-btn" disabled={!!gitBusy} title={t('gitPullTip')} onClick={onPull}><RefreshCw size={15} className={gitBusy ? 'spin' : ''} /></button>
          <button className="icon-btn" disabled={!!gitBusy} title={t('gitSyncTip')} onClick={onPush}><Upload size={15} /></button>
        </>)}
        {cur?.kind === 'md' && (<>
          {/* 编辑开关：选中=编辑（分屏下也算编辑），未选中=阅读 */}
          <button className={`icon-btn ${cur.mode !== 'preview' ? 'on' : ''}`} title={t('modeEditTip')} onClick={() => onMode(cur.mode === 'preview' ? 'edit' : 'preview')}><Pencil size={15} /></button>
          {/* 分屏开关：选中=分屏，未选中=单视图（编辑） */}
          <button className={`icon-btn ${cur.mode === 'split' ? 'on' : ''}`} title={t('modeSplit')} onClick={() => onMode(cur.mode === 'split' ? 'edit' : 'split')}><Columns2 size={15} /></button>
        </>)}
      </div>
    </div>
  )
}
