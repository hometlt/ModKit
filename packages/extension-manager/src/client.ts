import {
  compareCatalogVersions,
  isRemoteCatalogUri,
  parseExtensionCatalog,
  snapshotExtensionPresentation,
} from './catalog.js'
import { createGameSupportPlan, gameSupportPlansEqual } from './game-support.js'
import { ExtensionManagerError } from './schema.js'
import type {
  AcquiredExtensionArtifact,
  ArtifactAcquirer,
  ArtifactStore,
  CatalogSource,
  CreateExtensionManagerClientOptions,
  EnablementStore,
  ExtensionCatalogCandidate,
  ExtensionCatalogVersion,
  ExtensionManagerSnapshot,
  ExtensionRegistryCatalog,
  GameSupportAction,
  GameSupportErrorRecord,
  GameSupportExtensionManagerClient,
  GameSupportRollbackRecord,
  InstalledExtensionRecord,
} from './public-types.js'

interface UnknownRecord extends Record<string, unknown> {
  catalog?: unknown
  signatureVerified?: unknown
  source?: unknown
  id?: unknown
  version?: unknown
  roots?: unknown
  presentation?: unknown
  enabled?: unknown
  artifact?: unknown
  integrity?: unknown
  code?: unknown
  game?: unknown
  catalogSource?: unknown
  artifactAcquirer?: unknown
  artifactStore?: unknown
  enablementStore?: unknown
  channels?: unknown
}

interface CatalogEnvelope {
  readonly catalog: ExtensionRegistryCatalog
  readonly source: string
  readonly signatureVerified: boolean
}

const ALL_CHANNELS = Object.freeze(['stable', 'preview', 'development'])
const SHA256_INTEGRITY = /^sha256:[0-9a-f]{64}$/u

function record(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>> = {},
): never {
  throw new ExtensionManagerError(code, message, context)
}

function requirePort<T extends object>(port: unknown, name: string, methods: readonly string[]): T {
  if (!record(port)) fail('extension-manager/port-invalid', `${name} must be an object`, { name })
  for (const method of methods) {
    if (typeof port[method] !== 'function') {
      fail('extension-manager/port-invalid', `${name}.${method} must be a function`, {
        name,
        method,
      })
    }
  }
  return port as T
}

function catalogEnvelope(value: unknown, label: string): CatalogEnvelope | undefined {
  if (value === undefined) return undefined
  if (record(value) && Object.hasOwn(value, 'catalog')) {
    if (value.signatureVerified !== undefined && typeof value.signatureVerified !== 'boolean') {
      fail('extension-manager/catalog-source-invalid', `${label}.signatureVerified must be boolean`)
    }
    return Object.freeze({
      catalog: parseExtensionCatalog(value.catalog),
      source: typeof value.source === 'string' ? value.source : label,
      signatureVerified: value.signatureVerified === true,
    })
  }
  return Object.freeze({
    catalog: parseExtensionCatalog(value),
    source: label,
    signatureVerified: false,
  })
}

function publisherFrom(id: string): string {
  const slash = id.indexOf('/')
  return slash < 1 ? 'unknown' : id.slice(0, slash)
}

function selectedVersion(
  item: ExtensionRegistryCatalog['packages'][number],
  channels: ReadonlySet<ExtensionCatalogVersion['channel']>,
  requested?: string,
): ExtensionCatalogVersion | undefined {
  if (requested !== undefined) {
    return item.versions.find(version => version.version === requested)
  }
  return item.versions
    .filter(version => channels.has(version.channel))
    .sort((left, right) => compareCatalogVersions(left.version, right.version))
    .at(-1)
}

function sourceWithCatalogBase(
  source: ExtensionCatalogVersion['source'],
  catalogSource: string,
): ExtensionCatalogVersion['source'] {
  let uri = source.uri
  try {
    const catalogUrl = new URL(catalogSource)
    if (catalogUrl.protocol === 'http:' || catalogUrl.protocol === 'https:') {
      uri = new URL(uri, catalogUrl).href
    }
  } catch {
    // A local path or adapter label is not a network base and leaves relative artifacts local.
  }
  return Object.freeze({ ...source, uri })
}

