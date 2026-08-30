import { createHash, randomUUID } from 'node:crypto'
import { stat, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Diagnostic } from '@modkitx-x3/core'
import {
  artifactNamespaceSourceFromVfsMount,
  createKnowledgeCatalog,
  openSubject,
  subjectOpenSnapshot,
  type Inventory,
} from '@modkitx-x3/host'
import { discoverGameInstallations } from '@modkitx-x3/host/games'
import {
  createModkit,
  createNodeMapPreviewResourcePlanResolver,
  type ModkitOpened,
  workerBackendPolicy,
} from '@modkitx-x3/host/node'
import { coordinateMapPreviewAssetSession } from '@modkitx-x3/host/maps'
import type { AssetSession, KnowledgeCatalog } from '@modkitx-x3/sdk'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import type { ModkitMcpConfiguration } from './config.js'

export interface McpOpenedSubject {
  readonly snapshot: ModkitOpened['snapshot']
  readonly session?: AssetSession
  readonly selectionCandidates?: readonly {
    readonly candidateId: string
    readonly displayName: string
    readonly sourcePath?: string
  }[]
  select?(selectionId: string, signal?: AbortSignal): Promise<McpOpenedSubject>
  close(): Promise<void>
}

export interface McpDiscoveredSubject {
  readonly selectionId: string
  readonly gameId: string
  readonly displayName: string
  readonly openable: boolean
  readonly version?: string
  readonly buildName?: string
  readonly buildUid?: string
}

export interface McpDiscoveryResult {
  readonly snapshotId: string
  readonly complete: boolean
  readonly items: readonly McpDiscoveredSubject[]
  readonly diagnostics: readonly Diagnostic[]
}

/** Minimal host-injected seam; all authority remains in the public Modkit host. */
export interface ModkitMcpHostPort {
  readonly inventory: Inventory
  readonly knowledge: KnowledgeCatalog
  readonly roots: readonly string[]
  readonly extensionCoordinates: readonly string[]
  readonly executionProfiles: readonly string[]
  readonly supportedExtensions: readonly string[]
  discoverInstallations?(
    gameId: string | undefined,
    maxCandidates: number,
    signal?: AbortSignal,
  ): Promise<McpDiscoveryResult>
  openDiscovered?(selectionId: string, signal?: AbortSignal): Promise<McpOpenedSubject>
  open(path: string, signal?: AbortSignal, selectionId?: string): Promise<McpOpenedSubject>
  close(): Promise<void>
}

const mapPreviewLimits = Object.freeze({
  maxCandidates: 64,
  maxSubjectEntries: 4_096,
  maxSubjectPages: 64,
  maxRoots: 64,
  maxDepth: 16,
  limits: Object.freeze({
    maxDocuments: 16,
    maxRequirements: 16,
    maxDocumentBytes: 16_777_216,
    maxTotalBytes: 33_554_432,
    maxObjects: 100_000,
    maxRegions: 10_000,
    maxTerrainCells: 100_000,
    maxTerrainSamples: 100_000,
    maxDepth: 128,
    maxPageSize: 1_000,
    maxDiagnostics: 1_000,
  }),
  catalogEnrichment: Object.freeze({
    locales: Object.freeze(['enUS']),
    limits: Object.freeze({
      maxRequirements: 64,
      maxDocumentBytes: 16_777_216,
      maxTextBytes: 268_435_456,
      maxEntities: 100_000,
      maxDepth: 128,
      maxPageSize: 1_000,
    }),
  }),
})

const mapPreviewBudget = Object.freeze({
  maxInputBytes: 1_073_741_824n,
  maxDepth: 256,
  maxNodes: 1_048_576,
  maxScalarBytes: 268_435_456,
  maxDiagnostics: 1_000,
})

const inside = (roots: readonly string[], path: string): boolean =>
  roots.some(root => {
    const child = relative(root, path)
    return child === '' || (!child.startsWith('..') && !isAbsolute(child))
  })

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined

const nonBlank = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined

/** Read exact provider facets from the trusted inventory; this is not a second game registry. */
const installationGameIds = (inventory: Inventory): readonly string[] => {
  const ids = new Set<string>()
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const provides = recordOf(contribution.manifest?.spec)?.['provides']
      if (!Array.isArray(provides)) continue
      for (const offer of provides) {
        const row = recordOf(offer)
        if (row?.['contract'] !== 'common.game/installation-discovery' || row['major'] !== 1) {
          continue
        }
        const gameIds = recordOf(row['facet'])?.['gameIds']
        if (!Array.isArray(gameIds)) continue
        for (const gameId of gameIds) {
          const id = nonBlank(gameId)
          if (id !== undefined) ids.add(id)
        }
      }
    }
  }
  return Object.freeze([...ids].sort())
}

