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
const { createHash, randomUUID } = require('node:crypto')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { readSettings, writeSettings } = require('./settings-store.cjs')
const { findInitialFileArgument } = require('./file-arguments.cjs')
const BUNDLED_EXTENSION_DIRECTORIES = require('../generated/bundled-catalog.cjs')

const RENDERER = path.join(__dirname, '..', 'dist-app', 'index.html')
const FORMAT_SMOKE_AUTHORITY = path.join(__dirname, '..', 'dist-app', 'format-smoke.v1.json')
const PACKAGED_RUNTIME = path.join(__dirname, '..', 'dist-app', 'main-runtime', 'dist', 'index.js')
const ACCEPTANCE_USER_DATA = process.env.MODKIT_ELECTRON_USER_DATA_DIR

if (ACCEPTANCE_USER_DATA !== undefined && ACCEPTANCE_USER_DATA.trim() !== '') {
  const acceptanceUserData = path.resolve(ACCEPTANCE_USER_DATA)
  fs.mkdirSync(acceptanceUserData, { recursive: true })
  app.setPath('userData', acceptanceUserData)
}

/** The composition root is ESM; main is CJS, so it is loaded through a dynamic import. */
const root = import(
  pathToFileURL(
    fs.existsSync(PACKAGED_RUNTIME)
      ? PACKAGED_RUNTIME
      : path.join(__dirname, '..', 'dist', 'index.js'),
  ).href
)

