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
    describeInventoryContributions,
    disabledContributionNotices,
    probeElectronExtensionRoot,
    resolveElectronPresentationPlan,
    createGrantedRoots,
    exposeElectronSubjectRpc,
    openFileArtifactSource,
    createFileEditingBackend,
    createSubjectEditing,
    createRawWriter,
    createEvidenceRegistry,
  } = await root

  const repositoryRoot = path.resolve(__dirname, '..', '..', '..')
  const BUNDLED_ROOTS = BUNDLED_EXTENSION_DIRECTORIES.map(directory =>
    path.join(repositoryRoot, 'extensions', 'common', directory),
  )

  /**
   * What the settings file asks this composition for.
   *
   * Read here, in main, because main owns the settings file and the trust decision: a user's
   * directory is an `installed` artifact and never reaches the in-process boundary. A disabled
   * entry is skipped; a broken one is reported by `loadExtensionRoots` and the application still
   * starts with everything else. The disabled-contribution list travels the same way and is the
   * one place a switched-off codec is decided — the host keeps the record and refuses activation.
   */
  const readExtensionConfiguration = async () => {
    try {
      const settings = await readSettings(app)
      // a malformed settings file is reported by the store; say so, or the user's extensions
      // would simply be absent with no explanation anywhere
      if (settings.problem !== undefined) {
        console.log(`[main] settings could not be read: ${settings.problem}`)
      }
      const raw = settings.raw
      const configured = Array.isArray(raw?.extensions) ? raw.extensions : []
      const entries = configured.flatMap(entry =>
        entry && typeof entry.path === 'string' && entry.path.length > 0
          ? [
              {
                path: entry.path,
                root: path.resolve(entry.path),
                enabled: entry.enabled !== false,
                ...(typeof entry.id === 'string' && entry.id.length > 0 ? { id: entry.id } : {}),
              },
            ]
          : [],
      )
      const disabledContributions = (
        Array.isArray(raw?.disabledContributions) ? raw.disabledContributions : []
      ).filter(value => typeof value === 'string' && value.length > 0)
      return {
        location: settings.location,
        entries,
        disabledContributions,
        ...(settings.problem === undefined ? {} : { problem: settings.problem }),
      }
    } catch (error) {
      console.log(`[main] settings unreadable, no user extensions loaded: ${String(error)}`)
      return {
        location: 'settings',
        entries: [],
        disabledContributions: [],
        problem: String(error),
      }
    }
  }

  /** Compose the whole subject pipeline from what the settings file says right now. */
  const composeFromSettings = async () => {
    const configuration = await readExtensionConfiguration()
    const services = await createElectronSubjectServices(BUNDLED_ROOTS, {
      // worker realm diagnostics: the SB-1 shared-process notice, restarts, crashes, capped stdio
      onDiagnostic: diagnostic =>
        console.log(`[worker] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`),
      userRoots: configuration.entries
        .filter(entry => entry.enabled)
        .map(entry => ({
          root: entry.root,
          ...(entry.id === undefined ? {} : { expectedId: entry.id }),
        })),
      disabledContributions: configuration.disabledContributions,
    })
    for (const failure of services.extensions.failures) {
      console.log(
        `[main] extension not loaded: ${failure.root} — ${failure.code}: ${failure.message}`,
      )
    }
    if (services.extensions.installed.length > 0) {
      console.log(`[main] user extensions: ${services.extensions.installed.join(', ')}`)
    }
    if (configuration.disabledContributions.length > 0) {
      console.log(`[main] disabled codecs: ${configuration.disabledContributions.join(', ')}`)
    }
    const application = services.application
    console.log(
      `[main] composed ${application.topology.topologyId}: ` +
        `main ${application.main.profile.facilities.length} facilities, ` +
        `renderer ${application.renderer.profile.facilities.length} facilities, ` +
        `codecs run in ${application.workers.profile.realmId} (${services.executionProfiles.join('/')})`,
    )
    return { services, configuration }
  }

  /*
   * Live, not "on next launch".
   *
   * Both bindings are reassigned by `modkit.extensions.reload`, so every handler below reads the
   * composition the user's settings describe *now*. The renderer closes its tabs before asking and
   * reopens them afterwards, which is what disposes the sessions of the old composition — a worker
   * lease ends with the session that holds it.
   */
  let { services: subjectServices, configuration: extensionConfiguration } =
    await composeFromSettings()

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
  // Read at call time, not captured: `modkit.extensions.reload` replaces the composition, and a
  // snapshot pinned to the one built at start would keep describing codecs that are gone.
  ipcMain.handle('modkit.profile', () => {
    const composed = subjectServices.application
    return {
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
    }
  })

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
    /*
     * Whether this host can replace the file decides the *open grant*, not just the arm.
     *
     * ADR-HOST-002 §2: a mutating operation's `write-source` is checked twice — once when the
     * activation narrows the child grant, and again by the host before an `invoke` reaches the
     * codec. Opening every subject read-only therefore made `edit.field`, `edit.structure` and
     * `edit.content` refuse with `permission-missing` no matter what the user did, which is why no
     * application ever offered them. Asking `access(W_OK)` first and opening with the class only
     * when the answer is yes keeps the refusal exactly where it belongs: a file this process
     * cannot replace still opens, still reads, and refuses the mutating operation with its reason.
     * `access(W_OK)` is the right check on Windows too, where it reports the read-only attribute.
     */
    const notEditable = []
    try {
      await fsp.access(file, fs.constants.W_OK)
    } catch (error) {
      notEditable.push(`the file is not writable (${error.code ?? 'EACCES'})`)
    }
    const writable = notEditable.length === 0
    const result = await subjectServices.open({
      source,
      path: file,
      intent: 'full',
      grant: {
        id: `electron:${randomUUID()}`,
        classes: writable ? ['read-source', 'write-source'] : ['read-source'],
      },
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
      /*
       * Why nothing claimed it, when the answer is "you switched that codec off".
       *
       * A disabled contribution is never a candidate, so the result carries no diagnostic that
       * would explain it. The host's own record does; this puts it in front of the user instead of
       * leaving them with a bare "no codec claimed it" for a file that opened a minute ago.
       */
      const switchedOff = disabledContributionNotices(
        subjectServices.application.main.inventory,
        file,
      )
      for (const notice of switchedOff) {
        console.log(`[main] ${path.basename(file)} ${notice.code}: ${notice.message}`)
      }
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
          // the switched-off notices first: they are the reason, the rest is the consequence
          diagnostics: [...switchedOff, ...result.diagnostics],
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
    /*
     * The editing arm for this session; the renderer only ever names it by id.
     *
     * A subject this host cannot write must have *no* arm, because `edit()` refusing is what tells
     * the renderer to drop its editable stages instead of drawing a Save that fails at the end.
     * Two things make a subject unwritable here: a shape editing does not support yet (a bundle, a
     * namespace — `createSubjectEditing` throws), and a file the OS will not let us replace. The
     * second was already decided above, because it also decides the open grant.
     */
    if (writable) {
      try {
        editingBySession.set(
          sessionId,
          createSubjectEditing({
            opened: result,
            grant: { id: `electron:${sessionId}`, classes: ['read-source', 'write-source'] },
            backendFor: () => editingBackend,
            evidenceFor: plan => evidence.evidenceFor(plan),
            writer: rawWriter,
          }),
        )
      } catch (error) {
        notEditable.push(String(error.message ?? error))
      }
    }
    // The reason travels in the snapshot: the RPC refusal itself is a generic "not editable here",
    // and a renderer that cannot say *why* a file is read-only has not explained anything.
    const editingDiagnostics = notEditable.map(message => {
      console.log(`[main] ${path.basename(file)} opened without an editing arm: ${message}`)
      return { severity: 'information', code: 'x3.app/subject-not-editable', message }
    })
    return {
      snapshot: {
        state: result.state,
        sessionId,
        descriptor: result.descriptor,
        presentation,
        selected: result.selected,
        candidates: result.candidates,
        diagnostics: [...result.diagnostics, ...editingDiagnostics],
      },
      session: result.session,
    }
  }

  /*
   * S14: the renderer can edit, but it holds nothing that authorises a write. Main keeps the file
   * backend, the grant snapshot, the writer and every prepared commit; the renderer gets ids. The
   * backend is confined to the roots the user granted through a dialog, so a subject outside them
   * cannot be written even if a session id for it existed.
   */
  const editingBackend = createFileEditingBackend({ roots: () => roots.list() })
  const editingBySession = new Map()

  /*
   * Host fidelity-evidence policy (ADR-HOST-002 §6): which fidelity claims this application is
   * willing to commit, and what proves each. A claim with no record is `fidelity-unproven` and
   * nothing is written — which is the right default, and the reason this list is explicit.
   *
   * The registry's own record covers every `{byte-identical, preservesUnknownData: true}` plan:
   * the host raw writer's, and the metadata edits of the PNG, JPEG and MP3 codecs, which splice
   * one byte range and leave every other byte where it was.
   *
   * A ZIP edit is a different fact. The codec re-assembles the whole archive, so it claims
   * `semantic`, and what proves the re-assembly is verbatim is a corpus run rather than a
   * construction argument: `packages/host/test/archive-edits.test.ts` compares every kept entry's
   * local header, compressed data and central-directory record byte for byte against an
   * independent ZIP reader, and checks a kept deflated entry still inflates. Two records, because
   * the codec downgrades its own claim honestly for an archive whose layout the central directory
   * does not account for, and "keeps every unknown byte" and "does not" are two different claims.
   */
  const ZIP_WRITER = Object.freeze({
    providerId: 'org.modkitx/archive-zip',
    providerVersion: '1.0.0',
    artifactDigest: 'none:extension-artifact-not-pinned',
    formatId: 'zip',
    representationId: 'archive-namespace',
  })
  const zipEvidenceRecord = (preservesUnknownData, evidenceId, inputClass) =>
    Object.freeze({
      writer: ZIP_WRITER,
      claim: { roundTrip: 'semantic', preservesUnknownData },
      evidenceId,
      corpusId: 'modkitX3/packages/host/test/archive-edits.test.ts',
      corpusDigest: 'none:proof-suite',
      conformanceProfile: 'org.modkitx/codec-contribution-v1',
      optionsFingerprint: 'options:stored-additions',
      inputClass,
      provenAt: '2026-08-19T00:00:00Z',
    })
  const evidence = createEvidenceRegistry()
    .with(zipEvidenceRecord(true, 'zip-verbatim-reassembly-v1', 'zip-classic'))
    .with(
      zipEvidenceRecord(
        false,
        'zip-verbatim-reassembly-non-canonical-v1',
        'zip-non-canonical-layout',
      ),
    )
  /** The writer for editors that know nothing about the format (hex, plain text). */
  const rawWriter = createRawWriter()

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
      /*
       * One arm per opened session, handed out once. The consumer leases it when the tab opens and
       * releases it when the tab closes; keeping the entry afterwards would leave a map that only
       * grows and would let a second `edit()` build an arm over an edit session the first one
       * already disposed. Taking it out on the way through is the whole lifetime rule.
       */
      editing: sessionId => {
        const editing = editingBySession.get(sessionId)
        editingBySession.delete(sessionId)
        return editing
      },
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
       * No write channel. Saving is the editing arm (S14) and nothing else: `editingBackend` below
       * owns the temp-file-and-rename, the revision check and the pre-image, under a grant the
       * renderer never holds. A path-named whole-file write beside it would be a second write
       * authority with none of those guarantees.
       */

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

  // ------------------------------------------------------------------ extensions and codecs
  /**
   * What the settings page draws: one row per configured extension with the outcome the loader
   * gave it, and one row per contribution in the inventory with the switch it is in.
   *
   * The outcome is joined here rather than in the renderer, because main is the side that resolved
   * the path and called `loadExtensionRoots` — the renderer has no `path.resolve` and must never
   * be handed one. A failure travels with its code and message unchanged: a user who pointed at
   * the wrong folder needs the loader's own sentence, not a paraphrase.
   */
  const extensionReport = () => {
    const configuration = extensionConfiguration
    const failures = subjectServices.extensions.failures
    const installed = new Set(subjectServices.extensions.installed)
    const entries = configuration.entries.map(entry => {
      const failure = failures.find(item => item.root.toLowerCase() === entry.root.toLowerCase())
      /*
       * The loader reports one failure per root it refused — an unreadable directory, a folder
       * that is not an extension, a coordinate conflict, an identity mismatch — so an enabled
       * root that is not among them is loaded. Requiring the settings entry to name a coordinate
       * would report a hand-written bare path as "absent" for no reason; that state is kept for
       * the one genuinely odd case, an entry naming a coordinate the inventory does not hold.
       */
      const state = !entry.enabled
        ? 'disabled'
        : failure !== undefined
          ? 'failed'
          : entry.id !== undefined && !installed.has(entry.id)
            ? 'absent'
            : 'loaded'
      return {
        ...(entry.id === undefined ? {} : { id: entry.id }),
        path: entry.path,
        root: entry.root,
        enabled: entry.enabled,
        state,
        ...(failure === undefined ? {} : { code: failure.code, message: failure.message }),
      }
    })
    /*
     * Failures whose root is not in the settings list at all — a bundled directory this build
     * shipped broken. They belong on the page too: the user cannot fix them from here, but a
     * codec that is missing for that reason must not look like a codec that never existed.
     */
    const configuredRoots = new Set(configuration.entries.map(entry => entry.root.toLowerCase()))
    const unconfiguredFailures = failures
      .filter(item => !configuredRoots.has(item.root.toLowerCase()))
      .map(item => ({ root: item.root, code: item.code, message: item.message }))
    return {
      location: configuration.location,
      ...(configuration.problem === undefined ? {} : { problem: configuration.problem }),
      bundled: [...subjectServices.extensions.bundled],
      installed: [...subjectServices.extensions.installed],
      entries,
      unconfiguredFailures,
      contributions: describeInventoryContributions(subjectServices.application.main.inventory).map(
        row => ({ ...row }),
      ),
      disabledContributions: [...configuration.disabledContributions],
      supportedExtensions: [...subjectServices.supportedExtensions],
    }
  }

  /*
   * Reloading is serialised.
   *
   * Two toggles in quick succession would otherwise compose two pipelines against the same
   * settings file and the last one to finish — not the last one asked for — would win. Chaining
   * makes the final composition the one the final settings write describes.
   */
  let reloading = Promise.resolve()
  const reloadExtensions = async () => {
    const next = reloading.then(async () => {
      const composedNow = await composeFromSettings()
      subjectServices = composedNow.services
      extensionConfiguration = composedNow.configuration
    })
    reloading = next.catch(() => undefined)
    await next
    return extensionReport()
  }

  ipcMain.handle('modkit.extensions.report', () => extensionReport())
  ipcMain.handle('modkit.extensions.reload', () => reloadExtensions())

  /*
   * Picking an extension folder.
   *
   * A native directory dialog, exactly like `dialog.open-directory` — and deliberately *not*
   * through it: opening a folder to browse grants it to the renderer's file access, and connecting
   * an extension must not. Nothing here calls `roots.grant`.
   *
   * The directory is probed before anything is written, because the settings document keys an
   * extension by identity and only the directory knows its own coordinate. A folder that is not an
   * extension comes back as a refusal carrying the loader's code and message, which the page shows
   * verbatim instead of silently dropping the folder.
   */
  const selfTestExtensionFolders = process.argv.includes('--selftest')
    ? process.argv.flatMap((value, index) =>
        value === '--extension-folder' && process.argv[index + 1] !== undefined
          ? [process.argv[index + 1]]
          : [],
      )
    : []
  ipcMain.handle('modkit.extensions.browse', async () => {
    /*
     * A dialog needs a human. `--extension-folder <dir>` (accepted only in a `--selftest` run,
     * beside `--open`) answers it from the command line instead, so the *renderer's* add flow —
     * the button, the probe, the settings write, the reload — is the one being verified rather
     * than a second path that only the test uses.
     */
    const scripted = selfTestExtensionFolders.shift()
    const picked =
      scripted === undefined
        ? await dialog.showOpenDialog(window, {
            properties: ['openDirectory'],
            title: 'Add an extension folder',
            buttonLabel: 'Add extension',
          })
        : { canceled: false, filePaths: [scripted] }
    if (picked.canceled || picked.filePaths[0] === undefined) return { canceled: true }
    const root = path.resolve(picked.filePaths[0])
    const already = extensionConfiguration.entries.find(
      entry => entry.root.toLowerCase() === root.toLowerCase(),
    )
    if (already !== undefined) {
      return {
        canceled: false,
        state: 'already-configured',
        root,
        ...(already.id === undefined ? {} : { id: already.id }),
      }
    }
    const claimed = [
      ...subjectServices.extensions.bundled,
      ...extensionConfiguration.entries.flatMap(entry =>
        entry.id === undefined ? [] : [entry.id],
      ),
    ]
    const probe = await probeElectronExtensionRoot(root, claimed)
    console.log(
      probe.state === 'extension'
        ? `[main] extension folder accepted: ${probe.root} declares ${probe.id}`
        : `[main] extension folder refused: ${probe.root} — ${probe.code}: ${probe.message}`,
    )
    return { canceled: false, ...probe }
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
            {
              label: 'Extensions & Codecs…',
              accelerator: 'CmdOrCtrl+Shift+X',
              click: send('modkit.menu.extensions'),
            },
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
  const selfTest = process.argv.includes('--selftest')
  window.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[renderer] ${message}`)
    /*
     * A self-test run has a last line, and a window that stays open after it forces every harness
     * to kill the process on a timeout — which is indistinguishable from the run hanging. Exiting
     * on the renderer's own final line makes the exit code mean something.
     */
    if (selfTest && String(message).trim() === 'selftest: done') {
      setTimeout(() => app.exit(0), 250)
    }
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
