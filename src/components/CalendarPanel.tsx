import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CalendarCheck } from 'lucide-react'
import type { TreeNode } from '../types'
import { formatDate, sameDay } from '../lib/date'
import { locale, t } from '../lib/i18n'

interface Props {
  tree: TreeNode[]
  dailyFolder: string
  dailyFormat: string
  activePath: string | null
  onOpenDay: (d: Date) => void
  onOpen: (path: string) => void
}

function collect(nodes: TreeNode[], prefix: string, out: TreeNode[]) {
  for (const n of nodes) {
    if (n.type === 'dir') collect(n.children ?? [], prefix, out)
    else if ((!prefix || n.path.startsWith(prefix + '/')) && /\.md$/i.test(n.path)) out.push(n)
  }
  return out
}

export default function CalendarPanel({ tree, dailyFolder, dailyFormat, activePath, onOpenDay, onOpen }: Props) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const today = new Date()

  const daily = useMemo(() => collect(tree, dailyFolder.replace(/\/$/, ''), []), [tree, dailyFolder])
  const pathFor = (d: Date) => (dailyFolder ? dailyFolder.replace(/\/$/, '') + '/' : '') + formatDate(d, dailyFormat) + '.md'
  const existing = useMemo(() => new Set(daily.map((n) => n.path)), [daily])

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const first = new Date(year, month, 1)
  const start = (first.getDay() + 6) % 7 // 周一开始
  const days = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = [...Array(start).fill(null), ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1))]
  while (cells.length % 7) cells.push(null)

  const recent = [...daily].sort((a, b) => b.path.localeCompare(a.path)).slice(0, 30)

  return (
    <div className="panel">
      <div className="panel-header">
        <span>{t('journal')}</span>
        <div className="panel-actions">
          <button className="icon-btn" title={t('todayNoteTip')} onClick={() => onOpenDay(new Date())}><CalendarCheck size={15} /></button>
        </div>
      </div>
      <div className="calendar">
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={16} /></button>
          <span className="cal-title" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} title={t('backToThisMonth')}>{t('monthTitle', { year, month: month + 1, monthName: first.toLocaleString(locale(), { month: 'long' }) })}</span>
          <button className="icon-btn" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={16} /></button>
        </div>
        <div className="cal-grid">
          {t('weekdaysShort').split(',').map((w) => <div key={w} className="cal-week">{w}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={i} />
            const p = pathFor(d)
            return (
              <div
                key={i}
                className={`cal-day ${sameDay(d, today) ? 'today' : ''} ${existing.has(p) ? 'has' : ''} ${activePath === p ? 'active' : ''}`}
                onClick={() => onOpenDay(d)}
              >
                {d.getDate()}
              </div>
            )
          })}
        </div>
      </div>
      <div className="panel-subheader">{t('recentJournal')}</div>
      <div className="list">
        {recent.map((n) => (
          <div key={n.path} className={`list-item ${activePath === n.path ? 'active' : ''}`} onClick={() => onOpen(n.path)}>{n.name.replace(/\.md$/i, '')}</div>
        ))}
        {!recent.length && <div className="empty">{t('noJournal')}</div>}
      </div>
    </div>
  )
}
