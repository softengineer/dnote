import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Settings } from '../types'
import { DEFAULT_SETTINGS, THEMES } from '../lib/settings'
import { LANGUAGES, t, type I18nKey } from '../lib/i18n'

interface Props {
  settings: Settings
  onChange: (s: Settings) => void
  onClose: () => void
}

const SECTIONS = ['appearance', 'fonts', 'editor', 'journal', 'git', 'keys'] as const
const secName = (x: (typeof SECTIONS)[number]) => t(`sec_${x}` as I18nKey)

let fontCache: string[] | null = null

function FontPicker({ value, onChange, fonts, placeholder, mono }: { value: string; onChange: (v: string) => void; fonts: string[]; placeholder: string; mono?: boolean }) {
  const id = 'fonts-' + placeholder
  return (
    <div className="font-picker">
      <input className="input" list={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>{fonts.map((f) => <option key={f} value={f} />)}</datalist>
      <div className="font-sample" style={{ fontFamily: value ? `"${value}", ${mono ? 'monospace' : 'sans-serif'}` : undefined }}>
        {mono ? t('monoSample') : t('fontSample')}
      </div>
    </div>
  )
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label"><div>{label}</div>{desc && <div className="desc">{desc}</div>}</div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function Num({ value, onChange, min, max, step = 1, suffix }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <div className="num">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input className="input small" type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  )
}

export default function SettingsModal({ settings: s, onChange, onClose }: Props) {
  const [tab, setTab] = useState<(typeof SECTIONS)[number]>('appearance')
  const [fonts, setFonts] = useState<string[]>(fontCache ?? [])
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v })

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.dialog')) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    if (!fontCache) window.api.listFonts().then((f) => { fontCache = f; setFonts(f) }).catch(() => {})
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings">
        <nav className="settings-nav">
          <div className="settings-title">{t('settings')}</div>
          {SECTIONS.map((x) => <div key={x} className={`settings-nav-item ${tab === x ? 'active' : ''}`} onClick={() => setTab(x)}>{secName(x)}</div>)}
        </nav>
        <div className="settings-body">
          <button className="icon-btn close" onClick={onClose}><X size={18} /></button>
          <h2>{secName(tab)}</h2>

          {tab === 'appearance' && <>
            <Row label={t('language')}>
              <select className="input" value={s.language} onChange={(e) => set('language', e.target.value as Settings['language'])}>
                {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Row>
            <Row label={t('theme')}>
              <div className="theme-grid">
                {THEMES.map((th) => (
                  <div key={th.id} className={`theme-card ${s.theme === th.id ? 'active' : ''}`} data-preview={th.id} onClick={() => set('theme', th.id)}>
                    <div className="swatch" /><span>{t(`theme_${th.id}` as I18nKey)}</span>
                  </div>
                ))}
              </div>
            </Row>
            <Row label={t('uiFontSize')}><Num value={s.uiFontSize} min={11} max={18} onChange={(v) => set('uiFontSize', v)} suffix="px" /></Row>
            <Row label={t('customCss')} desc={t('customCssDesc')}>
              <textarea className="input code" rows={8} value={s.customCss} spellCheck={false} onChange={(e) => set('customCss', e.target.value)} />
            </Row>
          </>}

          {tab === 'fonts' && <>
            <Row label={t('uiFont')} desc={t('uiFontDesc')}><FontPicker fonts={fonts} value={s.uiFont} onChange={(v) => set('uiFont', v)} placeholder={t('uiFontPh')} /></Row>
            <Row label={t('textFont')} desc={t('textFontDesc')}><FontPicker fonts={fonts} value={s.textFont} onChange={(v) => set('textFont', v)} placeholder={t('textFontPh')} /></Row>
            <Row label={t('monoFont')} desc={t('monoFontDesc')}><FontPicker fonts={fonts} value={s.monoFont} onChange={(v) => set('monoFont', v)} placeholder={t('monoFontPh')} mono /></Row>
            <Row label={t('fontSize')} desc={t('fontSizeDesc')}><Num value={s.fontSize} min={10} max={32} onChange={(v) => set('fontSize', v)} suffix="px" /></Row>
            <Row label={t('lineHeight')}><Num value={s.lineHeight} min={1.1} max={2.6} step={0.05} onChange={(v) => set('lineHeight', v)} /></Row>
            <Row label={t('readableWidth')} desc={t('readableWidthDesc')}><Num value={s.readableWidth} min={0} max={1600} step={20} onChange={(v) => set('readableWidth', v)} suffix="px" /></Row>
          </>}

          {tab === 'editor' && <>
            <Row label={t('defaultMode')}>
              <select className="input" value={s.defaultMode} onChange={(e) => set('defaultMode', e.target.value as Settings['defaultMode'])}>
                <option value="edit">{t('modeEdit')}</option><option value="split">{t('modeSplit')}</option><option value="preview">{t('modePreview')}</option>
              </select>
            </Row>
            <Row label={t('autosave')} desc={t('autosaveDesc')}><input type="checkbox" checked={s.autosave} onChange={(e) => set('autosave', e.target.checked)} /></Row>
            <Row label={t('showToolbar')}><input type="checkbox" checked={s.showToolbar} onChange={(e) => set('showToolbar', e.target.checked)} /></Row>
            <Row label={t('lineNumbers')}><input type="checkbox" checked={s.showLineNumbers} onChange={(e) => set('showLineNumbers', e.target.checked)} /></Row>
            <Row label={t('newNoteFolder')} desc={t('newNoteFolderDesc')}><input className="input" value={s.newNoteFolder} onChange={(e) => set('newNoteFolder', e.target.value)} /></Row>
            <Row label={t('attachmentFolder')} desc={t('attachmentFolderDesc')}><input className="input" value={s.attachmentFolder} onChange={(e) => set('attachmentFolder', e.target.value)} /></Row>
          </>}

          {tab === 'journal' && <>
            <Row label={t('dailyFolder')}><input className="input" value={s.dailyFolder} onChange={(e) => set('dailyFolder', e.target.value)} /></Row>
            <Row label={t('dailyFormat')} desc={t('dailyFormatDesc')}><input className="input" value={s.dailyFormat} onChange={(e) => set('dailyFormat', e.target.value)} /></Row>
            <Row label={t('dailyTemplate')} desc={t('dailyTemplateDesc')}>
              <textarea className="input code" rows={6} value={s.dailyTemplate} onChange={(e) => set('dailyTemplate', e.target.value)} />
            </Row>
          </>}

          {tab === 'git' && <>
            <Row label={t('autoSync')} desc={t('autoSyncDesc')}><Num value={s.gitAutoSyncMinutes} min={0} max={120} onChange={(v) => set('gitAutoSyncMinutes', v)} suffix={t('minutes')} /></Row>
            <Row label={t('pullOnOpen')}><input type="checkbox" checked={s.gitPullOnOpen} onChange={(e) => set('gitPullOnOpen', e.target.checked)} /></Row>
            <Row label={t('commitMessage')} desc={t('commitMessageDesc')}><input className="input" value={s.gitCommitMessage} onChange={(e) => set('gitCommitMessage', e.target.value)} /></Row>
            <p className="hint">{t('gitAuthHint')}</p>
          </>}

          {tab === 'keys' && (
            <table className="keys">
              <tbody>
                {[
                  ['Ctrl+O / Ctrl+P', t('key_quickOpen')], ['Ctrl+N', t('key_newNote')], ['Ctrl+Shift+D', t('key_today')],
                  ['Ctrl+Shift+F', t('key_search')], ['Ctrl+F', t('key_find')], ['Ctrl+S', t('key_save')],
                  ['Ctrl+E', t('key_toggleMode')], ['Ctrl+W', t('key_closeTab')], ['Ctrl+Tab / Ctrl+Shift+Tab', t('key_switchTab')],
                  ['Ctrl+Shift+T', t('key_reopenTab')], ['Ctrl+\\', t('key_sidebar')], ['Ctrl+Shift+G', t('key_gitSync')],
                  ['Ctrl+= / Ctrl+- / Ctrl+0', t('key_zoom')], ['Ctrl+B / I / K', t('key_format')], ['Ctrl+,', t('key_settings')],
                ].map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}
              </tbody>
            </table>
          )}

          <div className="settings-footer">
            <button className="btn" onClick={() => onChange({ ...DEFAULT_SETTINGS, language: s.language })}>{t('resetSettings')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