const discoveryBudget = Object.freeze({
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
})

const MCP_MAX_DISCOVERY_GAME_IDS = 16
const MCP_MAX_DISCOVERY_SELECTIONS = 128

const discoverySnapshot = (items: readonly McpDiscoveredSubject[]): string => {
  const hash = createHash('sha256')
  for (const item of items) {
    hash.update(
      `${item.gameId}\u0000${item.displayName}\u0000${item.version ?? ''}\u0000${item.buildUid ?? ''}\u0000${item.openable}\n`,
    )
  }
  return `installations-v1:${hash.digest('hex')}`
}

const canonicalDirectories = async (
  paths: readonly string[],
  label: string,
): Promise<readonly string[]> =>
  Object.freeze(
    await Promise.all(
      paths.map(async path => {
        const canonical = await realpath(path)
        if (!(await stat(canonical)).isDirectory()) {
          throw new TypeError(`${label} is not a directory: ${path}`)
        }
        return canonical
      }),
    ),
  )

/** Compose the production read-only host from explicit, canonical allowlists. */
export async function createHostMcpPort(
  configuration: ModkitMcpConfiguration,
  onDiagnostic?: (diagnostic: Diagnostic) => void,
): Promise<ModkitMcpHostPort> {
  const [roots, extensions] = await Promise.all([
    canonicalDirectories(configuration.roots, 'root'),
    canonicalDirectories(configuration.extensions, 'extension'),
  ])
  const modkit = await createModkit({
    extensions: [],
    userExtensions: extensions,
    roots,
    intent: 'inspect',
    policy: workerBackendPolicy({
      resourceLimits: {
        maxOldGenerationSizeMb: 2_048,
        maxYoungGenerationSizeMb: 256,
      },
      loadDeadlineMs: 120_000,
      defaultCallDeadlineMs: 120_000,
      graceMs: 5_000,
      outputCapBytes: 1_048_576,
    }),
    ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
  })
  if (modkit.extensionFailures.length > 0) {
    await modkit.close()
    throw new TypeError(
      `${modkit.extensionFailures.length} explicitly configured extension root(s) failed to load`,
    )
  }
  const knowledge = createKnowledgeCatalog(modkit.services.inventory)
  const mapPreviewResources = createNodeMapPreviewResourcePlanResolver({
    subjects: modkit.services,
  })
  const discoveredById = new Map<string, { readonly path: string }>()
  const discoveryIdByCoordinate = new Map<string, string>()
  const advertisedGameIds = installationGameIds(modkit.services.inventory)
  const port: ModkitMcpHostPort = {
    inventory: modkit.services.inventory,
    knowledge,
    roots,
    extensionCoordinates: modkit.extensionCoordinates,
    executionProfiles: modkit.services.executionProfiles,
    supportedExtensions: modkit.services.supportedExtensions,
    async discoverInstallations(
      requestedGameId: string | undefined,
      maxCandidates: number,
      signal?: AbortSignal,
    ): Promise<McpDiscoveryResult> {
      signal?.throwIfAborted()
      const matchingGameIds =
        requestedGameId === undefined
          ? advertisedGameIds
          : advertisedGameIds.includes(requestedGameId)
            ? [requestedGameId]
            : []
      const diagnostics: Diagnostic[] = []
      const items: McpDiscoveredSubject[] = []
      let selectionLimitReported = false
      const gameIds = matchingGameIds.slice(0, MCP_MAX_DISCOVERY_GAME_IDS)
      let complete =
        (requestedGameId === undefined || gameIds.length === 1) &&
        gameIds.length === matchingGameIds.length
      if (matchingGameIds.length > gameIds.length) {
        diagnostics.push({
          code: 'x3.mcp/discovery-game-ids-capped',
          message: `Installation discovery was capped at ${MCP_MAX_DISCOVERY_GAME_IDS} advertised game IDs.`,
          severity: 'warning',
        })
      }
      if (requestedGameId !== undefined && matchingGameIds.length === 0) {
        diagnostics.push({
          code: 'x3.mcp/game-installation-provider-unavailable',
          message: `No loaded installation-discovery contribution advertises ${requestedGameId}.`,
          severity: 'information',
        })
      }
      for (const gameId of gameIds) {
        signal?.throwIfAborted()
        const discovery = await discoverGameInstallations({
          services: modkit.services,
          gameId,
          maxCandidates,
          grant: {
            id: `modkit-mcp-game-installation-discovery:${gameId}`,
            classes:
              process.platform === 'win32'
                ? ['filesystem-read', 'process-launch']
                : ['filesystem-read'],
          },
          budgets: discoveryBudget,
          ...(signal === undefined ? {} : { signal }),
        })
        diagnostics.push(...discovery.diagnostics)
        if (discovery.state !== 'discovered') {
          complete = false
          continue
        }
        complete &&= discovery.result.complete
        diagnostics.push(
          ...discovery.result.diagnostics.map(item => ({
            code: item.code,
            message: item.message,
            severity: item.severity,
          })),
        )
        for (const installation of discovery.result.installations) {
          signal?.throwIfAborted()
          let canonical: string
          try {
            canonical = await realpath(installation.installPath)
          } catch {
            complete = false
            diagnostics.push({
              code: 'x3.mcp/discovered-installation-stale',
              message: `A verified ${gameId} installation disappeared before it could be selected.`,
              severity: 'warning',
            })
            continue
          }
          const coordinate = `${gameId}\u0000${installation.normalizedPath}`
          let selectionId = discoveryIdByCoordinate.get(coordinate)
          if (selectionId === undefined) {
            if (discoveredById.size >= MCP_MAX_DISCOVERY_SELECTIONS) {
              complete = false
              if (!selectionLimitReported) {
                selectionLimitReported = true
                diagnostics.push({
                  code: 'x3.mcp/discovery-selection-limit',
                  message: `The process-local discovery selection limit (${MCP_MAX_DISCOVERY_SELECTIONS}) was reached.`,
                  severity: 'warning',
                })
              }
              continue
            }
            selectionId = randomUUID()
            discoveryIdByCoordinate.set(coordinate, selectionId)
          }
          discoveredById.set(selectionId, { path: canonical })
          items.push(
            Object.freeze({
              selectionId,
              gameId,
              displayName: installation.displayName,
              openable: inside(roots, canonical),
              ...(installation.version === undefined ? {} : { version: installation.version }),
              ...(installation.buildName === undefined
                ? {}
                : { buildName: installation.buildName }),
              ...(installation.buildUid === undefined ? {} : { buildUid: installation.buildUid }),
            }),
          )
        }
      }
      const boundedItems = Object.freeze(items.slice(0, 64))
      if (items.length > boundedItems.length) {
        complete = false
        diagnostics.push({
          code: 'x3.mcp/discovered-installations-capped',
          message: 'Installation discovery was capped at 64 selectable results.',
          severity: 'warning',
        })
      }
      return Object.freeze({
        snapshotId: discoverySnapshot(boundedItems),
        complete,
        items: boundedItems,
        diagnostics: Object.freeze(diagnostics),
      })
    },
    async openDiscovered(selectionId: string, signal?: AbortSignal): Promise<McpOpenedSubject> {
      const selection = discoveredById.get(selectionId)
      if (selection === undefined) {
        throw new RangeError(
          'installation selection is unknown, stale or belongs to another MCP process',
        )
      }
      // The opaque selection removes path copying, but never widens the configured subject roots.
      return port.open(selection.path, signal)
    },
    async open(
      path: string,
      signal?: AbortSignal,
      selectionId?: string,
    ): Promise<McpOpenedSubject> {
      signal?.throwIfAborted()
      if (!isAbsolute(path)) throw new TypeError('subject path must be absolute')
      const lexical = resolve(path)
      if (!inside(roots, lexical)) throw new TypeError('subject path is outside configured roots')
      const canonical = await realpath(lexical)
      signal?.throwIfAborted()
      if (!inside(roots, canonical)) throw new TypeError('subject path is outside configured roots')
      const canonicalStat = await stat(canonical)
      const opened = canonicalStat.isDirectory()
        ? await (async (): Promise<McpOpenedSubject> => {
            const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
            const mount = await vfs.openMount(pathToFileURL(canonical).href)
            const result = await openSubject({
              inventory: modkit.services.inventory,
              source: artifactNamespaceSourceFromVfsMount(mount),
              path: basename(canonical),
              intent: 'inspect',
              target: modkit.services.target,
              grant: { id: `modkit-mcp-directory:${randomUUID()}`, classes: ['read-source'] },
              budget: mapPreviewBudget,
              executionBackends: modkit.services.executionBackends,
              ...(modkit.services.serviceDefinitions === undefined
                ? {}
                : { serviceDefinitions: modkit.services.serviceDefinitions }),
              ...(signal === undefined ? {} : { signal }),
            })
            const snapshot = subjectOpenSnapshot({
              result,
              sessionId: randomUUID,
              diagnostics: result.diagnostics,
            })
            if (result.state !== 'opened') {
              await vfs.dispose()
              return Object.freeze({ snapshot, close: async () => undefined })
            }
            const session = result.session
            let closed = false
            return Object.freeze({
              snapshot,
              session,
              async close(): Promise<void> {
                if (closed) return
                closed = true
                await session.dispose()
                await vfs.dispose()
              },
            })
          })()
        : await modkit.open(canonical, signal)
      if (opened.snapshot.state !== 'opened' || opened.session === undefined) return opened
      const originalSession = opened.session
      const coordinatePreview = (selectionId?: string, requestSignal = signal) =>
        coordinateMapPreviewAssetSession({
          services: modkit.services,
          grant: {
            id: 'modkit-mcp-map-preview',
            classes: ['read-source', 'filesystem-read', 'process-launch'],
          },
          budgets: mapPreviewBudget,
          original: originalSession,
          resourcePlanResolver: mapPreviewResources,
          ...mapPreviewLimits,
          ...(selectionId === undefined ? {} : { selectionId }),
          ...(requestSignal === undefined ? {} : { signal: requestSignal }),
        })
      let preview = await coordinatePreview(selectionId)
      if (preview.state === 'selection-required' && preview.candidates.length === 1) {
        const onlyCandidate = preview.candidates[0]
        if (onlyCandidate !== undefined) {
          preview = await coordinatePreview(onlyCandidate.candidateId)
        }
      }
      if (preview.state !== 'opened') {
        const selectionDiagnostic: readonly Diagnostic[] =
          preview.state === 'selection-required'
            ? [
                {
                  code: 'x3.mcp/map-preview-selection-required',
                  message: `Map preview requires one of ${preview.candidates.length} candidate(s): ${preview.candidates.map(item => `${item.candidateId} (${item.sourcePath ?? item.displayName})`).join(', ')}`,
                  severity: 'information',
                },
              ]
            : []
        return Object.freeze({
          ...opened,
          ...(preview.state === 'selection-required'
            ? {
                selectionCandidates: preview.candidates,
                async select(
                  requestedSelectionId: string,
                  requestSignal?: AbortSignal,
                ): Promise<McpOpenedSubject> {
                  const selectedPreview = await coordinatePreview(
                    requestedSelectionId,
                    requestSignal,
                  )
                  if (selectedPreview.state !== 'opened') {
                    throw new TypeError(
                      `map preview selection did not open (${selectedPreview.state}): ${selectedPreview.diagnostics.map(item => item.message).join('; ')}`,
                    )
                  }
                  let closed = false
                  return Object.freeze({
                    snapshot: Object.freeze({
                      ...opened.snapshot,
                      descriptor:
                        selectedPreview.descriptor as unknown as typeof opened.snapshot.descriptor,
                      diagnostics: Object.freeze([
                        ...opened.snapshot.diagnostics,
                        ...selectedPreview.diagnostics,
                      ]),
                    }),
                    session: selectedPreview.session,
                    async close(): Promise<void> {
                      if (closed) return
                      closed = true
                      await selectedPreview.session.dispose()
                      await opened.close()
                    },
                  })
                },
              }
            : {}),
          snapshot: Object.freeze({
            ...opened.snapshot,
            diagnostics: Object.freeze([
              ...opened.snapshot.diagnostics,
              ...preview.diagnostics,
              ...selectionDiagnostic,
            ]),
          }),
        })
      }
      let closed = false
      return Object.freeze({
        snapshot: Object.freeze({
          ...opened.snapshot,
          descriptor: preview.descriptor as unknown as typeof opened.snapshot.descriptor,
          diagnostics: Object.freeze([...opened.snapshot.diagnostics, ...preview.diagnostics]),
        }),
        session: preview.session,
        async close(): Promise<void> {
          if (closed) return
          closed = true
          await preview.session.dispose()
          await opened.close()
        },
      })
    },
    async close(): Promise<void> {
      discoveredById.clear()
      discoveryIdByCoordinate.clear()
      await modkit.close()
    },
  }
  return Object.freeze(port)
}
