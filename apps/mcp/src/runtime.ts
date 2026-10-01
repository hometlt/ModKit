import { OutputArtifacts, OutputArtifactError, OUTPUT_ARTIFACT_POLICY } from './output-artifacts.js'
import { randomUUID } from 'node:crypto'
import { ModkitError } from '@modkit/core'
import { describeInventoryContributions, summarizeEditPlan } from '@modkit/host'
import type {
  AssetEditPlan,
  CommitReceipt,
  KnowledgeResolveQuery,
  KnowledgeSearchQuery,
  JsonValue,
  Lease,
  Page,
  PageRequest,
  PreparedCommit,
  RelationGraphEdge,
  RelationGraphNode,
  SelectableSubject,
  SubjectCalculation,
  SubjectCalculationsSource,
  SubjectFact,
  SubjectFactGroup,
  SubjectFactsSource,
  SubjectSelectorSource,
} from '@modkit/sdk'
import { relationGraphNeighbourhood, type RelationGraphScan } from '@modkit/sdk'
import {
  MAP_LAYER_READ_OPERATION,
  WORLD_SCENE_SOURCE_CONTRACT,
  type CandidateWorldSceneSource,
  type MapLayerGrid,
  type WorldSceneSource,
} from '@modkit/sdk/maps'
import { encodePng, greyGridToPng } from '@modkit/codec-kit/raster'
import { createWorldWebGlPlan, renderWorldTopDown } from '@modkit/scene/world'
import {
  WORLD_VIEWER_MAX_ITEMS_PER_LAYER,
  WORLD_VIEWER_MAX_LAYERS,
  inspectCandidateWorld,
} from '@modkit/ui/world'
import type {
  McpLanguageRequest,
  McpLanguageSession,
  McpLanguageSessionContext,
  McpLanguageSessionFeatureRequest,
  McpLanguageSessionOpenRequest,
  McpLanguageSessionUpdateRequest,
  McpOpenedSubject,
  McpResolvedChange,
  McpResolvedDataWorkspace,
  McpResolvedWorkspaceRequest,
  ModkitMcpHostPort,
} from './host-port.js'
import {
  MCP_MAX_CURSOR_LENGTH,
  MCP_MAX_OPEN_HANDLES,
  MCP_MAX_WORLD_PAGE_ITEMS,
  boundedJson,
  createCursorSecret,
  envelope,
  fingerprint,
  makeOffsetCursor,
  makeSourceCursor,
  mcpImage,
  readOffsetCursor,
  readSourceCursor,
  type CursorSecret,
  type McpCompleteness,
  type McpEnvelope,
  type McpImage,
} from './protocol.js'

const MCP_MAX_PROGRESS_EVENTS = 50
const MCP_MAX_EDIT_PLANS = 64
const MCP_EDIT_PLAN_TTL_MS = 15 * 60 * 1_000
const MCP_MAX_LANGUAGE_SESSIONS = 32

export class McpOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * A `map.layer-read` grid as a grey 8-bit PNG for the client to look at, black to white over the
 * grid's lowest to highest sample. The numbers themselves stay in the JSON.
 */
async function renderLayerGrid(grid: MapLayerGrid, signal: AbortSignal) {
  if (!Array.isArray(grid.values) || grid.values.length === 0 || grid.values.length !== grid.width * grid.height)
    throw new McpOperationError('x3.mcp/render-unsupported', 'The operation did not return a layer grid.')
  let black = Infinity
  let white = -Infinity
  for (const value of grid.values) {
    black = Math.min(black, value)
    white = Math.max(white, value)
  }
  const span = white - black
  const values = grid.values.map(value => (span === 0 ? 0 : Math.round(((value - black) * 255) / span)))
  const image = mcpImage(await greyGridToPng({ width: grid.width, height: grid.height, values }, 255, signal))
  if (image === undefined)
    throw new McpOperationError('x3.mcp/render-too-large', 'The drawn layer exceeds the MCP image limit.')
  return { image, legend: { kind: 'grey', blackSample: black, whiteSample: white } }
}

interface HandleEntry {
  readonly id: string
  opened: McpOpenedSubject
  readonly controller: AbortController
  readonly pending: Set<Promise<unknown>>
}

interface EntityHandleEntry {
  readonly id: string
  readonly parentId: string
  readonly subjectId: string
  readonly snapshotId: string
  readonly selector: Lease<SubjectSelectorSource>
  readonly facts: Lease<SubjectFactsSource>
  readonly calculations: Lease<SubjectCalculationsSource>
  readonly controller: AbortController
  readonly pending: Set<Promise<unknown>>
}

/** Host-owned commit authority behind a retained plan: a subject's or a resolved workspace's. */
type McpEditingAuthority = Pick<
  NonNullable<McpOpenedSubject['editing']>,
  'coordinator' | 'grantSnapshot' | 'releasePlan'
>

interface EditPlanEntry {
  readonly id: string
  readonly handleId: string
  readonly editing: McpEditingAuthority
  readonly operationId: string
  readonly plan: AssetEditPlan
  readonly expiresAt: number
  prepared: PreparedCommit | undefined
}

interface EditHistoryEntry {
  readonly handleId: string
  readonly editing: McpEditingAuthority
  receipt: CommitReceipt
}

export interface SubjectsQuery {
  readonly cursor?: string
  readonly limit: number
  readonly kind?: string
  readonly type?: string
  readonly text?: string
}

export interface ExactSubjectsQuery {
  readonly cursor?: string
  readonly limit: number
  readonly subjectId?: string
  readonly label?: string
  readonly kind?: string
  readonly type?: string
}

export type FactsQuery =
  | { readonly view: 'summary' }
  | { readonly view: 'groups'; readonly cursor?: string; readonly limit: number }
  | {
      readonly view: 'facts'
      readonly groupId: string
      readonly cursor?: string
      readonly limit: number
    }
  | { readonly view: 'relations'; readonly cursor?: string; readonly limit: number }

export type GraphQuery =
  | { readonly view: 'summary' }
  | { readonly view: 'nodes'; readonly cursor?: string; readonly limit: number }
  | { readonly view: 'edges'; readonly cursor?: string; readonly limit: number }
  | {
      readonly view: 'traverse'
      readonly roots: readonly string[]
      readonly direction: 'outgoing' | 'incoming' | 'both'
      readonly depth: number
      readonly maxNodes: number
      readonly maxEdges: number
      readonly scanLimit: number
    }

export type CalculationsQuery =
  | { readonly view: 'summary' }
  | { readonly view: 'calculations'; readonly cursor?: string; readonly limit: number }

export type WorldSceneQuery =
  | { readonly view: 'info' }
  | { readonly view: 'image'; readonly maxSize: number }
  | { readonly view: 'export' }
  | {
      readonly view: 'page'
      readonly facet: 'layers' | 'objects' | 'regions'
      readonly layerId?: string
      readonly cursor?: string
      readonly limit: number
    }

const combinedSignal = (request: AbortSignal, handle: AbortSignal): AbortSignal =>
  AbortSignal.any([request, handle])

const raceAbort = async <Value>(signal: AbortSignal, run: () => Promise<Value>): Promise<Value> => {
  signal.throwIfAborted()
  return new Promise<Value>((resolve, reject) => {
    const aborted = (): void =>
      reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    signal.addEventListener('abort', aborted, { once: true })
    void run()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted))
  })
}

const hostFailure = (code: string, message: string): McpEnvelope =>
  envelope({
    snapshotId: 'mcp:error',
    completeness: 'invalid',
    diagnostics: [{ code, message, severity: 'error' }],
    data: null,
  })

export const operationFailure = (error: unknown): McpEnvelope => {
  if (error instanceof OutputArtifactError) return hostFailure(error.code, error.message)
  if (error instanceof McpOperationError) return hostFailure(error.code, error.message)
  // Host-authored refusals carry a stable code the client can act on.
  if (error instanceof ModkitError && error.code.startsWith('x3.host/')) {
    return hostFailure(error.code, error.message)
  }
  if (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return hostFailure('x3.mcp/cancelled', 'The request was cancelled.')
  }
  return hostFailure('x3.mcp/host-operation-failed', 'The host operation failed.')
}

const boundedOpaqueCursor = (
  cursor: string | undefined,
  diagnostics: unknown[],
): { readonly cursor?: string; readonly capped: boolean } => {
  if (cursor === undefined) return { capped: false }
  if (cursor.length <= MCP_MAX_CURSOR_LENGTH) return { cursor, capped: false }
  diagnostics.push({
    code: 'x3.mcp/upstream-cursor-too-large',
    message: 'The data source returned a cursor larger than the MCP adapter limit.',
    severity: 'warning',
  })
  return { capped: true }
}

const sourceCursor = (
  secret: CursorSecret,
  cursor: string | undefined,
  snapshotId: string,
  binding: string,
  diagnostics: unknown[],
): { readonly cursor?: string; readonly capped: boolean } => {
  if (cursor === undefined) return { capped: false }
  const wrapped = makeSourceCursor(secret, snapshotId, binding, cursor)
  if (wrapped !== undefined) return { cursor: wrapped, capped: false }
  diagnostics.push({
    code: 'x3.mcp/upstream-cursor-too-large',
    message: 'The data source returned a cursor larger than the MCP adapter limit.',
    severity: 'warning',
  })
  return { capped: true }
}

const pageCompleteness = (page: Page<unknown>, cursorCapped: boolean): McpCompleteness =>
  cursorCapped ? 'capped' : page.nextCursor === undefined ? 'complete' : 'partial'

const boundPageRequest = (
  secret: CursorSecret,
  query: { readonly cursor?: string; readonly limit: number },
  snapshotId: string,
  binding: string,
): PageRequest => {
  const upstream = readSourceCursor(secret, query.cursor, snapshotId, binding)
  if (upstream === null) {
    throw new McpOperationError(
      'x3.mcp/invalid-cursor',
      'The data-source cursor is invalid, stale or belongs to another query.',
    )
  }
  return { ...(upstream === undefined ? {} : { cursor: upstream }), limit: query.limit }
}

const sourceProvenance = (items: readonly unknown[]): readonly unknown[] =>
  items.flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const provenance = (item as Record<string, unknown>)['provenance']
    return Array.isArray(provenance) ? provenance : []
  })

const locatedSubject = (handle: string, item: SelectableSubject) => {
  const prefix = `${item.kind}:`
  return Object.freeze({
    ...item,
    locator: Object.freeze({
      kind: 'nested-subject' as const,
      handle,
      subjectId: item.subjectId,
    }),
    coordinate: Object.freeze({
      namespace: item.kind,
      entityId: item.subjectId.startsWith(prefix)
        ? item.subjectId.slice(prefix.length)
        : item.subjectId,
    }),
  })
}

export class ModkitMcpRuntime {
  private readonly handles = new Map<string, HandleEntry>()
  private readonly entityHandles = new Map<string, EntityHandleEntry>()
  private readonly editPlans = new Map<string, EditPlanEntry>()
  private readonly editHistory = new Map<string, EditHistoryEntry>()
  private readonly resolvedWorkspaces = new Map<string, McpResolvedDataWorkspace>()
  private readonly languageSessions = new Map<string, McpLanguageSession>()
  private languageSessionsOpening = 0
  private readonly outputs: OutputArtifacts
  private readonly cursorSecret = createCursorSecret()
  private readonly inventoryRows
  private readonly inventorySnapshotId: string

