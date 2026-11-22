import { useEffect, useMemo, useRef } from 'react'
import { renderMarkdown, slug } from '../lib/markdown'
import { dirname, fileUrl, join } from '../lib/paths'

interface Props {
  content: string
  notePath: string
  vaultRoot: string
  resolveLink: (target: string) => string | null // wiki 名称 -> vault 相对路径
  onOpen: (target: string, opts: { wiki: boolean; newTab: boolean; heading?: string }) => void
  onToggleTask: (line: number, checked: boolean) => void
  syncLine?: number
}

export default function Preview({ content, notePath, vaultRoot, resolveLink, onOpen, onToggleTask, syncLine }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(content), [content])

  // 解析本地图片路径
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const dir = dirname(notePath)
    el.querySelectorAll('img').forEach((img) => {
      const embed = img.getAttribute('data-wikiembed')
      if (embed) {
        const rel = resolveLink(embed)
        if (rel) img.src = fileUrl(vaultRoot, rel)
        return
      }
      const src = img.getAttribute('src') ?? ''
      if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return
      const rel = src.startsWith('/') ? src.slice(1) : join(dir, decodeURI(src))
      img.src = fileUrl(vaultRoot, rel)
    })
  }, [html, notePath, vaultRoot, resolveLink])

  // 分屏滚动同步
  useEffect(() => {
    const el = ref.current
    if (!el || syncLine == null) return
    const blocks = el.querySelectorAll<HTMLElement>('[data-line]')
    let target: HTMLElement | null = null
    for (const b of blocks) {
      if (Number(b.dataset.line) <= syncLine) target = b
      else break
    }
    const scroller = el.parentElement!
    scroller.scrollTop = target ? target.offsetTop - 16 : 0
  }, [syncLine, html])

  const onClick = (ev: React.MouseEvent) => {
    const t = ev.target as HTMLElement
    if (t instanceof HTMLInputElement && t.classList.contains('task')) {
      onToggleTask(Number(t.dataset.line), t.checked)
      return
    }
    const a = t.closest('a')
    if (!a) return
    ev.preventDefault()
    const newTab = ev.ctrlKey || ev.metaKey || ev.button === 1
    const wiki = a.getAttribute('data-wikilink')
    if (wiki != null) {
      const [name, heading] = wiki.split('#')
      if (!name && heading) return scrollToHeading(heading)
      return onOpen(name, { wiki: true, newTab, heading })
    }
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) return scrollToHeading(decodeURIComponent(href.slice(1)))
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return void window.api.openExternal(href)
    const [p, heading] = href.split('#')
    onOpen(join(dirname(notePath), decodeURI(p)), { wiki: false, newTab, heading })
  }

  const scrollToHeading = (h: string) => {
    const el = ref.current?.querySelector(`[id="${CSS.escape(slug(h))}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return <div className="markdown-body" ref={ref} onClick={onClick} onAuxClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
