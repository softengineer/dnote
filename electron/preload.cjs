const { contextBridge, ipcRenderer } = require('electron')

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args)
  if (!r.ok) throw new Error(r.error)
  return r.data
}

contextBridge.exposeInMainWorld('api', {
  init: () => call('app:init'),
  saveSettings: (s) => call('settings:save', s),
  getSession: (vault) => call('session:get', vault),
  saveSession: (vault, s) => call('session:save', vault, s),
  listFonts: () => call('fonts:list'),
  popupMenu: (items) => call('menu:popup', items),
  openExternal: (url) => call('shell:openExternal', url),
  reveal: (rel) => call('shell:reveal', rel),
  openPath: (rel) => call('shell:openPath', rel),

  pickVault: () => call('vault:pick'),
  openVault: (p) => call('vault:open', p),
  closeVault: () => call('vault:close'),
  forgetVault: (p) => call('vault:forget', p),
  newWindow: (p) => call('vault:newWindow', p),
  cloneVault: (url, parent) => call('vault:clone', url, parent),

  tree: () => call('fs:tree'),
  read: (rel) => call('fs:read', rel),
  exists: (rel) => call('fs:exists', rel),
  write: (rel, content) => call('fs:write', rel, content),
  writeBinary: (rel, bytes) => call('fs:writeBinary', rel, bytes),
  create: (rel, content) => call('fs:create', rel, content),
  mkdir: (rel) => call('fs:mkdir', rel),
  rename: (from, to) => call('fs:rename', from, to),
  trash: (rel) => call('fs:trash', rel),
  search: (q, opts) => call('search:run', q, opts),

  git: {
    status: () => call('git:status'),
    init: () => call('git:init'),
    setRemote: (url) => call('git:setRemote', url),
    commit: (msg) => call('git:commit', msg),
    pull: () => call('git:pull'),
    push: () => call('git:push'),
    sync: (msg) => call('git:sync', msg),
    log: (file) => call('git:log', file),
    show: (hash, file) => call('git:show', hash, file),
    abortRebase: () => call('git:abortRebase'),
  },

  onVaultChanged: (cb) => {
    const h = (_e, paths) => cb(paths)
    ipcRenderer.on('vault:changed', h)
    return () => ipcRenderer.removeListener('vault:changed', h)
  },
})
