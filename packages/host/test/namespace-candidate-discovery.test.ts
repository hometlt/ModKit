import { CANCELLED_CODE } from '@modkit/core'
import {
  revisionId,
  type NamespaceEntry,
  type NamespaceEntrySource,
  type PageRequest,
  type RevisionId,
} from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import {
  createWorkspaceNamespaceCandidateDiscovery,
  type WorkspaceNamespaceCandidateDiscoveryLimits,
} from '../src/index.js'
import {
  containerEntryRevision,
  createWorkspaceNamespaceCompanionOrigin,
  type WorkspaceNamespaceDiscoveredCandidate,
  type WorkspaceNamespaceLogicalRoot,
} from '../src/namespace-origin.js'
import { createResourceSession } from '../src/resource-session.js'
import { COMPANION_PATH_REFUSED } from '../src/input-resolution.js'

const containerRevision: RevisionId = revisionId('provider-token:namespace-candidate-test')
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

async function expectResolvedCandidates(
  source: NamespaceEntrySource,
  logicalRoots: readonly WorkspaceNamespaceLogicalRoot[],
  candidates: readonly WorkspaceNamespaceDiscoveredCandidate[],
  expected: readonly NamespaceEntry[],
) {
  const resources = createResourceSession({
    revision: containerRevision,
    origin: createWorkspaceNamespaceCompanionOrigin({
      namespace: source,
      containerRevision,
      primaryLogicalId: 'model.m3',
      logicalRoots,
      async extract(entryId) {
        const selected = expected.find(item => item.id === entryId)
        if (selected?.size === undefined) throw new Error(`unexpected extracted entry ${entryId}`)
        return new Uint8Array(Number(selected.size))
      },
    }),
  })
  try {
    expect(candidates).toHaveLength(expected.length)
    for (const [index, candidate] of candidates.entries()) {
      const resolved = await resources.resolve({
        id: `discovered-${index}`,
        logicalId: candidate.logicalId,
        role: 'sidecar',
        scopes: ['workspace-dependency-layer'],
      })
      expect(resolved.state).toBe('resolved')
      if (resolved.state !== 'resolved') throw new Error(resolved.reason)
      try {
        expect(resolved.revision).toBe(candidate.expectedRevision)
        expect(resolved.lease.value.revision).toBe(candidate.expectedRevision)
        expect(resolved.lease.value.ref.id).toBe(expected[index]?.id)
        if (resolved.lease.value.kind !== 'bytes') throw new Error('expected a byte resource')
        expect(resolved.lease.value.size).toBe(candidate.size)
      } finally {
        await resolved.lease.release()
      }
    }
  } finally {
    await resources.dispose()
  }
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

  it('selects the same overlay revision as resolve when searches start with the lower root', async () => {
    const active = entry('mods/active.package/base.assets/assets/characters/shared.m3a', 11n)
    const dependency = entry(
      'mods/dependency.package/base.assets/assets/characters/shared.m3a',
      999n,
    )
    const source = namespaceSource([dependency, active])
    const reversedSearches = [...searches].reverse()
    const result = await createWorkspaceNamespaceCandidateDiscovery({
      namespace: source,
      containerRevision,
      logicalRoots: roots,
      searches: reversedSearches,
      extension: '.m3a',
      limits: { ...limits, maxBytes: 11n, maxCandidates: 1 },
    }).discover()
    expect(result.state).toBe('complete')
    if (result.state !== 'complete') throw new Error(result.message)
    expect(result.candidates).toEqual([
      {
        logicalId: 'assets/characters/shared.m3a',
        expectedRevision: containerEntryRevision(containerRevision, active.id, 11),
        size: 11n,
        rootId: 'active',
      },
    ])
    expect(result.receipt).toMatchObject({ bytes: 11n, searches: reversedSearches })
    await expectResolvedCandidates(source, roots, result.candidates, [active])
  })

  it.each([
    {
      pathPrefix: '',
      logicalPrefix: undefined,
      search: '',
      path: 'characters/a.m3a',
      logicalId: 'characters/a.m3a',
      requested: '',
    },
    {
      pathPrefix: '',
      logicalPrefix: 'assets',
      search: '',
      path: 'characters/a.m3a',
      logicalId: 'assets/characters/a.m3a',
      requested: '',
    },
    {
      pathPrefix: '',
      logicalPrefix: 'assets',
      search: 'assets/characters',
      path: 'characters/a.m3a',
      logicalId: 'assets/characters/a.m3a',
      requested: 'characters/',
    },
    {
      pathPrefix: 'payload',
      logicalPrefix: 'assets',
      search: 'assets/characters',
      path: 'payload/characters/a.m3a',
      logicalId: 'assets/characters/a.m3a',
      requested: 'payload/characters/',
    },
    {
      pathPrefix: 'payload',
      logicalPrefix: 'assets',
      search: 'assets',
      path: 'payload/characters/a.m3a',
      logicalId: 'assets/characters/a.m3a',
      requested: 'payload/',
    },
    {
      pathPrefix: 'payload',
      logicalPrefix: 'assets',
      search: '',
      path: 'payload/characters/a.m3a',
      logicalId: 'assets/characters/a.m3a',
      requested: 'payload/',
    },
    {
      pathPrefix: 'payload',
      logicalPrefix: 'Assets',
      search: 'assets/characters',
      path: 'payload/characters/a.m3a',
      logicalId: 'Assets/characters/a.m3a',
      requested: 'payload/characters/',
    },
  ])(
    'maps $pathPrefix + $logicalPrefix / $search identically for discovery and resolve',
    async testCase => {
      const selected = entry(testCase.path, 19n)
      const base = namespaceSource([selected])
      const prefixes: string[] = []
      const source: NamespaceEntrySource = {
        ...base,
        async list(prefix, page, signal) {
          prefixes.push(prefix)
          return base.list(prefix, page, signal)
        },
      }
      const logicalRoots = [
        {
          rootId: 'mapped',
          pathPrefix: testCase.pathPrefix,
          ...(testCase.logicalPrefix === undefined
            ? {}
            : { logicalPrefix: testCase.logicalPrefix }),
        },
      ]
      const result = await createWorkspaceNamespaceCandidateDiscovery({
        namespace: source,
        containerRevision,
        logicalRoots,
        searches: [{ rootId: 'mapped', logicalPrefix: testCase.search }],
        extension: '.m3a',
        limits,
      }).discover()
      expect(prefixes).toEqual([testCase.requested])
      expect(result.state).toBe('complete')
      if (result.state !== 'complete') throw new Error(result.message)
      expect(result.candidates).toEqual([
        {
          logicalId: testCase.logicalId,
          expectedRevision: containerEntryRevision(containerRevision, selected.id, 19),
          size: 19n,
          rootId: 'mapped',
        },
      ])
      await expectResolvedCandidates(source, logicalRoots, result.candidates, [selected])
    },
  )

  it.each(['assets2', 'assets2/characters', 'characters'])(
    'refuses public search prefix %s outside the mapped root',
    logicalPrefix => {
      expect(() =>
        createWorkspaceNamespaceCandidateDiscovery({
          namespace: namespaceSource([]),
          containerRevision,
          logicalRoots: [{ rootId: 'mapped', pathPrefix: 'payload', logicalPrefix: 'assets' }],
          searches: [{ rootId: 'mapped', logicalPrefix }],
          extension: '.m3a',
          limits,
        }),
      ).toThrow('outside logical root')
    },
  )

  it.each([
    entry('mods/active.package/base.assets/assets/other/leak.m3a'),
    entry('mods/active.package/base.assets/assets/characters-extra/leak.m3a'),
    entry('mods/dependency.package/base.assets/assets/characters/leak.m3a'),
    entry('mods/active.package/base.assets/assets/other/readme.txt'),
    { ...entry('mods/active.package/base.assets/assets/other'), kind: 'directory' as const },
    entry('mods/active.package/base.assets/assets/characters/../other/leak.m3a'),
    entry('mods/active.package/base.assets/assets/characters/./alias.m3a'),
  ])('refuses escaped/noncanonical entry $path after an otherwise valid page', async escaped => {
    const valid = entry('mods/active.package/base.assets/assets/characters/a.m3a')
    let calls = 0
    const source: NamespaceEntrySource = {
      ...namespaceSource([]),
      async list() {
        calls++
        return calls === 1 ? { items: [valid], nextCursor: 'next' } : { items: [escaped] }
      },
    }
    const result = await createWorkspaceNamespaceCandidateDiscovery({
      namespace: source,
      containerRevision,
      logicalRoots: roots,
      searches,
      extension: '.m3a',
      limits: { ...limits, pageItems: 1 },
    }).discover()
    expect(calls).toBe(2)
    expect(result).toMatchObject({
      state: 'refused',
      reason: 'namespace-invalid',
      candidates: [],
      receipt: { complete: false, candidates: 0, bytes: 0n },
    })
  })

  it('refuses incomplete precedence coverage without probing undeclared higher-root subtrees', async () => {
    const active = entry('mods/active.package/base.assets/assets/characters/a.m3a', 17n)
    const dependency = entry('mods/dependency.package/base.assets/assets/characters/a.m3a', 19n)
    const base = namespaceSource([active, dependency])
    const prefixes: string[] = []
    const source: NamespaceEntrySource = {
      ...base,
      async list(prefix, page, signal) {
        prefixes.push(prefix)
        return base.list(prefix, page, signal)
      },
    }
    const result = await createWorkspaceNamespaceCandidateDiscovery({
      namespace: source,
      containerRevision,
      logicalRoots: roots,
      searches: [{ rootId: 'dependency', logicalPrefix: 'assets/characters' }],
      extension: '.m3a',
      limits,
    }).discover()
    expect(prefixes).toEqual(['mods/dependency.package/base.assets/assets/characters/'])
    expect(result).toMatchObject({
      state: 'refused',
      reason: 'namespace-invalid',
      candidates: [],
      receipt: { complete: false, candidates: 0, bytes: 0n },
    })
    if (result.state !== 'refused') throw new Error('expected a refused discovery')
    expect(result.message).toContain('incomplete precedence coverage')
    expect(result.message).toContain('may serve the same logical id')
  })

  it.each(['covered-empty', 'incompatible-prefix', 'directory-prefix-only'])(
    'allows lower-root candidates with %s higher roots',
    async mode => {
      const selected = entry('mods/dependency.package/base.assets/assets/characters/a.m3a', 19n)
      const source = namespaceSource([selected])
      const logicalRoots = roots.map(root => ({
        ...root,
        ...(root.rootId === 'active' && mode !== 'covered-empty'
          ? {
              logicalPrefix:
                mode === 'incompatible-prefix' ? 'unrelated' : 'assets/characters/a.m3a',
            }
          : {}),
      }))
      const result = await createWorkspaceNamespaceCandidateDiscovery({
        namespace: source,
        containerRevision,
        logicalRoots,
        searches:
          mode === 'covered-empty'
            ? [...searches].reverse()
            : [{ rootId: 'dependency', logicalPrefix: 'assets/characters' }],
        extension: '.m3a',
        limits,
      }).discover()
      expect(result.state).toBe('complete')
      if (result.state !== 'complete') throw new Error(result.message)
      expect(result.candidates[0]?.rootId).toBe('dependency')
      await expectResolvedCandidates(source, logicalRoots, result.candidates, [selected])
    },
  )

  it.each([17n, 36n])(
    'snapshots paths, source revision and the %s-byte budget before awaited pages',
    async maxBytes => {
      const first = entry('payload/characters/a.m3a', 17n)
      const second = entry('payload/characters/b.m3a', 19n)
      const base = namespaceSource([first, second])
      const prefixes: string[] = []
      const source: NamespaceEntrySource = {
        ...base,
        async list(prefix, page, signal) {
          prefixes.push(prefix)
          options.namespace = namespaceSource([])
          options.containerRevision = revisionId('provider-token:changed-after-snapshot')
          options.limits.maxBytes = 1_000n
          options.logicalRoots.forEach(root => {
            root.pathPrefix = 'outside'
            root.logicalPrefix = 'elsewhere'
          })
          options.searches.forEach(search => {
            search.logicalPrefix = ''
          })
          return base.list(prefix, page, signal)
        },
      }
      const options = {
        namespace: source,
        containerRevision,
        logicalRoots: [{ rootId: 'mapped', pathPrefix: 'payload', logicalPrefix: 'assets' }],
        searches: [{ rootId: 'mapped', logicalPrefix: 'assets/characters' }],
        extension: '.m3a',
        limits: { ...limits, maxBytes, pageItems: 1 },
      }
      const result = await createWorkspaceNamespaceCandidateDiscovery(options).discover()
      expect(prefixes).toEqual(['payload/characters/', 'payload/characters/'])
      expect(result.receipt.searches).toEqual([
        { rootId: 'mapped', logicalPrefix: 'assets/characters' },
      ])
      if (maxBytes === 17n) {
        expect(result).toMatchObject({
          state: 'refused',
          reason: 'budget-exceeded',
          candidates: [],
        })
      } else {
        expect(result.state).toBe('complete')
        if (result.state !== 'complete') throw new Error(result.message)
        expect(result.candidates.map(candidate => candidate.logicalId)).toEqual([
          'assets/characters/a.m3a',
          'assets/characters/b.m3a',
        ])
        expect(result.candidates.map(candidate => candidate.expectedRevision)).toEqual([
          containerEntryRevision(containerRevision, first.id, 17),
          containerEntryRevision(containerRevision, second.id, 19),
        ])
        expect(result.receipt.bytes).toBe(36n)
      }
    },
  )

  it.each(['../escape', 'assets/../escape', '/absolute', 'C:\\absolute'])(
    'refuses traversal/absolute discovery configuration %s',
    unsafe => {
      const options = {
        namespace: namespaceSource([]),
        containerRevision,
        logicalRoots: roots.filter(root => root.rootId === 'active'),
        searches: searches.filter(search => search.rootId === 'active'),
        extension: '.m3a',
        limits,
      }
      for (const invalid of [
        { ...options, logicalRoots: [{ rootId: 'active', pathPrefix: unsafe }] },
        { ...options, logicalRoots: [{ rootId: 'active', pathPrefix: '', logicalPrefix: unsafe }] },
        { ...options, searches: [{ rootId: 'active', logicalPrefix: unsafe }] },
      ])
        expect(() => createWorkspaceNamespaceCandidateDiscovery(invalid)).toThrow(
          expect.objectContaining({ code: COMPANION_PATH_REFUSED }),
        )
    },
  )

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
