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
  'dialog.reopen-recent',
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

/** Menu commands arrive as one-way signals; the renderer decides what each one does. */
contextBridge.exposeInMainWorld('modkitMenu', {
  on: (command, handler) => {
    const channel = `modkit.menu.${command}`
    // The event is dropped on purpose: it carries `sender`, which the renderer must never hold.
    ipcRenderer.on(channel, (_event, payload) => handler(payload))
  },
  /** Recent entries live in the settings file, so the renderer pushes them into the menu. */
  setRecent: recent => ipcRenderer.invoke('modkit.menu.rebuild', recent),
})

contextBridge.exposeInMainWorld('modkitSettings', {
  read: () => ipcRenderer.invoke('modkit.settings.read'),
  write: text => ipcRenderer.invoke('modkit.settings.write', text),
})

/*
 * Managing extensions and codecs.
 *
 * Separate from `modkitSettings`, which only moves the JSON document: these three ask main to act
 * on it — show a native folder dialog, recompose the running host, describe what is loaded now.
 * None of them names a filesystem path the renderer chose, and `browse` deliberately does not go
 * through the broker's `dialog.open-directory`: that channel *grants* the folder to the renderer's
 * file access, and connecting an extension must not widen what the renderer may read.
 */
contextBridge.exposeInMainWorld('modkitExtensions', {
  /** What the current composition loaded, refused, and which contributions it holds. */
  report: () => ipcRenderer.invoke('modkit.extensions.report'),
  /** Recompose from the settings file as it stands now; resolves with the new report. */
  reload: () => ipcRenderer.invoke('modkit.extensions.reload'),
  /** Native directory dialog plus a probe: the coordinate the folder declares, or why not. */
  browse: () => ipcRenderer.invoke('modkit.extensions.browse'),
})

/** Window chrome. Separate from the broker: this touches the window, never the user's files. */
contextBridge.exposeInMainWorld('modkitWindow', {
  send: command => ipcRenderer.invoke('modkit.window', command),
  onState: handler => {
    ipcRenderer.on('modkit.window.state', (_event, state) => handler(state))
  },
})

contextBridge.exposeInMainWorld('modkitHost', {
  profile: () => ipcRenderer.invoke('modkit.profile'),
  /** Native save/discard/cancel prompt, asked before closing a tab with unsaved changes. */
  confirmClose: name => ipcRenderer.invoke('modkit.confirm-close', name),
  /** A file handed to us on the command line, e.g. by a double-click in Explorer. */
  initialFile: () => ipcRenderer.invoke('modkit.initial-file'),
  /** User-initiated only; writes per-user registry keys in the main process. */
  registerFileTypes: extensions => ipcRenderer.invoke('modkit.register-file-types', extensions),
})

/*
 * The shared command surface (block 13, works 4–6).
 *
 * The original list/run/cancel/progress API stays intact. `catalog` and `execute` expose the same
 * versioned document/receipt automation and PWA consume, without asking the renderer to infer a
 * protocol from those legacy convenience methods. `runId` stays out-of-band cancellation state.
 */
contextBridge.exposeInMainWorld('modkitCommands', {
  list: () => ipcRenderer.invoke('modkit.command.list'),
  run: request => ipcRenderer.invoke('modkit.command.run', request),
  catalog: () => ipcRenderer.invoke('modkit.command.catalog'),
  execute: (request, options = {}) =>
    ipcRenderer.invoke('modkit.command.execute', { request, runId: options.runId }),
  cancel: runId => ipcRenderer.invoke('modkit.command.cancel', runId),
  onProgress: handler => {
    const listener = (_event, step) => handler(step)
    ipcRenderer.on('modkit.command.progress', listener)
    return () => ipcRenderer.removeListener('modkit.command.progress', listener)
  },
})

/*
 * R6: the subject bridge is capability-RPC over a dedicated MessagePort pair. Main creates the
 * channel and posts one end here; the preload forwards the DOM port into the main world with
 * `window.postMessage` (the documented Electron pattern for context-isolated pages). No method
 * names cross this file any more — the surface authority lives with the contract definitions.
 */
ipcRenderer.on('modkit.subject.port', (event, message) => {
  window.postMessage(
    { type: 'modkit-subject-port', session: message?.session ?? null },
    '*',
    event.ports,
  )
})
contextBridge.exposeInMainWorld('modkitSubjects', {
  /** Ask main to mint the RPC channel; the port itself arrives via the message event above. */
  requestPort: () => ipcRenderer.invoke('modkit.subject.port'),
})
