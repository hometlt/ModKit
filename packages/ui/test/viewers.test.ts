import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify, traitId } from '@modkit/core'
import {
  evaluateViewerApplicability,
  evaluateViewerContribution,
  createHostContributionContractRegistry,
  resolvePresentationPlan,
  type CatalogPresentationCandidate,
} from '@modkit/host'
import {
  bindingId,
  presentationSlotId,
  revisionId,
  validateContributionManifest,
  type AnyDescriptor,
  type ContributionManifestV1Wire,
  type ViewerContributionSpecV1,
} from '@modkit/sdk'
import {
  BoundedTextModel,
  HexWindowModel,
  LazyTableModel,
  LazyTreeModel,
  NamespaceModel,
  VirtualTextModel,
  loadSubjectCalculations,
  normalizeNamespacePath,
  safeViewerText,
} from '@modkit/ui'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

function descriptor(): AnyDescriptor {
  return {
    schemaVersion: 2,
    subjectUri: 'memory://viewer/fixture',
    origin: {
      kind: 'single',
      binding: {
        id: 'content',
        role: 'content',
        source: { id: 'memory://viewer/fixture', uri: 'memory://viewer/fixture' },
        required: true,
        ownership: 'owned',
        revision: revisionId('content-hash.sha256:viewer'),
      },
    },
    interpretation: 'codec',
    identity: {
      codecId: 'org.example/viewer-fixture',
      codecVersion: '1.0.0',
      formatId: 'fixture',
      formatLabel: 'Fixture',
      confidence: 1,
      detection: [],
    },
    traits: [
      {
        id: traitId('content.text'),
        descriptorVersion: 1,
        state: 'available',
        parameters: { encoding: 'utf-8' },
      },
      {
        id: traitId('content.binary'),
        descriptorVersion: 1,
        state: 'available',
        parameters: { bytes: '1024' },
      },
      {
        id: traitId('structure.hierarchy'),
        descriptorVersion: 1,
        state: 'available',
        parameters: { lazy: true },
      },
      {
        id: traitId('table.cells'),
        descriptorVersion: 1,
        state: 'available',
        parameters: { rows: 'unknown' },
      },
    ],
    operations: [],
    constraints: {
      readOnly: true,
      seekable: true,
      randomAccess: true,
      trusted: false,
    },
    dataSources: [
      { contract: 'common.view/text-data-source', major: 1 },
      { contract: 'common.view/byte-range-source', major: 1 },
      { contract: 'common.view/tree-data-source', major: 1 },
      { contract: 'common.view/table-data-source', major: 1 },
    ],
    diagnostics: [],
    metadata: [],
    revision: revisionId('content-hash.sha256:viewer'),
  }
}

async function viewerManifests(): Promise<ContributionManifestV1Wire[]> {
  const directory = join(packageRoot, 'contributions')
  return Promise.all(
    (await readdir(directory))
      .filter(name => name.startsWith('viewer-') && name.endsWith('.json'))
      .sort()
      .map(async name => JSON.parse(await readFile(join(directory, name), 'utf8'))),
  )
}