  constructor(private readonly host: ModkitMcpHostPort) {
    this.outputs = new OutputArtifacts(host.outputArtifacts === true)
    this.inventoryRows = describeInventoryContributions(host.inventory)
    this.inventorySnapshotId = `inventory-v1:${fingerprint(
      host.inventory.extensions.flatMap(extension =>
        extension.contributions.map(contribution =>
          [
            extension.manifest.publisher,
            extension.manifest.id,
            extension.manifest.version,
            contribution.path,
            contribution.record?.manifestDigest ?? '',
            contribution.record?.artifactDigest ?? '',
          ].join('\u0000'),
        ),
      ),
    )}`
  }

  inventory(cursor: string | undefined, limit: number): McpEnvelope {
    const offset = readOffsetCursor(
      this.cursorSecret,
      cursor,
      this.inventorySnapshotId,
      'inventory',
      this.inventoryRows.length,
    )
    if (offset === undefined) {
      return hostFailure('x3.mcp/invalid-cursor', 'The inventory cursor is invalid or stale.')
    }
    const end = Math.min(this.inventoryRows.length, offset + limit)
    const rows = this.inventoryRows.slice(offset, end)
    const records = new Map(
      this.host.inventory.extensions.flatMap(extension => {
        const owner = `${extension.manifest.publisher}/${extension.manifest.id}`
        return extension.contributions.map(contribution => [
          `${owner}\u0000${contribution.path}`,
          contribution.record,
        ])
      }),
    )
    const provenance = rows.flatMap(row => {
      const record = records.get(`${row.extension}\u0000${row.path}`)
      return record === undefined
        ? []
        : [
            {
              extension: row.extension,
              path: row.path,
              inventoryRecordId: record.inventoryRecordId,
              manifestDigest: record.manifestDigest,
              artifactDigest: record.artifactDigest,
            },
          ]
    })
    return envelope({
      snapshotId: this.inventorySnapshotId,
      ...(end < this.inventoryRows.length
        ? {
            nextCursor: makeOffsetCursor(
              this.cursorSecret,
              this.inventorySnapshotId,
              'inventory',
              end,
            ),
          }
        : {}),
      completeness: end < this.inventoryRows.length ? 'partial' : 'complete',
      diagnostics: this.host.inventory.diagnostics,
      provenance,
      data: { total: this.inventoryRows.length, items: rows },
    })
  }

  capabilities(): McpEnvelope {
    return envelope({
      snapshotId: this.inventorySnapshotId,
      completeness: 'complete',
      diagnostics: this.host.inventory.diagnostics,
      provenance: this.host.inventory.extensions.flatMap(extension =>
        extension.contributions.flatMap(contribution =>
          contribution.record === undefined
            ? []
            : [
                {
                  extension: `${extension.manifest.publisher}/${extension.manifest.id}`,
                  inventoryRecordId: contribution.record.inventoryRecordId,
                  artifactDigest: contribution.record.artifactDigest,
                },
              ],
        ),
      ),
      data: {
        readOnly: this.host.editsEnabled !== true && this.host.effectfulServiceOperations !== true,
        edits: {
          enabled: this.host.editsEnabled === true,
          maxRetainedPlans: MCP_MAX_EDIT_PLANS,
          planTtlMs: MCP_EDIT_PLAN_TTL_MS,
        },
        outputArtifacts: { enabled: this.host.outputArtifacts === true, ...OUTPUT_ARTIFACT_POLICY },
        roots: this.host.roots,
        extensionCoordinates: this.host.extensionCoordinates,
        executionProfiles: this.host.executionProfiles,
        supportedExtensions: this.host.supportedExtensions,
        serviceOperations: {
          available:
            this.host.serviceOperations !== undefined &&
            this.host.invokeServiceOperation !== undefined,
          permissions: this.host.serviceOperationPermissions ?? [],
          effectful: this.host.effectfulServiceOperations === true,
        },
        maxOpenHandles: MCP_MAX_OPEN_HANDLES,
        operations: [
          'inventory',
          'capabilities',
          'credentials',
          'open-subject',
          'open-selection',
          'close-subject',
          'inspect',
          'list-subjects',
          'search-subjects',
          'select-subject',
          'close-selected-subject',
          'subject-facts',
          'relation-graph',
          'subject-calculations',
          'subject-edit-target',
          'subject-isolation',
          'subject-isolation-plan',
          'invoke-readonly',
          'propose-edit',
          'prepare-edit',
          ...(this.host.editsEnabled === true ? ['commit-edit', 'undo-edit', 'redo-edit'] : []),
          'edit-history',
          'discard-edit',
          'release-output',
          ...(this.host.openResolvedDataWorkspace === undefined
            ? []
            : ['open-resolved-workspace', 'propose-resolved-edit']),
          ...(this.host.serviceOperations === undefined ? [] : ['service-operations']),
          ...(this.host.invokeServiceOperation === undefined ? [] : ['invoke-service-operation']),
          'knowledge-search',
          'knowledge-resolve',
          ...(this.host.language === undefined ? [] : ['language']),
          ...(this.host.openLanguageSession === undefined ? [] : [
            'language-session-open', 'language-session-update', 'language-session-feature', 'language-session-close',
          ]),
          ...(this.host.discoverInstallations === undefined ||
          this.host.openDiscovered === undefined
            ? []
            : ['discover-installations', 'open-discovered']),
        ],
      },
    })
  }

  async serviceOperations(
    cursor: string | undefined,
    limit: number,
    activate: boolean,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    if (this.host.serviceOperations === undefined) {
      throw new McpOperationError(
        'x3.mcp/service-operations-unavailable',
        'The host does not expose the service operation catalog.',
      )
    }
    const snapshotId = `${this.inventorySnapshotId}:service-operations:${activate ? 'active' : 'inert'}`
    let offset = 0
    if (cursor !== undefined) {
      const probe = await this.host.serviceOperations(0, 1, false, signal)
      const decoded = readOffsetCursor(
        this.cursorSecret,
        cursor,
        snapshotId,
        'service-operations',
        probe.total,
      )
      if (decoded === undefined) {
        return hostFailure(
          'x3.mcp/invalid-cursor',
          'The service operation cursor is invalid or stale.',
        )
      }
      offset = decoded
    }
    const catalog = await this.host.serviceOperations(offset, limit, activate, signal)
    return envelope({
      snapshotId,
      ...(catalog.nextOffset === undefined
        ? {}
        : {
            nextCursor: makeOffsetCursor(
              this.cursorSecret,
              snapshotId,
              'service-operations',
              catalog.nextOffset,
            ),
          }),
      completeness: catalog.complete ? 'complete' : 'partial',
      diagnostics: catalog.entries.flatMap(entry => entry.diagnostics),
      data: { total: catalog.total, items: catalog.entries },
    })
  }

  async invokeServiceOperation(
    operationId: string,
    input: JsonValue,
    signal: AbortSignal,
    retainOutput = false,
  ): Promise<McpEnvelope> {
    if (this.host.invokeServiceOperation === undefined) {
      throw new McpOperationError(
        'x3.mcp/service-operation-invoke-unavailable',
        'The host does not expose service operation invocation.',
      )
    }
    const reservation = retainOutput ? this.outputs.reserve('service-operations') : undefined
    try {
      const invocation = await this.host.invokeServiceOperation(operationId, input, signal)
      const serialized = JSON.stringify(invocation)
      const snapshotId = `service-operation-v1:${fingerprint([operationId, serialized])}`
      if (reservation !== undefined && invocation.state === 'invoked') {
        const artifact = this.outputs.commit(reservation, new TextEncoder().encode(serialized), {
          sourceRevision: this.inventorySnapshotId,
          operationId,
        })
        return envelope({
          snapshotId,
          completeness: 'complete',
          diagnostics: invocation.diagnostics,
          data: {
            state: 'retained',
            operationId,
            invocationState: invocation.state,
            outputArtifact: artifact,
          },
        })
      }
      if (reservation !== undefined) this.outputs.cancel(reservation)
      return envelope({
        snapshotId,
        completeness: 'complete',
        diagnostics: invocation.diagnostics,
        data: invocation,
      })
    } catch (error) {
      if (reservation !== undefined) this.outputs.cancel(reservation)
      throw error
    }
  }

  async discoverInstallations(
    gameId: string | undefined,
    maxCandidates: number,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    if (this.host.discoverInstallations === undefined) {
      throw new McpOperationError(
        'x3.mcp/installation-discovery-unavailable',
        'This host does not publish installation discovery.',
      )
    }
    const result = await this.host.discoverInstallations(gameId, maxCandidates, signal)
    return envelope({
      snapshotId: result.snapshotId,
      completeness: result.complete ? 'complete' : 'partial',
      diagnostics: result.diagnostics,
      data: {
        items: result.items.map(item => ({
          ...item,
          locator: { kind: 'discovered-installation', selectionId: item.selectionId },
        })),
      },
    })
  }

  async open(path: string, signal: AbortSignal, selectionId?: string): Promise<McpEnvelope> {
    return this.openFrom(() => this.host.open(path, signal, selectionId), path, signal)
  }

  async openDiscovered(selectionId: string, signal: AbortSignal): Promise<McpEnvelope> {
    const openDiscovered = this.host.openDiscovered
    if (openDiscovered === undefined) {
      throw new McpOperationError(
        'x3.mcp/installation-discovery-unavailable',
        'This host does not publish installation discovery.',
      )
    }
    return this.openFrom(
      () => openDiscovered(selectionId, signal),
      `discovery:${selectionId}`,
      signal,
    )
  }

  private async openFrom(
    resolveOpened: () => Promise<McpOpenedSubject>,
    unresolvedIdentity: string,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    signal.throwIfAborted()
    if (this.handles.size + this.entityHandles.size >= MCP_MAX_OPEN_HANDLES) {
      return hostFailure(
        'x3.mcp/handle-limit',
        `At most ${MCP_MAX_OPEN_HANDLES} subject handles may be open at once.`,
      )
    }
    const opened = await resolveOpened()
    let storedHandle: string | undefined
    try {
      signal.throwIfAborted()
      if (opened.snapshot.state !== 'opened' || opened.session === undefined) {
        return envelope({
          snapshotId: `unresolved:${fingerprint([unresolvedIdentity])}`,
          completeness: opened.snapshot.diagnostics.some(item => item.severity === 'error')
            ? 'invalid' : 'complete',
          diagnostics: opened.snapshot.diagnostics,
          data: opened.snapshot,
        })
      }
      const handle = randomUUID()
      const entry: HandleEntry = {
        id: handle,
        opened,
        controller: new AbortController(),
        pending: new Set(),
      }
      this.handles.set(handle, entry)
      storedHandle = handle
      return envelope({
        snapshotId: String(opened.session.revision),
        completeness: 'complete',
        diagnostics: opened.snapshot.diagnostics,
        provenance: [opened.snapshot.selected],
        data: {
          state: 'opened',
          handle,
          descriptor: opened.snapshot.descriptor,
          selected: opened.snapshot.selected,
          ...(opened.selectionCandidates === undefined
            ? {}
            : { selectionCandidates: opened.selectionCandidates }),
        },
      })
    } finally {
      if (opened.snapshot.state !== 'opened' || opened.session === undefined || signal.aborted) {
        if (storedHandle !== undefined) this.handles.delete(storedHandle)
        await opened.close()
      }
    }
  }

  /** Drop retained plans and history owned by one handle and release their payloads. */
  private async releaseEditState(handle: string): Promise<void> {
    const plans = [...this.editPlans.values()].filter(plan => plan.handleId === handle)
    for (const plan of plans) this.editPlans.delete(plan.id)
    await Promise.allSettled(plans.map(plan => plan.editing.releasePlan(plan.plan)))
    for (const [transactionId, history] of this.editHistory) {
      if (history.handleId === handle) this.editHistory.delete(transactionId)
    }
  }

