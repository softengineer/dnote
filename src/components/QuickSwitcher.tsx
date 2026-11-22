import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Plus } from 'lucide-react'
import { t } from '../lib/i18n'

interface Props {
  files: { path: string; mtime: number }[]
  onPick: (path: string, newTab: boolean) => void
  onCreate: (name: string) => void
  onClose: () => void
}

/** 子序列模糊匹配，返回分数（越大越好），-1 表示不匹配 */
function fuzzy(q: string, s: string) {
  if (!q) return 0
  const ql = q.toLowerCase(), sl = s.toLowerCase()
  const idx = sl.indexOf(ql)
  if (idx >= 0) return 1000 - idx - s.length * 0.1 + (sl.lastIndexOf('/') < idx ? 200 : 0)
  let score = 0, j = 0, last = -2
  for (let i = 0; i < sl.length && j < ql.length; i++) {
    if (sl[i] === ql[j]) { score += last === i - 1 ? 5 : 1; last = i; j++ }
  }
  return j === ql.length ? score : -1
}

export default function QuickSwitcher({ files, onPick, onCreate, onClose }: Props) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const items = useMemo(() => {
    if (!q) return [...files].sort((a, b) => b.mtime - a.mtime).slice(0, 50)
    return files
      .map((f) => ({ f, s: fuzzy(q, f.path.replace(/\.md$/i, '')) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((x) => x.f)
  }, [q, files])

  useEffect(() => setSel(0), [q])
  useEffect(() => { list.current?.children[sel]?.scrollIntoView({ block: 'nearest' }) }, [sel])

  const total = items.length + (q ? 1 : 0)
  const choose = (i: number, newTab: boolean) => {
    if (i < items.length) onPick(items[i].path, newTab)
    else if (q) onCreate(q)
    onClose()
  }

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal switcher">
        <input
          autoFocus
          className="input big"
          placeholder={t('switcherPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % Math.max(total, 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + total) % Math.max(total, 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); choose(sel, e.ctrlKey || e.metaKey) }
            else if (e.key === 'Escape') onClose()
          }}
        />
        <div className="switcher-list" ref={list}>
          {items.map((f, i) => (
            <div key={f.path} className={`switcher-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={(e) => choose(i, e.ctrlKey || e.metaKey)}>
              <FileText size={14} />
              <span className="name">{f.path.split('/').pop()!.replace(/\.md$/i, '')}</span>
              <span className="dir">{f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''}</span>
            </div>
          ))}
          {q && (
            <div className={`switcher-item ${sel === items.length ? 'sel' : ''}`} onMouseEnter={() => setSel(items.length)} onClick={() => choose(items.length, false)}>
              <Plus size={14} /> <span className="name">{t('switcherCreate', { name: q })}</span>
            </div>
          )}
        </div>
        <div className="switcher-hint">{t('switcherHint')}</div>
      </div>
    </div>
  )
}
