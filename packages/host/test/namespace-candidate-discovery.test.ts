import { CANCELLED_CODE } from '@modkitx-x3/core'
import {
  revisionId,
  type NamespaceEntry,
  type NamespaceEntrySource,
  type PageRequest,
} from '@modkitx-x3/sdk'
import { describe, expect, it } from 'vitest'
import {
  createWorkspaceNamespaceCandidateDiscovery,
  type WorkspaceNamespaceCandidateDiscoveryLimits,
} from '../src/index.js'
import { containerEntryRevision } from '../src/namespace-origin.js'

const containerRevision = revisionId('provider-token:namespace-candidate-test')
const roots = Object.freeze([
  { rootId: 'active', pathPrefix: 'mods/active.package/base.assets' },
  { rootId: 'dependency', pathPrefix: 'mods/dependency.package/base.assets' },
])
const searches = Object.freeze([
  { rootId: 'active', logicalPrefix: 'assets/characters' },
  { rootId: 'dependency', logicalPrefix: 'assets/characters' },
])
const limits: WorkspaceNamespaceCandidateDiscoveryLimits = Object.freeze({
  pageItems: 2,
  maxPages: 8,
  maxEntries: 16,
  maxCandidates: 8,
  maxBytes: 1_024n,
})

function entry(path: string, size: bigint | null = 16n): NamespaceEntry {
  return Object.freeze({
    id: path,
    path,
    name: path.split('/').at(-1) ?? path,
    kind: 'file',
    ...(size === null ? {} : { size }),
    revision: containerRevision,
  })
}

function namespaceSource(entries: readonly NamespaceEntry[]): NamespaceEntrySource {
  return Object.freeze({
    async list(prefix: string, page: PageRequest) {
      const matching = entries.filter(item => item.path.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      const items = matching.slice(start, start + page.limit)
      const next = start + items.length
      return Object.freeze({
        items: Object.freeze(items),
        ...(next < matching.length ? { nextCursor: String(next) } : {}),
      })
    },
    async openEntry(entryId: string) {
      return Object.freeze({
        value: Object.freeze({ id: entryId, uri: `memory://namespace/${entryId}` }),
        release: async () => undefined,
      })
    },
  })
}

function discovery(
  entries: readonly NamespaceEntry[],
  overrides: Partial<WorkspaceNamespaceCandidateDiscoveryLimits> = {},
) {
  return createWorkspaceNamespaceCandidateDiscovery({
    namespace: namespaceSource(entries),
    containerRevision,
    logicalRoots: roots,
    searches,
    extension: '.m3a',
    limits: { ...limits, ...overrides },
  })
}

describe('workspace namespace candidate discovery', () => {
  it('orders exact-extension candidates by explicit root precedence and pins entry revisions', async () => {
    const activeB = entry('mods/active.package/base.assets/assets/characters/b/b.m3a', 31n)
    const activeA = entry('mods/active.package/base.assets/assets/characters/a/a.m3a', 29n)
    const dependencyDuplicate = entry(
      'mods/dependency.package/base.assets/assets/characters/a/a.m3a',
      37n,
    )
    const dependencyC = entry('mods/dependency.package/base.assets/assets/characters/c/c.M3A', 41n)
    const result = await discovery([
      activeB,
      entry('mods/active.package/base.assets/assets/characters/readme.txt'),
      activeA,
      dependencyC,
      dependencyDuplicate,
      entry('mods/active.package/base.assets/assets/other/out-of-scope.m3a'),
    ]).discover()

    expect(result.state).toBe('complete')
    if (result.state !== 'complete') throw new Error(result.message)
    expect(result.candidates).toEqual([
      {
        logicalId: 'assets/characters/a/a.m3a',
        expectedRevision: containerEntryRevision(containerRevision, activeA.id, 29),
        size: 29n,
        rootId: 'active',
      },
      {
        logicalId: 'assets/characters/b/b.m3a',
        expectedRevision: containerEntryRevision(containerRevision, activeB.id, 31),
        size: 31n,
        rootId: 'active',
      },
      {
        logicalId: 'assets/characters/c/c.M3A',
        expectedRevision: containerEntryRevision(containerRevision, dependencyC.id, 41),
        size: 41n,
        rootId: 'dependency',
      },
    ])
    expect(result.receipt).toMatchObject({
      complete: true,
      entries: 5,
      candidates: 3,
      bytes: 101n,
      searches,
    })
  })

  it('publishes no partial candidates when entry, candidate or byte budgets are exhausted', async () => {
    const entries = [
      entry('mods/active.package/base.assets/assets/characters/a.m3a', 17n),
      entry('mods/active.package/base.assets/assets/characters/b.m3a', 19n),
    ]
    for (const overrides of [
      { pageItems: 1, maxPages: 1 },
      { maxEntries: 1 },
      { maxCandidates: 1 },
      { maxBytes: 20n },
    ]) {
      const result = await discovery(entries, overrides).discover()
      expect(result).toMatchObject({
        state: 'refused',
        reason: 'budget-exceeded',
        candidates: [],
        receipt: { complete: false, candidates: 0, bytes: 0n },
      })
    }
  })

  it('fails closed when a candidate has no bounded size and completes an empty search honestly', async () => {
    const unbounded = await discovery([
      entry('mods/active.package/base.assets/assets/characters/a.m3a', null),
    ]).discover()
    expect(unbounded).toMatchObject({
      state: 'refused',
      reason: 'size-unavailable',
      candidates: [],
    })

    const empty = await discovery([
      entry('mods/active.package/base.assets/assets/characters/model.m3'),
    ]).discover()
    expect(empty).toMatchObject({
      state: 'complete',
      candidates: [],
      receipt: { complete: true, candidates: 0, bytes: 0n },
    })
  })

  it('propagates cancellation before namespace paging', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(discovery([]).discover(controller.signal)).rejects.toMatchObject({
      code: CANCELLED_CODE,
    })
  })

  it('propagates cancellation immediately after an awaited page', async () => {
    const controller = new AbortController()
    const source = namespaceSource([])
    const cancellingSource: NamespaceEntrySource = Object.freeze({
      ...source,
      async list() {
        controller.abort()
        return Object.freeze({ items: Object.freeze([]) })
      },
    })
    const subject = createWorkspaceNamespaceCandidateDiscovery({
      namespace: cancellingSource,
      containerRevision,
      logicalRoots: roots,
      searches,
      extension: '.m3a',
      limits,
    })
    await expect(subject.discover(controller.signal)).rejects.toMatchObject({
      code: CANCELLED_CODE,
    })
  })

  it('refuses malformed and overproduced pages without publishing partial candidates', async () => {
    const validSource = namespaceSource([])
    const invalidPages = [
      { items: 'not-an-array' },
      {
        items: [
          entry('mods/active.package/base.assets/assets/characters/a.m3a'),
          entry('mods/active.package/base.assets/assets/characters/b.m3a'),
        ],
      },
    ]
    for (const invalidPage of invalidPages) {
      const invalidSource: NamespaceEntrySource = Object.freeze({
        ...validSource,
        async list() {
          return invalidPage as never
        },
      })
      const result = await createWorkspaceNamespaceCandidateDiscovery({
        namespace: invalidSource,
        containerRevision,
        logicalRoots: roots,
        searches,
        extension: '.m3a',
        limits: { ...limits, pageItems: 1 },
      }).discover()
      expect(result).toMatchObject({
        state: 'refused',
        reason: 'namespace-invalid',
        candidates: [],
        receipt: { complete: false, candidates: 0, bytes: 0n },
      })
    }
  })
})