  async close(handle: string): Promise<McpEnvelope> {
    if (this.entityHandles.has(handle)) return this.closeEntity(handle)
    const workspace = this.resolvedWorkspaces.get(handle)
    if (workspace !== undefined) {
      this.resolvedWorkspaces.delete(handle)
      await this.releaseEditState(handle)
      await workspace.release()
      return envelope({
        snapshotId: `closed:${fingerprint([handle])}`,
        completeness: 'complete',
        data: { handle, closed: true },
      })
    }
    const entry = this.handles.get(handle)
    if (entry === undefined) {
      return hostFailure(
        'x3.mcp/unknown-handle',
        'The subject handle is unknown or already closed.',
      )
    }
    this.handles.delete(handle)
    this.outputs.closeOwner(handle)
    await this.releaseEditState(handle)
    const children = [...this.entityHandles.values()]
      .filter(candidate => candidate.parentId === handle)
      .map(candidate => candidate.id)
    await Promise.allSettled(children.map(child => this.closeEntity(child)))
    entry.controller.abort()
    let forced = false
    if (entry.pending.size > 0) {
      let deadline: NodeJS.Timeout | undefined
      await Promise.race([
        Promise.allSettled([...entry.pending]).then(() => undefined),
        new Promise<void>(resolve => {
          deadline = setTimeout(() => {
            forced = entry.pending.size > 0
            resolve()
          }, 1_000)
        }),
      ])
      if (deadline !== undefined) clearTimeout(deadline)
    }
    await entry.opened.close()
    return envelope({
      snapshotId: `closed:${fingerprint([handle])}`,
      completeness: forced ? 'capped' : 'complete',
      diagnostics: forced
        ? [
            {
              code: 'x3.mcp/close-deadline',
              message:
                'The handle was force-closed after a data source did not stop on cancellation.',
              severity: 'warning',
            },
          ]
        : [],
      data: { state: 'closed', handle },
    })
  }

  async openSelection(
    handle: string,
    selectionId: string,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    return this.withHandle(handle, signal, async (entry, scopedSignal) => {
      if (entry.opened.select === undefined) {
        throw new McpOperationError(
          'x3.mcp/open-selection-unavailable',
          'This handle does not have a pending container selection.',
        )
      }
      const selected = await entry.opened.select(selectionId, scopedSignal)
      entry.opened = selected
      const snapshot = selected.snapshot
      if (snapshot.state !== 'opened' || selected.session === undefined) {
        throw new McpOperationError(
          'x3.mcp/open-selection-failed',
          'The selected container subject did not open.',
        )
      }
      return envelope({
        snapshotId: String(snapshot.descriptor.revision),
        completeness: 'complete',
        diagnostics: snapshot.diagnostics,
        provenance: [snapshot.selected],
        data: {
          state: 'opened',
          handle,
          descriptor: snapshot.descriptor,
          selected: snapshot.selected,
        },
      })
    })
  }

  async closeEntity(handle: string): Promise<McpEnvelope> {
    const entry = this.entityHandles.get(handle)
    if (entry === undefined) {
      return hostFailure(
        'x3.mcp/unknown-handle',
        'The selected-subject handle is unknown or closed.',
      )
    }
    this.entityHandles.delete(handle)
    entry.controller.abort()
    let forced = false
    if (entry.pending.size > 0) {
      let deadline: NodeJS.Timeout | undefined
      await Promise.race([
        Promise.allSettled([...entry.pending]).then(() => undefined),
        new Promise<void>(resolve => {
          deadline = setTimeout(() => {
            forced = entry.pending.size > 0
            resolve()
          }, 1_000)
        }),
      ])
      if (deadline !== undefined) clearTimeout(deadline)
    }
    const releases = await Promise.allSettled([
      entry.facts.release(),
      entry.calculations.release(),
      entry.selector.release(),
    ])
    const failed = releases.some(result => result.status === 'rejected')
    const diagnostics = []
    if (forced) {
      diagnostics.push({
        code: 'x3.mcp/close-deadline',
        message:
          'The selected-subject handle was force-closed after a data source did not stop on cancellation.',
        severity: 'warning' as const,
      })
    }
    if (failed) {
      diagnostics.push({
        code: 'x3.mcp/selected-subject-release-failed',
        message: 'A selected-subject lease did not release cleanly.',
        severity: 'warning' as const,
      })
    }
    return envelope({
      snapshotId: `closed:${fingerprint([handle])}`,
      completeness: failed ? 'invalid' : forced ? 'capped' : 'complete',
      diagnostics,
      data: { state: 'closed', handle, subjectId: entry.subjectId },
    })
  }

  private async withHandle<Value>(
    handle: string,
    requestSignal: AbortSignal,
    run: (entry: HandleEntry, signal: AbortSignal) => Promise<Value>,
  ): Promise<Value> {
    const entry = this.handles.get(handle)
    if (entry === undefined || entry.controller.signal.aborted) {
      throw new McpOperationError(
        'x3.mcp/unknown-handle',
        'The subject handle is unknown or already closed.',
      )
    }
    const signal = combinedSignal(requestSignal, entry.controller.signal)
    signal.throwIfAborted()
    const work = Promise.resolve().then(() => {
      signal.throwIfAborted()
      return run(entry, signal)
    })
    entry.pending.add(work)
    void work
      .finally(() => {
        entry.pending.delete(work)
      })
      .catch(() => undefined)
    return raceAbort(signal, () => work)
  }

  private async withEntity<Value>(
    handle: string,
    requestSignal: AbortSignal,
    run: (entry: EntityHandleEntry, signal: AbortSignal) => Promise<Value>,
  ): Promise<Value> {
    const entry = this.entityHandles.get(handle)
    if (entry === undefined || entry.controller.signal.aborted) {
      throw new McpOperationError(
        'x3.mcp/unknown-handle',
        'The selected-subject handle is unknown or already closed.',
      )
    }
    if (!this.handles.has(entry.parentId)) {
      throw new McpOperationError('x3.mcp/stale-entity-handle', 'The parent subject is closed.')
    }
    const signal = combinedSignal(requestSignal, entry.controller.signal)
    const work = Promise.resolve().then(() => run(entry, signal))
    entry.pending.add(work)
    void work.finally(() => entry.pending.delete(work)).catch(() => undefined)
    return raceAbort(signal, () => work)
  }

  async inspect(handle: string, signal: AbortSignal): Promise<McpEnvelope> {
    return this.withHandle(handle, signal, async (entry, scopedSignal) => {
      const session = entry.opened.session
      if (session === undefined)
        throw new McpOperationError('x3.mcp/no-session', 'No session exists.')
      scopedSignal.throwIfAborted()
      const descriptor = await session.descriptor()
      scopedSignal.throwIfAborted()
      const snapshot = entry.opened.snapshot
      if (snapshot.state !== 'opened') {
        throw new McpOperationError('x3.mcp/no-session', 'No opened snapshot exists.')
      }
      return envelope({
        snapshotId: String(descriptor.revision),
        completeness: 'complete',
        diagnostics: [...snapshot.diagnostics, ...descriptor.diagnostics],
        provenance: [descriptor.origin, snapshot.selected],
        data: { handle: entry.id, descriptor },
      })
    })
  }

  async subjects(handle: string, query: SubjectsQuery, signal: AbortSignal): Promise<McpEnvelope> {
    return this.withHandle(handle, signal, async (entry, scopedSignal) => {
      const session = entry.opened.session
      if (session === undefined)
        throw new McpOperationError('x3.mcp/no-session', 'No session exists.')
      const descriptor = await session.descriptor()
      if (
        !descriptor.dataSources.some(
          offer => offer.contract === 'common.view/subject-selector-source' && offer.major === 1,
        )
      ) {
        throw new McpOperationError(
          'x3.mcp/subject-selector-unavailable',
          'This subject does not publish selectable nested subjects.',
        )
      }
      const lease = (await session.dataSource(
        'common.view/subject-selector-source',
        1,
      )) as Lease<SubjectSelectorSource>
      try {
        const summary = await lease.value.summary(scopedSignal)
        const binding = `subjects:${entry.id}:${fingerprint([
          query.kind ?? '',
          query.type ?? '',
          query.text ?? '',
        ])}`
        const pageRequest = boundPageRequest(this.cursorSecret, query, summary.snapshotId, binding)
        const page = await lease.value.subjects(
          {
            ...pageRequest,
            ...(query.kind === undefined ? {} : { kind: query.kind }),
            ...(query.type === undefined ? {} : { type: query.type }),
            ...(query.text === undefined ? {} : { text: query.text }),
          },
          scopedSignal,
        )
        const diagnostics: unknown[] = []
        const cursor = sourceCursor(
          this.cursorSecret,
          page.nextCursor,
          summary.snapshotId,
          binding,
          diagnostics,
        )
        return envelope({
          snapshotId: summary.snapshotId,
          ...(cursor.cursor === undefined ? {} : { nextCursor: cursor.cursor }),
          completeness:
            summary.completeness === 'complete'
              ? pageCompleteness(page, cursor.capped)
              : summary.completeness,
          diagnostics: [
            ...diagnostics,
            ...(summary.reason === undefined
              ? []
              : [
                  {
                    code: 'x3.mcp/subject-selector-incomplete',
                    message: summary.reason,
                    severity: 'information' as const,
                  },
                ]),
          ],
          data: { total: summary.totalSubjects, items: page.items },
        })
      } finally {
        await lease.release()
      }
    })
  }

  async searchSubjects(
    handle: string,
    query: ExactSubjectsQuery,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    const exactText = query.subjectId ?? query.label
    if (exactText === undefined) {
      throw new McpOperationError(
        'x3.mcp/exact-subject-query-required',
        'Exact subject search requires subjectId, label, or both.',
      )
    }
    return this.withHandle(handle, signal, async (entry, scopedSignal) => {
      const session = entry.opened.session
      if (session === undefined)
        throw new McpOperationError('x3.mcp/no-session', 'No session exists.')
      const descriptor = await session.descriptor()
      if (
        !descriptor.dataSources.some(
          offer => offer.contract === 'common.view/subject-selector-source' && offer.major === 1,
        )
      ) {
        throw new McpOperationError(
          'x3.mcp/subject-selector-unavailable',
          'This subject does not publish selectable nested subjects.',
        )
      }
      const lease = (await session.dataSource(
        'common.view/subject-selector-source',
        1,
      )) as Lease<SubjectSelectorSource>
      try {
        const summary = await lease.value.summary(scopedSignal)
        const binding = `exact-subjects:${entry.id}:${fingerprint([
          query.subjectId ?? '',
          query.label ?? '',
          query.kind ?? '',
          query.type ?? '',
        ])}`
        const request = boundPageRequest(this.cursorSecret, query, summary.snapshotId, binding)
        const page = await lease.value.subjects(
          {
            ...request,
            ...(query.kind === undefined ? {} : { kind: query.kind }),
            ...(query.type === undefined ? {} : { type: query.type }),
            text: exactText,
          },
          scopedSignal,
        )
        const diagnostics: unknown[] = []
        const cursor = sourceCursor(
          this.cursorSecret,
          page.nextCursor,
          summary.snapshotId,
          binding,
          diagnostics,
        )
        const matches = page.items
          .filter(
            item =>
              (query.subjectId === undefined || item.subjectId === query.subjectId) &&
              (query.label === undefined || item.label === query.label),
          )
          .map(item => locatedSubject(entry.id, item))
        return envelope({
          snapshotId: summary.snapshotId,
          ...(cursor.cursor === undefined ? {} : { nextCursor: cursor.cursor }),
          completeness:
            summary.completeness === 'complete'
              ? pageCompleteness(page, cursor.capped)
              : summary.completeness,
          diagnostics: [
            ...diagnostics,
            ...(summary.reason === undefined
              ? []
              : [
                  {
                    code: 'x3.mcp/subject-selector-incomplete',
                    message: summary.reason,
                    severity: 'information' as const,
                  },
                ]),
          ],
          data: {
            catalogTotal: summary.totalSubjects,
            exact: {
              ...(query.subjectId === undefined ? {} : { subjectId: query.subjectId }),
              ...(query.label === undefined ? {} : { label: query.label }),
              ...(query.kind === undefined ? {} : { kind: query.kind }),
              ...(query.type === undefined ? {} : { type: query.type }),
            },
            items: matches,
          },
        })
      } finally {
        await lease.release()
      }
    })
  }