function isHttpTransport(uri: string): boolean {
  try {
    const protocol = new URL(uri).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function candidateOf(
  state: CatalogEnvelope,
  item: ExtensionRegistryCatalog['packages'][number],
  channels: ReadonlySet<ExtensionCatalogVersion['channel']>,
  requested?: string,
): ExtensionCatalogCandidate | undefined {
  const version = selectedVersion(item, channels, requested)
  if (version === undefined) return undefined
  const source = sourceWithCatalogBase(version.source, state.source)
  const remote = isRemoteCatalogUri(source.uri)
  const catalogRemote = isRemoteCatalogUri(state.source)
  const catalogSigned = state.catalog.signature !== undefined && state.signatureVerified
  const remoteCatalogTransportAllowed = !catalogRemote || isHttpTransport(source.uri)
  const trusted =
    remoteCatalogTransportAllowed &&
    (!catalogRemote || catalogSigned) &&
    ((!catalogRemote && !remote && source.trust.mode === 'local-user') ||
      (source.trust.mode === 'signed' &&
        catalogSigned &&
        (!(catalogRemote || remote) || SHA256_INTEGRITY.test(source.integrity ?? ''))))
  return Object.freeze({
    id: item.id,
    displayName: item.displayName,
    publisher: item.publisher,
    version: version.version,
    channel: version.channel,
    summary: item.summary,
    ...(item.presentation === undefined ? {} : { presentation: item.presentation }),
    extensions: version.extensions,
    source,
    catalogId: state.catalog.registryId,
    catalogSource: state.source,
    catalogSignature: state.catalog.signature,
    signatureVerified: state.signatureVerified,
    remote,
    trusted,
  })
}

function candidatesOf(
  state: CatalogEnvelope | undefined,
  channels: ReadonlySet<ExtensionCatalogVersion['channel']>,
): readonly ExtensionCatalogCandidate[] {
  if (state === undefined) return Object.freeze([])
  return Object.freeze(
    state.catalog.packages
      .map(item => candidateOf(state, item, channels))
      .filter(candidate => candidate !== undefined),
  )
}

function installedRecords(value: unknown): readonly InstalledExtensionRecord[] {
  if (!Array.isArray(value)) {
    fail('extension-manager/artifact-store-invalid', 'ArtifactStore.list() must return an array')
  }
  const ids = new Set<string>()
  return Object.freeze(
    value.map((entry: unknown, index: number) => {
      if (
        !record(entry) ||
        typeof entry.id !== 'string' ||
        typeof entry.version !== 'string' ||
        !Array.isArray(entry.roots) ||
        entry.roots.length === 0
      ) {
        fail(
          'extension-manager/artifact-store-invalid',
          `ArtifactStore.list()[${index}] must contain id, version and roots`,
        )
      }
      const rootIds = new Set<string>()
      entry.roots.forEach((root: unknown, rootIndex: number) => {
        if (
          !record(root) ||
          !Object.hasOwn(root, 'root') ||
          typeof root['expectedId'] !== 'string'
        ) {
          fail(
            'extension-manager/artifact-store-invalid',
            `ArtifactStore.list()[${index}].roots[${rootIndex}] must contain root and expectedId`,
          )
        }
        if (rootIds.has(root['expectedId'])) {
          fail(
            'extension-manager/artifact-store-invalid',
            `ArtifactStore.list()[${index}] contains duplicate root «${root['expectedId']}»`,
          )
        }
        rootIds.add(root['expectedId'])
      })
      if (ids.has(entry.id)) {
        fail(
          'extension-manager/artifact-store-invalid',
          `ArtifactStore.list() contains duplicate id «${entry.id}»`,
        )
      }
      ids.add(entry.id)
      const presentation =
        entry.presentation === undefined
          ? undefined
          : snapshotExtensionPresentation(
              entry.presentation,
              `ArtifactStore.list()[${index}].presentation`,
            )
      return Object.freeze({
        ...(entry as InstalledExtensionRecord),
        ...(presentation === undefined ? {} : { presentation }),
      })
    }),
  )
}

function enablementRecords(value: unknown): ReadonlyMap<string, boolean> {
  if (!Array.isArray(value)) {
    fail(
      'extension-manager/enablement-store-invalid',
      'EnablementStore.list() must return an array',
    )
  }
  const enabled = new Map<string, boolean>()
  value.forEach((entry: unknown, index: number) => {
    if (!record(entry) || typeof entry.id !== 'string' || typeof entry.enabled !== 'boolean') {
      fail(
        'extension-manager/enablement-store-invalid',
        `EnablementStore.list()[${index}] must contain id and enabled`,
      )
    }
    if (enabled.has(entry.id)) {
      fail(
        'extension-manager/enablement-store-invalid',
        `EnablementStore.list() contains duplicate id «${entry.id}»`,
      )
    }
    enabled.set(entry.id, entry.enabled)
  })
  return enabled
}

function assertInstallable(candidate: ExtensionCatalogCandidate): void {
  if (!candidate.trusted) {
    fail(
      'extension-manager/artifact-untrusted',
      `extension «${candidate.id}» is not signed by a trusted catalog`,
      { id: candidate.id, source: candidate.source.uri },
    )
  }
  if (candidate.remote) {
    if (
      candidate.source.trust.mode !== 'signed' ||
      typeof candidate.source.integrity !== 'string' ||
      !candidate.signatureVerified ||
      candidate.catalogSignature === undefined
    ) {
      fail(
        'extension-manager/remote-artifact-refused',
        `remote extension «${candidate.id}» requires a verified signature and sha256 integrity`,
        { id: candidate.id, source: candidate.source.uri },
      )
    }
  }
}

function validateAcquired(
  candidate: ExtensionCatalogCandidate,
  acquired: unknown,
): AcquiredExtensionArtifact {
  if (!record(acquired) || !Object.hasOwn(acquired, 'artifact')) {
    fail(
      'extension-manager/acquirer-invalid',
      'ArtifactAcquirer.acquire() must return an artifact record',
      { id: candidate.id },
    )
  }
  const expected = candidate.source.integrity
  if (expected !== undefined && acquired.integrity !== expected) {
    fail(
      'extension-manager/integrity-mismatch',
      `artifact for «${candidate.id}» does not match ${expected}`,
      { id: candidate.id, expected, actual: acquired.integrity },
    )
  }
  return acquired as AcquiredExtensionArtifact
}

function validateInstalled(candidate: ExtensionCatalogCandidate, installed: unknown): void {
  const [validated] = installedRecords([installed]) as readonly [InstalledExtensionRecord]
  if (validated.id !== candidate.id || validated.version !== candidate.version) {
    fail(
      'extension-manager/artifact-store-invalid',
      'ArtifactStore.install() returned a different extension identity',
      {
        expectedId: candidate.id,
        expectedVersion: candidate.version,
        actual: installed,
      },
    )
  }
  const expectedRoots = [...candidate.extensions].sort()
  const actualRoots = validated.roots.map(root => root.expectedId).sort()
  if (
    actualRoots.length !== expectedRoots.length ||
    actualRoots.some((id, index) => id !== expectedRoots[index])
  ) {
    fail(
      'extension-manager/artifact-store-invalid',
      'ArtifactStore.install() did not return every extension root in the catalog package',
      { id: candidate.id, expectedRoots, actualRoots },
    )
  }
}

function errorRecord(error: unknown): GameSupportErrorRecord {
  if (error instanceof Error) {
    return Object.freeze({
      name: error.name,
      message: error.message,
      ...(typeof (error as Error & { code?: unknown }).code === 'string'
        ? { code: (error as Error & { code: string }).code }
        : {}),
    })
  }
  return Object.freeze({ name: 'Error', message: String(error) })
}

/**
 * Compose the browser-safe extension manager from storage and acquisition ports.
 *
 * Construction performs no I/O. `snapshot()` reads only `CatalogSource.cached()` and the two local
 * stores; `CatalogSource.refresh()` and artifact acquisition are reached exclusively by matching
 * explicit methods below.
 */
export function createExtensionManagerClient(
  options: CreateExtensionManagerClientOptions,
): GameSupportExtensionManagerClient
export function createExtensionManagerClient(options: unknown): GameSupportExtensionManagerClient {
  if (!record(options)) fail('extension-manager/options-invalid', 'options must be an object')
  const catalogSource = requirePort<CatalogSource>(options['catalogSource'], 'CatalogSource', [
    'cached',
    'refresh',
  ])
  const artifactAcquirer = requirePort<ArtifactAcquirer>(
    options['artifactAcquirer'],
    'ArtifactAcquirer',
    ['acquire'],
  )
  const artifactStore = requirePort<ArtifactStore>(options['artifactStore'], 'ArtifactStore', [
    'list',
    'install',
    'remove',
  ])
  const enablementStore = requirePort<EnablementStore>(
    options['enablementStore'],
    'EnablementStore',
    ['list', 'setEnabled', 'remove'],
  )
  const channels = new Set<ExtensionCatalogVersion['channel']>(
    (options['channels'] ?? ALL_CHANNELS) as readonly ExtensionCatalogVersion['channel'][],
  )
  for (const channel of channels) {
    if (!ALL_CHANNELS.includes(channel)) {
      fail('extension-manager/channel-invalid', `unsupported catalog channel «${channel}»`)
    }
  }

  // Serialize every cross-store mutation. Reads remain lock-free, but fail-closed enablement keeps
  // snapshots/Host roots safe if they observe a mutation between its artifact and state writes.
  let mutationTail = Promise.resolve()
  const mutate = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const result = mutationTail.then(operation, operation)
    mutationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  let cachedStatePromise: Promise<CatalogEnvelope | undefined> | undefined
  const cachedState = (): Promise<CatalogEnvelope | undefined> => {
    cachedStatePromise ??= Promise.resolve(catalogSource.cached()).then(value =>
      catalogEnvelope(value, 'cached catalog'),
    )
    return cachedStatePromise
  }

  const catalogCandidate = async (
    id: string,
    requestedVersion?: string,
  ): Promise<ExtensionCatalogCandidate> => {
    const state = await cachedState()
    const item = state?.catalog.packages.find(candidate => candidate.id === id)
    if (item === undefined) {
      fail('extension-manager/catalog-entry-missing', `extension «${id}» is not in the catalog`, {
        id,
      })
    }
    const candidate = candidateOf(state as CatalogEnvelope, item, channels, requestedVersion)
    if (candidate === undefined) {
      fail(
        'extension-manager/catalog-version-missing',
        requestedVersion === undefined
          ? `extension «${id}» has no version in the selected channels`
          : `extension «${id}» has no version «${requestedVersion}»`,
        { id, requestedVersion },
      )
    }
    return candidate
  }

  const acquireAndInstall = async (
    candidate: ExtensionCatalogCandidate,
  ): Promise<InstalledExtensionRecord> => {
    assertInstallable(candidate)
    const acquired = validateAcquired(candidate, await artifactAcquirer.acquire(candidate))
    const installed = await artifactStore.install(
      Object.freeze({
        entry: candidate,
        artifact: acquired.artifact,
        ...(acquired.integrity === undefined ? {} : { integrity: acquired.integrity }),
      }),
    )
    validateInstalled(candidate, installed)
    return installed
  }

  const snapshotOperation = async (): Promise<ExtensionManagerSnapshot> => {
    const [state, installedValue, enablementValue] = await Promise.all([
      cachedState(),
      artifactStore.list(),
      enablementStore.list(),
    ])
    const available = candidatesOf(state, channels)
    const installed = installedRecords(installedValue)
    const enablement = enablementRecords(enablementValue)
    const availableById = new Map(available.map(entry => [entry.id, entry]))
    const installedById = new Map(installed.map(entry => [entry.id, entry]))
    const ids = [...new Set([...availableById.keys(), ...installedById.keys()])].sort()
    return Object.freeze({
      entries: Object.freeze(
        ids.map((id): ExtensionManagerSnapshot['entries'][number] => {
          const offered = availableById.get(id)
          const present = installedById.get(id)
          const availableVersion = offered?.version ?? present?.version ?? 'unknown'
          return Object.freeze({
            id,
            displayName: offered?.displayName ?? present?.displayName ?? id,
            publisher: offered?.publisher ?? present?.publisher ?? publisherFrom(id),
            availableVersion,
            ...(present === undefined ? {} : { installedVersion: present.version }),
            enabled:
              present !== undefined &&
              (enablement.get(id) ?? (typeof present.enabled === 'boolean' && present.enabled)),
            updateAvailable:
              present !== undefined &&
              offered !== undefined &&
              compareCatalogVersions(offered.version, present.version) > 0,
            source: offered?.source.uri ?? present?.source ?? 'local',
            trusted: offered?.trusted ?? present?.trusted ?? false,
            ...(offered?.presentation === undefined && present?.presentation === undefined
              ? {}
              : { presentation: offered?.presentation ?? present?.presentation }),
          })
        }),
      ),
    })
  }

  const installOperation = async (id: string, version?: string): Promise<void> => {
    const installed = installedRecords(await artifactStore.list()).find(entry => entry.id === id)
    if (installed !== undefined) {
      fail(
        'extension-manager/artifact-already-installed',
        `extension «${id}» is already installed`,
        { id, version: installed.version },
      )
    }
    const candidate = await catalogCandidate(id, version)
    // Disable first so a store commit followed by validation/enablement failure can never expose
    // partial roots to a Host. Atomic adapters leave this false record in place on later failure.
    await enablementStore.setEnabled(id, false)
    try {
      await acquireAndInstall(candidate)
      await enablementStore.setEnabled(id, true)
    } catch (error) {
      // A fresh install has no prior artifact to preserve, so compensating removal is safe. This
      // covers both a post-store validation failure and a final enablement write failure.
      let artifactError
      let enablementError
      try {
        await artifactStore.remove(id)
      } catch (cause) {
        artifactError = cause
      }
      try {
        // Reassert fail-closed state in case a custom port committed true before throwing.
        await enablementStore.setEnabled(id, false)
        if (artifactError === undefined) await enablementStore.remove(id)
      } catch (cause) {
        enablementError = cause
      }
      if (artifactError !== undefined || enablementError !== undefined) {
        fail(
          'extension-manager/install-compensation-failed',
          `extension «${id}» failed installation and could not be removed`,
          { id, error, artifactError, enablementError },
        )
      }
      throw error
    }
  }

  const updateOperation = async (id: string): Promise<void> => {
    const installed = installedRecords(await artifactStore.list()).find(entry => entry.id === id)
    if (installed === undefined) {
      fail('extension-manager/artifact-not-installed', `extension «${id}» is not installed`, {
        id,
      })
    }
    const candidate = await catalogCandidate(id)
    if (compareCatalogVersions(candidate.version, installed.version) <= 0) return
    const wasEnabled = enablementRecords(await enablementStore.list()).get(id) === true
    await enablementStore.setEnabled(id, false)
    await acquireAndInstall(candidate)
    if (wasEnabled) await enablementStore.setEnabled(id, true)
  }

  const removeOperation = async (id: string): Promise<void> => {
    await artifactStore.remove(id)
    await enablementStore.remove(id)
  }

  const setEnabledOperation = async (id: string, enabled: boolean): Promise<void> => {
    if (typeof enabled !== 'boolean') {
      fail('extension-manager/enablement-invalid', 'enabled must be boolean', { id, enabled })
    }
    const installed = installedRecords(await artifactStore.list()).some(entry => entry.id === id)
    if (!installed) {
      fail('extension-manager/artifact-not-installed', `extension «${id}» is not installed`, {
        id,
      })
    }
    await enablementStore.setEnabled(id, enabled)
  }

  return Object.freeze({
    snapshot: snapshotOperation,

    async planGameSupport(gameId: string) {
      return createGameSupportPlan(await snapshotOperation(), gameId)
    },

    refresh() {
      return mutate(async () => {
        const refreshed = catalogEnvelope(await catalogSource.refresh(), 'refreshed catalog')
        if (refreshed === undefined) {
          fail(
            'extension-manager/catalog-refresh-empty',
            'CatalogSource.refresh() returned no catalog',
          )
        }
        cachedStatePromise = Promise.resolve(refreshed)
      })
    },

    install(id: string, version?: string) {
      return mutate(() => installOperation(id, version))
    },

    update(id: string) {
      return mutate(() => updateOperation(id))
    },

    remove(id: string) {
      return mutate(() => removeOperation(id))
    },

    setEnabled(id: string, enabled: boolean) {
      return mutate(() => setEnabledOperation(id, enabled))
    },

    applyGameSupport(plan: Parameters<GameSupportExtensionManagerClient['applyGameSupport']>[0]) {
      return mutate(async () => {
        const gameId = record(plan) && record(plan.game) ? plan.game.id : undefined
        const current = createGameSupportPlan(await snapshotOperation(), gameId as string)
        if (!gameSupportPlansEqual(plan, current)) {
          fail(
            'extension-manager/game-support-plan-stale',
            'game support plan no longer matches the cached catalog and installed state',
            { gameId },
          )
        }
        if (!current.ready) {
          fail(
            'extension-manager/game-support-plan-blocked',
            'game support plan contains untrusted package actions',
            { gameId, blocked: current.blocked },
          )
        }

        const beforeEnablement = enablementRecords(await enablementStore.list())
        const completed: GameSupportAction[] = []
        try {
          for (const action of current.actions) {
            if (action.kind === 'install') {
              await installOperation(action.packageId, action.version)
            } else if (action.kind === 'enable') {
              await setEnabledOperation(action.packageId, true)
            } else {
              await updateOperation(action.packageId)
            }
            completed.push(action)
          }
          return Object.freeze({
            schemaVersion: 1,
            game: current.game,
            status: 'applied',
            applied: Object.freeze(completed.map(action => Object.freeze({ ...action }))),
            rollback: Object.freeze([]),
          })
        } catch (error) {
          const rollback: GameSupportRollbackRecord[] = []
          let partial = completed.some(action => action.reversible === false)
          const failedAction = current.actions[completed.length]
          if (failedAction?.reversible === false) partial = true

          for (const action of completed.toReversed()) {
            if (!action.reversible) {
              rollback.push(
                Object.freeze({
                  packageId: action.packageId,
                  kind: action.kind,
                  status: 'not-reversible',
                }),
              )
              continue
            }
            try {
              if (action.kind === 'install') {
                await removeOperation(action.packageId)
              } else if (beforeEnablement.has(action.packageId)) {
                await enablementStore.setEnabled(
                  action.packageId,
                  beforeEnablement.get(action.packageId) as boolean,
                )
              } else {
                await enablementStore.remove(action.packageId)
              }
              rollback.push(
                Object.freeze({
                  packageId: action.packageId,
                  kind: action.kind,
                  status: 'rolled-back',
                }),
              )
            } catch (rollbackError) {
              partial = true
              rollback.push(
                Object.freeze({
                  packageId: action.packageId,
                  kind: action.kind,
                  status: 'rollback-failed',
                  error: errorRecord(rollbackError),
                }),
              )
            }
          }

          return Object.freeze({
            schemaVersion: 1,
            game: current.game,
            status: partial ? 'partial' : 'rolled-back',
            applied: Object.freeze(completed.map(action => Object.freeze({ ...action }))),
            failed:
              failedAction === undefined
                ? Object.freeze({ error: errorRecord(error) })
                : Object.freeze({ ...failedAction, error: errorRecord(error) }),
            rollback: Object.freeze(rollback),
          })
        }
      })
    },
  })
}
