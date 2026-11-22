import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'

type Req =
  | { kind: 'prompt'; title: string; value: string; placeholder?: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; danger?: boolean; resolve: (v: boolean) => void }

let push: ((r: Req) => void) | null = null

export const prompt = (title: string, value = '', placeholder?: string) =>
  new Promise<string | null>((resolve) => push?.({ kind: 'prompt', title, value, placeholder, resolve }))
export const confirm = (title: string, message: string, danger = false) =>
  new Promise<boolean>((resolve) => push?.({ kind: 'confirm', title, message, danger, resolve }))

/** 全局唯一的对话框宿主 */
export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null)
  const [val, setVal] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    push = (r) => { setReq(r); if (r.kind === 'prompt') setVal(r.value) }
    return () => { push = null }
  }, [])
  useEffect(() => {
    if (req?.kind === 'prompt') setTimeout(() => {
      const el = input.current
      if (!el) return
      el.focus()
      const dot = el.value.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : el.value.length)
    })
  }, [req])

  if (!req) return null
  const close = (ok: boolean) => {
    if (req.kind === 'prompt') req.resolve(ok ? val.trim() || null : null)
    else req.resolve(ok)
    setReq(null)
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="modal dialog" onKeyDown={(e) => { if (e.key === 'Escape') close(false); if (e.key === 'Enter') close(true) }}>
        <div className="modal-title">{req.title}</div>
        {req.kind === 'prompt'
          ? <input ref={input} className="input" value={val} placeholder={req.placeholder} onChange={(e) => setVal(e.target.value)} />
          : <p className="dialog-msg">{req.message}</p>}
        <div className="dialog-actions">
          <button className="btn" onClick={() => close(false)}>{t('cancel')}</button>
          <button autoFocus={req.kind === 'confirm'} className={`btn ${req.kind === 'confirm' && req.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>{t('ok')}</button>
        </div>
      </div>
    </div>
  )
}

/** 右上角轻提示 */
let toastPush: ((msg: string, type: 'info' | 'error') => void) | null = null
export const toast = (msg: string, type: 'info' | 'error' = 'info') => toastPush?.(msg, type)

export function ToastHost() {
  const [items, setItems] = useState<{ id: number; msg: string; type: string }[]>([])
  useEffect(() => {
    let id = 0
    toastPush = (msg, type) => {
      const i = ++id
      setItems((xs) => [...xs, { id: i, msg, type }])
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== i)), type === 'error' ? 6000 : 2500)
    }
    return () => { toastPush = null }
  }, [])
  return (
    <div className="toasts">
      {items.map((t) => <div key={t.id} className={`toast ${t.type}`} onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>{t.msg}</div>)}
    </div>
  )
}