  async selectSubject(
    parentHandle: string,
    subjectId: string,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    return this.withHandle(parentHandle, signal, async (entry, scopedSignal) => {
      if (this.handles.size + this.entityHandles.size >= MCP_MAX_OPEN_HANDLES) {
        throw new McpOperationError(
          'x3.mcp/handle-limit',
          `At most ${MCP_MAX_OPEN_HANDLES} subject handles may be open at once.`,
        )
      }
      const session = entry.opened.session
      if (session === undefined)
        throw new McpOperationError('x3.mcp/no-session', 'No session exists.')
      const descriptor = await session.descriptor()
      if (
        !descriptor.dataSources.some(
          offer => offer.contract === 'common.view/subject-selector-source' && offer.major === 1,
        )
      ) {
        throw new McpOperationError(
          'x3.mcp/subject-selector-unavailable',
          'This subject does not publish selectable nested subjects.',
        )
      }
      let selector: Lease<SubjectSelectorSource> | undefined = (await session.dataSource(
        'common.view/subject-selector-source',
        1,
      )) as Lease<SubjectSelectorSource>
      let facts: Lease<SubjectFactsSource> | undefined
      let calculations: Lease<SubjectCalculationsSource> | undefined
      try {
        const summary = await selector.value.summary(scopedSignal)
        facts = await selector.value.openFacts(subjectId, scopedSignal)
        calculations = await selector.value.openCalculations(subjectId, scopedSignal)
        const [factsSummary, calculationsSummary] = await Promise.all([
          facts.value.summary(scopedSignal),
          calculations.value.summary(scopedSignal),
        ])
        if (
          factsSummary.snapshotId !== summary.snapshotId ||
          calculationsSummary.snapshotId !== summary.snapshotId ||
          factsSummary.identity.subjectId !== subjectId ||
          calculationsSummary.subjectId !== subjectId
        ) {
          throw new McpOperationError(
            'x3.mcp/selected-subject-mismatch',
            'The publisher returned leases for a different subject or snapshot.',
          )
        }
        const handle = randomUUID()
        this.entityHandles.set(handle, {
          id: handle,
          parentId: entry.id,
          subjectId,
          snapshotId: summary.snapshotId,
          selector,
          facts,
          calculations,
          controller: new AbortController(),
          pending: new Set(),
        })
        facts = undefined
        calculations = undefined
        selector = undefined
        return envelope({
          snapshotId: summary.snapshotId,
          completeness:
            summary.completeness === 'complete' && calculationsSummary.completeness === 'complete'
              ? 'complete'
              : 'partial',
          provenance: factsSummary.identity.origins,
          data: {
            state: 'selected',
            handle,
            parentHandle,
            subjectId,
            facts: factsSummary,
            calculations: calculationsSummary,
          },
        })
      } finally {
        await Promise.allSettled([
          ...(facts === undefined ? [] : [facts.release()]),
          ...(calculations === undefined ? [] : [calculations.release()]),
          ...(selector === undefined ? [] : [selector.release()]),
        ])
      }
    })
  }

  async facts(handle: string, query: FactsQuery, signal: AbortSignal): Promise<McpEnvelope> {
    if (this.entityHandles.has(handle)) {
      return this.withEntity(handle, signal, (entry, scopedSignal) =>
        this.readFacts(entry.id, entry.facts.value, query, scopedSignal),
      )
    }
    return this.withHandle(handle, signal, async (entry, scopedSignal) => {
      const session = entry.opened.session
      if (session === undefined)
        throw new McpOperationError('x3.mcp/no-session', 'No session exists.')
      const descriptor = await session.descriptor()
      if (
        !descriptor.dataSources.some(
          offer => offer.contract === 'common.view/subject-facts-source' && offer.major === 1,
        )
      ) {
        throw new McpOperationError(
          'x3.mcp/subject-facts-unavailable',
          'This subject does not publish subject facts.',
        )
      }
      const lease = await session.dataSource('common.view/subject-facts-source', 1)
      try {
        return await this.readFacts(entry.id, lease.value, query, scopedSignal)
      } finally {
        await lease.release()
      }
    })
  }

  /** The open subject's mod context: layers in load order, then the declared packages none holds. */
  async modContext(handle: string, signal: AbortSignal): Promise<McpEnvelope> {
    const open = this.host.modContext
    if (open === undefined) {
      throw new McpOperationError(
        'x3.mcp/content-sources-unavailable',
        'The MCP host has no configured content source to open a mod context.',
      )
    }
    return this.withHandle(handle, signal, async entry => {
      const session = entry.opened.session
      if (session === undefined) throw new McpOperationError('x3.mcp/no-session', 'No session exists.')
      const context = await open((await session.descriptor()).subjectUri)
      return envelope({
        snapshotId: context.contextId,
        completeness: context.unresolved.length === 0 ? 'complete' : 'partial',
        diagnostics: context.unresolved.map(name => ({
          code: 'x3.mcp/mod-context-unresolved',
          message: `No content source holds the declared dependency ${name}.`,
          severity: 'warning' as const,
        })),
        data: { layers: context.layers, unresolved: context.unresolved },
      })
    })
  }

  /** Declared sign-ins and keys with their status only: an MCP client never sees a secret. */
  async credentials(): Promise<McpEnvelope> {
    const items = (await this.host.credentialStatus?.()) ?? []
    return envelope({
      snapshotId: this.inventorySnapshotId,
      completeness: 'complete',
      data: { total: items.length, items: items as unknown as JsonValue },
    })
  }

  async preview(handle: string, signal: AbortSignal): Promise<McpEnvelope> {
    const facts = await this.facts(handle, { view: 'summary' }, signal)
    const summary = facts.data as {
      readonly identity?: { readonly subjectId?: string }
      readonly preview?: unknown
    }
    if (summary.preview === undefined) {
      return envelope({
        snapshotId: facts.snapshotId,
        completeness: 'invalid',
        diagnostics: [
          ...facts.diagnostics,
          {
            code: 'x3.mcp/subject-preview-unavailable',
            message: 'This subject does not publish a safe preview resource locator.',
            severity: 'information',
          },
        ],
        provenance: facts.provenance,
        data: null,
      })
    }
    return envelope({
      snapshotId: facts.snapshotId,
      completeness: facts.completeness,
      diagnostics: facts.diagnostics,
      provenance: facts.provenance,
      data: { subjectId: summary.identity?.subjectId, preview: summary.preview },
    })
  }

  private async readFacts(
    handle: string,
    source: SubjectFactsSource,
    query: FactsQuery,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    const summary = await source.summary(signal)
    if (query.view === 'summary') {
      return envelope({
        snapshotId: summary.snapshotId,
        completeness: 'complete',
        provenance: summary.identity.origins,
        data: summary,
      })
    }
    const binding = `facts:${handle}:${query.view}:${query.view === 'facts' ? query.groupId : ''}`
    const request = boundPageRequest(this.cursorSecret, query, summary.snapshotId, binding)
    let page: Page<SubjectFactGroup | SubjectFact | unknown>
    if (query.view === 'groups') page = await source.groups(request, signal)
    else if (query.view === 'facts') page = await source.facts(query.groupId, request, signal)
    else page = await source.relations(request, signal)
    const diagnostics: unknown[] = []
    const cursor = sourceCursor(
      this.cursorSecret,
      page.nextCursor,
      summary.snapshotId,
      binding,
      diagnostics,
    )
    return envelope({
      snapshotId: summary.snapshotId,
      ...(cursor.cursor === undefined ? {} : { nextCursor: cursor.cursor }),
      completeness: pageCompleteness(page, cursor.capped),
      diagnostics,
      provenance: sourceProvenance(page.items),
      data: { view: query.view, items: page.items },
    })
  }

