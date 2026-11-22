import { useEffect, useRef, useState } from 'react'
import { CaseSensitive, Regex, FileText } from 'lucide-react'
import type { SearchResult } from '../types'
import { t } from '../lib/i18n'

interface Props {
  focusNonce: number
  onOpen: (path: string, line?: number) => void
}

export default function SearchPanel({ focusNonce, onOpen }: Props) {
  const [q, setQ] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => { input.current?.focus(); input.current?.select() }, [focusNonce])

  useEffect(() => {
    const id = ++seq.current
    if (!q.trim()) { setResults([]); setError(''); return }
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const r = await window.api.search(q, { matchCase, regex })
        if (id === seq.current) { setResults(r); setError('') }
      } catch (e) {
        if (id === seq.current) setError(String((e as Error).message))
      } finally {
        if (id === seq.current) setBusy(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [q, matchCase, regex])

  const total = results.reduce((n, r) => n + r.matches.length, 0)

  return (
    <div className="panel">
      <div className="panel-header"><span>{t('search')}</span></div>
      <div className="search-box">
        <input ref={input} className="input" placeholder={t('searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={`icon-btn toggle ${matchCase ? 'on' : ''}`} title={t('matchCase')} onClick={() => setMatchCase(!matchCase)}><CaseSensitive size={16} /></button>
        <button className={`icon-btn toggle ${regex ? 'on' : ''}`} title={t('useRegex')} onClick={() => setRegex(!regex)}><Regex size={16} /></button>
      </div>
      <div className="search-meta">{error ? <span className="err">{error}</span> : q && !busy ? t('searchSummary', { files: results.length, hits: total }) : busy ? t('searching') : ''}</div>
      <div className="search-results">
        {results.map((r) => (
          <div key={r.path} className="search-file">
            <div className="search-file-name" onClick={() => onOpen(r.path)} title={r.path}>
              <FileText size={14} /> <span>{r.path.replace(/\.(md|markdown)$/i, '')}</span>
              {r.matches.length > 0 && <span className="count">{r.matches.length}</span>}
            </div>
            {r.matches.map((m, i) => (
              <div key={i} className="search-hit" onClick={() => onOpen(r.path, m.line)}>
                <span className="ln">{m.line}</span>
                <span>{m.text.slice(0, m.col)}<mark>{m.text.slice(m.col, m.col + m.len)}</mark>{m.text.slice(m.col + m.len)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
