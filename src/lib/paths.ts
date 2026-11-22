export const basename = (p: string) => p.split('/').pop() ?? p
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const stem = (p: string) => basename(p).replace(/\.[^.]+$/, '')
export const ext = (p: string) => (basename(p).match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase()
export const isMarkdown = (p: string) => /\.(md|markdown)$/i.test(p)
export const isImage = (p: string) => /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i.test(p)
export const join = (...parts: string[]) => normalize(parts.filter(Boolean).join('/'))

export function normalize(p: string) {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** from 目录到 to 文件的相对路径 */
export function relative(fromDir: string, to: string) {
  const a = fromDir ? fromDir.split('/') : []
  const b = to.split('/')
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/')
}

/** vault 绝对路径 + 相对路径 -> dnote:// URL */
export function fileUrl(vaultRoot: string, rel: string) {
  const abs = (vaultRoot.replace(/\\/g, '/').replace(/\/$/, '') + '/' + rel).replace(/^([A-Za-z]):/, '/$1:')
  return 'dnote://f' + abs.split('/').map(encodeURIComponent).join('/')
}

/** 非法文件名字符 */
export const sanitizeName = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, '-').trim()