  /**
   * The subject's map world as it publishes it: `info` (coordinate spaces, facets, and `edit` —
   * the operation and object edit kind `propose_edit` takes) or one bounded page of a facet.
   */
  async worldScene(handle: string, query: WorldSceneQuery, signal: AbortSignal): Promise<McpEnvelope> {
    return this.withHandle(handle, signal, async (entry, scopedSignal) => {
      const session = entry.opened.session
      if (session === undefined)
        throw new McpOperationError('x3.mcp/no-session', 'No session exists.')
      const descriptor = await session.descriptor()
      if (
        !descriptor.dataSources.some(
          offer => offer.contract === WORLD_SCENE_SOURCE_CONTRACT && offer.major === 1,
        )
      ) {
        throw new McpOperationError(
          'x3.mcp/world-scene-unavailable',
          'This subject does not publish a map world.',
        )
      }
      const lease = await session.dataSource(WORLD_SCENE_SOURCE_CONTRACT, 1)
      try {
        const source = lease.value as unknown as WorldSceneSource
        if (query.view === 'info') {
          const { provenance, ...info } = await source.info(scopedSignal)
          return envelope({
            snapshotId: info.snapshotId,
            completeness: info.complete ? 'complete' : 'partial',
            provenance,
            data: info,
          })
        }
        if (query.view === 'image') {
          // The world viewer's own collector and plan; models stay placeholders from above.
          const model = await inspectCandidateWorld(source, {
            maxLayers: WORLD_VIEWER_MAX_LAYERS,
            maxItemsPerLayer: WORLD_VIEWER_MAX_ITEMS_PER_LAYER,
            maxPageItems: MCP_MAX_WORLD_PAGE_ITEMS,
            modelResourceFilter: () => false,
            signal: scopedSignal,
          })
          const image = renderWorldTopDown(
            createWorldWebGlPlan({
              items: model.layers.flatMap(layer => layer.page.items),
              terrainMaterials: model.layers.flatMap(layer => layer.layer.materials ?? []),
              waterMaterials: model.layers.flatMap(layer => layer.layer.waterMaterials ?? []),
              terrainWeightRasters: model.layers.flatMap(layer => layer.layer.weightRasters ?? []),
            }),
            { maxSize: query.maxSize },
          )
          const shown = mcpImage(await encodePng(image.width, image.height, image.rgba, scopedSignal))
          if (shown === undefined)
            throw new McpOperationError('x3.mcp/render-too-large', 'The drawn world exceeds the MCP image limit.')
          const cut = model.layers
            .filter(layer => layer.page.state !== 'available' || layer.page.nextCursor !== undefined)
            .map(layer => layer.layer.layerId)
          return envelope({
            snapshotId: model.snapshotId,
            completeness: model.info.complete && cut.length === 0 ? 'complete' : 'partial',
            diagnostics:
              cut.length === 0
                ? []
                : [
                    {
                      code: 'x3.mcp/world-image-partial',
                      message: `Drawn without the whole of these layers: ${cut.join(', ')}.`,
                      severity: 'information',
                    },
                  ],
            data: { width: image.width, height: image.height, world: image.world, objects: image.objects },
            images: [shown],
          })
        }
        if (query.view === 'export') {
          // one UVW document of the world, kept as an output resource, and what the UVW lacks
          const reservation = this.outputs.reserve(entry.id)
          try {
            const { materializeWorldToUvw } = await import('@modkit/uv/world')
            const world = await materializeWorldToUvw(
              source as unknown as CandidateWorldSceneSource,
              {
                maxPageItems: MCP_MAX_WORLD_PAGE_ITEMS,
                maxTerrainItems: 4096 * 4096,
                maxOutputBytes: OUTPUT_ARTIFACT_POLICY.maxArtifactBytes,
                signal: scopedSignal,
              },
            )
            if (world.state === 'refused')
              throw new McpOperationError(
                'x3.mcp/world-uvw-refused',
                world.refusals.map(refusal => `${refusal.code}: ${refusal.message}`).join('; '),
              )
            const outputArtifact = this.outputs.commit(reservation, world.bytes, {
              sourceRevision: String(descriptor.revision),
              operationId: WORLD_SCENE_SOURCE_CONTRACT,
            })
            const whole =
              world.excludedFacetIds.length === 0 &&
              world.omittedObjects === 0 &&
              world.lostFields.length === 0
            return envelope({
              snapshotId: world.sourceSnapshotId,
              completeness: whole ? 'complete' : 'partial',
              data: {
                outputArtifact,
                artifactDigest: world.artifactDigest,
                excludedFacetIds: world.excludedFacetIds,
                omittedObjects: world.omittedObjects,
                lostFields: world.lostFields,
              },
            })
          } finally {
            this.outputs.cancel(reservation)
          }
        }
        const binding = `world:${handle}:${query.facet}:${query.layerId ?? ''}`
        const request = boundPageRequest(this.cursorSecret, query, source.snapshotId, binding)
        const page = await source.page(
          { facet: query.facet, ...(query.layerId === undefined ? {} : { layerId: query.layerId }), ...request },
          scopedSignal,
        )
        const diagnostics: unknown[] =
          page.reason === undefined
            ? []
            : [{ code: `x3.mcp/world-scene-${page.state}`, message: page.reason, severity: 'information' }]
        const cursor = sourceCursor(this.cursorSecret, page.nextCursor, page.snapshotId, binding, diagnostics)
        return envelope({
          snapshotId: page.snapshotId,
          ...(cursor.cursor === undefined ? {} : { nextCursor: cursor.cursor }),
          completeness:
            page.state === 'available' ? pageCompleteness(page as Page<unknown>, cursor.capped) : 'partial',
          diagnostics,
          data: { facet: page.facet, state: page.state, items: page.items },
        })
      } finally {
        await lease.release()
      }
    })
  }

  async graph(handle: string, query: GraphQuery, signal: AbortSignal): Promise<McpEnvelope> {
    return this.withHandle(handle, signal, async (entry, scopedSignal) => {
      const session = entry.opened.session
      if (session === undefined)
        throw new McpOperationError('x3.mcp/no-session', 'No session exists.')
      const descriptor = await session.descriptor()
      if (
        !descriptor.dataSources.some(
          offer => offer.contract === 'common.view/relation-graph-source' && offer.major === 1,
        )
      ) {
        throw new McpOperationError(
          'x3.mcp/relation-graph-unavailable',
          'This subject does not publish a relation graph.',
        )
      }
      const lease = await session.dataSource('common.view/relation-graph-source', 1)
      try {
        const summary = await lease.value.summary(scopedSignal)
        if (query.view === 'summary') {
          return envelope({
            snapshotId: summary.snapshotId,
            completeness: summary.completeness,
            diagnostics:
              summary.reason === undefined
                ? []
                : [
                    {
                      code: 'x3.mcp/relation-graph-incomplete',
                      message: summary.reason,
                      severity: 'information',
                    },
                  ],
            data: summary,
          })
        }
        if (query.view === 'traverse') {
          const walk = await relationGraphNeighbourhood(
            lease.value,
            {
              roots: query.roots,
              direction: query.direction,
              depth: query.depth,
              maxNodes: query.maxNodes,
              maxEdges: query.maxEdges,
              scanLimit: query.scanLimit,
            },
            scopedSignal,
          )
          const scanDiagnostics = (scan: RelationGraphScan) =>
            scan.invalidCursor
              ? [
                  {
                    code: 'x3.mcp/relation-graph-invalid-upstream-cursor',
                    message: 'Traversal stopped because the graph source returned an invalid cursor.',
                    severity: 'warning' as const,
                  },
                ]
              : scan.exhausted
                ? []
                : [
                    {
                      code: 'x3.mcp/relation-graph-scan-capped',
                      message: `Traversal stopped after scanning ${scan.read} items.`,
                      severity: 'warning' as const,
                    },
                  ]
          const diagnostics = [
            ...(walk.reason === undefined
              ? []
              : [
                  {
                    code: 'x3.mcp/relation-graph-incomplete',
                    message: walk.reason,
                    severity: 'information' as const,
                  },
                ]),
            ...scanDiagnostics(walk.scanned.edges),
            ...scanDiagnostics(walk.scanned.nodes),
            ...(walk.capped
              ? [
                  {
                    code: 'x3.mcp/relation-graph-traversal-capped',
                    message: 'Traversal reached its requested node or edge result limit.',
                    severity: 'warning' as const,
                  },
                ]
              : []),
          ]
          return envelope({
            snapshotId: walk.snapshotId,
            completeness: walk.completeness === 'complete' ? 'complete' : 'capped',
            diagnostics,
            data: {
              view: query.view,
              roots: query.roots,
              direction: query.direction,
              depth: query.depth,
              nodes: walk.nodes,
              edges: walk.edges,
              missingNodeIds: walk.missingNodeIds,
              scanned: { nodes: walk.scanned.nodes.read, edges: walk.scanned.edges.read },
            },
          })
        }
        const binding = `graph:${entry.id}:${query.view}`
        const request = boundPageRequest(this.cursorSecret, query, summary.snapshotId, binding)
        let page: Page<RelationGraphNode | RelationGraphEdge>
        if (query.view === 'nodes') {
          page = await lease.value.nodes(request, scopedSignal)
        } else {
          page = await lease.value.edges(request, scopedSignal)
        }
        const diagnostics: unknown[] = []
        const cursor = sourceCursor(
          this.cursorSecret,
          page.nextCursor,
          summary.snapshotId,
          binding,
          diagnostics,
        )
        return envelope({
          snapshotId: summary.snapshotId,
          ...(cursor.cursor === undefined ? {} : { nextCursor: cursor.cursor }),
          completeness:
            summary.completeness === 'complete'
              ? pageCompleteness(page, cursor.capped)
              : summary.completeness,
          diagnostics,
          data: { view: query.view, items: page.items },
        })
      } finally {
        await lease.release()
      }
    })
  }

  async calculations(
    handle: string,
    query: CalculationsQuery,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    if (this.entityHandles.has(handle)) {
      return this.withEntity(handle, signal, (entry, scopedSignal) =>
        this.readCalculations(entry.id, entry.calculations.value, query, scopedSignal),
      )
    }
    return this.withHandle(handle, signal, async (entry, scopedSignal) => {
      const session = entry.opened.session
      if (session === undefined)
        throw new McpOperationError('x3.mcp/no-session', 'No session exists.')
      const descriptor = await session.descriptor()
      if (
        !descriptor.dataSources.some(
          offer =>
            offer.contract === 'common.view/subject-calculations-source' && offer.major === 1,
        )
      ) {
        throw new McpOperationError(
          'x3.mcp/subject-calculations-unavailable',
          'This subject does not publish subject calculations.',
        )
      }
      const lease = await session.dataSource('common.view/subject-calculations-source', 1)
      try {
        return await this.readCalculations(entry.id, lease.value, query, scopedSignal)
      } finally {
        await lease.release()
      }
    })
  }

  private async readCalculations(
    handle: string,
    source: SubjectCalculationsSource,
    query: CalculationsQuery,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    const summary = await source.summary(signal)
    if (query.view === 'summary') {
      return envelope({
        snapshotId: summary.snapshotId,
        completeness: summary.completeness,
        diagnostics:
          summary.reason === undefined
            ? []
            : [
                {
                  code: 'x3.mcp/calculations-incomplete',
                  message: summary.reason,
                  severity: 'information',
                },
              ],
        data: summary,
      })
    }
    const binding = `calculations:${handle}:${query.view}`
    const page: Page<SubjectCalculation> = await source.calculations(
      boundPageRequest(this.cursorSecret, query, summary.snapshotId, binding),
      signal,
    )
    const diagnostics: unknown[] = []
    const cursor = sourceCursor(
      this.cursorSecret,
      page.nextCursor,
      summary.snapshotId,
      binding,
      diagnostics,
    )
    return envelope({
      snapshotId: summary.snapshotId,
      ...(cursor.cursor === undefined ? {} : { nextCursor: cursor.cursor }),
      completeness:
        summary.completeness === 'complete'
          ? pageCompleteness(page, cursor.capped)
          : summary.completeness,
      diagnostics,
      provenance: sourceProvenance(page.items),
      data: { view: query.view, items: page.items },
    })
  }

