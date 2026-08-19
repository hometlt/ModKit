/**
 * Electron main process.
 *
 * The window is created from `ELECTRON_SECURE_WEB_PREFERENCES` and every broker IPC message is
 * checked with `assertElectronBrokerRequest` — both defined and unit tested in the composition
 * root. Subject sessions speak capability-RPC over a dedicated MessagePort pair (R6): the surface
 * authority is the contract definitions, so this file carries no method lists at all.
 *
 * CommonJS on purpose: Electron's main entry is loaded as CJS, and the package is `type: module`.
 */
const { app, BrowserWindow, Menu, MessageChannelMain, dialog, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { readSettings, writeSettings } = require('./settings-store.cjs')
const BUNDLED_EXTENSION_DIRECTORIES = require('../generated/bundled-catalog.cjs')
const PRESENTATION_CATALOG = require('../generated/presentation-catalog.cjs')

const RENDERER = path.join(__dirname, '..', 'dist-app', 'index.html')

/** The composition root is ESM; main is CJS, so it is loaded through a dynamic import. */
const root = import(pathToFileURL(path.join(__dirname, '..', 'dist', 'index.js')).href)

/*
 * R6: no method allowlists live here any more. The renderer speaks capability-RPC to a
 * per-window endpoint (see `exposeElectronSubjectRpc`); which methods exist on a session or a
 * data source is decided by the contract-owned method surfaces, the same authority every other
 * execution boundary uses.
 */
const MAXIMUM_SUBJECT_BYTES = 64 * 1024 * 1024

/* S7: the file adapter is the host's `openFileArtifactSource` (revision-checked reads). */

/**
 * Register this build for a set of file extensions.
 *
 * Per-user only: everything is written under `HKCU\Software\Classes`, never `HKLM`, so it needs no
 * elevation and cannot change the machine for other accounts. It is also reversible — the keys it
 * writes are the ones Windows' own "Open with → Choose another app" would create.
 *
 * Called only from the renderer's explicit "Set as default app" action. Nothing here runs at start.
 */
async function registerFileTypes(extensions) {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      message: `File association is not implemented for ${process.platform}.`,
    }
  }
  const { execFile } = require('node:child_process')
  const run = args =>
    new Promise((resolve, reject) => {
      execFile('reg', args, error => (error ? reject(error) : resolve(undefined)))
    })

  // In a packaged build this is the app executable; in a dev run it is electron.exe plus the
  // script, which is why the command line keeps both.
  const command = app.isPackaged
    ? `"${process.execPath}" "%1"`
    : `"${process.execPath}" "${path.join(__dirname, 'main.cjs')}" "%1"`

  const clean = extensions
    .map(value => String(value).replace(/^\./u, '').toLowerCase())
    .filter(value => /^[a-z0-9]{1,16}$/u.test(value))
  if (clean.length === 0)
    return { supported: true, registered: [], message: 'No valid extensions.' }

  const registered = []
  for (const extension of clean) {
    const progId = `Modkit.${extension}`
    try {
      await run(['add', `HKCU\\Software\\Classes\\.${extension}`, '/ve', '/d', progId, '/f'])
      await run([
        'add',
        `HKCU\\Software\\Classes\\${progId}`,
        '/ve',
        '/d',
        `Modkit ${extension.toUpperCase()} file`,
        '/f',
      ])
      await run([
        'add',
        `HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`,
        '/ve',
        '/d',
        command,
        '/f',
      ])
      registered.push(extension)
    } catch (error) {
      return {
        supported: true,
        registered,
        message: `Failed on .${extension}: ${error.message}`,
      }
    }
  }
  return {
    supported: true,
    registered,
    message:
      `Registered ${registered.length} type(s) for this user: ${registered.join(', ')}. ` +
      'Windows may still ask you to confirm the default the first time you open one.',
  }
}

