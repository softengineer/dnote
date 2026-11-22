import { useEffect, useReducer } from 'react'
import { EditorSelection, StateEffect, type ChangeSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { undo, redo } from '@codemirror/commands'
import {
  Bold, Italic, Strikethrough, Code, Highlighter, List, ListOrdered, ListChecks, Quote,
  Link, Image, SquareCode, Table, Minus, Undo2, Redo2, IndentIncrease, IndentDecrease,
} from 'lucide-react'
import { t } from '../lib/i18n'
import { wrap } from './Editor'

const HEADING = /^(\s*)(#{1,6})\s+/
const LIST = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/

/** 选区覆盖到的所有行（去重） */
function selectedLines(view: EditorView) {
  const { doc } = view.state
  const seen = new Set<number>()
  const lines = []
  for (const r of view.state.selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) {
      if (!seen.has(n)) { seen.add(n); lines.push(doc.line(n)) }
    }
  }
  return lines
}

function headingLevel(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  return line.text.match(HEADING)?.[2].length ?? 0
}

function setHeading(view: EditorView, level: number) {
  const changes: ChangeSpec[] = selectedLines(view).map((line) => {
    const m = line.text.match(HEADING)
    const end = m ? m[0].length : line.text.match(/^\s*/)![0].length
    return { from: line.from, to: line.from + end, insert: level ? '#'.repeat(level) + ' ' : '' }
  })
  view.dispatch({ changes })
  view.focus()
}

type ListKind = 'bullet' | 'ordered' | 'task' | 'quote'
const IS: Record<ListKind, RegExp> = {
  bullet: /^(\s*)[-*+]\s+(?!\[[ xX]\])/,
  ordered: /^(\s*)\d+[.)]\s+/,
  task: /^(\s*)[-*+]\s+\[[ xX]\]\s+/,
  quote: /^(\s*)>\s?/,
}

/** 列表 / 引用：全部已是该格式则取消，否则统一改成该格式 */
function toggleList(view: EditorView, kind: ListKind) {
  const lines = selectedLines(view)
  const content = lines.filter((l) => l.text.trim() || lines.length === 1)
  const remove = content.length > 0 && content.every((l) => IS[kind].test(l.text))
  let n = 1
  const changes: ChangeSpec[] = content.map((line) => {
    const m = line.text.match(LIST)
    const indent = line.text.match(/^\s*/)![0]
    const end = m ? m[0].length : indent.length
    const prefix = remove ? '' : kind === 'bullet' ? '- ' : kind === 'ordered' ? `${n++}. ` : kind === 'task' ? '- [ ] ' : '> '
    return { from: line.from, to: line.from + end, insert: indent + prefix }
  })
  view.dispatch({ changes })
  view.focus()
}

function indent(view: EditorView, dir: 1 | -1) {
  const changes: ChangeSpec[] = selectedLines(view).flatMap((line): ChangeSpec[] => {
    if (dir > 0) return [{ from: line.from, insert: '  ' }]
    const sp = line.text.match(/^( {1,2}|\t)/)
    return sp ? [{ from: line.from, to: line.from + sp[0].length }] : []
  })
  view.dispatch({ changes })
  view.focus()
}

/** 在选区处插入块级内容，必要时前后补空行 */
function insertBlock(view: EditorView, build: (sel: string) => string, cursorOffset?: (block: string) => number) {
  const { state } = view
  const r = state.selection.main
  const sel = state.sliceDoc(r.from, r.to)
  const before = r.from > 0 ? state.sliceDoc(r.from - 1, r.from) : '\n'
  const after = r.to < state.doc.length ? state.sliceDoc(r.to, r.to + 1) : '\n'
  const body = build(sel)
  const pre = before === '\n' ? '' : '\n\n'
  const post = after === '\n' ? '' : '\n'
  const insert = pre + body + post
  const pos = r.from + pre.length + (cursorOffset ? cursorOffset(body) : body.length)
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.cursor(pos), scrollIntoView: true })
  view.focus()
}

function inline(view: EditorView, open: string, close = open) {
  wrap(open, close)(view)
  view.focus()
}