  async invokeReadonly(
    handle: string,
    operationId: string,
    input: unknown,
    signal: AbortSignal,
    outputOptions: {
      readonly retainOutput?: boolean
      readonly inputArtifact?: {
        readonly id: string
        readonly field: string
        readonly encoding: 'hex'
      }
      readonly render?: 'image'
    } = {},
  ): Promise<McpEnvelope> {
    const capturedInput = boundedJson(input)
    const retainOutput = outputOptions.retainOutput === true
    const requestedArtifact =
      outputOptions.inputArtifact === undefined
        ? undefined
        : Object.freeze({ ...outputOptions.inputArtifact })
    if (requestedArtifact !== undefined && requestedArtifact.encoding !== 'hex')
      throw new OutputArtifactError(
        'x3.mcp/output-artifact-encoding',
        'Only explicit hex input substitution is supported.',
      )
    return this.withHandle(handle, signal, async (entry, scopedSignal) => {
      const session = entry.opened.session
      if (session === undefined)
        throw new McpOperationError('x3.mcp/no-session', 'No session exists.')
      const reservation = retainOutput ? this.outputs.reserve(entry.id) : undefined
      let substituted: ReturnType<OutputArtifacts['input']> | undefined
      try {
        const descriptor = await session.descriptor()
        scopedSignal.throwIfAborted()
        const operation = descriptor.operations.find(candidate => candidate.id === operationId)
        if (operation === undefined) {
          throw new McpOperationError(
            'x3.mcp/operation-not-declared',
            'The exact operation ID is not declared by the current subject descriptor.',
          )
        }
        if (operation.mutatesSource) {
          throw new McpOperationError(
            'x3.mcp/mutating-operation-refused',
            'The subject declares this operation as mutating, so the read-only adapter refused it.',
          )
        }
        if (operation.state !== 'available') {
          throw new McpOperationError(
            'x3.mcp/operation-unavailable',
            `The declared read-only operation is ${operation.state}: ${operation.reason}`,
          )
        }
        if (outputOptions.render !== undefined && operation.id !== MAP_LAYER_READ_OPERATION) {
          throw new McpOperationError(
            'x3.mcp/render-unsupported',
            `render "image" draws ${MAP_LAYER_READ_OPERATION} grids only.`,
          )
        }

        const projectedInput = capturedInput
        if (projectedInput.capped) {
          throw new McpOperationError(
            'x3.mcp/operation-input-too-large',
            'The operation input exceeds the bounded JSON limits.',
          )
        }

        substituted =
          requestedArtifact === undefined
            ? undefined
            : this.outputs.input(
                entry.id,
                requestedArtifact.id,
                requestedArtifact.field,
                projectedInput.value,
              )
        const progress: unknown[] = []
        let progressCapped = false
        const result = await session
          .operations()
          .invoke(operation.handlerId, (substituted?.value ?? projectedInput.value) as JsonValue, {
            signal: scopedSignal,
            onProgress: event => {
              if (progress.length >= MCP_MAX_PROGRESS_EVENTS) {
                progressCapped = true
                return
              }
              const projected = boundedJson(event)
              progress.push(projected.value)
              progressCapped ||= projected.capped
            },
          })
        const streamLease =
          result.state === 'ok' && result.output.kind === 'stream'
            ? result.output.stream
            : undefined
        try {
          scopedSignal.throwIfAborted()

          const diagnostics: unknown[] = [...result.diagnostics]
          let resultValue: unknown = result
          const artifact =
            reservation !== undefined && result.state === 'ok' && result.output.kind === 'bytes'
              ? this.outputs.commit(reservation, result.output.value, {
                  sourceRevision: String(descriptor.revision),
                  operationId: operation.id,
                  ...(substituted === undefined ? {} : { inputArtifact: substituted.provenance }),
                })
              : undefined
          if (artifact !== undefined)
            resultValue = {
              ...result,
              output: {
                kind: 'bytes',
                byteLength: artifact.byteLength,
                sha256: artifact.sha256,
                artifactUri: artifact.uri,
              },
            }
          if (reservation !== undefined && artifact === undefined && result.state === 'ok')
            throw new OutputArtifactError(
              'x3.mcp/output-artifact-not-bytes',
              'This operation did not return a complete byte output to retain.',
            )
          let completeness: McpCompleteness = result.state === 'ok' ? 'complete' : 'invalid'
          if (streamLease !== undefined) {
            resultValue = {
              ...result,
              output: { kind: 'stream', state: 'not-materialized' },
            }
            completeness = 'capped'
            diagnostics.push({
              code: 'x3.mcp/operation-stream-not-materialized',
              message:
                'The bounded read-only adapter released the stream without materializing it.',
              severity: 'information',
            })
          }
          const projectedResult = boundedJson(resultValue)
          if (projectedResult.capped || progressCapped) {
            completeness = result.state === 'rejected' ? 'invalid' : 'capped'
            diagnostics.push({
              code: 'x3.mcp/operation-output-capped',
              message: 'The operation result or progress exceeded the bounded JSON limits.',
              severity: 'warning',
            })
          }
          const snapshot = entry.opened.snapshot
          if (snapshot.state !== 'opened') {
            throw new McpOperationError('x3.mcp/no-session', 'No opened snapshot exists.')
          }
          const images: McpImage[] = []
          const shown = result.state === 'ok' && result.output.kind === 'bytes' ? mcpImage(result.output.value) : undefined
          if (shown !== undefined) images.push(shown)
          const rendered =
            outputOptions.render === undefined || result.state !== 'ok' || result.output.kind !== 'json'
              ? undefined
              : await renderLayerGrid(result.output.value as unknown as MapLayerGrid, scopedSignal)
          if (rendered !== undefined) images.push(rendered.image)
          return envelope({
            snapshotId: String(descriptor.revision),
            completeness,
            diagnostics,
            provenance: [descriptor.origin, snapshot.selected],
            data: {
              handle: entry.id,
              operationId: operation.id,
              result: projectedResult.value,
              progress,
              ...(artifact === undefined ? {} : { outputArtifact: artifact }),
              ...(substituted === undefined ? {} : { inputArtifact: substituted.provenance }),
              ...(rendered === undefined ? {} : { render: rendered.legend }),
            },
            images,
          })
        } finally {
          await streamLease?.release()
        }
      } finally {
        substituted?.release()
        if (reservation !== undefined) this.outputs.cancel(reservation)
      }
    })
  }

  private async pruneExpiredEditPlans(): Promise<void> {
    const now = Date.now()
    const expired = [...this.editPlans.values()].filter(plan => plan.expiresAt <= now)
    for (const plan of expired) this.editPlans.delete(plan.id)
    await Promise.allSettled(expired.map(plan => plan.editing.releasePlan(plan.plan)))
  }

  private async retainedEditPlan(planHandle: string): Promise<{
    readonly plan: EditPlanEntry
    readonly editing: McpEditingAuthority
  }> {
    await this.pruneExpiredEditPlans()
    const plan = this.editPlans.get(planHandle)
    if (plan === undefined) {
      throw new McpOperationError(
        'x3.mcp/unknown-edit-plan',
        'The edit plan is unknown, expired, committed or already discarded.',
      )
    }
    if (!this.handles.has(plan.handleId) && !this.resolvedWorkspaces.has(plan.handleId)) {
      this.editPlans.delete(planHandle)
      throw new McpOperationError(
        'x3.mcp/editing-unavailable',
        'The subject editing surface for this plan is no longer open.',
      )
    }
    return { plan, editing: plan.editing }
  }

  /**
   * Ask a mutating operation what it *would* change, without changing it.
   *
   * An agent that can read a mod and not propose a change to it is half a tool, and the obvious way
   * to close that gap — letting it invoke mutating operations — is the wrong one: it puts an
   * unreviewed write into a file the moment a model misreads a request. MK3 already has the right
   * shape for this, because a codec answers a write with an edit *plan* rather than performing one.
   * So this returns the plan.
   *
   * What the caller gets is exactly what would happen: which bytes, how many, with what label and
   * what round-trip fidelity. The raw plan stays in the host and can only cross the separate
   * validate/commit policy boundary by its opaque handle.
   */
  async proposeEdit(
    handle: string,
    operationId: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    return this.withHandle(handle, signal, async (entry, scopedSignal) => {
      const session = entry.opened.session
      if (session === undefined) {
        throw new McpOperationError('x3.mcp/no-session', 'No session exists.')
      }
      const editing = entry.opened.editing
      const descriptor = await session.descriptor()
      scopedSignal.throwIfAborted()
      const operation = descriptor.operations.find(candidate => candidate.id === operationId)
      if (operation === undefined) {
        throw new McpOperationError(
          'x3.mcp/operation-not-declared',
          'The exact operation ID is not declared by the current subject descriptor.',
        )
      }
      /*
       * The mirror of `invokeReadonly`'s refusal. A read-only operation sent here would be executed
       * for its result and reported as a proposal, which is a lie about what happened.
       */
      if (!operation.mutatesSource) {
        throw new McpOperationError(
          'x3.mcp/non-mutating-operation-refused',
          'The subject declares this operation as read-only; invoke it through the read-only adapter.',
        )
      }
      if (operation.state !== 'available') {
        throw new McpOperationError(
          'x3.mcp/operation-unavailable',
          `The declared operation is ${operation.state}: ${operation.reason}`,
        )
      }

      const projectedInput = boundedJson(input)
      if (projectedInput.capped) {
        throw new McpOperationError(
          'x3.mcp/operation-input-too-large',
          'The operation input exceeds the bounded JSON limits.',
        )
      }

      const result = await session
        .operations()
        .invoke(operation.handlerId, projectedInput.value as JsonValue, { signal: scopedSignal })
      scopedSignal.throwIfAborted()

      const diagnostics: unknown[] = [...result.diagnostics]
      let completeness: McpCompleteness = result.state === 'ok' ? 'complete' : 'invalid'
      let plan: unknown
      let planHandle: string | undefined
      let planExpiresAt: number | undefined

      if (result.state === 'ok' && result.output.kind === 'edit-plan') {
        await this.pruneExpiredEditPlans()
        if (this.editPlans.size >= MCP_MAX_EDIT_PLANS) {
          throw new McpOperationError(
            'x3.mcp/edit-plan-limit',
            `At most ${MCP_MAX_EDIT_PLANS} uncommitted edit plans may be retained.`,
          )
        }
        const retainedPlan =
          editing === undefined
            ? (result.output.plan as AssetEditPlan)
            : await editing.stagePlan(editing.planFromOperation(result.output), scopedSignal)
        if (editing !== undefined) {
          planHandle = randomUUID()
          planExpiresAt = Date.now() + MCP_EDIT_PLAN_TTL_MS
          this.editPlans.set(planHandle, {
            id: planHandle,
            handleId: entry.id,
            editing,
            operationId: operation.id,
            plan: retainedPlan,
            expiresAt: planExpiresAt,
            prepared: undefined,
          })
        }
        /*
         * The plan is summarized rather than passed through. Its payloads are the replacement bytes,
         * which for a re-encoded texture is the whole file — an agent asking "what would change"
         * wants the shape of the change, and the bytes would blow the JSON bound and tell it nothing.
         */
        plan = summarizeEditPlan(retainedPlan)
        diagnostics.push({
          code: 'x3.mcp/edit-not-committed',
          message:
            planHandle === undefined
              ? 'The plan describes the change and was not applied; this host exposes no retained editing surface.'
              : 'The plan describes the change and was retained by the host. It has not been validated or committed.',
          severity: 'information',
        })
      } else if (result.state === 'ok') {
        completeness = 'invalid'
        diagnostics.push({
          code: 'x3.mcp/operation-not-an-edit-plan',
          message: `The mutating operation answered with ${result.output.kind}, not an edit plan.`,
          severity: 'error',
        })
      }

      const projectedPlan = boundedJson(plan ?? null)
      if (projectedPlan.capped) {
        completeness = 'capped'
        diagnostics.push({
          code: 'x3.mcp/operation-output-capped',
          message: 'The plan summary exceeded the bounded JSON limits.',
          severity: 'warning',
        })
      }
      const snapshot = entry.opened.snapshot
      if (snapshot.state !== 'opened') {
        throw new McpOperationError('x3.mcp/no-session', 'No opened snapshot exists.')
      }
      return envelope({
        snapshotId: String(descriptor.revision),
        completeness,
        diagnostics,
        provenance: [descriptor.origin, snapshot.selected],
        data: {
          handle: entry.id,
          operationId: operation.id,
          state: result.state,
          ...(result.state === 'rejected' ? { reason: result.reason } : {}),
          plan: projectedPlan.value,
          ...(planHandle === undefined ? {} : { planHandle }),
          ...(planExpiresAt === undefined
            ? {}
            : { expiresAt: new Date(planExpiresAt).toISOString() }),
          committed: false,
        },
      })
    })
  }

  async knowledgeSearch(query: KnowledgeSearchQuery, signal: AbortSignal): Promise<McpEnvelope> {
    const page = await this.host.knowledge.search(query, signal)
    const diagnostics: unknown[] = [...page.diagnostics]
    const cursor = boundedOpaqueCursor(page.nextCursor, diagnostics)
    return envelope({
      snapshotId: page.snapshotId,
      ...(cursor.cursor === undefined ? {} : { nextCursor: cursor.cursor }),
      completeness: cursor.capped && page.completeness !== 'invalid' ? 'capped' : page.completeness,
      diagnostics,
      provenance: page.items.map(item => item.provenance),
      data: { total: page.total, items: page.items },
    })
  }