describe('13C universal viewer contracts and models', () => {
  it('validates twenty-two declarative viewer contributions and resolves them shuffle-stably', async () => {
    const manifests = await viewerManifests()
    expect(manifests).toHaveLength(23)
    const registry = createHostContributionContractRegistry().validationRegistry()
    for (const manifest of manifests) {
      const result = await validateContributionManifest(manifest, registry)
      expect(result.specState, `${manifest.id}: ${JSON.stringify(result.diagnostics)}`).toBe(
        'validated',
      )
    }
    const subject = descriptor()
    const candidates = manifests.map((manifest, index): CatalogPresentationCandidate => {
      const spec = manifest.spec as unknown as ViewerContributionSpecV1
      const eligibility = evaluateViewerContribution(spec, subject, {
        interpretation: 'codec',
        sourceBytes: 1024n,
        longestLineBytes: 80,
      })
      return {
        slotId: presentationSlotId(`slot-${index}`),
        kind: spec.kind,
        contributionId: manifest.id,
        extensionId: 'modkit/ui',
        priority: spec.priority,
        ...(spec.singletonGroup === undefined ? {} : { singletonGroup: spec.singletonGroup }),
        bindings: spec.consumesDataSources.map((source, bindingIndex) => ({
          bindingId: bindingId(`binding-${index}-${bindingIndex}`),
          contract: source.contract,
          major: source.major,
        })) as never,
        eligible: eligibility.eligible,
        missing: eligibility.missing,
      }
    })
    const resolve = (items: readonly CatalogPresentationCandidate[]) =>
      resolvePresentationPlan({
        descriptor: subject,
        candidates: items,
        async resolveBinding(binding) {
          return {
            ...binding,
            offerId: `offer-${binding.bindingId}`,
            providerId: 'modkit/viewer-data',
            variantId: 'portable',
            ticket: { bindingId: binding.bindingId },
          }
        },
        digest: canonicalJsonStringify,
        ticketMatches: () => true,
      })
    const forward = await resolve(candidates)
    const reverse = await resolve([...candidates].reverse())
    expect(canonicalJsonStringify(reverse)).toBe(canonicalJsonStringify(forward))
    expect(
      forward.plan.slots.find(slot => slot.slotId === forward.plan.activeStage)?.contributionId,
    ).toBe('modkit.ui/table-stage')
  })

  it('loads auditable subject calculations with a visible consumer cap', async () => {
    const snapshot = await loadSubjectCalculations(
      {
        async summary() {
          return {
            snapshotId: 'calculations-1',
            subjectId: 'unit:Marine',
            totalCalculations: 3,
            completeness: 'complete' as const,
          }
        },
        async calculations(request) {
          const offset = Number(request.cursor ?? 0)
          return {
            items: [
              {
                id: `calculation-${offset}`,
                label: `Calculation ${offset}`,
                formula: { id: 'formula', name: 'Formula', version: '1', expression: 'a + b' },
                status: 'computed' as const,
                value: offset,
                inputs: [],
                provenance: [{ label: 'fixture' }],
                warnings: [],
              },
            ],
            ...(offset >= 2 ? {} : { nextCursor: String(offset + 1) }),
          }
        },
      },
      { maximum: 2, pageSize: 1 },
    )
    expect(snapshot.calculations.map(item => item.id)).toEqual(['calculation-0', 'calculation-1'])
    expect(snapshot.capped).toBe(true)
    expect(snapshot.summary.totalCalculations).toBe(3)
  })

  it('evaluates bounded vs virtual text before viewer activation', () => {
    expect(
      evaluateViewerApplicability(
        {
          sourceBytes: { maximum: '16777216' },
          longestLineBytes: { maximum: 1048576, whenUnknown: 'ineligible' },
        },
        { interpretation: 'codec', sourceBytes: 1024n, longestLineBytes: 80 },
      ),
    ).toEqual({ eligible: true, missing: [] })
    const oversized = evaluateViewerApplicability(
      {
        sourceBytes: { maximum: '16777216' },
        longestLineBytes: { maximum: 1048576, whenUnknown: 'ineligible' },
      },
      {
        interpretation: 'codec',
        sourceBytes: 100n * 1024n * 1024n,
        longestLineBytes: 'unknown',
      },
    )
    expect(oversized.eligible).toBe(false)
    expect(oversized.missing).toEqual(['source-bytes<=16777216', 'longest-line<=1048576'])
  })

  it('keeps bounded and virtual text models mechanically distinct', async () => {
    const smallSource = {
      async info() {
        return {
          bytes: 5n,
          encoding: 'utf-8',
          bom: false,
          newline: 'lf' as const,
          lines: 1,
          longestLineBytes: 5,
        }
      },
      async slice() {
        return { complete: true as const, text: 'hello', fromLine: 0, lineCount: 1 }
      },
      async *search() {
        yield { utf16Offset: 0, utf16Length: 5, line: 0, column: 0 }
      },
    }
    expect(await new BoundedTextModel(smallSource).load()).toBe('hello')
    expect(await new BoundedTextModel(smallSource).search('hello')).toBe(1)

    let calls = 0
    const virtual = new VirtualTextModel({
      ...smallSource,
      async slice(request) {
        calls += 1
        return request.kind === 'from-line'
          ? { complete: false as const, text: 'first', fromLine: 0, lineCount: 1, nextCursor: '5' }
          : { complete: true as const, text: 'second', fromLine: 0, lineCount: 0 }
      },
    })
    expect(await virtual.first()).toMatchObject({ text: 'first', nextCursor: '5' })
    expect(await virtual.next()).toMatchObject({ text: 'second', complete: true })
    expect(await virtual.next()).toBeUndefined()
    expect(calls).toBe(2)
  })

  it('uses bigint hex offsets and bounded reads', async () => {
    const offset = 2n ** 60n
    let requested: bigint | undefined
    const model = new HexWindowModel({
      async size() {
        return offset + 8192n
      },
      async read(value, length) {
        requested = value
        return new Uint8Array(Math.min(length, 32)).fill(0x41)
      },
    })
    const window = await model.read(offset)
    expect(requested).toBe(offset)
    expect(window.bytes).toHaveLength(32)
    expect(window.text).toContain('1000000000000000')

    const controller = new AbortController()
    const cancelled = new HexWindowModel({
      async size() {
        return 1n
      },
      async read(_offset, _length, signal) {
        controller.abort('cancel-in-flight')
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
        return new Uint8Array()
      },
    })
    await expect(cancelled.read(0n, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    await expect(model.read(-1n)).rejects.toThrow(/non-negative/u)
    await expect(model.read(offset + 8193n)).rejects.toThrow(/exceeds/u)
  })

  it('loads tree facts once and table pages by cursor', async () => {
    let factCalls = 0
    const root = { id: 'root', hasChildren: true }
    const tree = new LazyTreeModel({
      async root() {
        return root
      },
      async children() {
        return { items: [{ id: 'child', hasChildren: false }] }
      },
      async facts(node) {
        factCalls += 1
        return { kind: 'fixture', label: node.id }
      },
      async *search() {
        yield root
      },
    })
    expect(await tree.facts(root)).toEqual({ kind: 'fixture', label: 'root' })
    expect(await tree.facts(root)).toEqual({ kind: 'fixture', label: 'root' })
    expect(factCalls).toBe(1)
    expect((await tree.children(root)).items[0]?.id).toBe('child')

    const requests: unknown[] = []
    let cellSignal: AbortSignal | undefined
    const table = new LazyTableModel({
      async shape() {
        return { rows: 'unknown' as const, columns: 2 }
      },
      async rows(request) {
        requests.push(request)
        return requests.length === 1
          ? { items: [{ index: 0, cells: ['a', 'b'] }], nextCursor: '1' }
          : { items: [{ index: 1, cells: ['c', 'd'] }] }
      },
      async cell(_coord, signal) {
        cellSignal = signal
        return { value: 'a' }
      },
      async *search() {
        yield { row: 0, column: 0 }
      },
    })
    expect(await table.shape()).toEqual({ rows: 'unknown', columns: 2 })
    expect((await table.first()).items[0]?.index).toBe(0)
    expect((await table.next())?.items[0]?.index).toBe(1)
    const cellController = new AbortController()
    expect(await table.cell({ row: 0, column: 0 }, cellController.signal)).toEqual({ value: 'a' })
    expect(cellSignal).toBe(cellController.signal)
    expect(requests).toHaveLength(2)
  })

  it('rejects namespace traversal and unstable entry identity', async () => {
    expect(() => normalizeNamespacePath('../secret')).toThrow(/traversal/u)
    expect(() => normalizeNamespacePath('a\\b')).toThrow(/portable/u)
    let revision: AnyDescriptor['revision'] = revisionId('content-hash.sha256:first')
    const model = new NamespaceModel({
      async list() {
        return {
          items: [
            {
              id: 'entry',
              path: 'safe/file.bin',
              name: 'file.bin',
              kind: 'file' as const,
              revision,
            },
          ],
        }
      },
      async openEntry() {
        return {
          value: { id: 'memory://safe/file.bin', uri: 'memory://safe/file.bin' },
          async release() {
            return undefined
          },
        }
      },
    })
    await model.list('safe')
    revision = revisionId('content-hash.sha256:second')
    await expect(model.list('safe')).rejects.toThrow(/identity changed/u)
  })

  it('neutralizes hostile layout controls and never treats javascript URLs as markup', () => {
    const hostile = '\u202Ejavascript:alert(1)\u200B'
    expect(safeViewerText(hostile)).toBe('\\u{202E}javascript:alert(1)\\u{200B}')
  })
})
