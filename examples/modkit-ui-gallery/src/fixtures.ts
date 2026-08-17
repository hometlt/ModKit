/**
 * In-memory data sources for the gallery.
 *
 * These are real implementations of the six standard contracts, not stubs that fake DOM. The
 * gallery mounts the shipped `ViewerModule`s against them, so what you see is the actual viewer
 * rendering actual leased data. If a viewer breaks, the gallery breaks.
 */
import { traitId } from '@modkitx-x3/core'
import { revisionId, bindingId, presentationSlotId } from '@modkitx-x3/sdk'
import type {
  AnyDescriptor,
  ByteRangeSource,
  CellCoord,
  CellFacts,
  Lease,
  NamespaceEntry,
  NamespaceEntrySource,
  OperationSession,
  Page,
  PageRequest,
  PresentationSlot,
  ResolvedPresentationPlan,
  Row,
  SourceSpan,
  TableDataSource,
  TablePageRequest,
  TextDataSource,
  TextSlice,
  TextSliceRequest,
  TransportEvent,
  TransportSnapshot,
  TransportSource,
  TreeDataSource,
  TreeNodeFacts,
  TreeNodeRef,
  ViewerSources,
} from '@modkitx-x3/sdk'

const REVISION = revisionId('content-hash.sha256:gallery')

const lease = <T>(value: T): Lease<T> => ({
  value,
  release: async () => Promise.resolve(),
})

// ---------------------------------------------------------------- text
const SAMPLE_LINES = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Catalog>',
  '  <CUnit id="Marine" parent="CUnitStandard">',
  '    <Life value="45"/>',
  '    <Armor value="0"/>',
  '    <Model value="Marine.m3"/>',
  '  </CUnit>',
  '  <!-- a control character and a bidi override follow, both must render inert -->',
  '  <CUnit id="Zealot‮" parent="CUnitStandard">',
  '    <Life value="100"/>',
  '  </CUnit>',
  '</Catalog>',
]

export function textSource(lines: readonly string[] = SAMPLE_LINES): TextDataSource {
  const text = lines.join('\n')
  return {
    async info() {
      return {
        bytes: BigInt(new TextEncoder().encode(text).length),
        encoding: 'utf-8',
        bom: false,
        newline: 'lf',
        lines: lines.length,
        longestLineBytes: Math.max(...lines.map(line => line.length)),
      }
    },
    async slice(request: TextSliceRequest): Promise<TextSlice> {
      const from = request.kind === 'from-line' ? request.line : 0
      const count = request.kind === 'from-line' ? request.lineCount : lines.length
      const window = lines.slice(from, from + count)
      return {
        text: window.join('\n'),
        firstLine: from,
        lineCount: window.length,
        complete: from + count >= lines.length,
      } as TextSlice
    },
    async *search(query): AsyncIterable<SourceSpan> {
      const needle = query.text
      if (needle.length === 0) return
      for (const [index, line] of lines.entries()) {
        const at = line.indexOf(needle)
        if (at !== -1)
          yield {
            start: { line: index, column: at },
            end: { line: index, column: at + needle.length },
          } as SourceSpan
      }
    },
  }
}

/** A large logical text that is never materialised, to exercise the virtual stage. */
export function virtualTextSource(totalLines = 250_000): TextDataSource {
  const line = (n: number) =>
    `${String(n).padStart(9, '0')}  synthetic log record, never materialised in full`
  return {
    async info() {
      return {
        bytes: BigInt(totalLines) * 64n,
        encoding: 'utf-8',
        bom: false,
        newline: 'lf',
        lines: totalLines,
        longestLineBytes: 64,
      }
    },
    async slice(request: TextSliceRequest): Promise<TextSlice> {
      const from = request.kind === 'from-line' ? request.line : 0
      const count = Math.min(request.kind === 'from-line' ? request.lineCount : 200, 200)
      const window = Array.from({ length: count }, (_, index) => line(from + index))
      return {
        text: window.join('\n'),
        firstLine: from,
        lineCount: window.length,
        complete: from + count >= totalLines,
      } as TextSlice
    },
    async *search(): AsyncIterable<SourceSpan> {
      return
    },
  }
}

