import { OutputArtifacts, OutputArtifactError, OUTPUT_ARTIFACT_POLICY } from './output-artifacts.js'
import { randomUUID } from 'node:crypto'
import { describeInventoryContributions } from '@modkit/host'
import type {
  KnowledgeResolveQuery,
  KnowledgeSearchQuery,
  JsonValue,
  Lease,
  Page,
  PageRequest,
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
import type { McpLanguageRequest, McpOpenedSubject, ModkitMcpHostPort } from './host-port.js'
import {
  MCP_MAX_CURSOR_LENGTH,
  MCP_MAX_OPEN_HANDLES,
  boundedJson,
  createCursorSecret,
  envelope,
  fingerprint,
  makeOffsetCursor,
  makeSourceCursor,
  readOffsetCursor,
  readSourceCursor,
  type CursorSecret,
  type McpCompleteness,
  type McpEnvelope,
} from './protocol.js'

const MCP_MAX_PROGRESS_EVENTS = 50
const MCP_GRAPH_SCAN_PAGE_SIZE = 50
const MCP_MAX_GRAPH_SCAN_PAGES = 1_000

export class McpOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
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
  if (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    return hostFailure('x3.mcp/cancelled', 'The read-only request was cancelled.')
  }
  return hostFailure('x3.mcp/host-operation-failed', 'The read-only host operation failed.')
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

interface GraphScan<Value> {
  readonly items: readonly Value[]
  readonly exhausted: boolean
  readonly diagnostic?: {
    readonly code: string
    readonly message: string
    readonly severity: 'warning'
  }
}

const scanGraphSource = async <Value>(
  read: (page: PageRequest, signal: AbortSignal) => Promise<Page<Value>>,
  scanLimit: number,
  signal: AbortSignal,
): Promise<GraphScan<Value>> => {
  const items: Value[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let pageCount = 0
  while (items.length < scanLimit && pageCount < MCP_MAX_GRAPH_SCAN_PAGES) {
    signal.throwIfAborted()
    const page = await read(
      {
        ...(cursor === undefined ? {} : { cursor }),
        limit: Math.min(MCP_GRAPH_SCAN_PAGE_SIZE, scanLimit - items.length),
      },
      signal,
    )
    pageCount += 1
    items.push(...page.items.slice(0, scanLimit - items.length))
    if (page.nextCursor === undefined) return { items, exhausted: true }
    if (
      page.nextCursor.length > MCP_MAX_CURSOR_LENGTH ||
      seenCursors.has(page.nextCursor) ||
      page.nextCursor === cursor
    ) {
      return {
        items,
        exhausted: false,
        diagnostic: {
          code: 'x3.mcp/relation-graph-invalid-upstream-cursor',
          message: 'Traversal stopped because the graph source returned an invalid cursor.',
          severity: 'warning',
        },
      }
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
  return {
    items,
    exhausted: false,
    diagnostic: {
      code: 'x3.mcp/relation-graph-scan-capped',
      message: `Traversal stopped after scanning ${items.length} items.`,
      severity: 'warning',
    },
  }
}

const traversedEdges = (
  edges: readonly RelationGraphEdge[],
  query: Extract<GraphQuery, { readonly view: 'traverse' }>,
): {
  readonly nodeIds: ReadonlySet<string>
  readonly edges: readonly RelationGraphEdge[]
  readonly capped: boolean
} => {
  const nodeIds = new Set(query.roots)
  let frontier = new Set(query.roots)
  const selected: RelationGraphEdge[] = []
  const selectedKeys = new Set<string>()
  let capped = false
  for (let level = 0; level < query.depth && frontier.size > 0; level += 1) {
    const next = new Set<string>()
    for (const edge of edges) {
      const followsOutgoing = query.direction !== 'incoming' && frontier.has(edge.from)
      const followsIncoming = query.direction !== 'outgoing' && frontier.has(edge.to)
      if (!followsOutgoing && !followsIncoming) continue
      const key = `${edge.from}\u0000${edge.to}\u0000${edge.role ?? ''}\u0000${edge.dead === true}`
      if (!selectedKeys.has(key)) {
        if (selected.length >= query.maxEdges) {
          capped = true
          continue
        }
        selectedKeys.add(key)
        selected.push(edge)
      }
      for (const candidate of [edge.from, edge.to]) {
        if (nodeIds.has(candidate)) continue
        if (nodeIds.size >= query.maxNodes) {
          capped = true
          continue
        }
        nodeIds.add(candidate)
        next.add(candidate)
      }
    }
    frontier = next
  }
  return { nodeIds, edges: selected, capped }
}

export class ModkitMcpRuntime {
  private readonly handles = new Map<string, HandleEntry>()
  private readonly entityHandles = new Map<string, EntityHandleEntry>()
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
        readOnly: true,
        outputArtifacts: { enabled: this.host.outputArtifacts === true, ...OUTPUT_ARTIFACT_POLICY },
        roots: this.host.roots,
        extensionCoordinates: this.host.extensionCoordinates,
        executionProfiles: this.host.executionProfiles,
        supportedExtensions: this.host.supportedExtensions,
        maxOpenHandles: MCP_MAX_OPEN_HANDLES,
        operations: [
          'inventory',
          'capabilities',
          'open-subject',
          'close-subject',
          'inspect',
          'list-subjects',
          'search-subjects',
          'select-subject',
          'close-selected-subject',
          'subject-facts',
          'relation-graph',
          'subject-calculations',
          'invoke-readonly',
          'knowledge-search',
          'knowledge-resolve',
          ...(this.host.language === undefined ? [] : ['language']),
          ...(this.host.discoverInstallations === undefined ||
          this.host.openDiscovered === undefined
            ? []
            : ['discover-installations', 'open-discovered']),
        ],
      },
    })
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
          completeness: 'complete',
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

  async close(handle: string): Promise<McpEnvelope> {
    if (this.entityHandles.has(handle)) return this.closeEntity(handle)
    const entry = this.handles.get(handle)
    if (entry === undefined) {
      return hostFailure(
        'x3.mcp/unknown-handle',
        'The subject handle is unknown or already closed.',
      )
    }
    this.handles.delete(handle)
    this.outputs.closeOwner(handle)
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
        return this.readFacts(entry.id, lease.value, query, scopedSignal)
      } finally {
        await lease.release()
      }
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
          const edgeScan = await scanGraphSource(
            (page, pageSignal) => lease.value.edges(page, pageSignal),
            query.scanLimit,
            scopedSignal,
          )
          const traversal = traversedEdges(edgeScan.items, query)
          const nodeScan = await scanGraphSource(
            (page, pageSignal) => lease.value.nodes(page, pageSignal),
            query.scanLimit,
            scopedSignal,
          )
          const nodes = nodeScan.items.filter(node => traversal.nodeIds.has(node.id))
          const foundNodeIds = new Set(nodes.map(node => node.id))
          const missingNodeIds = [...traversal.nodeIds].filter(id => !foundNodeIds.has(id))
          const diagnostics = [
            ...(summary.reason === undefined
              ? []
              : [
                  {
                    code: 'x3.mcp/relation-graph-incomplete',
                    message: summary.reason,
                    severity: 'information' as const,
                  },
                ]),
            ...(edgeScan.diagnostic === undefined ? [] : [edgeScan.diagnostic]),
            ...(nodeScan.diagnostic === undefined ? [] : [nodeScan.diagnostic]),
            ...(traversal.capped
              ? [
                  {
                    code: 'x3.mcp/relation-graph-traversal-capped',
                    message: 'Traversal reached its requested node or edge result limit.',
                    severity: 'warning' as const,
                  },
                ]
              : []),
          ]
          const complete =
            summary.completeness === 'complete' &&
            edgeScan.exhausted &&
            nodeScan.exhausted &&
            !traversal.capped
          return envelope({
            snapshotId: summary.snapshotId,
            completeness: complete ? 'complete' : 'capped',
            diagnostics,
            data: {
              view: query.view,
              roots: query.roots,
              direction: query.direction,
              depth: query.depth,
              nodes,
              edges: traversal.edges,
              missingNodeIds,
              scanned: { nodes: nodeScan.items.length, edges: edgeScan.items.length },
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
        return this.readCalculations(entry.id, lease.value, query, scopedSignal)
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
            },
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
   * what round-trip fidelity. What it does not get is a commit — that needs an authorization the
   * host owns and a person to grant it, and routing it through here would be routing around the
   * approval rather than asking for it.
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

      if (result.state === 'ok' && result.output.kind === 'edit-plan') {
        /*
         * The plan is summarized rather than passed through. Its payloads are the replacement bytes,
         * which for a re-encoded texture is the whole file — an agent asking "what would change"
         * wants the shape of the change, and the bytes would blow the JSON bound and tell it nothing.
         */
        const raw = result.output.plan as {
          planId?: string
          fidelity?: unknown
          edits?: readonly {
            operation?: string
            label?: string
            targetId?: string
            range?: { offset?: unknown; length?: unknown }
            payload?: { kind?: string; bytes?: { byteLength?: number } }
          }[]
        }
        plan = {
          planId: raw.planId,
          fidelity: raw.fidelity,
          edits: (raw.edits ?? []).map(edit => ({
            operation: edit.operation,
            label: edit.label,
            targetId: edit.targetId,
            ...(edit.range === undefined
              ? {}
              : { offset: String(edit.range.offset ?? 0), length: String(edit.range.length ?? 0) }),
            replacementBytes:
              edit.payload?.kind === 'inline'
                ? (edit.payload.bytes?.byteLength ?? 0)
                : undefined,
          })),
        }
        diagnostics.push({
          code: 'x3.mcp/edit-not-committed',
          message:
            'The plan describes the change and was not applied. Committing needs the host authorization this adapter does not hold.',
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
    const handles = [...this.handles.keys()]
    await Promise.allSettled(handles.map(handle => this.close(handle)))
    this.outputs.dispose()
  }
}