function readFormatSmokeAuthority() {
  const bytes = fs.readFileSync(FORMAT_SMOKE_AUTHORITY)
  return {
    document: JSON.parse(bytes.toString('utf8')),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

function readFormatSmokePlan() {
  const planArg = process.argv.indexOf('--format-smoke-plan')
  const planPath =
    planArg === -1 ? process.env.MODKIT_ELECTRON_FORMAT_SMOKE_PLAN : process.argv[planArg + 1]
  if (planPath === undefined || planPath.trim() === '') return undefined
  const document = JSON.parse(fs.readFileSync(planPath, 'utf8'))
  if (
    document?.kind !== 'x3.electron/format-smoke-plan' ||
    document.schemaVersion !== 1 ||
    !Array.isArray(document.cases)
  ) {
    throw new TypeError('MODKIT_ELECTRON_FORMAT_SMOKE_PLAN did not point at a format-smoke plan')
  }
  return document
}

/*
 * R6: no method allowlists live here any more. The renderer speaks capability-RPC to a
 * per-window endpoint (see `exposeElectronSubjectRpc`); which methods exist on a session or a
 * data source is decided by the contract-owned method surfaces, the same authority every other
 * execution boundary uses.
 */
const MAXIMUM_SUBJECT_BYTES = 64 * 1024 * 1024
const MAXIMUM_RANGE_BACKED_SUBJECT_BYTES = 256 * 1024 * 1024

/* S7/C1: the shared host adapter revision-checks files and confines bounded loose directories. */

/**
 * Register this build for a set of file extensions.
 *
 * Per-user only: everything is written under `HKCU\Software\Classes`, never `HKLM`, so it needs no
 * elevation and cannot change the machine for other accounts. It is also reversible — the keys it
 * writes are the ones Windows' own "Open with → Choose another app" would create.
 *
 * Called only from the renderer's explicit "Set as default app" action. Nothing here runs at start.
 */
async function registerFileTypes(extensions, localizer) {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      message: localizer.text('electron.main.fileAssociation.unsupported', {
        platform: process.platform,
      }),
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
    return {
      supported: true,
      registered: [],
      message: localizer.text('electron.main.fileAssociation.noValid'),
    }

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
        localizer.text('electron.main.fileAssociation.description', {
          extension: extension.toUpperCase(),
        }),
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
        message: localizer.text('electron.main.fileAssociation.failed', {
          extension,
          reason: error instanceof Error ? error.message : String(error),
        }),
      }
    }
  }
  return {
    supported: true,
    registered,
    message: localizer.text('electron.main.fileAssociation.registered', {
      count: registered.length,
      types: registered.join(', '),
    }),
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
    describeInventoryExtensionSubjects,
    disabledContributionNotices,
    probeElectronExtensionRoot,
    composeElectronExtensionRoots,
    parseElectronMapPreviewSelectionRequest,
    prepareElectronMapPreview,
    createElectronLocalizer,
    loadElectronLocalization,
    resolveElectronPresentationPlan,
    createGrantedRoots,
    exposeElectronSubjectRpc,
    createElectronNestedSubjectNavigator,
    openPathArtifactSource,
    createFilesystemInputResolver,
    createNodeMapPreviewResourcePlanResolver,
    createFileEditingBackend,
    createSubjectEditing,
    createRawWriter,
    createEvidenceRegistry,
    codecFidelityEvidenceRecords,
    serviceProviderFidelityEvidenceRecord,
    resolveFormatWriter,
    commandRequest,
    createSubjectCommandEndpoint,
    createElectronExtensionManagerBackend,
    readElectronManagedExtensionState,
    nestedSubjectServices,
    openNestedSubject,
  } = await root
  const repositoryRoot = path.resolve(__dirname, '..', '..', '..')
  const packagedCommonExtensions = path.join(__dirname, '..', 'dist-app', 'extensions')
  const BUNDLED_ROOTS = BUNDLED_EXTENSION_DIRECTORIES.map(directory =>
    path.join(packagedCommonExtensions, directory),
  )
  const packagedRelease = path.join(__dirname, '..', 'dist-app', 'managed-packages')
  const developmentRegistry = process.env.MODKIT_EXTENSION_REGISTRY
  const extensionRegistry = developmentRegistry || path.join(packagedRelease, 'catalog.v1.json')
  const extensionAllowedOrigins = (process.env.MODKIT_EXTENSION_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const extensionTrustedPublicKeys = (() => {
    if (developmentRegistry === undefined) {
      const descriptor = JSON.parse(
        fs.readFileSync(path.join(packagedRelease, 'release.v1.json'), 'utf8'),
      )
      if (
        !descriptor ||
        !descriptor.signing ||
        typeof descriptor.signing.keyId !== 'string' ||
        descriptor.signing.keyId.trim() === '' ||
        typeof descriptor.signing.publicKeyPem !== 'string' ||
        !descriptor.signing.publicKeyPem.includes('BEGIN PUBLIC KEY')
      ) {
        throw new TypeError('packaged offline release has no valid Ed25519 public-key identity')
      }
      return Object.freeze({ [descriptor.signing.keyId]: descriptor.signing.publicKeyPem })
    }
    console.warn('[main] MODKIT_EXTENSION_REGISTRY is a development-only registry override')
    const text = process.env.MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS
    if (text === undefined || text.trim() === '') return Object.freeze({})
    if (text.length > 1_000_000) {
      throw new TypeError('MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS is too large')
    }
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError('MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS must be a JSON object')
    }
    for (const [keyId, publicKey] of Object.entries(parsed)) {
      if (
        keyId.length === 0 ||
        keyId.length > 200 ||
        typeof publicKey !== 'string' ||
        publicKey.length === 0 ||
        publicKey.length > 100_000
      ) {
        throw new TypeError('trusted extension public keys must be bounded non-empty strings')
      }
    }
    return Object.freeze({ ...parsed })
  })()
  const extensionVfsOptions = {
    ...(extensionAllowedOrigins.length === 0 ? {} : { allowedOrigins: extensionAllowedOrigins }),
    ...(process.env.MODKIT_RAPID_POOL_ROOT
      ? { rapidPoolRoot: process.env.MODKIT_RAPID_POOL_ROOT }
      : {}),
  }
  const extensionManager = createElectronExtensionManagerBackend({
    registry: extensionRegistry,
    baseDirectory: repositoryRoot,
    // Production uses the key carried by the copied offline release; development overrides are
    // explicit and still require a matching trusted key.
    trustedPublicKeys: extensionTrustedPublicKeys,
    requireSignature: true,
    fetch: globalThis.fetch,
    vfsOptions: extensionVfsOptions,
    storeRoot: path.join(app.getPath('userData'), 'managed-extensions'),
  })

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
      const disabledExtensions = new Set(
        (Array.isArray(raw?.disabledExtensions) ? raw.disabledExtensions : []).filter(
          value => typeof value === 'string' && value.length > 0,
        ),
      )
      // Backward compatibility: older settings kept the same choice only on the manual root row.
      for (const entry of entries) {
        if (!entry.enabled && entry.id !== undefined) disabledExtensions.add(entry.id)
      }
      return {
        location: settings.location,
        entries,
        disabledExtensions: [...disabledExtensions],
        disabledContributions,
        ...(settings.problem === undefined ? {} : { problem: settings.problem }),
      }
    } catch (error) {
      console.log(`[main] settings unreadable, no user extensions loaded: ${String(error)}`)
      return {
        location: 'settings',
        entries: [],
        disabledExtensions: [],
        disabledContributions: [],
        problem: String(error),
      }
    }
  }

  /** Compose the whole subject pipeline from manual settings and manager-owned package state. */
  const composeFromSettings = async () => {
    const configuration = await readExtensionConfiguration()
    const managed = await readElectronManagedExtensionState(extensionManager)
    const rootComposition = await composeElectronExtensionRoots({
      manualRoots: configuration.entries,
      managedRoots: managed.roots,
      probeManual: (root, claimed) => probeElectronExtensionRoot(root, claimed),
    })
    const disabledExtensions = [
      ...new Set([
        ...managed.disabledExtensions,
        ...configuration.disabledExtensions,
        ...rootComposition.disabledExtensions,
      ]),
    ]
    const effectiveConfiguration = {
      ...configuration,
      disabledExtensions,
      conflicts: rootComposition.conflicts,
    }
    const services = await createElectronSubjectServices(BUNDLED_ROOTS, {
      // worker realm diagnostics: the SB-1 shared-process notice, restarts, crashes, capped stdio
      onDiagnostic: diagnostic =>
        console.log(`[worker] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`),
      userRoots: rootComposition.roots,
      disabledExtensions,
      disabledContributions: configuration.disabledContributions,
    })
    for (const failure of rootComposition.conflicts) {
      console.log(
        `[main] extension not loaded: ${failure.root} — ${failure.code}: ${failure.message}`,
      )
    }
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
    const mapPreviewResourcePlanResolver = createNodeMapPreviewResourcePlanResolver({
      subjects: services,
    })
    let localization
    try {
      localization = await loadElectronLocalization(
        application.main.inventory,
        app.getLocale(),
        extensionVfsOptions,
      )
      for (const item of localization.diagnostics) {
        console.log(`[localization] ${item.severity} ${item.code}: ${item.message}`)
      }
    } catch (error) {
      console.log(
        `[localization] external catalogs unavailable; built-in English/Russian remain active: ${String(error)}`,
      )
      localization = {
        catalogs: Object.freeze([]),
        diagnostics: Object.freeze([]),
        localizer: createElectronLocalizer(app.getLocale()),
      }
    }
    console.log(
      `[main] composed ${application.topology.topologyId}: ` +
        `main ${application.main.profile.facilities.length} facilities, ` +
        `renderer ${application.renderer.profile.facilities.length} facilities, ` +
        `codecs run in ${application.workers.profile.realmId} (${services.executionProfiles.join('/')})`,
    )
    return {
      services,
      mapPreviewResourcePlanResolver,
      configuration: effectiveConfiguration,
      localization,
    }
  }

  /*
   * A verification-only command-line stand-in for the Extensions page's Install action. It still
   * uses the production signed catalog, digest verification, atomic managed store and the normal
   * `composeFromSettings` path; no checkout root is injected into the subject services.
   */
  if (process.argv.includes('--selftest') && process.argv.includes('--directory-subject-only')) {
    const packageIndex = process.argv.indexOf('--install-package')
    const packageId = packageIndex === -1 ? undefined : process.argv[packageIndex + 1]
    if (
      packageId !== undefined &&
      /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(packageId)
    ) {
      await extensionManager.refresh()
      const snapshot = await extensionManager.snapshot()
      const installed = snapshot.entries.find(
        entry => entry.id === packageId && entry.installedVersion !== undefined,
      )
      if (installed === undefined) await extensionManager.install(packageId)
      console.log(`[main] selftest installed signed package ${packageId}`)
    }
  }

  /*
   * Live, not "on next launch".
   *
   * Both bindings are reassigned by `modkit.extensions.reload`, so every handler below reads the
   * composition the user's settings describe *now*. The renderer closes its tabs before asking and
   * reopens them afterwards, which is what disposes the sessions of the old composition — a worker
   * lease ends with the session that holds it.
   */
  let {
    services: subjectServices,
    mapPreviewResourcePlanResolver,
    configuration: extensionConfiguration,
    localization,
  } = await composeFromSettings()
  let localizer = localization.localizer
  let localizationCatalogs = localization.catalogs

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
  window.once('closed', () => void extensionManager.dispose())

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
   * composition root imports `@modkit/host/node`, so a renderer that could run it would need
   * Node access — exactly what `nodeIntegration: false` denies. Main composes, and the renderer
   * receives the snapshot its own realm is allowed to see.
   */
  // Read at call time, not captured: `modkit.extensions.reload` replaces the composition, and a
  // snapshot pinned to the one built at start would keep describing codecs that are gone.
  ipcMain.handle('modkit.profile', () => {
    const composed = subjectServices.application
    const formatSmoke = readFormatSmokeAuthority()
    const formatSmokePlan = readFormatSmokePlan()
    if (process.argv.includes('--format-smoke-only')) {
      console.log(
        `[main] format-smoke profile plan=${formatSmokePlan === undefined ? 'absent' : `cases:${formatSmokePlan.cases.length}`}`,
      )
    }
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
      // Validated, function-free JSON only; renderer never receives VFS or inventory authority.
      localizationCatalogs,
      supportedExtensions: subjectServices.supportedExtensions,
      formatSmokeAuthority: formatSmoke.document,
      formatSmokeAuthoritySha256: formatSmoke.sha256,
      ...(formatSmokePlan === undefined ? {} : { formatSmokePlan }),
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

  const parseContainerEntryRequest = value => {
    if (typeof value !== 'string' || !value.startsWith('modkit-container:')) return undefined
    const body = value.slice('modkit-container:'.length)
    const queryIndex = body.indexOf('?')
    const parentSessionId = decodeURIComponent(queryIndex === -1 ? body : body.slice(0, queryIndex))
    const params = new URLSearchParams(queryIndex === -1 ? '' : body.slice(queryIndex + 1))
    const entryId = params.get('entryId')
    if (parentSessionId === '' || entryId === null || entryId === '') {
      throw new TypeError('modkit-container URI requires parent session id and entryId')
    }
    return { parentSessionId, entryId }
  }

  const selectedRouteStep = (descriptor, selected) =>
    Object.freeze({
      formatId: String(descriptor.identity?.formatId ?? ''),
      extensionId: String(selected.extensionId ?? ''),
      contributionId: selected.contributionId,
    })

  const openedSessions = new Map()
  const trackSession = (sessionId, session, selectedRoute) => {
    let disposed = false
    const tracked = Object.freeze({
      revision: session.revision,
      selectedRoute,
      state: () => session.state(),
      descriptor: () => session.descriptor(),
      dataSource: session.dataSource.bind(session),
      operations: () => session.operations(),
      events: signal => session.events(signal),
      async dispose() {
        if (disposed) return
        disposed = true
        openedSessions.delete(sessionId)
        await session.dispose()
      },
    })
    openedSessions.set(sessionId, tracked)
    return tracked
  }

  const nestedAnswerForRpc = async (parent, nested, diagnostics) => {
    if (nested.result.state === 'unresolved') {
      return {
        snapshot: {
          state: nested.result.state,
          reason: nested.result.reason,
          candidates: nested.result.candidates,
          diagnostics: [...nested.result.diagnostics, ...diagnostics],
        },
      }
    }
    const sessionId = randomUUID()
    const childRoute = selectedRouteStep(nested.result.descriptor, nested.result.selected)
    const selectedRoute = Object.freeze([...(parent.selectedRoute ?? []), childRoute])
    const sourceBytes =
      typeof nested.entry.size === 'number' && Number.isFinite(nested.entry.size)
        ? nested.entry.size
        : 0
    const presentation = await resolveElectronPresentationPlan(
      nested.result.descriptor,
      {
        sessionId,
        contributionId: nested.result.selected.contributionId,
        variantId: nested.result.selected.variantId,
      },
      { sourceBytes },
    )
    return {
      snapshot: {
        state: nested.result.state,
        sessionId,
        descriptor: nested.result.descriptor,
        presentation,
        selected: nested.result.selected,
        selectedRoute,
        candidates: nested.result.candidates,
        diagnostics: [...nested.result.diagnostics, ...diagnostics],
      },
      session: trackSession(sessionId, nested.result.session, selectedRoute),
    }
  }

  /**
   * R6: open a subject the way the old IPC branch did, but return the session as an object for
   * the RPC endpoint to lease — no session table, no method dispatch, no allowlists here.
   */
  const openSubjectForRpc = async (requestedPath, signal) => {
    const nestedRequest = parseContainerEntryRequest(requestedPath)
    if (nestedRequest !== undefined) {
      const parent = openedSessions.get(nestedRequest.parentSessionId)
      if (parent === undefined) {
        throw new Error('modkit-container parent session is unavailable')
      }
      const budget = {
        maxInputBytes: BigInt(MAXIMUM_SUBJECT_BYTES),
        maxDepth: 256,
        maxNodes: 1_000_000,
        maxScalarBytes: MAXIMUM_SUBJECT_BYTES,
        maxDiagnostics: 10_000,
        deadlineMs: 30_000,
      }
      const grant = {
        id: `electron:${randomUUID()}`,
        classes: ['read-source'],
      }
      const diagnostics = []
      let nested
      try {
        nested = await openNestedSubject({
          parent,
          entryId: nestedRequest.entryId,
          ...nestedSubjectServices(subjectServices),
          grant,
          budget,
          onDiagnostic: item => diagnostics.push(item),
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (error) {
        console.log(
          `[main] nested subject ${nestedRequest.entryId} failed: ${error?.stack ?? String(error)}`,
        )
        throw error
      }
      if (nested.result.state === 'unresolved') {
        console.log(
          `[main] nested subject ${nested.entry.path} unresolved (${nested.result.reason}): ` +
            nested.result.diagnostics.map(item => item.code).join(', '),
        )
      } else {
        console.log(
          `[main] nested subject ${nested.entry.path} -> ${nested.result.selected.contributionId}/` +
            `${nested.result.selected.variantId} (${Math.round(nested.result.selected.confidence * 100)}%)`,
        )
      }
      return nestedAnswerForRpc(parent, nested, diagnostics)
    }
    const mapSelection = parseElectronMapPreviewSelectionRequest(requestedPath)
    const file = roots.require(mapSelection?.path ?? requestedPath)
    const fileStats = await fsp.stat(file)
    const source = await openPathArtifactSource(file, {
      maxEntries: 1_000_000,
      maxDepth: 256,
      ...(signal === undefined ? {} : { signal }),
    })
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
    if (fileStats.isDirectory()) {
      notEditable.push(localizer.text('electron.main.subject.notWritable', { code: 'EISDIR' }))
    }
    try {
      await fsp.access(file, fs.constants.W_OK)
    } catch (error) {
      notEditable.push(
        localizer.text('electron.main.subject.notWritable', { code: error.code ?? 'EACCES' }),
      )
    }
    const writable = notEditable.length === 0
    const budget = {
      maxInputBytes: BigInt(MAXIMUM_RANGE_BACKED_SUBJECT_BYTES),
      maxDepth: 256,
      maxNodes: 1_000_000,
      maxScalarBytes: MAXIMUM_SUBJECT_BYTES,
      maxDiagnostics: 10_000,
      deadlineMs: 30_000,
    }
    /*
     * Companion resolution for this open.
     *
     * A codec that declares companions — VXL naming its .hva, W3D/W3X/M3 naming textures — returns
     * a composite plan, and a composite plan with no resolver fails closed by design. Main opens the
     * byte source itself, so it composes the resolver the same way the Node path opener does,
     * confined to the roots the user actually granted.
     */
    const companionDiagnostics = []
    const resolveInput = fileStats.isDirectory()
      ? undefined
      : createFilesystemInputResolver({
          primaryPath: file,
          roots: roots.list(),
          inventory: subjectServices.application.main.inventory,
          deadlineMs: budget.deadlineMs,
          onDiagnostic: item => companionDiagnostics.push(item),
        })
    const openGrant = {
      id: `electron:${randomUUID()}`,
      classes: writable ? ['read-source', 'write-source'] : ['read-source'],
    }
    if (fileStats.isDirectory()) console.log(`[main] directory subject probe started: ${file}`)
    const result = await subjectServices.open({
      source,
      path: file,
      intent: 'full',
      grant: openGrant,
      budget,
      ...(resolveInput === undefined ? {} : { resolveInput }),
      ...(signal === undefined ? {} : { signal }),
    })
    if (fileStats.isDirectory()) {
      console.log(`[main] directory subject probe finished: ${file} -> ${result.state}`)
    }
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
          result.diagnostics
            .map(item => `${item.code}(${item.message};${JSON.stringify(item.data ?? {})})`)
            .join(', ') +
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
          diagnostics: [...switchedOff, ...result.diagnostics, ...companionDiagnostics],
        },
      }
    }
    console.log(
      `[main] subject ${path.basename(file)} -> ${result.selected.contributionId}/` +
        `${result.selected.variantId} (${Math.round(result.selected.confidence * 100)}%)`,
    )
    const mapPreview = await prepareElectronMapPreview({
      services: subjectServices,
      opened: result,
      grant: openGrant,
      budgets: budget,
      localizer,
      resourcePlanResolver: mapPreviewResourcePlanResolver,
      ...(mapSelection === undefined ? {} : { selectionId: mapSelection.selectionId }),
      ...(signal === undefined ? {} : { signal }),
    })
    const opened = mapPreview.opened
    const sessionId = randomUUID()
    const selectedRoute = Object.freeze([selectedRouteStep(opened.descriptor, opened.selected)])
    let presentation
    try {
      presentation = await resolveElectronPresentationPlan(
        opened.descriptor,
        {
          sessionId,
          contributionId: result.selected.contributionId,
          variantId: result.selected.variantId,
        },
        { sourceBytes: typeof source.size === 'bigint' ? source.size : BigInt(0) },
      )
    } catch (error) {
      await opened.session.dispose()
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
    const formatId = opened.descriptor.identity?.formatId
    const editGrant = {
      id: `electron:${sessionId}`,
      classes: ['read-source', 'write-source'],
    }
    let formatWriter
    if (writable) {
      formatWriter = await resolveFormatWriter({
        services: subjectServices,
        opened,
        grant: editGrant,
        budgets: budget,
        ...(formatId === 'png'
          ? {
              representationId: 'rgba8',
              mutationMode: 'mutate',
              minimumRoundTrip: 'semantic',
            }
          : {}),
      })
      for (const diagnostic of formatWriter.diagnostics) {
        console.log(`[writer] ${diagnostic.code}: ${diagnostic.message}`)
      }
      if (formatId === 'png' && formatWriter.writer === undefined) {
        notEditable.push(localizer.text('electron.main.subject.pngWriterUnavailable'))
      }
    }
    if (writable && (formatId !== 'png' || formatWriter?.writer !== undefined)) {
      try {
        const selectedWriter = formatWriter?.writer ?? rawWriter
        let evidence = codecFidelityEvidenceRecords(subjectServices.inventory, {
          codecId: opened.descriptor.identity?.codecId,
          formatId,
        }).reduce((registry, record) => registry.with(record), createEvidenceRegistry())
        if (formatWriter?.writer !== undefined) {
          const writerRecord = serviceProviderFidelityEvidenceRecord(subjectServices.inventory, {
            writer: formatWriter.writer,
          })
          if (writerRecord !== undefined) evidence = evidence.with(writerRecord)
        }
        const editing = createSubjectEditing({
          opened,
          grant: editGrant,
          backendFor: () => editingBackend,
          evidenceFor: plan => {
            const registered = evidence.evidenceFor(plan)
            if (registered !== undefined) return registered
            if (
              formatWriter?.writer !== undefined &&
              plan.fidelity.roundTrip === 'semantic' &&
              plan.fidelity.preservesUnknownData === false
            ) {
              return {
                roundTrip: 'semantic',
                preservesUnknownData: false,
                evidenceId: 'png-encoder-v1',
                corpusId: 'modkit/packages/host/test/media-edits.test.ts',
                corpusDigest: 'none:proof-suite',
                conformanceProfile: 'common.edit/writer-v1',
                writer: formatWriter.writer.identity,
                optionsFingerprint: 'options:none',
                inputClass: 'rgba8',
                provenAt: '2026-08-19T00:00:00Z',
              }
            }
            return undefined
          },
          writer: selectedWriter,
        })
        /*
         * `resolveFormatWriter` returned a service lease. The subject RPC releases an editing arm
         * by disposing its edit session, so bind the lease to that same lifetime. A tab switch
         * calls the renderer adapter's no-op dispose; closing the tab reaches this one.
         */
        const leasedSession = editing.session
        let released = false
        const editingForSession =
          formatWriter?.release === undefined || leasedSession === undefined
            ? editing
            : Object.freeze({
                ...editing,
                session: Object.freeze({
                  ...leasedSession,
                  async dispose() {
                    await leasedSession.dispose()
                    if (!released) {
                      released = true
                      await formatWriter.release()
                    }
                  },
                }),
              })
        editingBySession.set(sessionId, editingForSession)
      } catch (error) {
        await formatWriter?.release?.()
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
        state: opened.state,
        sessionId,
        descriptor: opened.descriptor,
        presentation,
        selected: opened.selected,
        selectedRoute,
        candidates: [...opened.candidates, ...mapPreview.candidates],
        diagnostics: [...opened.diagnostics, ...editingDiagnostics],
      },
      session: trackSession(sessionId, opened.session, selectedRoute),
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

  /** The writer for editors that know nothing about the format (hex, plain text). */
  const rawWriter = createRawWriter()

  /*
   * The shared command runtime (block 13, works 4–6).
   *
   * The same six descriptors the CLI runs and VS Code puts in its palette. Everything Electron
   * contributes is `openSubjectForRpc` — which already confines a requested path to the granted
   * roots. What a command decides is not written in this file, and that is exit-gate line 1 of the
   * block: no domain handler exists only inside an adapter.
   */
  const commandEndpoint = createSubjectCommandEndpoint({
    openSubject: openSubjectForRpc,
    // The renderer has only four task lanes; a larger table would add queued authority, not work.
    maxConcurrentRuns: 8,
  })
  window.once('closed', () => void commandEndpoint.dispose())

  ipcMain.handle('modkit.command.list', () =>
    commandEndpoint.catalog.commands.map(contract => ({
      id: contract.id,
      title: contract.title,
      summary: contract.summary,
      needsSubject: contract.input.subject === 'required',
      mutatesSource: contract.effects.mutatesSource,
    })),
  )
  ipcMain.handle('modkit.command.catalog', () => commandEndpoint.catalog)

  const executeCommand = (event, request, runId) => {
    const caller = new AbortController()
    const senderDestroyed = () => caller.abort()
    event.sender.once('destroyed', senderDestroyed)
    return commandEndpoint
      .execute(request, {
        ...(typeof runId === 'string' ? { runId } : {}),
        signal: caller.signal,
        // Progress travels back on the sender that asked; a closed window simply stops listening.
        progress: step => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('modkit.command.progress', { runId, ...step })
          }
        },
      })
      .finally(() => event.sender.removeListener('destroyed', senderDestroyed))
  }

  ipcMain.handle('modkit.command.run', async (event, request) => {
    const { command, subject, entry, target, runId } = request ?? {}
    if (typeof command !== 'string' || typeof subject !== 'string') {
      return {
        state: 'failed',
        command: String(command ?? ''),
        code: 'x3.command/input-invalid',
        message: 'a command run names a command and a subject',
        diagnostics: [],
      }
    }
    try {
      const receipt = await executeCommand(
        event,
        commandRequest(command, {
          subject,
          ...(typeof entry === 'string' ? { entry } : {}),
          ...(typeof target === 'string' ? { target } : {}),
        }),
        runId,
      )
      return receipt.result
    } catch (error) {
      return {
        state: 'failed',
        command,
        code: 'x3.command/host-refused',
        message: error instanceof Error ? error.message : String(error),
        diagnostics: [],
      }
    }
  })

  ipcMain.handle('modkit.command.execute', (event, payload) => {
    const request = payload?.request
    if (request === null || typeof request !== 'object') {
      throw new TypeError('a protocol command call needs a request document')
    }
    return executeCommand(event, request, payload?.runId)
  })

  ipcMain.handle('modkit.command.cancel', (_event, runId) => {
    return typeof runId === 'string' && commandEndpoint.cancel(runId)
  })

  /** One capability-RPC endpoint per handed-out port; closed with the window. */
  const subjectEndpoints = new Set()
  const navigateSubjectForRpc = createElectronNestedSubjectNavigator({
    services: subjectServices,
    grant: () => ({ id: `electron:${randomUUID()}`, classes: ['read-source'] }),
    budget: {
      maxInputBytes: BigInt(MAXIMUM_SUBJECT_BYTES),
      maxDepth: 256,
      maxNodes: 1_000_000,
      maxScalarBytes: MAXIMUM_SUBJECT_BYTES,
      maxDiagnostics: 10_000,
      deadlineMs: 30_000,
    },
    answer: nestedAnswerForRpc,
  })
  ipcMain.handle('modkit.subject.port', event => {
    const channel = new MessageChannelMain()
    const session = randomUUID()
    const exposure = exposeElectronSubjectRpc({
      port: channel.port1,
      listener: 'emitter-event',
      session,
      open: openSubjectForRpc,
      navigate: navigateSubjectForRpc,
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
          title: localizer.text('electron.main.dialog.openFolder'),
        })
        if (picked.canceled || picked.filePaths[0] === undefined) return { canceled: true }
        const root = roots.grant(picked.filePaths[0])
        return { canceled: false, root, label: path.basename(root) || root }
      }

      case 'dialog.open-file': {
        const picked = await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          title: localizer.text('electron.main.dialog.openFile'),
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
        if (described.length === 0)
          throw new Error(localizer.text('electron.main.drop.noneReadable'))
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
        if (!known) throw new Error(localizer.text('electron.main.recent.notListed'))

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
            localizer.text('electron.main.file.tooLarge', {
              size: stats.size,
              limit: request.payload.maxBytes,
            }),
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
          note: localizer.text('electron.main.broker.noNativeEffect'),
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
  if (process.argv.includes('--selftest')) {
    for (const [index, value] of process.argv.entries()) {
      if (value !== '--grant' || process.argv[index + 1] === undefined) continue
      const granted = roots.grant(process.argv[index + 1])
      console.log(`[main] granted ${granted}`)
    }
  }

  /*
   * A file passed on the command line — which is how a double-click reaches us once this app is
   * registered for a type. Windows and Linux deliver it in argv; macOS uses the `open-file` event.
   */
  ipcMain.handle('modkit.initial-file', async () => {
    if (openIndex !== -1 && process.argv[openIndex + 1] !== undefined) {
      const target = process.argv[openIndex + 1]
      return {
        present: true,
        root: target,
        selfTest: process.argv.includes('--selftest'),
        selfTestPngOnly: process.argv.includes('--selftest-png'),
        selfTestFormatSmokeOnly: process.argv.includes('--format-smoke-only'),
        selfTestDirectorySubject: process.argv.includes('--directory-subject-only'),
      }
    }
    const candidate = findInitialFileArgument(
      process.argv,
      app.isPackaged,
      value => fs.existsSync(value),
      value => fs.statSync(value).isFile(),
    )
    if (candidate === undefined) return { present: false }
    return { present: true, ...(await grantAndDescribe(candidate)) }
  })

  // Registering file associations writes to the user's registry, so it is never automatic: the
  // renderer asks only when the user activates the action.
  ipcMain.handle('modkit.register-file-types', async (_event, extensions) =>
    registerFileTypes(Array.isArray(extensions) ? extensions : [], localizer),
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
      buttons: [
        localizer.text('electron.main.close.save'),
        localizer.text('electron.main.close.discard'),
        localizer.text('electron.main.close.cancel'),
      ],
      defaultId: 0,
      cancelId: 2,
      message: localizer.text('electron.main.close.message', { name: String(name) }),
      detail: localizer.text('electron.main.close.detail'),
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
  const extensionReport = async () => {
    const configuration = extensionConfiguration
    const failures = [...subjectServices.extensions.failures, ...(configuration.conflicts ?? [])]
    const installed = new Set(subjectServices.extensions.installed)
    const disabledExtensions = new Set(configuration.disabledExtensions)
    const entries = configuration.entries.map(entry => {
      const failure = failures.find(item => item.root.toLowerCase() === entry.root.toLowerCase())
      /*
       * The loader reports one failure per root it refused — an unreadable directory, a folder
       * that is not an extension, a coordinate conflict, an identity mismatch — so an enabled
       * root that is not among them is loaded. Requiring the settings entry to name a coordinate
       * would report a hand-written bare path as "absent" for no reason; that state is kept for
       * the one genuinely odd case, an entry naming a coordinate the inventory does not hold.
       */
      const enabled = entry.enabled && (entry.id === undefined || !disabledExtensions.has(entry.id))
      const state = !enabled
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
        enabled,
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
      subjectCards: await describeInventoryExtensionSubjects(
        subjectServices.application.main.inventory,
        configuration.disabledExtensions,
      ),
      disabledExtensions: [...configuration.disabledExtensions],
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
      mapPreviewResourcePlanResolver = composedNow.mapPreviewResourcePlanResolver
      extensionConfiguration = composedNow.configuration
      localization = composedNow.localization
      localizer = localization.localizer
      localizationCatalogs = localization.catalogs
    })
    reloading = next.catch(() => undefined)
    await next
    return extensionReport()
  }

  ipcMain.handle('modkit.extensions.report', () => extensionReport())
  ipcMain.handle('modkit.extensions.reload', () => reloadExtensions())

  /*
   * Distribution-package manager.
   *
   * The Node manager exclusively owns managed artifacts and enablement. Settings contain only
   * manually connected folders. After a successful mutation the renderer uses the existing safe
   * reload lifecycle (close tabs, recompose from installedRoots(), reopen tabs); it never performs
   * filesystem or network work itself.
   */
  const managedId = value => {
    if (
      typeof value !== 'string' ||
      value.length > 200 ||
      !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value)
    ) {
      throw new TypeError('managed extension id must be a bounded coordinate')
    }
    return value
  }
  const managedVersion = value => {
    if (value === undefined) return undefined
    if (
      typeof value !== 'string' ||
      value.length > 100 ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(value)
    ) {
      throw new TypeError('managed extension version must be bounded semver')
    }
    return value
  }
  const managerSnapshot = () => extensionManager.snapshot()
  let managerMutation = Promise.resolve()
  const serialManagerMutation = operation => {
    const next = managerMutation.then(operation)
    managerMutation = next.catch(() => undefined)
    return next
  }

  ipcMain.handle('modkit.extensions.manager.snapshot', () => managerSnapshot())
  ipcMain.handle('modkit.extensions.manager.refresh', () =>
    serialManagerMutation(async () => {
      await extensionManager.refresh()
    }),
  )
  ipcMain.handle('modkit.extensions.manager.install', (_event, request) =>
    serialManagerMutation(async () => {
      const id = managedId(request?.id)
      await extensionManager.install(id, managedVersion(request?.version))
    }),
  )
  ipcMain.handle('modkit.extensions.manager.update', (_event, request) =>
    serialManagerMutation(async () => {
      const id = managedId(request?.id)
      await extensionManager.update(id)
    }),
  )
  ipcMain.handle('modkit.extensions.manager.remove', (_event, request) =>
    serialManagerMutation(async () => {
      const id = managedId(request?.id)
      await extensionManager.remove(id)
    }),
  )
  ipcMain.handle('modkit.extensions.manager.set-enabled', (_event, request) =>
    serialManagerMutation(async () => {
      const id = managedId(request?.id)
      if (typeof request?.enabled !== 'boolean') throw new TypeError('enabled must be boolean')
      await extensionManager.setEnabled(id, request.enabled)
    }),
  )

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
            title: localizer.text('electron.main.dialog.addExtensionFolder'),
            buttonLabel: localizer.text('electron.main.dialog.addExtension'),
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
      label: localizer.text(
        entry.kind === 'file' ? 'electron.menu.recentFile' : 'electron.menu.recentFolder',
        { path: entry.path },
      ),
      click: send('modkit.menu.open-recent', entry),
    }))

    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: localizer.text('electron.menu.file'),
          submenu: [
            {
              label: localizer.text('electron.menu.openFolder'),
              accelerator: 'CmdOrCtrl+K',
              click: send('modkit.menu.open-folder'),
            },
            {
              label: localizer.text('electron.menu.openFile'),
              accelerator: 'CmdOrCtrl+O',
              click: send('modkit.menu.open-file'),
            },
            {
              label: localizer.text('electron.main.menu.openRecent'),
              submenu:
                recentItems.length > 0
                  ? [
                      ...recentItems,
                      { type: 'separator' },
                      {
                        label: localizer.text('electron.menu.clearRecent'),
                        click: send('modkit.menu.clear-recent'),
                      },
                    ]
                  : [{ label: localizer.text('electron.menu.noRecent'), enabled: false }],
            },
            { type: 'separator' },
            {
              label: localizer.text('electron.menu.defaultApp'),
              click: send('modkit.menu.default-app'),
            },
            {
              label: localizer.text('electron.menu.settings'),
              accelerator: 'CmdOrCtrl+,',
              click: send('modkit.menu.settings'),
            },
            {
              label: localizer.text('electron.menu.extensions'),
              accelerator: 'CmdOrCtrl+Shift+X',
              click: send('modkit.menu.extensions'),
            },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        {
          label: localizer.text('electron.menu.view'),
          submenu: [
            {
              label: localizer.text('electron.menu.splitEditor'),
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
  const selfTestLateProbeIdleTimeoutMs = 180_000
  let selfTestLateProbeWatchdog
  let selfTestLateProbes = false
  const armSelfTestLateProbeWatchdog = () => {
    clearTimeout(selfTestLateProbeWatchdog)
    selfTestLateProbeWatchdog = setTimeout(() => {
      console.error(
        '[main] selftest: late probes FAILED after the extension lifecycle receipt; terminating',
      )
      console.log('[main] selftest: done')
      app.exit(1)
    }, selfTestLateProbeIdleTimeoutMs)
  }
  window.webContents.on('console-message', details => {
    const { message } = details
    console.log(`[renderer] ${message}`)
    /*
     * A self-test run has a last line, and a window that stays open after it forces every harness
     * to kill the process on a timeout — which is indistinguishable from the run hanging. Exiting
     * on the renderer's own final line makes the exit code mean something.
     */
    const selfTestMarker = String(message).trim()
    if (selfTest && selfTestMarker === 'selftest: extension lifecycle done') {
      selfTestLateProbes = true
      armSelfTestLateProbeWatchdog()
    } else if (
      selfTest &&
      selfTestLateProbes &&
      selfTestMarker.startsWith('selftest:') &&
      selfTestMarker !== 'selftest: done'
    ) {
      // This is an idle watchdog, not an absolute wall-clock ceiling. Each completed late probe
      // proves forward progress; one edit/reopen is itself allowed up to 120 seconds.
      armSelfTestLateProbeWatchdog()
    }
    if (selfTest && selfTestMarker === 'selftest: done') {
      clearTimeout(selfTestLateProbeWatchdog)
      selfTestLateProbes = false
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