// ---------------------------------------------------------------- bytes
export function byteRangeSource(): ByteRangeSource {
  // A deterministic pattern plus a readable ASCII banner, so the hex stage shows both columns.
  const banner = new TextEncoder().encode('MODKIT UI GALLERY — hex stage fixture\n')
  return {
    async size() {
      return 1n << 40n // 1 TiB logical, to prove 64-bit offsets are not materialised
    },
    async read(offset: bigint, length: number) {
      const out = new Uint8Array(length)
      for (let index = 0; index < length; index += 1) {
        const absolute = offset + BigInt(index)
        out[index] =
          absolute < BigInt(banner.length)
            ? (banner[Number(absolute)] as number)
            : Number((absolute * 31n + 7n) % 256n)
      }
      return out
    },
  }
}

// ---------------------------------------------------------------- tree
interface TreeSpec {
  readonly id: string
  readonly label: string
  readonly kind: string
  readonly children?: readonly TreeSpec[]
}

const TREE: TreeSpec = {
  id: 'root',
  label: 'Catalog',
  kind: 'document',
  children: [
    {
      id: 'unit-marine',
      label: 'CUnit "Marine"',
      kind: 'entity',
      children: [
        { id: 'marine-life', label: 'Life = 45', kind: 'field' },
        { id: 'marine-armor', label: 'Armor = 0', kind: 'field' },
        { id: 'marine-model', label: 'Model = Marine.m3', kind: 'reference' },
      ],
    },
    {
      id: 'unit-zealot',
      label: 'CUnit "Zealot"',
      kind: 'entity',
      children: [{ id: 'zealot-life', label: 'Life = 100', kind: 'field' }],
    },
    { id: 'comment', label: 'comment node', kind: 'comment' },
  ],
}

