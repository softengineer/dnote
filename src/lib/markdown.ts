import MarkdownItCtor from 'markdown-it'
import type { MarkdownIt, StateInline } from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** [[target#heading|alias]] 与 ![[image.png]] */
function wikilinks(md: MarkdownIt) {
  md.inline.ruler.before('link', 'wikilink', (state: StateInline, silent: boolean) => {
    const src = state.src
    let pos = state.pos
    const embed = src.charCodeAt(pos) === 0x21 /* ! */
    if (embed) pos++
    if (src.slice(pos, pos + 2) !== '[[') return false
    const end = src.indexOf(']]', pos + 2)
    if (end < 0) return false
    const inner = src.slice(pos + 2, end)
    if (!inner || inner.includes('\n')) return false
    if (!silent) {
      const [target, alias] = inner.split('|')
      const tok = state.push(embed ? 'wikiembed' : 'wikilink', '', 0)
      tok.meta = { target: target.trim(), alias: alias?.trim() }
    }
    state.pos = end + 2
    return true
  })
  md.renderer.rules.wikilink = (tokens, idx) => {
    const { target, alias } = tokens[idx].meta as { target: string; alias?: string }
    return `<a class="wikilink" data-wikilink="${escapeHtml(target)}" href="#">${escapeHtml(alias || target)}</a>`
  }
  md.renderer.rules.wikiembed = (tokens, idx) => {
    const { target, alias } = tokens[idx].meta as { target: string; alias?: string }
    if (/\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i.test(target)) {
      const width = alias && /^\d+$/.test(alias) ? ` width="${alias}"` : ''
      return `<img data-wikiembed="${escapeHtml(target)}" alt="${escapeHtml(target)}"${width}>`
    }
    return `<a class="wikilink embed" data-wikilink="${escapeHtml(target)}" href="#">${escapeHtml(alias || target)}</a>`
  }
}

/** - [ ] 任务列表 */
function taskLists(md: MarkdownIt) {
  md.core.ruler.after('inline', 'tasklist', (state) => {
    const toks = state.tokens
    for (let i = 2; i < toks.length; i++) {
      const t = toks[i]
      if (t.type !== 'inline' || toks[i - 1].type !== 'paragraph_open' || toks[i - 2].type !== 'list_item_open') continue
      const m = t.content.match(/^\[([ xX])\]\s/)
      if (!m || !t.children?.length) continue
      const first = t.children[0]
      first.content = first.content.replace(/^\[([ xX])\]\s/, '')
      const cb = new state.Token('html_inline', '', 0)
      cb.content = `<input type="checkbox" class="task" data-line="${t.map?.[0] ?? ''}"${m[1] !== ' ' ? ' checked' : ''}> `
      t.children.unshift(cb)
      toks[i - 2].attrJoin('class', 'task-item')
    }
  })
}

/** 给块级元素加 data-line，用于分屏滚动同步 */
function sourceLines(md: MarkdownIt) {
  md.core.ruler.push('source_lines', (state) => {
    for (const t of state.tokens) if (t.map && t.nesting === 1) t.attrSet('data-line', String(t.map[0]))
  })
}

/** 标题加 id，方便 [[note#heading]] 跳转 */
function headingIds(md: MarkdownIt) {
  md.core.ruler.push('heading_ids', (state) => {
    const toks = state.tokens
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type === 'heading_open') toks[i].attrSet('id', slug(toks[i + 1]?.content ?? ''))
    }
  })
}
/** ==高亮== -> <mark> */
function highlightMark(md: MarkdownIt) {
  md.inline.ruler.before('emphasis', 'mark', (state: StateInline, silent: boolean) => {
    const start = state.pos
    if (state.src.slice(start, start + 2) !== '==') return false
    const end = state.src.indexOf('==', start + 2)
    if (end < 0 || end > state.posMax - 2 || end === start + 2) return false
    if (!silent) {
      const max = state.posMax
      state.push('mark_open', 'mark', 1)
      state.pos = start + 2
      state.posMax = end
      state.md.inline.tokenize(state)
      state.posMax = max
      state.push('mark_close', 'mark', -1)
    }
    state.pos = end + 2
    return true
  })
}

export const slug = (s: string) => s.trim().toLowerCase().replace(/[\s]+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '')

const md: MarkdownIt = new MarkdownItCtor({
  html: true,
  linkify: true,
  breaks: true,
  typographer: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try { return `<pre class="hljs"><code class="language-${lang}">${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>` } catch {}
    }
    return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`
  },
})
md.use(wikilinks).use(highlightMark).use(taskLists).use(sourceLines).use(headingIds)

/** 去掉 YAML frontmatter，渲染成 <pre class="frontmatter"> */
function splitFrontmatter(src: string) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { fm: '', body: src, offset: 0 }
  return { fm: m[1], body: src.slice(m[0].length), offset: m[0].split('\n').length - 1 }
}

export function renderMarkdown(src: string) {
  const { fm, body, offset } = splitFrontmatter(src)
  const env = {}
  const tokens = md.parse(body, env)
  if (offset) for (const t of tokens) if (t.map) { t.map[0] += offset; t.map[1] += offset; if (t.attrGet('data-line') != null) t.attrSet('data-line', String(t.map[0])) }
  let html = md.renderer.render(tokens, md.options, env)
  if (fm) html = `<pre class="frontmatter">${escapeHtml(fm)}</pre>` + html
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-wikilink', 'data-wikiembed', 'data-line', 'target'], ADD_URI_SAFE_ATTR: ['src'], ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|dnote|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i })
}

/** 统计字数：中日韩字符按字计，其余按词计 */
export function wordCount(text: string) {
  const cjk = (text.match(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g) ?? []).length
  const words = (text.replace(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g, ' ').match(/[\p{L}\p{N}_'-]+/gu) ?? []).length
  return cjk + words
}
