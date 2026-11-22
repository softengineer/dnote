import { useState } from 'react'
import { X, Pencil, Eye, Columns2 } from 'lucide-react'
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
}

export default function TabBar({ tabs, active, onSelect, onClose, onContext, onReorder, onMode }: Props) {
  const [drag, setDrag] = useState<number | null>(null)
  const cur = tabs.find((t) => t.id === active)
  return (
    <div className="tabbar">
      <div className="tabs">
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
      {cur?.kind === 'md' && (
        <div className="mode-switch">
          <button className={`icon-btn ${cur.mode === 'edit' ? 'on' : ''}`} title={t('modeEditTip')} onClick={() => onMode('edit')}><Pencil size={15} /></button>
          <button className={`icon-btn ${cur.mode === 'split' ? 'on' : ''}`} title={t('modeSplit')} onClick={() => onMode('split')}><Columns2 size={15} /></button>
          <button className={`icon-btn ${cur.mode === 'preview' ? 'on' : ''}`} title={t('modePreview')} onClick={() => onMode('preview')}><Eye size={15} /></button>
        </div>
      )}
    </div>
  )
}