export function treeSource(): TreeDataSource {
  const index = new Map<string, TreeSpec>()
  const walk = (node: TreeSpec) => {
    index.set(node.id, node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(TREE)
  return {
    async root(): Promise<TreeNodeRef> {
      return { id: TREE.id, hasChildren: true }
    },
    async children(node: TreeNodeRef, page: PageRequest): Promise<Page<TreeNodeRef>> {
      const spec = index.get(node.id)
      const all = (spec?.children ?? []).map(child => ({
        id: child.id,
        hasChildren: (child.children?.length ?? 0) > 0,
      }))
      return { items: all.slice(0, page.limit) }
    },
    async facts(node: TreeNodeRef): Promise<TreeNodeFacts> {
      const spec = index.get(node.id)
      return { kind: spec?.kind ?? 'unknown', label: spec?.label ?? node.id }
    },
    async *search(): AsyncIterable<TreeNodeRef> {
      return
    },
  }
}

// ---------------------------------------------------------------- table
const HEADER = ['id', 'life', 'armor', 'model', 'note'] as const
const ROWS: readonly (readonly string[])[] = [
  ['Marine', '45', '0', 'Marine.m3', 'baseline infantry'],
  ['Marauder', '125', '1', 'Marauder.m3', 'anti-armour'],
  ['Zealot', '100', '1', 'Zealot.m3', 'shields 50'],
  ['Zergling', '35', '0', 'Zergling.m3', 'fast'],
  ['<img src=x onerror=alert(1)>', '1', '0', 'hostile.m3', 'markup must render as text'],
  ['Bidi‮override', '1', '0', 'hostile.m3', 'control chars must render inert'],
]

export function tableSource(): TableDataSource {
  return {
    async shape() {
      return { rows: ROWS.length, columns: HEADER.length, header: [...HEADER] }
    },
    async rows(request: TablePageRequest): Promise<Page<Row>> {
      const from = request.kind === 'range' ? request.from : 0
      const count = request.kind === 'range' ? request.count : ROWS.length
      const window = ROWS.slice(from, from + count)
      return {
        items: window.map((cells, offset) => ({ index: from + offset, cells: [...cells] })),
      }
    },
    async cell(coord: CellCoord): Promise<CellFacts> {
      const value = ROWS[coord.row]?.[coord.column] ?? ''
      return { kind: 'string', text: value } as CellFacts
    },
    async *search(): AsyncIterable<CellCoord> {
      return
    },
  }
}

// ---------------------------------------------------------------- transport
export function transportSource(): TransportSource {
  const snapshot: TransportSnapshot = {
    state: 'paused',
    position: 12.5,
    duration: 184,
    rate: 1,
    loop: false,
    controls: {
      playPause: 'media.play-pause',
      seek: 'media.seek',
      setRate: 'media.set-rate',
      selectTrack: 'media.select-track',
    },
    tracks: [
      { id: 'video-1', kind: 'video', label: '1920x1080 h264', selected: true },
      { id: 'audio-en', kind: 'audio', label: 'English 5.1', selected: true },
      { id: 'audio-de', kind: 'audio', label: 'Deutsch stereo', selected: false },
    ],
  } as TransportSnapshot
  return {
    async snapshot() {
      return snapshot
    },
    async *events(): AsyncIterable<TransportEvent> {
      return
    },
  }
}

// ---------------------------------------------------------------- namespace
const ENTRIES: readonly NamespaceEntry[] = [
  { id: 'e1', path: '', name: 'Assets', kind: 'directory', revision: REVISION },
  { id: 'e2', path: '', name: 'GameData', kind: 'directory', revision: REVISION },
  { id: 'e3', path: '', name: 'DocumentHeader', kind: 'file', size: 2048n, revision: REVISION },
  { id: 'e4', path: 'Assets', name: 'Marine.m3', kind: 'file', size: 918_272n, revision: REVISION },
  {
    id: 'e5',
    path: 'Assets',
    name: 'Marine_diffuse.dds',
    kind: 'file',
    size: 349_616n,
    revision: REVISION,
  },
  {
    id: 'e6',
    path: 'GameData',
    name: 'UnitData.xml',
    kind: 'file',
    size: 44_310n,
    revision: REVISION,
  },
]

export function namespaceSource(): NamespaceEntrySource {
  return {
    async list(prefix: string, page: PageRequest): Promise<Page<NamespaceEntry>> {
      const items = ENTRIES.filter(entry => entry.path === prefix)
      return { items: items.slice(0, page.limit) }
    },
    async openEntry(entryId: string) {
      return lease({ id: entryId, uri: `memory://gallery/${entryId}` })
    },
  }
}

// ---------------------------------------------------------------- descriptor, plan, sources
export interface GalleryCase {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly contributionId: string
  readonly kind: PresentationSlot['kind']
  readonly contract: string
  readonly source: unknown
}

export const CASES: readonly GalleryCase[] = Object.freeze([
  {
    id: 'bounded-text',
    title: 'Bounded text stage',
    summary: 'Whole-document text with hostile control characters escaped on the way in.',
    contributionId: 'org.modkitx.ui/bounded-text-stage',
    kind: 'stage',
    contract: 'common.view/text-data-source',
    source: textSource(),
  },
  {
    id: 'virtual-text',
    title: 'Virtual text stage',
    summary: '250 000 logical lines, windowed. Nothing is materialised in full.',
    contributionId: 'org.modkitx.ui/virtual-text-stage',
    kind: 'stage',
    contract: 'common.view/text-data-source',
    source: virtualTextSource(),
  },
  {
    id: 'hex',
    title: 'Hex stage',
    summary: 'A 1 TiB logical source addressed with 64-bit offsets; only the window is read.',
    contributionId: 'org.modkitx.ui/hex-stage',
    kind: 'stage',
    contract: 'common.view/byte-range-source',
    source: byteRangeSource(),
  },
  {
    id: 'tree',
    title: 'Tree stage',
    summary: 'Lazy children through paged requests, with node facts supplying labels.',
    contributionId: 'org.modkitx.ui/tree-stage',
    kind: 'stage',
    contract: 'common.view/tree-data-source',
    source: treeSource(),
  },
  {
    id: 'table',
    title: 'Table stage',
    summary: 'Paged rows. Two rows carry markup and bidi overrides that must render inert.',
    contributionId: 'org.modkitx.ui/table-stage',
    kind: 'stage',
    contract: 'common.view/table-data-source',
    source: tableSource(),
  },
  {
    id: 'namespace',
    title: 'Namespace tree',
    summary: 'Container entries; opening one yields a leased source ref, never eager bytes.',
    contributionId: 'org.modkitx.ui/namespace-tree',
    kind: 'tree',
    contract: 'common.view/namespace-entry-source',
    source: namespaceSource(),
  },
  {
    id: 'transport',
    title: 'Transport bar',
    summary: 'Playback snapshot with selectable video and audio tracks.',
    contributionId: 'org.modkitx.ui/transport-bar',
    kind: 'transport',
    contract: 'common.view/transport-source',
    source: transportSource(),
  },
])

export function galleryDescriptor(diagnostics = true): AnyDescriptor {
  return {
    schemaVersion: 2,
    subjectUri: 'memory://gallery/subject',
    origin: {
      kind: 'single',
      binding: {
        id: 'content',
        role: 'content',
        source: { id: 'memory://gallery/subject', uri: 'memory://gallery/subject' },
        required: true,
        ownership: 'owned',
        revision: REVISION,
      },
    },
    interpretation: 'codec',
    identity: {
      codecId: 'org.modkitx.gallery/fixture',
      codecVersion: '1.0.0',
      formatId: 'gallery-fixture',
      formatLabel: 'Gallery fixture',
      confidence: 1,
      detection: [],
    },
    traits: [
      { id: traitId('content.text'), descriptorVersion: 1, state: 'available', parameters: {} },
      { id: traitId('content.binary'), descriptorVersion: 1, state: 'available', parameters: {} },
      {
        id: traitId('structure.hierarchy'),
        descriptorVersion: 1,
        state: 'available',
        parameters: {},
      },
      { id: traitId('table.cells'), descriptorVersion: 1, state: 'available', parameters: {} },
    ],
    operations: [
      {
        id: 'export.raw',
        handlerId: 'gallery.export-raw',
        state: 'available',
        mutatesSource: false,
      },
      {
        id: 'asset.validate',
        handlerId: 'gallery.validate',
        state: 'available',
        mutatesSource: false,
      },
      {
        id: 'edit.content',
        handlerId: 'gallery.edit',
        state: 'dependency-required',
        mutatesSource: true,
      },
    ],
    constraints: { readOnly: true, seekable: true, randomAccess: true, trusted: false },
    dataSources: [
      { contract: 'common.view/text-data-source', major: 1 },
      { contract: 'common.view/byte-range-source', major: 1 },
      { contract: 'common.view/tree-data-source', major: 1 },
      { contract: 'common.view/table-data-source', major: 1 },
      { contract: 'common.view/transport-source', major: 1 },
      { contract: 'common.view/namespace-entry-source', major: 1 },
    ],
    diagnostics: diagnostics
      ? [
          {
            id: 'gallery/err-1',
            severity: 'error',
            category: 'structure',
            source: 'codec',
            message: 'Unresolved reference: Model value "Missing.m3" has no matching asset.',
          },
          {
            id: 'gallery/warn-1',
            severity: 'warning',
            category: 'semantics',
            source: 'codec',
            message: 'Armor value 0 is the inherited default; the override is redundant.',
          },
          {
            id: 'gallery/info-1',
            severity: 'information',
            category: 'provenance',
            source: 'host',
            message: 'Two of six rows contain characters that were escaped for display.',
          },
          {
            id: 'gallery/hint-1',
            severity: 'hint',
            category: 'style',
            source: 'codec',
            message: 'Entity "Zealot" could inherit Life from CUnitStandard.',
          },
        ]
      : [],
    metadata: [
      {
        id: 'file',
        label: 'File',
        entries: [
          { id: 'size', label: 'Size', value: '44 310 bytes' },
          { id: 'encoding', label: 'Encoding', value: 'UTF-8, LF' },
          { id: 'revision', label: 'Revision', value: REVISION },
        ],
      },
    ],
    revision: REVISION,
  } as AnyDescriptor
}

export function slotFor(item: GalleryCase, index: number): PresentationSlot {
  return {
    slotId: presentationSlotId(item.id),
    kind: item.kind,
    contributionId: item.contributionId,
    extensionId: 'org.modkitx.ui',
    priority: 100 + index,
    bindings: [{ bindingId: bindingId(item.id), contract: item.contract, major: 1 }],
  } as PresentationSlot
}

export function sourcesFor(item: GalleryCase): ViewerSources {
  return {
    async get() {
      return lease(item.source) as never
    },
    async getUnknown() {
      return lease(item.source)
    },
  }
}

export function resolvedPlanFor(item: GalleryCase, index: number): ResolvedPresentationPlan {
  const slot = slotFor(item, index)
  return {
    plan: {
      subjectUri: 'memory://gallery/subject',
      revision: REVISION,
      slots: [slot],
      unsatisfied: [],
      ...(item.kind === 'stage'
        ? { activeStage: slot.slotId, alternateStages: [] }
        : {
            alternateStages: [],
            fallback: { ...slot, kind: 'fallback' as const },
          }),
    },
    bindings: slot.bindings.map(binding => ({
      ...binding,
      offerId: `${item.contributionId}#offer`,
      providerId: 'org.modkitx.gallery/in-memory',
      variantId: 'browser',
      ticket: undefined,
    })),
    planDigest: `gallery:${item.id}`,
  } as ResolvedPresentationPlan
}

export function operationSession(log: (line: string) => void): OperationSession {
  return {
    async invoke(handlerId: string) {
      log(`operation invoked: ${handlerId}`)
      return { state: 'succeeded', output: null, diagnostics: [] }
    },
  } as unknown as OperationSession
}