async function createWindow() {
  const {
    ELECTRON_SECURE_WEB_PREFERENCES,
    ELECTRON_BROKER_CHANNELS,
    assertElectronBrokerRequest,
    isAllowedElectronNavigation,
    createElectronSubjectServices,
    resolveElectronPresentationPlan,
    createGrantedRoots,
    exposeElectronSubjectRpc,
    openFileArtifactSource,
  } = await root

  const repositoryRoot = path.resolve(__dirname, '..', '..', '..')
  /*
   * Extensions the user connected in Settings. They are read here, in main, because main owns the
   * settings file and the trust decision: a user's directory is an `installed` artifact and never
   * reaches the in-process boundary. A disabled entry is skipped; a broken one is reported by
   * `loadExtensionRoots` and the application still starts with everything else.
   */
  const userExtensionRoots = await (async () => {
    try {
      const settings = await readSettings(app)
      // a malformed settings file is reported by the store; say so, or the user's extensions
      // would simply be absent with no explanation anywhere
      if (settings.problem !== undefined) {
        console.log(`[main] settings could not be read: ${settings.problem}`)
      }
      const configured = Array.isArray(settings.raw?.extensions) ? settings.raw.extensions : []
      return configured
        .filter(entry => entry && typeof entry.path === 'string' && entry.enabled !== false)
        .map(entry => ({
          root: path.resolve(entry.path),
          ...(typeof entry.id === 'string' && entry.id.length > 0 ? { expectedId: entry.id } : {}),
        }))
    } catch (error) {
      console.log(`[main] settings unreadable, no user extensions loaded: ${String(error)}`)
      return []
    }
  })()
  const subjectServices = await createElectronSubjectServices(
    BUNDLED_EXTENSION_DIRECTORIES.map(directory =>
      path.join(repositoryRoot, 'extensions', 'common', directory),
    ),
    {
      // worker realm diagnostics: the SB-1 shared-process notice, restarts, crashes, capped stdio
      onDiagnostic: diagnostic =>
        console.log(`[worker] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`),
      userRoots: userExtensionRoots,
    },
  )
  for (const failure of subjectServices.extensions.failures) {
    console.log(
      `[main] extension not loaded: ${failure.root} — ${failure.code}: ${failure.message}`,
    )
  }
  if (subjectServices.extensions.installed.length > 0) {
    console.log(`[main] user extensions: ${subjectServices.extensions.installed.join(', ')}`)
  }
  const composed = subjectServices.application
  console.log(
    `[main] composed ${composed.topology.topologyId}: ` +
      `main ${composed.main.profile.facilities.length} facilities, ` +
      `renderer ${composed.renderer.profile.facilities.length} facilities, ` +
      `codecs run in ${composed.workers.profile.realmId} (${subjectServices.executionProfiles.join('/')})`,
  )

  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    backgroundColor: '#1f1f1f',
    /*
     * The app draws its own title bar so a theme can style it. `titleBarStyle: 'hidden'` keeps the
     * native window controls on macOS, where hiding them breaks platform convention; Windows and
     * Linux get none and the renderer supplies its own.
     */
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? {} : { frame: false }),
    // Windows and Linux read this for the window and taskbar; macOS uses the bundle icon instead.
    icon: path.join(
      __dirname,
      '..',
      'media',
      process.platform === 'win32' ? 'modkit.ico' : 'icon-512.png',
    ),
    webPreferences: {
      ...ELECTRON_SECURE_WEB_PREFERENCES,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // Navigation is denied by default; anything the user clicks goes to the real browser instead.
  const origin = pathToFileURL(RENDERER).href
  window.webContents.on('will-navigate', (event, target) => {
    if (!isAllowedElectronNavigation(target, origin)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  /*
   * Bootstrap data, not a broker call. The renderer must not compose the topology itself: the
   * composition root imports `@modkitx-x3/host/node`, so a renderer that could run it would need
   * Node access — exactly what `nodeIntegration: false` denies. Main composes, and the renderer
   * receives the snapshot its own realm is allowed to see.
   */
  ipcMain.handle('modkit.profile', () => ({
    topologyId: composed.topology.topologyId,
    renderer: {
      realmId: composed.renderer.profile.realmId,
      facilities: [...composed.renderer.profile.facilities],
      environment: composed.renderer.profile.target.environment,
    },
    mainFacilityCount: composed.main.profile.facilities.length,
    extensions: composed.renderer.inventory.extensions.length,
    diagnostics: composed.renderer.inventory.diagnostics.length,
    supportedExtensions: subjectServices.supportedExtensions,
    // OPUS-UX-01 vocabulary: which boundary codecs get — worker threads of main (SB-1), never the renderer
    execution: {
      codecRealm: composed.workers.profile.realmId,
      environment: composed.workers.profile.target.environment,
      profiles: [...subjectServices.executionProfiles],
    },
  }))

  /*
   * Every filesystem read is confined to a directory the user picked in a native dialog. Without
   * this, letting the renderer name paths would be an arbitrary-file-read primitive.
   */
  const roots = createGrantedRoots({
    resolve: value => path.resolve(value),
    separator: path.sep,
    caseSensitive: process.platform !== 'win32',
  })

  /** Grant a path and remember it as the file the window should open on start. */
  const grantAndDescribe = async target => {
    const stats = await fsp.stat(target)
    const directory = stats.isDirectory() ? target : path.dirname(target)
    roots.grant(directory)
    return {
      root: directory,
      entry: stats.isDirectory()
        ? undefined
        : { id: target, name: path.basename(target), directory: false, size: stats.size },
    }
  }

  /**
   * R6: open a subject the way the old IPC branch did, but return the session as an object for
   * the RPC endpoint to lease — no session table, no method dispatch, no allowlists here.
   */
  const openSubjectForRpc = async (requestedPath, signal) => {
    const file = roots.require(requestedPath)
    const source = await openFileArtifactSource(file)
    const result = await subjectServices.open({
      source,
      path: file,
      intent: 'full',
      grant: { id: `electron:${randomUUID()}`, classes: ['read-source'] },
      budget: {
        maxInputBytes: BigInt(MAXIMUM_SUBJECT_BYTES),
        maxDepth: 256,
        maxNodes: 1_000_000,
        maxScalarBytes: MAXIMUM_SUBJECT_BYTES,
        maxDiagnostics: 10_000,
        deadlineMs: 30_000,
      },
      ...(signal === undefined ? {} : { signal }),
    })
    if (result.state === 'unresolved') {
      console.log(
        `[main] subject ${path.basename(file)} unresolved (${result.reason}): ` +
          result.diagnostics.map(item => item.code).join(', ') +
          `; candidates=${result.candidates
            .map(
              item =>
                `${item.contributionId}/${item.variantId}:${item.state}:${item.confidence ?? '-'}:` +
                item.diagnostics
                  .map(
                    diagnostic =>
                      `${diagnostic.code}(${diagnostic.message};${JSON.stringify(diagnostic.data)})`,
                  )
                  .join('|'),
            )
            .join(',')}`,
      )
      return {
        snapshot: {
          state: result.state,
          reason: result.reason,
          candidates: result.candidates,
          diagnostics: result.diagnostics,
        },
      }
    }
    console.log(
      `[main] subject ${path.basename(file)} -> ${result.selected.contributionId}/` +
        `${result.selected.variantId} (${Math.round(result.selected.confidence * 100)}%)`,
    )
    const sessionId = randomUUID()
    let presentation
    try {
      presentation = await resolveElectronPresentationPlan(
        result.descriptor,
        PRESENTATION_CATALOG,
        {
          sessionId,
          contributionId: result.selected.contributionId,
          variantId: result.selected.variantId,
        },
      )
    } catch (error) {
      await result.session.dispose()
      throw error
    }
    return {
      snapshot: {
        state: result.state,
        sessionId,
        descriptor: result.descriptor,
        presentation,
        selected: result.selected,
        candidates: result.candidates,
        diagnostics: result.diagnostics,
      },
      session: result.session,
    }
  }

  /** One capability-RPC endpoint per handed-out port; closed with the window. */
  const subjectEndpoints = new Set()
  ipcMain.handle('modkit.subject.port', event => {
    const channel = new MessageChannelMain()
    const session = randomUUID()
    const exposure = exposeElectronSubjectRpc({
      port: channel.port1,
      listener: 'emitter-event',
      session,
      open: openSubjectForRpc,
      onDiagnostic: diagnostic =>
        console.log(`[subject-rpc] ${diagnostic.code}: ${diagnostic.message}`),
    })
    subjectEndpoints.add(exposure)
    event.sender.postMessage('modkit.subject.port', { session }, [channel.port2])
    return { session }
  })

  window.on('closed', () => {
    for (const exposure of subjectEndpoints) void exposure.close('window closed')
    subjectEndpoints.clear()
  })

  // One handler for the whole allowlist. A channel outside it is never registered, so the renderer
  // cannot reach it at all — the validator is the second line, not the first.
  ipcMain.handle('modkit.broker', async (_event, value) => {
    const request = assertElectronBrokerRequest(value)

    switch (request.channel) {
      case 'dialog.open-directory': {
        const picked = await dialog.showOpenDialog(window, {
          properties: ['openDirectory'],
          title: 'Open a folder in Modkit',
        })
        if (picked.canceled || picked.filePaths[0] === undefined) return { canceled: true }
        const root = roots.grant(picked.filePaths[0])
        return { canceled: false, root, label: path.basename(root) || root }
      }

      case 'dialog.open-file': {
        const picked = await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          title: 'Open a file in Modkit',
        })
        if (picked.canceled || picked.filePaths[0] === undefined) return { canceled: true }
        return { canceled: false, ...(await grantAndDescribe(picked.filePaths[0])) }
      }

      /*
       * A drop is consent. The user physically dragged these files onto the window, which is the
       * same standard the web platform applies to File System Access handles — so the drop grants
       * their containing directories, and nothing else.
       */
      case 'dialog.accept-drop': {
        const described = []
        for (const candidate of request.payload.paths) {
          try {
            described.push(await grantAndDescribe(candidate))
          } catch {
            // A path that no longer exists is skipped rather than failing the whole drop.
          }
        }
        if (described.length === 0) throw new Error('none of the dropped paths could be read')
        return { accepted: described }
      }

      /*
       * Reopening from the Recent menu.
       *
       * Grants are per-session and live in memory, so a path chosen after a restart has no grant —
       * which is why Open Recent could not list anything. Re-granting here is safe only because
       * main checks the request against the recent list in its own settings file: the renderer can
       * reopen what the user already opened through a dialog, and nothing else.
       */
      case 'dialog.reopen-recent': {
        const settings = await readSettings(app)
        const remembered = Array.isArray(settings.raw?.recent) ? settings.raw.recent : []
        const wanted = path.resolve(request.payload.path)
        const known = remembered.some(
          entry =>
            typeof entry?.path === 'string' &&
            path.resolve(entry.path).toLowerCase() === wanted.toLowerCase(),
        )
        if (!known) throw new Error('path is not in the recent list')

        const stats = await fsp.stat(wanted)
        const directory = stats.isDirectory() ? wanted : path.dirname(wanted)
        roots.grant(directory)
        return {
          root: directory,
          entry: stats.isDirectory()
            ? undefined
            : { id: wanted, name: path.basename(wanted), directory: false, size: stats.size },
        }
      }

      case 'directory.list': {
        const directory = roots.require(request.payload.path)
        const entries = await fsp.readdir(directory, { withFileTypes: true })
        const listed = await Promise.all(
          entries.map(async entry => {
            const full = path.join(directory, entry.name)
            const isDirectory = entry.isDirectory()
            let size
            if (!isDirectory) {
              // A broken symlink or a locked file must not fail the whole listing.
              try {
                size = (await fsp.stat(full)).size
              } catch {
                size = undefined
              }
            }
            return { id: full, name: entry.name, directory: isDirectory, size }
          }),
        )
        return { entries: listed }
      }

      case 'filesystem.read-file': {
        const file = roots.require(request.payload.path)
        const stats = await fsp.stat(file)
        if (stats.size > request.payload.maxBytes) {
          throw new Error(
            `file is ${stats.size} bytes, over the ${request.payload.maxBytes} byte limit`,
          )
        }
        const bytes = await fsp.readFile(file)
        // Sent as a plain Uint8Array so structured clone carries it without a Node Buffer view.
        return { bytes: new Uint8Array(bytes) }
      }

      /*
       * Written through a temporary file and a rename, so an interrupted save cannot leave a
       * half-written asset where a whole one used to be. Confined to the granted roots like every
       * other path the renderer names.
       */
      case 'filesystem.write-file': {
        const file = roots.require(request.payload.path)
        const temporary = `${file}.${process.pid}.tmp`
        const bytes = Buffer.from(
          request.payload.bytes.buffer,
          request.payload.bytes.byteOffset,
          request.payload.bytes.byteLength,
        )
        try {
          await fsp.writeFile(temporary, bytes)
          await fsp.rename(temporary, file)
        } finally {
          await fsp.rm(temporary, { force: true })
        }
        return { path: file, bytes: bytes.length }
      }

      default:
        return {
          channel: request.channel,
          accepted: true,
          note: 'Validated by the main process. No native effect is wired for this channel yet.',
        }
    }
  })

  /*
   * `--open <path>` grants a folder without a dialog. Only for verification runs: a dialog needs a
   * human, and the previewer must still be checkable end to end without one.
   */
  const openIndex = process.argv.indexOf('--open')
  if (openIndex !== -1 && process.argv[openIndex + 1] !== undefined) {
    const granted = roots.grant(process.argv[openIndex + 1])
    console.log(`[main] granted ${granted}`)
  }

  /*
   * A file passed on the command line — which is how a double-click reaches us once this app is
   * registered for a type. Windows and Linux deliver it in argv; macOS uses the `open-file` event.
   */
  ipcMain.handle('modkit.initial-file', async () => {
    if (openIndex !== -1 && process.argv[openIndex + 1] !== undefined) {
      const target = process.argv[openIndex + 1]
      return { present: true, root: target, selfTest: process.argv.includes('--selftest') }
    }
    const candidate = process.argv
      .slice(1)
      .find(value => !value.startsWith('-') && fs.existsSync(value) && fs.statSync(value).isFile())
    if (candidate === undefined) return { present: false }
    return { present: true, ...(await grantAndDescribe(candidate)) }
  })

  // Registering file associations writes to the user's registry, so it is never automatic: the
  // renderer asks only when the user activates the action.
  ipcMain.handle('modkit.register-file-types', async (_event, extensions) =>
    registerFileTypes(Array.isArray(extensions) ? extensions : []),
  )

  /*
   * Window controls. Exposed as their own channel rather than through the broker allowlist: the
   * allowlist is for facility effects on user data, and minimising a window is neither.
   */
  ipcMain.handle('modkit.window', (_event, command) => {
    switch (command) {
      case 'minimize':
        window.minimize()
        return { state: 'minimized' }
      case 'toggle-maximize':
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
        return { state: window.isMaximized() ? 'maximized' : 'normal' }
      case 'fullscreen':
        window.setFullScreen(!window.isFullScreen())
        return { state: window.isFullScreen() ? 'fullscreen' : 'normal' }
      case 'close':
        window.close()
        return { state: 'closing' }
      default:
        throw new TypeError(`unknown window command: ${String(command)}`)
    }
  })

  // The renderer mirrors the maximised state in its own chrome, so it has to hear about changes
  // the user makes by dragging or double-clicking the bar.
  for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    window.on(event, () => {
      window.webContents.send('modkit.window.state', {
        maximized: window.isMaximized(),
        fullscreen: window.isFullScreen(),
      })
    })
  }

  /*
   * Save-before-close prompt. A native message box rather than a page dialog: it is modal to the
   * window, survives a renderer that is busy, and matches what the user expects from a desktop app.
   */
  ipcMain.handle('modkit.confirm-close', async (_event, name) => {
    const answer = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `Save changes to ${String(name)}?`,
      detail: 'Your changes will be lost if you do not save them.',
    })
    return ['save', 'discard', 'cancel'][answer.response] ?? 'cancel'
  })

  // Settings live in a JSON file the renderer never touches directly — it has no filesystem access.
  ipcMain.handle('modkit.settings.read', () => readSettings(app))
  ipcMain.handle('modkit.settings.write', async (_event, text) => {
    if (typeof text !== 'string' || text.length > 1_000_000) {
      throw new TypeError('settings payload must be a bounded JSON string')
    }
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError('settings payload must contain a JSON object')
    }
    return { location: await writeSettings(app, text) }
  })

  /*
   * Native menu. The actions live here rather than as toolbar buttons because this is a desktop
   * app: File/Open Folder is where a user looks for it, and the accelerators come for free.
   * Each item only signals the renderer; the renderer owns what the UI then does.
   */
  const send = (channel, payload) => () => {
    window.webContents.send(channel, payload)
  }

  /**
   * Rebuild the menu from the renderer's recent list.
   *
   * An Electron menu is immutable once built, so "Open Recent" can only stay current by rebuilding
   * it. The renderer owns the list because it owns the settings file; main only renders it.
   */
  const buildMenu = (recent = []) => {
    const recentItems = recent.map(entry => ({
      label: `${entry.kind === 'file' ? 'File' : 'Folder'} — ${entry.path}`,
      click: send('modkit.menu.open-recent', entry),
    }))

    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'File',
          submenu: [
            {
              label: 'Open Folder…',
              accelerator: 'CmdOrCtrl+K',
              click: send('modkit.menu.open-folder'),
            },
            {
              label: 'Open File…',
              accelerator: 'CmdOrCtrl+O',
              click: send('modkit.menu.open-file'),
            },
            {
              label: 'Open Recent',
              submenu:
                recentItems.length > 0
                  ? [
                      ...recentItems,
                      { type: 'separator' },
                      { label: 'Clear Recent', click: send('modkit.menu.clear-recent') },
                    ]
                  : [{ label: 'Nothing yet', enabled: false }],
            },
            { type: 'separator' },
            { label: 'Set as Default App…', click: send('modkit.menu.default-app') },
            { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: send('modkit.menu.settings') },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        {
          label: 'View',
          submenu: [
            {
              label: 'Split Editor',
              accelerator: 'CmdOrCtrl+\\',
              click: send('modkit.menu.split'),
            },
            { type: 'separator' },
            { role: 'reload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { role: 'togglefullscreen' },
          ],
        },
      ]),
    )
  }

  buildMenu()
  ipcMain.handle('modkit.menu.rebuild', (_event, recent) => {
    buildMenu(Array.isArray(recent) ? recent : [])
  })

  // Renderer findings belong in the same log as the main process ones, otherwise verifying the
  // isolation checks would need a human looking at the window.
  window.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[renderer] ${message}`)
  })

  await window.loadFile(RENDERER)
  console.log(`[main] allowlisted broker channels: ${ELECTRON_BROKER_CHANNELS.join(', ')}`)

  /*
   * `--capture <file>`: render, save a PNG of the real window, and exit. This is how the shell can
   * be verified in an environment with no visible display — the image comes from Electron's own
   * compositor, not from a screenshot tool that needs a foreground window.
   */
  const captureIndex = process.argv.indexOf('--capture')
  if (captureIndex !== -1) {
    const target = process.argv[captureIndex + 1]
    if (target === undefined) {
      console.error('[main] --capture needs a file path')
      app.exit(2)
      return
    }
    // The renderer's checks include awaited IPC round-trips; capture once they have settled.
    setTimeout(() => {
      const fs = require('node:fs')
      // `capturePage` goes through the Viz compositor, which has no frames to give on a machine
      // with no usable display. `printToPDF` uses Skia's print pipeline instead, so it still
      // produces the real rendered page when capture cannot.
      window.webContents
        .capturePage()
        .then(image => {
          fs.writeFileSync(target, image.toPNG())
          return target
        })
        .catch(() =>
          window.webContents
            .printToPDF({ printBackground: true, pageSize: { width: 12.3, height: 8 } })
            .then(pdf => {
              const fallback = target.replace(/\.png$/u, '.pdf')
              fs.writeFileSync(fallback, pdf)
              return fallback
            }),
        )
        .then(written => {
          console.log(`[main] captured ${written}`)
          app.exit(0)
        })
        .catch(error => {
          console.error(`[main] capture failed: ${error.message}`)
          app.exit(1)
        })
    }, 2500)
  }
}

/*
 * `capturePage` goes through the GPU compositor, which fails with UnknownVizError on machines with
 * no usable display. Software rendering is slower but always available, and capture is a
 * verification path, not the normal one — so this only applies when capturing.
 */
if (process.argv.includes('--capture')) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('use-gl', 'swiftshader')
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})