function link(view: EditorView, image = false) {
  const r = view.state.selection.main
  const text = view.state.sliceDoc(r.from, r.to)
  const isUrl = /^(https?:\/\/|www\.)\S+$/.test(text)
  const label = isUrl ? '' : text
  const url = isUrl ? text : 'url'
  const insert = `${image ? '!' : ''}[${label}](${url})`
  const start = r.from + (image ? 2 : 1)
  // 有文字：选中 url 方便替换；是网址或空：光标放在 [] 里填标题
  const selection = label
    ? EditorSelection.range(start + label.length + 2, start + label.length + 2 + url.length)
    : EditorSelection.cursor(start)
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection })
  view.focus()
}

interface Props { view: EditorView | null }

export default function FormatToolbar({ view }: Props) {
  const [, rerender] = useReducer((x: number) => x + 1, 0)

  // 光标移动时刷新标题下拉框的当前值
  useEffect(() => {
    if (!view) return
    let alive = true
    view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of((u) => { if (alive && (u.selectionSet || u.docChanged)) rerender() })) })
    rerender()
    return () => { alive = false }
  }, [view])

  const run = (fn: (v: EditorView) => void) => (e: React.MouseEvent) => { e.preventDefault(); if (view) fn(view) }
  const btn = (title: string, icon: React.ReactNode, fn: (v: EditorView) => void) => (
    <button className="icon-btn" title={title} disabled={!view} onMouseDown={(e) => e.preventDefault()} onClick={run(fn)}>{icon}</button>
  )
  const level = view ? headingLevel(view) : 0
  const S = 16

  return (
    <div className="format-toolbar">
      <select
        className="select heading-select"
        title={t('fmtHeading')}
        disabled={!view}
        value={level}
        onChange={(e) => view && setHeading(view, Number(e.target.value))}
      >
        <option value={0}>{t('fmtParagraph')}</option>
        {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{t('fmtHeadingN', { n })}</option>)}
      </select>
      <span className="sep" />
      {btn(t('fmtBold') + ' (Ctrl+B)', <Bold size={S} />, (v) => inline(v, '**'))}
      {btn(t('fmtItalic') + ' (Ctrl+I)', <Italic size={S} />, (v) => inline(v, '*'))}
      {btn(t('fmtStrike') + ' (Ctrl+Shift+X)', <Strikethrough size={S} />, (v) => inline(v, '~~'))}
      {btn(t('fmtHighlight'), <Highlighter size={S} />, (v) => inline(v, '=='))}
      {btn(t('fmtInlineCode') + ' (Ctrl+`)', <Code size={S} />, (v) => inline(v, '`'))}
      <span className="sep" />
      {btn(t('fmtBullet'), <List size={S} />, (v) => toggleList(v, 'bullet'))}
      {btn(t('fmtOrdered'), <ListOrdered size={S} />, (v) => toggleList(v, 'ordered'))}
      {btn(t('fmtTask'), <ListChecks size={S} />, (v) => toggleList(v, 'task'))}
      {btn(t('fmtQuote'), <Quote size={S} />, (v) => toggleList(v, 'quote'))}
      {btn(t('fmtOutdent'), <IndentDecrease size={S} />, (v) => indent(v, -1))}
      {btn(t('fmtIndent'), <IndentIncrease size={S} />, (v) => indent(v, 1))}
      <span className="sep" />
      {btn(t('fmtLink') + ' (Ctrl+K)', <Link size={S} />, (v) => link(v))}
      {btn(t('fmtImage'), <Image size={S} />, (v) => link(v, true))}
      {btn(t('fmtCodeBlock'), <SquareCode size={S} />, (v) => insertBlock(v, (s) => '```\n' + s + '\n```', () => 3))}
      {btn(t('fmtTable'), <Table size={S} />, (v) => insertBlock(v, () => `| ${t('fmtCol')} 1 | ${t('fmtCol')} 2 | ${t('fmtCol')} 3 |\n| --- | --- | --- |\n|  |  |  |`, () => 2))}
      {btn(t('fmtHr'), <Minus size={S} />, (v) => insertBlock(v, () => '---\n'))}
      <span className="sep" />
      {btn(t('fmtUndo') + ' (Ctrl+Z)', <Undo2 size={S} />, (v) => { undo(v); v.focus() })}
      {btn(t('fmtRedo') + ' (Ctrl+Shift+Z)', <Redo2 size={S} />, (v) => { redo(v); v.focus() })}
    </div>
  )
}
