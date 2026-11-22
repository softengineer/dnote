import { useState } from 'react'
import { ChevronRight, FileText, Folder, FolderOpen, Image as ImageIcon, File, FilePlus, FolderPlus, ChevronsDownUp } from 'lucide-react'
import type { TreeNode } from '../types'
import { isImage, isMarkdown } from '../lib/paths'
import { t } from '../lib/i18n'

interface Props {
  tree: TreeNode[]
  activePath: string | null
  onOpen: (path: string, newTab: boolean) => void
  onContext: (node: TreeNode | null) => void
  onMove: (from: string, toDir: string) => void
  onNewNote: (dir: string) => void
  onNewFolder: (dir: string) => void
  expanded: Set<string>
  setExpanded: (s: Set<string>) => void
}

export default function FileTree(p: Props) {
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const toggle = (path: string) => {
    const s = new Set(p.expanded)
    if (s.has(path)) s.delete(path)
    else s.add(path)
    p.setExpanded(s)
  }

  const dropProps = (dir: string) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('text/dnote-path')) { e.preventDefault(); e.stopPropagation(); setDropTarget(dir) } },
    onDragLeave: () => setDropTarget((d) => (d === dir ? null : d)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation(); setDropTarget(null)
      const from = e.dataTransfer.getData('text/dnote-path')
      if (from) p.onMove(from, dir)
    },
  })

  const render = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      const pad = { paddingLeft: 8 + depth * 14 }
      if (n.type === 'dir') {
        const open = p.expanded.has(n.path)
        return (
          <div key={n.path}>
            <div
              className={`tree-item dir ${dropTarget === n.path ? 'drop' : ''}`}
              style={pad}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/dnote-path', n.path)}
              onClick={() => toggle(n.path)}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); p.onContext(n) }}
              {...dropProps(n.path)}
            >
              <ChevronRight size={14} className={`chev ${open ? 'open' : ''}`} />
              {open ? <FolderOpen size={15} /> : <Folder size={15} />}
              <span className="name">{n.name}</span>
            </div>
            {open && n.children && render(n.children, depth + 1)}
          </div>
        )
      }
      const Icon = isMarkdown(n.path) ? FileText : isImage(n.path) ? ImageIcon : File
      return (
        <div
          key={n.path}
          className={`tree-item file ${p.activePath === n.path ? 'active' : ''}`}
          style={pad}
          title={n.path}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/dnote-path', n.path)}
          onClick={(e) => p.onOpen(n.path, e.ctrlKey || e.metaKey)}
          onAuxClick={(e) => e.button === 1 && p.onOpen(n.path, true)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); p.onContext(n) }}
        >
          <span className="chev-space" />
          <Icon size={15} />
          <span className="name">{isMarkdown(n.name) ? n.name.replace(/\.(md|markdown)$/i, '') : n.name}</span>
        </div>
      )
    })

  return (
    <div className="panel">
      <div className="panel-header">
        <span>{t('files')}</span>
        <div className="panel-actions">
          <button className="icon-btn" title={t('newNote')} onClick={() => p.onNewNote('')}><FilePlus size={15} /></button>
          <button className="icon-btn" title={t('newFolder')} onClick={() => p.onNewFolder('')}><FolderPlus size={15} /></button>
          <button className="icon-btn" title={t('collapseAll')} onClick={() => p.setExpanded(new Set())}><ChevronsDownUp size={15} /></button>
        </div>
      </div>
      <div
        className={`tree ${dropTarget === '' ? 'drop' : ''}`}
        onContextMenu={(e) => { e.preventDefault(); p.onContext(null) }}
        {...dropProps('')}
      >
        {render(p.tree, 0)}
        {!p.tree.length && <div className="empty">{t('emptyTree')}</div>}
      </div>
    </div>
  )
}