  async knowledgeResolve(query: KnowledgeResolveQuery, signal: AbortSignal): Promise<McpEnvelope> {
    const page = await this.host.knowledge.resolve(query, signal)
    const diagnostics: unknown[] = [...page.diagnostics]
    const cursor = boundedOpaqueCursor(page.nextCursor, diagnostics)
    return envelope({
      snapshotId: page.snapshotId,
      ...(cursor.cursor === undefined ? {} : { nextCursor: cursor.cursor }),
      completeness: cursor.capped && page.completeness !== 'invalid' ? 'capped' : page.completeness,
      diagnostics,
      provenance: page.items.map(item => item.provenance),
      data: { total: page.total, items: page.items },
    })
  }

  outputManifest(id: string, signal: AbortSignal) {
    signal.throwIfAborted()
    return this.outputs.manifest(id)
  }

  async subjectEditTarget(
    handle: string,
    fieldPath: readonly string[],
    targetDocument: Readonly<{ rootId: string; path: string }> | undefined,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    return this.withEntity(handle, signal, async (entry, scopedSignal) => {
      const resolve = entry.selector.value.editTarget
      if (resolve === undefined) {
        throw new McpOperationError(
          'x3.mcp/subject-edit-target-unavailable',
          'This selected subject does not publish a resolved edit target.',
        )
      }
      const result = await resolve.call(
        entry.selector.value,
        {
          subjectId: entry.subjectId,
          fieldPath,
          ...(targetDocument === undefined ? {} : { targetDocument }),
        },
        scopedSignal,
      )
      if (result.snapshotId !== entry.snapshotId) {
        throw new McpOperationError(
          'x3.mcp/subject-edit-target-snapshot-mismatch',
          'The edit target belongs to a different resolved workspace snapshot.',
        )
      }
      return envelope({
        snapshotId: result.snapshotId,
        completeness:
          result.state === 'resolved'
            ? 'complete'
            : result.state === 'selection-required'
              ? 'partial'
              : 'invalid',
        diagnostics:
          result.state === 'unavailable'
            ? [
                {
                  code: 'x3.mcp/subject-edit-target-unavailable',
                  message: result.reason,
                  severity: 'information' as const,
                },
              ]
            : [],
        data: result,
      })
    })
  }

  async prepareEdit(
    planHandle: string,
    confirmationToken: string | undefined,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    const retained = await this.retainedEditPlan(planHandle)
    signal.throwIfAborted()
    retained.plan.prepared = undefined
    const prepared = await retained.editing.coordinator.prepare(retained.plan.plan, {
      grant: retained.editing.grantSnapshot,
      ...(confirmationToken === undefined ? {} : { confirmationToken }),
      signal,
    })
    if (prepared.state === 'ready') retained.plan.prepared = prepared.prepared
    const result =
      prepared.state === 'ready'
        ? {
            state: 'ready',
            preparedId: prepared.prepared.preparedId,
            planDigest: prepared.prepared.planDigest,
            writeSet: prepared.prepared.writeSet,
            authorization: prepared.prepared.authorization,
            fidelity: prepared.prepared.fidelity,
          }
        : prepared
    return envelope({
      snapshotId: `edit-plan:${planHandle}`,
      completeness: prepared.state === 'ready' ? 'complete' : 'invalid',
      diagnostics: prepared.state === 'rejected' ? prepared.diagnostics : [],
      data: { planHandle, ...result },
    })
  }

  async commitEdit(planHandle: string, signal: AbortSignal): Promise<McpEnvelope> {
    if (this.host.editsEnabled !== true) {
      throw new McpOperationError(
        'x3.mcp/edit-commit-disabled',
        'This MCP host did not start with edit commits enabled.',
      )
    }
    const retained = await this.retainedEditPlan(planHandle)
    const prepared = retained.plan.prepared
    if (prepared === undefined) {
      throw new McpOperationError(
        'x3.mcp/edit-not-prepared',
        'Validate and prepare the retained plan before committing it.',
      )
    }
    retained.plan.prepared = undefined
    const result = await retained.editing.coordinator.commit(prepared, {
      grant: retained.editing.grantSnapshot,
      signal,
    })
    if (result.state !== 'not-applied') {
      this.editPlans.delete(planHandle)
      this.editHistory.set(result.receipt.transactionId, {
        handleId: retained.plan.handleId,
        editing: retained.editing,
        receipt: result.receipt,
      })
    }
    return envelope({
      snapshotId:
        result.state === 'not-applied'
          ? `edit-plan:${planHandle}`
          : `transaction:${result.receipt.transactionId}`,
      completeness:
        result.state === 'committed'
          ? 'complete'
          : result.state === 'not-applied'
            ? 'invalid'
            : 'partial',
      diagnostics: result.state === 'not-applied' ? result.diagnostics : [],
      data: { planHandle, result },
    })
  }

  editHistoryPage(limit: number): McpEnvelope {
    const items = [...this.editHistory.values()]
      .map(item => item.receipt)
      .sort((left, right) => right.committedAt.localeCompare(left.committedAt))
      .slice(0, limit)
    return envelope({
      snapshotId: `edit-history:${fingerprint(items.map(item => item.transactionId))}`,
      completeness: items.length < this.editHistory.size ? 'capped' : 'complete',
      data: { total: this.editHistory.size, items },
    })
  }

  private async replayEdit(
    action: 'undo' | 'redo',
    transactionId: string,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    if (this.host.editsEnabled !== true) {
      throw new McpOperationError(
        'x3.mcp/edit-commit-disabled',
        'This MCP host did not start with edit commits enabled.',
      )
    }
    const history = this.editHistory.get(transactionId)
    if (
      history === undefined ||
      (!this.handles.has(history.handleId) && !this.resolvedWorkspaces.has(history.handleId))
    ) {
      throw new McpOperationError(
        'x3.mcp/unknown-edit-transaction',
        'The edit transaction is unknown or its subject handle is closed.',
      )
    }
    const result = await history.editing.coordinator[action](transactionId, {
      grant: history.editing.grantSnapshot,
      signal,
    })
    if (result.state !== 'not-applied') {
      history.receipt = result.receipt
      // A redo is a new transaction in the coordinator; it is the one a later undo names.
      if (action === 'redo') {
        this.editHistory.set(result.receipt.transactionId, { ...history, receipt: result.receipt })
      }
    }
    return envelope({
      snapshotId: `transaction:${transactionId}:${action}`,
      completeness: result.state === 'not-applied' ? 'invalid' : 'complete',
      diagnostics: result.state === 'not-applied' ? result.diagnostics : [],
      data: { transactionId, action, result },
    })
  }

  undoEdit(transactionId: string, signal: AbortSignal): Promise<McpEnvelope> {
    return this.replayEdit('undo', transactionId, signal)
  }

  redoEdit(transactionId: string, signal: AbortSignal): Promise<McpEnvelope> {
    return this.replayEdit('redo', transactionId, signal)
  }

  async discardEdit(id: string, signal: AbortSignal): Promise<McpEnvelope> {
    signal.throwIfAborted()
    const plan = this.editPlans.get(id)
    if (plan !== undefined) {
      this.editPlans.delete(id)
      await plan.editing.releasePlan(plan.plan)
      return envelope({
        snapshotId: `edit-plan:${id}:discarded`,
        completeness: 'complete',
        data: { id, kind: 'plan', discarded: true },
      })
    }
    const history = this.editHistory.get(id)
    if (history !== undefined) {
      const discarded = await history.editing.coordinator.discardHistory(id)
      if (discarded) this.editHistory.delete(id)
      return envelope({
        snapshotId: `transaction:${id}:discarded`,
        completeness: discarded ? 'complete' : 'invalid',
        data: { id, kind: 'history', discarded },
      })
    }
    throw new McpOperationError(
      'x3.mcp/unknown-edit-state',
      'The edit plan or transaction is unknown or already discarded.',
    )
  }

  /** Open a host-owned resolved-data workspace over loose mod directories (active mod last). */
  async openResolvedWorkspace(
    request: McpResolvedWorkspaceRequest,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    const open = this.host.openResolvedDataWorkspace
    if (open === undefined) {
      throw new McpOperationError(
        'x3.mcp/resolved-workspace-unavailable',
        'This MCP host cannot open resolved-data workspaces.',
      )
    }
    if (
      this.handles.size + this.entityHandles.size + this.resolvedWorkspaces.size >=
      MCP_MAX_OPEN_HANDLES
    ) {
      throw new McpOperationError(
        'x3.mcp/handle-limit',
        `At most ${MCP_MAX_OPEN_HANDLES} subject handles may be open at once.`,
      )
    }
    const result = await open(request, signal)
    if (result.state === 'unresolved') {
      return envelope({
        snapshotId: 'resolved-workspace:unresolved',
        completeness: 'invalid',
        diagnostics: result.diagnostics,
        data: { state: 'unresolved' },
      })
    }
    const workspace = result.workspace
    if (signal.aborted) {
      await workspace.release()
      signal.throwIfAborted()
    }
    const handle = randomUUID()
    this.resolvedWorkspaces.set(handle, workspace)
    const summary = await workspace.selector.summary(signal)
    const subjects = await workspace.selector.subjects({ limit: 50 }, signal)
    return envelope({
      snapshotId: workspace.snapshotId,
      completeness: summary.completeness === 'complete' ? 'complete' : 'partial',
      diagnostics: workspace.diagnostics,
      data: {
        state: 'opened',
        handle,
        activeRootId: workspace.activeRootId,
        rootIds: workspace.rootIds,
        totalSubjects: summary.totalSubjects,
        subjects: subjects.items,
      },
    })
  }

