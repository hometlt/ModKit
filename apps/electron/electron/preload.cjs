/**
 * Preload — the only bridge between renderer and main.
 *
 * It exposes a single function over `contextBridge`, never `ipcRenderer` itself: handing the
 * renderer the raw IPC object would let it reach any channel the main process ever registers, which
 * is exactly the escape the allowlist exists to prevent.
 *
 * The channel check here is a fast local reject, not the security boundary — main validates every
 * request again with `assertElectronBrokerRequest`, because a compromised renderer could call
 * `ipcRenderer` through some other route.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron')

const CHANNELS = Object.freeze([
  'filesystem.read-range',
  'filesystem.atomic-replace',
  'dialog.open-file',
  'dialog.open-directory',
  'dialog.accept-drop',
  'directory.list',
  'filesystem.read-file',
  'process.launch',
])

contextBridge.exposeInMainWorld('modkitBroker', {
  channels: CHANNELS,
  request(channel, payload) {
    if (!CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`channel is not allowlisted: ${String(channel)}`))
    }
    return ipcRenderer.invoke('modkit.broker', { channel, payload })
  },
})

/*
 * Separate from the broker on purpose. This is read-only bootstrap data the main process composed;
 * folding it into the broker allowlist would blur "facility operation" and "host metadata", and the
 * allowlist is easier to review when every entry is an effect.
 */
/*
 * `File.path` was removed in Electron 32; `webUtils.getPathForFile` replaces it and must be called
 * from the preload, because the renderer never gets the `webUtils` module itself. This only reads a
 * path the user already dropped — it grants nothing on its own.
 */
contextBridge.exposeInMainWorld('modkitFiles', {
  pathFor: file => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
})

contextBridge.exposeInMainWorld('modkitHost', {
  profile: () => ipcRenderer.invoke('modkit.profile'),
  /** A file handed to us on the command line, e.g. by a double-click in Explorer. */
  initialFile: () => ipcRenderer.invoke('modkit.initial-file'),
  /** User-initiated only; writes per-user registry keys in the main process. */
  registerFileTypes: extensions => ipcRenderer.invoke('modkit.register-file-types', extensions),
})
