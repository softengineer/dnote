import { useEffect, useRef } from 'react'
import { EditorState, Compartment, EditorSelection } from '@codemirror/state'
import { EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers, dropCursor, placeholder, rectangularSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'
import { t as tr } from '../lib/i18n'

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.6em', fontWeight: '700', color: 'var(--md-heading)' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '700', color: 'var(--md-heading)' },
  { tag: t.heading3, fontSize: '1.2em', fontWeight: '600', color: 'var(--md-heading)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600', color: 'var(--md-heading)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', color: 'var(--md-code)' },
  { tag: t.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--text-faint)' },
  { tag: t.list, color: 'var(--accent)' },
  { tag: t.keyword, color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-number)' },
  { tag: t.comment, color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-func)' },
  { tag: [t.typeName, t.className], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-prop)' },
])

const baseTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'transparent', fontSize: 'var(--text-size)' },
  '.cm-scroller': { fontFamily: 'var(--font-text)', lineHeight: 'var(--line-height)', overflow: 'auto' },
  '.cm-content': { maxWidth: 'var(--readable-width)', margin: '0 auto', padding: '24px 32px 40vh', caretColor: 'var(--accent)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' },
  '.cm-panels': { backgroundColor: 'var(--bg-secondary)', color: 'var(--text)', borderColor: 'var(--border)' },
  '.cm-searchMatch': { backgroundColor: 'var(--search-hit)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--on-accent)' },
})

export interface EditorProps {
  content: string
  version: number // 外部（磁盘）变更时递增，触发替换文档
  showLineNumbers: boolean
  jump?: { line: number; nonce: number }
  getNoteNames: () => string[]
  onChange: (text: string) => void
  onPasteFiles: (files: File[]) => Promise<string | null>
  onScrollLine?: (line: number) => void
  onReady?: (view: EditorView) => void
}

export default function Editor(props: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const gutter = useRef(new Compartment())

  useEffect(() => {
    const wikiComplete = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^\]\n]*/)
      if (!m) return null
      return {
        from: m.from + 2,
        options: propsRef.current.getNoteNames().map((n) => ({ label: n, apply: n + ']]', type: 'text' })),
        validFor: /^[^\]\n]*$/,
      }
    }
    const pasteHandler = EditorView.domEventHandlers({
      paste(ev, view) {
        const files = [...(ev.clipboardData?.files ?? [])]
        if (!files.length) return false
        ev.preventDefault()
        propsRef.current.onPasteFiles(files).then((ins) => ins && view.dispatch(view.state.replaceSelection(ins)))
        return true
      },
      drop(ev, view) {
        const files = [...(ev.dataTransfer?.files ?? [])]
        if (!files.length) return false
        ev.preventDefault()
        const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY }) ?? view.state.selection.main.head
        propsRef.current.onPasteFiles(files).then((ins) => ins && view.dispatch({ changes: { from: pos, insert: ins } }))
        return true
      },
      scroll(_ev, view) {
        const cb = propsRef.current.onScrollLine
        if (!cb) return
        const top = view.lineBlockAtHeight(view.scrollDOM.scrollTop)
        cb(view.state.doc.lineAt(top.from).number - 1)
      },
    })

    const state = EditorState.create({
      doc: props.content,
      extensions: [
        gutter.current.of(props.showLineNumbers ? lineNumbers() : []),
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        autocompletion({ override: [wikiComplete], icons: false }),
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
        syntaxHighlighting(mdHighlight),
        EditorView.lineWrapping,
        placeholder(tr('editorPlaceholder')),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab, ...formatKeymap]),
        baseTheme,
        pasteHandler,
        EditorView.updateListener.of((u) => { if (u.docChanged) propsRef.current.onChange(u.state.doc.toString()) }),
      ],
    })
    const view = new EditorView({ state, parent: host.current! })
    viewRef.current = view
    props.onReady?.(view)
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 磁盘内容变化
  useEffect(() => {
    const view = viewRef.current
    if (!view || props.version === 0) return
    const cur = view.state.doc.toString()
    if (cur !== props.content) view.dispatch({ changes: { from: 0, to: cur.length, insert: props.content } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.version])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: gutter.current.reconfigure(props.showLineNumbers ? lineNumbers() : []) })
  }, [props.showLineNumbers])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !props.jump) return
    const line = view.state.doc.line(Math.min(Math.max(1, props.jump.line), view.state.doc.lines))
    view.dispatch({ selection: EditorSelection.cursor(line.from), effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    view.focus()
  }, [props.jump])

  return <div className="editor" ref={host} />
}

// ---- 格式化快捷键：Ctrl+B 加粗 / Ctrl+I 斜体 / Ctrl+K 链接 / Ctrl+Shift+X 删除线
export function wrap(mark: string, after = mark) {
  return (view: EditorView) => {
    view.dispatch(view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to)
      if (text.startsWith(mark) && text.endsWith(after) && text.length >= mark.length + after.length) {
        const inner = text.slice(mark.length, text.length - after.length)
        return { changes: { from: range.from, to: range.to, insert: inner }, range: EditorSelection.range(range.from, range.from + inner.length) }
      }
      return {
        changes: [{ from: range.from, insert: mark }, { from: range.to, insert: after }],
        range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
      }
    }))
    return true
  }
}
const formatKeymap = [
  { key: 'Mod-b', run: wrap('**') },
  { key: 'Mod-i', run: wrap('*') },
  { key: 'Mod-Shift-x', run: wrap('~~') },
  { key: 'Mod-`', run: wrap('`') },
  { key: 'Mod-k', run: wrap('[', '](url)') },
]