  /**
   * Propose a write to a resolved subject. The provider previews the destination; when it cannot
   * choose one the answer lists candidates and retains nothing. Otherwise the writer plan is kept
   * host-side under a plan handle for the ordinary prepare/commit/undo lifecycle.
   */
  async proposeResolvedEdit(
    handle: string,
    change: McpResolvedChange,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    const workspace = this.resolvedWorkspaces.get(handle)
    if (workspace === undefined) {
      throw new McpOperationError(
        'x3.mcp/unknown-handle',
        'The resolved workspace handle is unknown or already closed.',
      )
    }
    const preview =
      change.kind === 'field'
        ? await workspace.selector.editTarget?.(
            {
              subjectId: change.subjectId,
              fieldPath: change.fieldPath,
              ...(change.targetDocument === undefined
                ? {}
                : { targetDocument: change.targetDocument }),
            },
            signal,
          )
        : await workspace.selector.isolationPlan?.(
            {
              schemaVersion: 1,
              ownerSubjectId: change.ownerSubjectId,
              targetSubjectId: change.targetSubjectId,
              cloneSubjectId: change.cloneSubjectId,
              ownerFieldPath: change.ownerFieldPath,
              maxEdges: change.maxEdges,
              ...(change.always === undefined ? {} : { always: change.always }),
              ...(change.ownerTargetDocument === undefined
                ? {}
                : { ownerTargetDocument: change.ownerTargetDocument }),
              ...(change.cloneTargetDocument === undefined
                ? {}
                : { cloneTargetDocument: change.cloneTargetDocument }),
            },
            signal,
          )
    if (preview === undefined) {
      throw new McpOperationError(
        'x3.mcp/resolved-edit-unavailable',
        'The resolved workspace publishes no destination preview for this change.',
      )
    }
    if (preview.state !== 'resolved' && preview.state !== 'planned') {
      return envelope({
        snapshotId: workspace.snapshotId,
        completeness: preview.state === 'selection-required' ? 'partial' : 'invalid',
        diagnostics: [
          {
            code:
              preview.state === 'selection-required'
                ? 'x3.mcp/resolved-edit-selection-required'
                : 'x3.mcp/resolved-edit-unavailable',
            message: preview.reason,
            severity: preview.state === 'selection-required' ? 'information' : 'error',
          },
        ],
        data: { state: preview.state, preview, committed: false },
      })
    }
    await this.pruneExpiredEditPlans()
    if (this.editPlans.size >= MCP_MAX_EDIT_PLANS) {
      throw new McpOperationError(
        'x3.mcp/edit-plan-limit',
        `At most ${MCP_MAX_EDIT_PLANS} uncommitted edit plans may be retained.`,
      )
    }
    let plan: AssetEditPlan
    try {
      plan = await workspace.planChange(change, signal)
    } catch (error) {
      const coded = error as { code?: unknown; message?: unknown; context?: unknown }
      if (typeof coded.code !== 'string' || !coded.code.startsWith('x3.host/')) throw error
      return envelope({
        snapshotId: workspace.snapshotId,
        completeness: 'invalid',
        diagnostics: [
          { code: coded.code, message: String(coded.message ?? ''), severity: 'error' },
        ],
        data: {
          state: 'refused',
          preview,
          context: (coded.context ?? null) as never,
          committed: false,
        },
      })
    }
    const planHandle = randomUUID()
    const expiresAt = Date.now() + MCP_EDIT_PLAN_TTL_MS
    this.editPlans.set(planHandle, {
      id: planHandle,
      handleId: handle,
      editing: workspace.editing,
      operationId: `resolved-data.${change.kind}`,
      plan,
      expiresAt,
      prepared: undefined,
    })
    const projected = boundedJson({ preview, plan: summarizeEditPlan(plan) })
    return envelope({
      snapshotId: workspace.snapshotId,
      completeness: projected.capped ? 'capped' : 'complete',
      diagnostics: [
        {
          code: 'x3.mcp/edit-not-committed',
          message:
            'The plan describes the change and was retained by the host. It has not been validated or committed.',
          severity: 'information',
        },
      ],
      data: {
        state: 'planned',
        handle,
        ...(projected.value as object),
        planHandle,
        expiresAt: new Date(expiresAt).toISOString(),
        committed: false,
      },
    })
  }

  async language(request: McpLanguageRequest, signal: AbortSignal): Promise<McpEnvelope> {
    if (this.host.language === undefined) {
      throw new McpOperationError(
        'x3.mcp/language-unavailable',
        'This host does not publish language analysis.',
      )
    }
    const result = await this.host.language(request, signal)
    return envelope({
      snapshotId: result.snapshotId,
      completeness: 'partial',
      diagnostics: result.diagnostics,
      data: {
        workspaceIncomplete: true,
        primaryUri: result.primaryUri,
        feature: result.feature,
        result: result.result ?? null,
      },
    })
  }
  async openLanguageSession(
    request: McpLanguageSessionOpenRequest,
    signal: AbortSignal,
    dependencySubjectHandle?: string,
  ): Promise<McpEnvelope> {
    signal.throwIfAborted()
    if (this.host.openLanguageSession === undefined) {
      throw new McpOperationError(
        'x3.mcp/language-session-unavailable',
        'This host does not publish persistent language sessions.',
      )
    }
    const openLanguageSession = this.host.openLanguageSession.bind(this.host)
    const open = async (
      scopedSignal: AbortSignal,
      context?: McpLanguageSessionContext,
    ): Promise<McpEnvelope> => {
      if (this.languageSessions.size + this.languageSessionsOpening >= MCP_MAX_LANGUAGE_SESSIONS) {
        throw new McpOperationError(
          'x3.mcp/language-session-limit',
          `At most ${MCP_MAX_LANGUAGE_SESSIONS} language sessions may be retained.`,
        )
      }
      this.languageSessionsOpening += 1
      try {
        const session = await openLanguageSession(request, scopedSignal, context)
        try {
          scopedSignal.throwIfAborted()
          const handle = randomUUID()
          this.languageSessions.set(handle, session)
          return envelope({
            snapshotId: `language-session:${handle}`,
            completeness: session.workspaceIncomplete ? 'partial' : 'complete',
            diagnostics: session.diagnostics,
            data: {
              sessionHandle: handle,
              workspaceIncomplete: session.workspaceIncomplete,
              documents: session.documents,
            },
          })
        } catch (error) {
          await session.close()
          throw error
        }
      } finally {
        this.languageSessionsOpening -= 1
      }
    }
    if (dependencySubjectHandle === undefined) return open(signal)
    return this.withHandle(dependencySubjectHandle, signal, async (entry, scopedSignal) => {
      const session = entry.opened.session
      if (session === undefined) {
        throw new McpOperationError('x3.mcp/no-session', 'No subject session exists.')
      }
      return open(scopedSignal, {
        descriptor: await session.descriptor(),
        operations: session.operations(),
      })
    })
  }
  async updateLanguageSession(
    handle: string,
    request: McpLanguageSessionUpdateRequest,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    signal.throwIfAborted()
    const session = this.languageSessions.get(handle)
    if (session === undefined) {
      throw new McpOperationError(
        'x3.mcp/unknown-language-session',
        'The language session is unknown or already closed.',
      )
    }
    const result = await session.update(request, signal)
    return envelope({
      snapshotId: result.snapshotId,
      completeness: session.workspaceIncomplete ? 'partial' : 'complete',
      diagnostics: result.diagnostics,
      data: {
        sessionHandle: handle,
        workspaceIncomplete: session.workspaceIncomplete,
        ...(result.workspaceContext === undefined
          ? {}
          : { workspaceContext: result.workspaceContext }),
        primaryUri: result.primaryUri,
        feature: result.feature,
        result: result.result ?? null,
      },
    })
  }
  async languageSessionFeature(
    handle: string,
    request: McpLanguageSessionFeatureRequest,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    signal.throwIfAborted()
    const session = this.languageSessions.get(handle)
    if (session === undefined) {
      throw new McpOperationError(
        'x3.mcp/unknown-language-session',
        'The language session is unknown or already closed.',
      )
    }
    const result = await session.invoke(request, signal)
    return envelope({
      snapshotId: result.snapshotId,
      completeness:
        session.workspaceIncomplete ||
        (typeof result.result === 'object' && result.result !== null &&
          'isIncomplete' in result.result && result.result.isIncomplete === true) ||
        result.workspaceContext?.semanticComplete === false
          ? 'partial' : 'complete',
      diagnostics: result.diagnostics,
      data: {
        sessionHandle: handle,
        workspaceIncomplete: session.workspaceIncomplete,
        ...(result.workspaceContext === undefined
          ? {}
          : { workspaceContext: result.workspaceContext }),
        primaryUri: result.primaryUri,
        feature: result.feature,
        result: result.result ?? null,
      },
    })
  }
  async closeLanguageSession(handle: string, signal: AbortSignal): Promise<McpEnvelope> {
    signal.throwIfAborted()
    const session = this.languageSessions.get(handle)
    if (session === undefined) {
      throw new McpOperationError(
        'x3.mcp/unknown-language-session',
        'The language session is unknown or already closed.',
      )
    }
    this.languageSessions.delete(handle)
    await session.close()
    return envelope({
      snapshotId: `language-session:${handle}:closed`,
      completeness: 'complete',
      data: { sessionHandle: handle, closed: true },
    })
  }
  async subjectIsolation(
    handle: string,
    targetSubjectId: string,
    ownerFieldPath: readonly string[],
    maxEdges: number,
    always: boolean | undefined,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    return this.withEntity(handle, signal, async (entry, scopedSignal) => {
      const analyze = entry.selector.value.isolation
      if (analyze === undefined) {
        throw new McpOperationError(
          'x3.mcp/subject-isolation-unavailable',
          'This selected subject does not publish shared-object isolation analysis.',
        )
      }
      const result = await analyze.call(
        entry.selector.value,
        {
          schemaVersion: 1,
          ownerSubjectId: entry.subjectId,
          targetSubjectId,
          ownerFieldPath,
          maxEdges,
          ...(always === undefined ? {} : { always }),
        },
        scopedSignal,
      )
      if (result.snapshotId !== entry.snapshotId) {
        throw new McpOperationError(
          'x3.mcp/subject-isolation-snapshot-mismatch',
          'The isolation analysis belongs to a different resolved workspace snapshot.',
        )
      }
      return envelope({
        snapshotId: result.snapshotId,
        completeness: result.state === 'ready' ? 'complete' : 'invalid',
        diagnostics:
          result.state === 'unavailable'
            ? [
                {
                  code: 'x3.mcp/subject-isolation-unavailable',
                  message: result.reason,
                  severity: 'information' as const,
                },
              ]
            : [],
        data: result,
      })
    })
  }
  async subjectIsolationPlan(
    handle: string,
    request: Readonly<{
      targetSubjectId: string
      cloneSubjectId: string
      ownerFieldPath: readonly string[]
      maxEdges: number
      always?: boolean
      ownerTargetDocument?: Readonly<{ rootId: string; path: string }>
      cloneTargetDocument?: Readonly<{ rootId: string; path: string }>
    }>,
    signal: AbortSignal,
  ): Promise<McpEnvelope> {
    return this.withEntity(handle, signal, async (entry, scopedSignal) => {
      const plan = entry.selector.value.isolationPlan
      if (plan === undefined) {
        throw new McpOperationError(
          'x3.mcp/subject-isolation-plan-unavailable',
          'This selected subject does not publish shared-object isolation plans.',
        )
      }
      const result = await plan.call(
        entry.selector.value,
        {
          schemaVersion: 1,
          ownerSubjectId: entry.subjectId,
          ...request,
        },
        scopedSignal,
      )
      if (result.snapshotId !== entry.snapshotId) {
        throw new McpOperationError(
          'x3.mcp/subject-isolation-plan-snapshot-mismatch',
          'The isolation plan belongs to a different resolved workspace snapshot.',
        )
      }
      const diagnostics =
        result.state === 'planned'
          ? result.diagnostics
          : result.state === 'unavailable'
            ? [
                {
                  code: 'x3.mcp/subject-isolation-plan-unavailable',
                  message: result.reason,
                  severity: 'information' as const,
                },
              ]
            : []
      return envelope({
        snapshotId: result.snapshotId,
        completeness:
          result.state === 'planned'
            ? 'complete'
            : result.state === 'selection-required'
              ? 'partial'
              : 'invalid',
        diagnostics,
        data: result,
      })
    })
  }
  outputChunk(id: string, offset: number, signal: AbortSignal) {
    signal.throwIfAborted()
    return this.outputs.chunk(id, offset)
  }
  releaseOutput(id: string, signal: AbortSignal): McpEnvelope {
    signal.throwIfAborted()
    this.outputs.release(id)
    return envelope({
      snapshotId: 'output-released',
      completeness: 'complete',
      data: { id, released: true },
    })
  }
  async dispose(): Promise<void> {
    const languageSessions = [...this.languageSessions.values()]
    this.languageSessions.clear()
    await Promise.allSettled(languageSessions.map(session => session.close()))
    const handles = [...this.handles.keys(), ...this.resolvedWorkspaces.keys()]
    await Promise.allSettled(handles.map(handle => this.close(handle)))
    this.outputs.dispose()
  }
}
