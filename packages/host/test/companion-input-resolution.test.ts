/**
 * The contract of host-owned companion input resolution (block 9, step 1).
 *
 * Everything here runs against a *fake* origin backend, on purpose: the algorithm's job is to be
 * the same algorithm for a directory, an archive namespace and whatever comes third, so the suite
 * that defines it must not be able to smuggle a filesystem assumption in. The fake counts
 * enumerations, opens and releases, which is how the three load-bearing claims get proved rather
 * than asserted — the hot path touches nothing, every failure point releases what it took, and no
 * outcome depends on the order the backend happened to enumerate in.
 *
 * The real filesystem backend is exercised end-to-end in `companion-sibling.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import {
  CANCELLED_CODE,
  isModkitError,
  throwIfAborted,
  traitId,
  type Diagnostic,
} from '@modkit/core'
import {
  revisionId,
  type ArtifactByteSource,
  type ArtifactNamespaceSource,
  type ArtifactSource,
  type AssetInput,
  type AssetInputRequirement,
  type AssetNamespace,
  type DetectionResult,
  type InputSearchScope,
  type Lease,
  type PhysicalAssetInputPlan,
} from '@modkit/sdk'
import { buildInventory, createHostContributionContractRegistry } from '@modkit/host'
import { loadExtensionDirectory } from '@modkit/host/node'
import { join } from 'node:path'
import {
  COMPANION_AMBIGUOUS,
  COMPANION_BUDGET_EXCEEDED,
  COMPANION_PATH_REFUSED,
  COMPANION_PATTERN_INVALID,
  COMPANION_PLAN_INVALID,
  COMPANION_REQUIRED_MISSING,
  COMPANION_SCOPE_UNSUPPORTED,
  COMPANION_TRAIT_PROBE_UNAVAILABLE,
  COMPANION_UNAVAILABLE,
  createCompanionInputResolver,
  type CompanionInputResolverOptions,
  createSignatureTraitProbe,
  type CompanionCaseSensitivity,
  type CompanionEnumerationOptions,
  type CompanionOrigin,
  type CompanionOriginEntry,
  type CompanionTraitProbe,
} from '../src/input-resolution.js'
import type { SubjectInputResolutionContext } from '../src/subject-open.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')

const detection: DetectionResult = Object.freeze({
  codecId: 'org.example/companion-fixture',
  confidence: 1,
  evidence: Object.freeze([]),
  requiredRanges: Object.freeze([]),
}) as DetectionResult

interface Counters {
  enumerations: number
  entries: number
  opens: number
  releases: number
  doubleRelease: boolean
  readonly opened: string[]
  /** Listing prefixes the resolver asked this backend to narrow to. */
  readonly prefixes: string[]
}

interface FakeOriginOptions {
  readonly entries: readonly string[]
  readonly primaryLogicalId?: string
  readonly caseSensitivity?: CompanionCaseSensitivity
  readonly scopes?: readonly InputSearchScope[]
  readonly bytesFor?: (logicalId: string) => Uint8Array
  /** Called after each yielded entry — the seam for "abort in the middle of enumerate". */
  readonly onEntry?: (logicalId: string, index: number) => void
  /** Called before each open — the seam for "abort in the middle of open". */
  readonly onOpen?: (logicalId: string, index: number) => void
  readonly honorPrefix?: boolean
}

function fakeOrigin(options: FakeOriginOptions): {
  readonly origin: CompanionOrigin
  readonly counters: Counters
} {
  const counters: Counters = {
    enumerations: 0,
    entries: 0,
    opens: 0,
    releases: 0,
    doubleRelease: false,
    opened: [],
    prefixes: [],
  }
  const scopes = options.scopes ?? (['sibling-directory'] as const)
  const origin: CompanionOrigin = Object.freeze({
    primaryLogicalId: options.primaryLogicalId ?? 'primary.vxl',
    caseSensitivity: options.caseSensitivity ?? 'sensitive',
    scopes,
    async *enumerate(
      scope: InputSearchScope,
      enumeration: CompanionEnumerationOptions,
      signal?: AbortSignal,
    ): AsyncIterable<CompanionOriginEntry> {
      counters.enumerations += 1
      counters.prefixes.push(enumeration.prefix)
      if (!scopes.includes(scope)) return
      let index = 0
      for (const logicalId of options.entries) {
        if (options.honorPrefix === true && !logicalId.startsWith(enumeration.prefix)) continue
        // exactly what the real backends do: cancellation is the host's own error, not a raw one
        throwIfAborted(signal)
        counters.entries += 1
        yield { logicalId }
        options.onEntry?.(logicalId, index)
        index += 1
      }
    },
    async open(logicalId: string): Promise<Lease<ArtifactSource>> {
      options.onOpen?.(logicalId, counters.opens)
      counters.opens += 1
      counters.opened.push(logicalId)
      const bytes = options.bytesFor?.(logicalId) ?? new Uint8Array([0])
      const uri = `fake://origin/${logicalId}`
      let released = false
      const source: ArtifactByteSource = {
        kind: 'bytes',
        ref: { id: uri, uri },
        revision: revisionId(`provider-token:${encodeURIComponent(logicalId)}`),
        size: BigInt(bytes.byteLength),
        async read(offset, length) {
          return bytes.slice(Number(offset), Number(offset) + length)
        },
        async *stream() {
          yield bytes
        },
      }
      return {
        value: source,
        async release() {
          if (released) {
            counters.doubleRelease = true
            return
          }
          released = true
          counters.releases += 1
        },
      }
    },
  })
  return { origin, counters }
}

function byteSource(
  name: string,
  bytes = new Uint8Array([1, 2, 3]),
): ArtifactByteSource & {
  readonly reads: () => number
} {
  let reads = 0
  const uri = `memory://companion/${name}`
  return Object.freeze({
    kind: 'bytes' as const,
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:${name}`),
    size: BigInt(bytes.byteLength),
    reads: () => reads,
    async read(offset: bigint, length: number) {
      reads += 1
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      reads += 1
      yield bytes
    },
  })
}

function namespaceSource(name: string): ArtifactNamespaceSource & { readonly opens: () => number } {
  let opens = 0
  const uri = `memory://companion-namespace/${name}`
  const namespace: AssetNamespace = {
    revision: revisionId(`content-hash.sha256:${name}`),
    async *list(): AsyncIterable<never> {
      // the fixture namespace is empty; enumeration is the origin's job, never the source's
    },
    async open(): Promise<Lease<ArtifactSource>> {
      throw new Error('namespace fixture holds no entries')
    },
  }
  return Object.freeze({
    kind: 'namespace' as const,
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:${name}`),
    opens: () => opens,
    async openNamespace(): Promise<Lease<AssetNamespace>> {
      opens += 1
      return { value: namespace, release: async () => undefined }
    },
  })
}

function requirement(
  overrides: Partial<AssetInputRequirement> & Pick<AssetInputRequirement, 'id' | 'role'>,
): AssetInputRequirement {
  return {
    ownership: 'companion',
    patterns: ['*.hva'],
    scopes: ['sibling-directory'],
    cardinality: 'zero-or-one',
    required: false,
    ...overrides,
  } as AssetInputRequirement
}

function bundlePlan(requirements: readonly AssetInputRequirement[]): PhysicalAssetInputPlan {
  return {
    originKind: 'bundle',
    candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
    requirements,
  }
}

function context(
  plan: PhysicalAssetInputPlan,
  source: ArtifactSource,
  signal?: AbortSignal,
): SubjectInputResolutionContext {
  return { source, plan, detection, ...(signal === undefined ? {} : { signal }) }
}

/** Every plan in this suite is physical; `openBinding` lives only on that arm of the union. */
function physical(input: AssetInput): Exclude<AssetInput, { readonly originKind: 'derived' }> {
  if (input.originKind === 'derived') throw new Error('a physical plan resolved as derived')
  return input
}

/** The resolver under test, already narrowed: no case here plans a derived input. */
function companionResolver(
  origin: CompanionOrigin,
  options?: CompanionInputResolverOptions,
): (
  request: SubjectInputResolutionContext,
) => Promise<Exclude<AssetInput, { readonly originKind: 'derived' }>> {
  const resolve = createCompanionInputResolver(origin, options ?? {})
  return async request => physical(await resolve(request))
}

async function codeOf(action: () => unknown): Promise<string> {
  try {
    await action()
  } catch (error) {
    return isModkitError(error) ? error.code : `not-a-modkit-error:${String(error)}`
  }
  return 'no-error'
}

async function contextOf(action: () => unknown): Promise<Record<string, unknown>> {
  try {
    await action()
  } catch (error) {
    if (isModkitError(error)) return (error.context ?? {}) as Record<string, unknown>
    throw error
  }
  throw new Error('expected the resolution to fail')
}

describe('companion input resolution — the hot path pays nothing', () => {
  it('resolves a single-file plan without enumerating or opening anything', async () => {
    const { origin, counters } = fakeOrigin({ entries: ['primary.hva'] })
    const source = byteSource('primary.vxl')
    const resolve = companionResolver(origin)
    const input = await resolve(
      context(
        {
          originKind: 'single',
          candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
          requirements: [],
        },
        source,
      ),
    )

    expect(input.originKind).toBe('single')
    expect(input.bindings).toHaveLength(1)
    expect(input.bindingsFor('anything')).toEqual([])
    expect(counters.enumerations).toBe(0)
    expect(counters.opens).toBe(0)
    expect(source.reads()).toBe(0)

    // and the candidate binding is still the very source that was probed — not a re-open
    const lease = await input.openBinding('content')
    expect(lease.value).toBe(source)
    await lease.release()
    expect(counters.opens).toBe(0)
  })

  it('resolves a namespace plan with no requirements without enumerating the origin', async () => {
    const { origin, counters } = fakeOrigin({ entries: ['a.hva'] })
    const source = namespaceSource('mount')
    const resolve = companionResolver(origin)
    const input = await resolve(context({ originKind: 'namespace', requirements: [] }, source))

    expect(input.originKind).toBe('namespace')
    expect(input.bindings).toEqual([])
    expect(counters.enumerations).toBe(0)
    expect(counters.opens).toBe(0)
    expect(source.opens()).toBe(0)
  })
})

describe('companion input resolution — cardinality', () => {
  it('binds a required companion and hands it over only through bindingsFor/openBinding', async () => {
    const { origin, counters } = fakeOrigin({
      entries: ['primary.vxl', 'primary.hva', 'other.txt'],
    })
    const resolve = companionResolver(origin)
    const input = await resolve(
      context(
        bundlePlan([
          requirement({ id: 'motion', role: 'animation', cardinality: 'one', required: true }),
        ]),
        byteSource('primary.vxl'),
      ),
    )

    expect(input.originKind).toBe('bundle')
    const bound = input.bindingsFor('motion')
    expect(bound).toHaveLength(1)
    expect(bound[0]).toMatchObject({
      sourceKind: 'requirement',
      requirementId: 'motion',
      role: 'animation',
      ownership: 'companion',
    })
    // the primary is never offered to itself, and a non-matching sibling never appears
    expect(input.bindings.map(item => item.bindingId)).toEqual(['content', 'motion#primary.hva'])
    expect(input.revisions.topology).toBe('bundle')
    expect(input.revisions.compositionFingerprint).toContain('primary.hva')

    const lease = await input.openBinding('motion#primary.hva')
    expect(lease.value.kind).toBe('bytes')
    await lease.release()
    expect(counters.opens).toBe(counters.releases)
    expect(counters.doubleRelease).toBe(false)
  })

  it('reports a missing required companion with its id, role and the scopes it checked', async () => {
    const { origin, counters } = fakeOrigin({ entries: ['primary.vxl', 'unrelated.txt'] })
    const resolve = companionResolver(origin)
    const failing = () =>
      resolve(
        context(
          bundlePlan([
            requirement({ id: 'motion', role: 'animation', cardinality: 'one', required: true }),
          ]),
          byteSource('primary.vxl'),
        ),
      )

    expect(await codeOf(failing)).toBe(COMPANION_REQUIRED_MISSING)
    expect(await contextOf(failing)).toMatchObject({
      requirementId: 'motion',
      role: 'animation',
      cardinality: 'one',
      checkedScopes: ['sibling-directory'],
    })
    expect(counters.opens).toBe(counters.releases)
  })

  it('opens without a binding when an optional companion is absent, and names the reason', async () => {
    const reported: Diagnostic[] = []
    const { origin } = fakeOrigin({ entries: ['primary.vxl'] })
    const resolve = companionResolver(origin, {
      onDiagnostic: item => reported.push(item),
    })
    const input = await resolve(
      context(
        bundlePlan([requirement({ id: 'palette', role: 'palette' })]),
        byteSource('primary.vxl'),
      ),
    )

    expect(input.bindingsFor('palette')).toEqual([])
    expect(input.bindings.map(item => item.bindingId)).toEqual(['content'])
    expect(reported).toEqual([
      expect.objectContaining({
        code: COMPANION_UNAVAILABLE,
        severity: 'information',
        data: expect.objectContaining({ requirementId: 'palette', reason: 'no-candidate-matched' }),
      }),
    ])
  })

  it('opens without a listed optional companion that will not open, and names why', async () => {
    const reported: Diagnostic[] = []
    const { origin } = fakeOrigin({
      entries: ['primary.vxl', 'locked.hva'],
      onOpen: logicalId => {
        if (logicalId === 'locked.hva') throw new Error('sharing violation')
      },
    })
    const resolve = companionResolver(origin, { onDiagnostic: item => reported.push(item) })
    const input = await resolve(
      context(
        bundlePlan([requirement({ id: 'motion', role: 'animation' })]),
        byteSource('primary.vxl'),
      ),
    )
    expect(input.bindingsFor('motion')).toEqual([])
    expect(reported).toEqual([
      expect.objectContaining({
        code: COMPANION_UNAVAILABLE,
        data: expect.objectContaining({ reason: 'open-failed', error: 'sharing violation' }),
      }),
    ])
    // a required one that will not open still fails the open
    await expect(
      companionResolver(origin)(
        context(
          bundlePlan([
            requirement({ id: 'motion', role: 'animation', required: true, cardinality: 'one' }),
          ]),
          byteSource('primary.vxl'),
        ),
      ),
    ).rejects.toThrow('sharing violation')
  })

  it('refuses to choose between two candidates where at most one was declared', async () => {
    const { origin, counters } = fakeOrigin({
      entries: ['primary.vxl', 'left.hva', 'right.hva'],
    })
    const resolve = companionResolver(origin)
    const failing = () =>
      resolve(
        context(
          bundlePlan([requirement({ id: 'motion', role: 'animation' })]),
          byteSource('primary.vxl'),
        ),
      )

    expect(await codeOf(failing)).toBe(COMPANION_AMBIGUOUS)
    expect(await contextOf(failing)).toMatchObject({
      requirementId: 'motion',
      candidates: ['left.hva', 'right.hva'],
    })
    expect(counters.opens).toBe(counters.releases)
  })

  it('orders one-or-more bindings by logical id, not by enumeration order', async () => {
    const forward = fakeOrigin({ entries: ['primary.vxl', 'a.hva', 'b.hva', 'c.hva'] })
    const reversed = fakeOrigin({ entries: ['c.hva', 'b.hva', 'primary.vxl', 'a.hva'] })
    const plan = bundlePlan([
      requirement({ id: 'motion', role: 'animation', cardinality: 'one-or-more', required: true }),
    ])

    const ids = async (origin: CompanionOrigin): Promise<readonly string[]> => {
      const input = await companionResolver(origin)(context(plan, byteSource('primary.vxl')))
      return input.bindingsFor('motion').map(item => item.bindingId)
    }

    expect(await ids(forward.origin)).toEqual(['motion#a.hva', 'motion#b.hva', 'motion#c.hva'])
    expect(await ids(reversed.origin)).toEqual(await ids(forward.origin))
  })

  it('keeps several requirements with independent roles apart', async () => {
    const { origin } = fakeOrigin({
      entries: ['primary.vxl', 'primary.hva', 'primary.pal', 'spare.pal'],
    })
    const resolve = companionResolver(origin)
    const input = await resolve(
      context(
        bundlePlan([
          requirement({
            id: 'motion',
            role: 'animation',
            patterns: ['*.hva'],
            cardinality: 'one',
            required: true,
          }),
          requirement({
            id: 'colours',
            role: 'palette',
            patterns: ['*.pal'],
            cardinality: 'many',
            required: false,
          }),
        ]),
        byteSource('primary.vxl'),
      ),
    )

    expect(input.bindingsFor('motion').map(item => item.role)).toEqual(['animation'])
    expect(input.bindingsFor('colours').map(item => item.bindingId)).toEqual([
      'colours#primary.pal',
      'colours#spare.pal',
    ])
    expect(input.bindingsFor('unknown-requirement')).toEqual([])
  })

  it('rejects a plan whose cardinality and requiredness disagree', async () => {
    const { origin } = fakeOrigin({ entries: ['primary.vxl'] })
    const resolve = companionResolver(origin)
    const failing = () =>
      resolve(
        context(
          bundlePlan([
            {
              ...requirement({ id: 'motion', role: 'animation' }),
              cardinality: 'one',
            } as AssetInputRequirement,
          ]),
          byteSource('primary.vxl'),
        ),
      )
    expect(await codeOf(failing)).toBe(COMPANION_PLAN_INVALID)
  })

  it('rejects two requirements that share one id', async () => {
    const { origin } = fakeOrigin({ entries: ['primary.vxl'] })
    const resolve = companionResolver(origin)
    const failing = () =>
      resolve(
        context(
          bundlePlan([
            requirement({ id: 'motion', role: 'animation' }),
            requirement({ id: 'motion', role: 'palette' }),
          ]),
          byteSource('primary.vxl'),
        ),
      )
    expect(await codeOf(failing)).toBe(COMPANION_PLAN_INVALID)
  })
})

describe('companion input resolution — scopes', () => {
  it('refuses a required companion whose only scope this origin cannot serve', async () => {
    const { origin, counters } = fakeOrigin({ entries: ['primary.vxl', 'primary.hva'] })
    const resolve = companionResolver(origin)
    const failing = () =>
      resolve(
        context(
          bundlePlan([
            requirement({
              id: 'motion',
              role: 'animation',
              scopes: ['current-mount'],
              cardinality: 'one',
              required: true,
            }),
          ]),
          byteSource('primary.vxl'),
        ),
      )

    expect(await codeOf(failing)).toBe(COMPANION_SCOPE_UNSUPPORTED)
    expect(await contextOf(failing)).toMatchObject({
      requirementId: 'motion',
      requestedScopes: ['current-mount'],
      servedScopes: ['sibling-directory'],
      reason: 'origin-cannot-serve-scope',
    })
    // an unserved scope is a refusal, never a quiet widening to a scope that *is* served
    expect(counters.enumerations).toBe(0)
  })

  it('names workspace-dependency-layer unavailable when no provider is wired', async () => {
    const reported: Diagnostic[] = []
    const { origin } = fakeOrigin({ entries: ['primary.vxl', 'primary.hva'] })
    const resolve = companionResolver(origin, {
      onDiagnostic: item => reported.push(item),
    })
    const input = await resolve(
      context(
        bundlePlan([
          requirement({ id: 'motion', role: 'animation', scopes: ['workspace-dependency-layer'] }),
        ]),
        byteSource('primary.vxl'),
      ),
    )

    expect(input.bindingsFor('motion')).toEqual([])
    expect(reported).toEqual([
      expect.objectContaining({
        code: COMPANION_SCOPE_UNSUPPORTED,
        data: expect.objectContaining({ reason: 'no-provider' }),
      }),
    ])
  })

  it('names explicit-user-selection unavailable when the product passed no bindings', async () => {
    const reported: Diagnostic[] = []
    const { origin } = fakeOrigin({ entries: ['primary.vxl', 'primary.hva'] })
    const resolve = companionResolver(origin, {
      onDiagnostic: item => reported.push(item),
    })
    await resolve(
      context(
        bundlePlan([
          requirement({ id: 'motion', role: 'animation', scopes: ['explicit-user-selection'] }),
        ]),
        byteSource('primary.vxl'),
      ),
    )
    expect(reported).toEqual([
      expect.objectContaining({
        code: COMPANION_SCOPE_UNSUPPORTED,
        data: expect.objectContaining({ reason: 'no-product-selection' }),
      }),
    ])
  })

  it('serves a product selection when one was passed, and only the ids it names', async () => {
    const { origin } = fakeOrigin({ entries: ['primary.vxl', 'chosen.hva', 'other.hva'] })
    const resolve = companionResolver(origin, {
      explicitSelections: { motion: ['chosen.hva'] },
    })
    const input = await resolve(
      context(
        bundlePlan([
          requirement({
            id: 'motion',
            role: 'animation',
            scopes: ['explicit-user-selection'],
            cardinality: 'one',
            required: true,
          }),
        ]),
        byteSource('primary.vxl'),
      ),
    )
    expect(input.bindingsFor('motion').map(item => item.bindingId)).toEqual(['motion#chosen.hva'])
  })

  it('skips the unserved half of a multi-scope requirement and records what it checked', async () => {
    const { origin } = fakeOrigin({ entries: ['primary.vxl', 'primary.hva'] })
    const resolve = companionResolver(origin)
    const input = await resolve(
      context(
        bundlePlan([
          requirement({
            id: 'motion',
            role: 'animation',
            scopes: ['enclosing-container', 'sibling-directory'],
            cardinality: 'one',
            required: true,
          }),
        ]),
        byteSource('primary.vxl'),
      ),
    )
    expect(input.bindingsFor('motion').map(item => item.bindingId)).toEqual(['motion#primary.hva'])
  })
})

describe('companion input resolution — names and patterns', () => {
  it.each([
    ['a traversal segment', '../escape.hva'],
    ['an absolute path', '/etc/escape.hva'],
    ['a NUL byte', 'escape\0.hva'],
    ['a UNC prefix', '//server/share/escape.hva'],
    ['a drive prefix', 'C:/escape.hva'],
  ])('refuses a candidate carrying %s', async (_label, name) => {
    const { origin } = fakeOrigin({ entries: ['primary.vxl', name] })
    const resolve = companionResolver(origin)
    expect(
      await codeOf(() =>
        resolve(
          context(
            bundlePlan([requirement({ id: 'motion', role: 'animation' })]),
            byteSource('primary.vxl'),
          ),
        ),
      ),
    ).toBe(COMPANION_PATH_REFUSED)
  })

  it.each([
    ['no literal part', '*'],
    ['a recursive wildcard', '**/*.hva'],
    ['an absolute path', '/x.hva'],
    ['a drive prefix', 'C:x.hva'],
    ['a traversal segment', '../x.hva'],
    ['a NUL byte', 'x\0.hva'],
    ['nothing at all', ''],
  ])('refuses a pattern with %s', async (_label, pattern) => {
    const { origin, counters } = fakeOrigin({ entries: ['primary.vxl', 'primary.hva'] })
    const resolve = companionResolver(origin)
    expect(
      await codeOf(() =>
        resolve(
          context(
            bundlePlan([requirement({ id: 'motion', role: 'animation', patterns: [pattern] })]),
            byteSource('primary.vxl'),
          ),
        ),
      ),
    ).toBe(COMPANION_PATTERN_INVALID)
    // a refused pattern is refused before any directory is touched, never after a hidden scan
    expect(counters.enumerations).toBe(0)
  })

  it.each([
    ['a bare name says nothing about location', ['bowl.tga'], ''],
    ['a directory-qualified pattern narrows to it', ['assets/textures/*.dds'], 'assets/textures/'],
    [
      'a wildcard-free pattern narrows to itself',
      ['assets/textures/alpha2.dds'],
      'assets/textures/alpha2.dds',
    ],
    [
      'patterns agree only as far as they agree',
      ['assets/textures/*.dds', 'assets/textures/*.tga'],
      'assets/textures/',
    ],
    [
      'disagreeing patterns fall back to their common directory',
      ['assets/textures/*.dds', 'assets/models/*.dds'],
      'assets/',
    ],
    ['one bare pattern widens the whole requirement', ['assets/textures/*.dds', 'bowl.tga'], ''],
    ['a partial segment narrows only to its parent', ['assets/tex*'], 'assets/'],
  ])('derives the listing prefix so that %s', async (_label, patterns, expected) => {
    /*
     * The prefix is a hint the resolver derives from the codec's own patterns, and it is the only
     * reason a 666k-entry namespace can be searched under a four-thousand-entry budget. It must
     * never narrow further than the patterns license, which is why it is always cut back to a `/`:
     * `assets/tex*` may match `assets/textures/hero.dds` or `assets/texture-atlas.dds`, so the
     * prefix is `assets/` and never `assets/tex`, which would silently exclude the first.
     */
    const { origin, counters } = fakeOrigin({ entries: ['primary.vxl'] })
    const resolve = companionResolver(origin)
    await resolve(
      context(
        bundlePlan([
          requirement({
            id: 'skin',
            role: 'texture',
            patterns,
            cardinality: 'many',
            required: false,
          }),
        ]),
        byteSource('primary.vxl'),
      ),
    )
    expect(counters.prefixes).toEqual([expected])
  })

  it('resolves several exact paths within a two-entry budget despite thousands of adjacent resources', async () => {
    const paths = ['assets/textures/a.dds', 'assets/textures/b.dds']
    const { origin, counters } = fakeOrigin({
      entries: [
        ...Array.from({ length: 5000 }, (_, index) => `assets/textures/noise-${index}.dds`),
        ...paths,
      ],
      honorPrefix: true,
      caseSensitivity: 'insensitive',
    })
    const resolve = companionResolver(origin, { limits: { maxEntries: 2 } })
    const input = await resolve(
      context(
        bundlePlan([
          requirement({
            id: 'skin',
            role: 'texture',
            patterns: [...paths, 'ASSETS/TEXTURES/A.DDS'],
            cardinality: 'one-or-more',
            required: true,
          }),
        ]),
        byteSource('primary.vxl'),
      ),
    )
    expect(input.bindingsFor('skin').map(item => item.bindingId)).toEqual(
      paths.map(path => `skin#${path}`),
    )
    expect(counters.prefixes).toEqual(paths)
    expect(counters.entries).toBe(2)
  })

  it('still enforces the entry budget when an origin ignores exact-path hints', async () => {
    const { origin } = fakeOrigin({ entries: ['noise-1.dds', 'noise-2.dds', 'assets/a.dds'] })
    const resolve = companionResolver(origin, { limits: { maxEntries: 2 } })
    expect(
      await codeOf(() =>
        resolve(
          context(
            bundlePlan([
              requirement({
                id: 'skin',
                role: 'texture',
                patterns: ['assets/a.dds', 'assets/b.dds'],
                cardinality: 'many',
              }),
            ]),
            byteSource('primary.vxl'),
          ),
        ),
      ),
    ).toBe(COMPANION_BUDGET_EXCEEDED)
  })

  it('refuses a requirement that declares no patterns at all', async () => {
    const { origin } = fakeOrigin({ entries: ['primary.vxl', 'primary.hva'] })
    const resolve = companionResolver(origin)
    // the key is absent, not undefined: `patterns` is optional in the ABI, and omitting it is the
    // widest possible declaration — which is exactly what must be refused
    const { patterns, ...unpatterned } = requirement({ id: 'motion', role: 'animation' })
    expect(patterns).toBeDefined()
    expect(
      await codeOf(() =>
        resolve(
          context(bundlePlan([unpatterned as AssetInputRequirement]), byteSource('primary.vxl')),
        ),
      ),
    ).toBe(COMPANION_PATTERN_INVALID)
  })

  it('folds case on an insensitive backend, so two spellings are one companion', async () => {
    const { origin } = fakeOrigin({
      entries: ['primary.vxl', 'Sample.hva', 'sample.hva'],
      caseSensitivity: 'insensitive',
    })
    const resolve = companionResolver(origin)
    const input = await resolve(
      context(
        bundlePlan([
          requirement({ id: 'motion', role: 'animation', cardinality: 'one', required: true }),
        ]),
        byteSource('primary.vxl'),
      ),
    )
    // one logical id, deterministically the first in UTF-8 order among the spellings
    expect(input.bindingsFor('motion').map(item => item.bindingId)).toEqual(['motion#Sample.hva'])
  })

  it('keeps two spellings apart on a case-sensitive backend', async () => {
    const { origin } = fakeOrigin({
      entries: ['primary.vxl', 'Sample.hva', 'sample.hva'],
      caseSensitivity: 'sensitive',
    })
    const resolve = companionResolver(origin)
    expect(
      await codeOf(() =>
        resolve(
          context(
            bundlePlan([
              requirement({ id: 'motion', role: 'animation', cardinality: 'one', required: true }),
            ]),
            byteSource('primary.vxl'),
          ),
        ),
      ),
    ).toBe(COMPANION_AMBIGUOUS)
  })

  it('matches patterns case-insensitively on an insensitive backend', async () => {
    const { origin } = fakeOrigin({
      entries: ['primary.vxl', 'PRIMARY.HVA'],
      caseSensitivity: 'insensitive',
    })
    const resolve = companionResolver(origin)
    const input = await resolve(
      context(
        bundlePlan([
          requirement({ id: 'motion', role: 'animation', cardinality: 'one', required: true }),
        ]),
        byteSource('primary.vxl'),
      ),
    )
    expect(input.bindingsFor('motion')).toHaveLength(1)
  })
})

describe('companion input resolution — expected traits', () => {
  const acceptFirstByte = (wanted: number): CompanionTraitProbe => {
    return async request => {
      if (request.source.kind !== 'bytes') return false
      const bytes = await request.source.read(0n, 1)
      return bytes[0] === wanted
    }
  }

  it('accepts a candidate the bounded probe validates and rejects one it does not', async () => {
    const entries = ['primary.vxl', 'good.hva', 'bad.hva']
    const bytesFor = (logicalId: string): Uint8Array =>
      new Uint8Array([logicalId === 'good.hva' ? 1 : 9])
    const { origin, counters } = fakeOrigin({ entries, bytesFor })
    const resolve = companionResolver(origin, { traitProbe: acceptFirstByte(1) })
    const input = await resolve(
      context(
        bundlePlan([
          requirement({
            id: 'motion',
            role: 'animation',
            expected: { all: [{ id: traitId('model.animations') }] },
            cardinality: 'one',
            required: true,
          }),
        ]),
        byteSource('primary.vxl'),
      ),
    )

    expect(input.bindingsFor('motion').map(item => item.bindingId)).toEqual(['motion#good.hva'])
    // both candidates were probed, both leases were released, and the accepted one was not
    // re-opened just to learn an identity the probe already observed
    expect(counters.opens).toBe(2)
    expect(counters.releases).toBe(2)
    expect(counters.doubleRelease).toBe(false)
  })

  it('reports an optional companion rejected by expected traits as rejected, not as absent', async () => {
    const reported: Diagnostic[] = []
    const { origin } = fakeOrigin({
      entries: ['primary.vxl', 'bad.hva'],
      bytesFor: () => new Uint8Array([9]),
    })
    const resolve = companionResolver(origin, {
      traitProbe: acceptFirstByte(1),
      onDiagnostic: item => reported.push(item),
    })
    await resolve(
      context(
        bundlePlan([
          requirement({
            id: 'motion',
            role: 'animation',
            expected: { all: [{ id: traitId('model.animations') }] },
          }),
        ]),
        byteSource('primary.vxl'),
      ),
    )
    expect(reported).toEqual([
      expect.objectContaining({
        code: COMPANION_UNAVAILABLE,
        data: expect.objectContaining({
          reason: 'expected-traits-rejected',
          rejectedByExpectedTraits: ['bad.hva'],
        }),
      }),
    ])
  })

  it('fails closed when expected traits are declared and no host probe is wired', async () => {
    const { origin, counters } = fakeOrigin({ entries: ['primary.vxl', 'primary.hva'] })
    const resolve = companionResolver(origin)
    expect(
      await codeOf(() =>
        resolve(
          context(
            bundlePlan([
              requirement({
                id: 'motion',
                role: 'animation',
                expected: { all: [{ id: traitId('model.animations') }] },
              }),
            ]),
            byteSource('primary.vxl'),
          ),
        ),
      ),
    ).toBe(COMPANION_TRAIT_PROBE_UNAVAILABLE)
    expect(counters.opens).toBe(counters.releases)
  })

  it('validates expected traits from the inventory signature index, without activating a codec', async () => {
    /*
     * TODO (block 9, archive slice / step 3): this probe proves a *declared* trait of a format the
     * host identified by its byte signature — it does not prove an *observed* trait state, because
     * observing one would mean activating a codec and opening a session per candidate, which the
     * step-1 budget explicitly rules out. A requirement that constrains `states` is therefore
     * refused rather than accepted; see the assertion at the end of this test.
     */
    const input = await loadExtensionDirectory(join(repoRoot, 'extensions', 'images'))
    const inventory = await buildInventory(
      [{ ...input, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
      createHostContributionContractRegistry(),
    )
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
    const noise = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    const { origin } = fakeOrigin({
      entries: ['primary.vxl', 'skin.bin', 'noise.bin'],
      bytesFor: logicalId => (logicalId === 'skin.bin' ? png : noise),
    })
    const probe = createSignatureTraitProbe(inventory)
    const resolve = companionResolver(origin, { traitProbe: probe })
    const resolved = await resolve(
      context(
        bundlePlan([
          requirement({
            id: 'skin',
            role: 'texture',
            patterns: ['*.bin'],
            expected: { all: [{ id: traitId('image.raster') }] },
            cardinality: 'one',
            required: true,
          }),
        ]),
        byteSource('primary.vxl'),
      ),
    )
    expect(resolved.bindingsFor('skin').map(item => item.bindingId)).toEqual(['skin#skin.bin'])

    const stateConstrained = fakeOrigin({
      entries: ['primary.vxl', 'skin.bin'],
      bytesFor: () => png,
    })
    expect(
      await codeOf(() =>
        companionResolver(stateConstrained.origin, { traitProbe: probe })(
          context(
            bundlePlan([
              requirement({
                id: 'skin',
                role: 'texture',
                patterns: ['*.bin'],
                expected: { all: [{ id: traitId('image.raster'), states: ['available'] }] },
                cardinality: 'one',
                required: true,
              }),
            ]),
            byteSource('primary.vxl'),
          ),
        ),
      ),
    ).toBe(COMPANION_TRAIT_PROBE_UNAVAILABLE)
  })
})

describe('companion input resolution — budgets, cancellation and leases', () => {
  it('stops enumerating at its entry limit instead of walking a large directory', async () => {
    const entries = ['primary.vxl', ...Array.from({ length: 20 }, (_, index) => `f${index}.hva`)]
    const { origin, counters } = fakeOrigin({ entries })
    const resolve = companionResolver(origin, { limits: { maxEntries: 4 } })
    const failing = () =>
      resolve(
        context(
          bundlePlan([
            requirement({ id: 'motion', role: 'animation', cardinality: 'many', required: false }),
          ]),
          byteSource('primary.vxl'),
        ),
      )

    expect(await codeOf(failing)).toBe(COMPANION_BUDGET_EXCEEDED)
    expect(await contextOf(failing)).toMatchObject({ limit: 'entries', value: 4 })
    expect(counters.entries).toBeLessThanOrEqual(10)
  })

  it('counts its entry limit per scope: three scopes of one archive are not one scope', async () => {
    // A bare texture name is looked for in the model's folder, its mount and its enclosing archive;
    // each scope is bounded on its own, as the limit's documentation says.
    const scopes = ['sibling-directory', 'current-mount', 'enclosing-container'] as const
    const { origin, counters } = fakeOrigin({ entries: ['primary.vxl', 'a.hva', 'b.hva'], scopes })
    const resolve = companionResolver(origin, { limits: { maxEntries: 4 } })
    const input = await resolve(
      context(
        bundlePlan([
          requirement({
            id: 'motion',
            role: 'animation',
            cardinality: 'many',
            required: false,
            scopes: [...scopes],
          }),
        ]),
        byteSource('primary.vxl'),
      ),
    )
    expect(counters.entries).toBeGreaterThan(4)
    expect(input.bindingsFor('motion').length).toBeGreaterThan(0)
  })

  it('stops a runaway trait probe at its byte limit', async () => {
    const { origin, counters } = fakeOrigin({
      entries: ['primary.vxl', 'big.hva'],
      bytesFor: () => new Uint8Array(4096),
    })
    const greedy: CompanionTraitProbe = async request => {
      if (request.source.kind !== 'bytes') return false
      for (let index = 0; index < 8; index += 1) await request.source.read(0n, 512)
      return true
    }
    const resolve = companionResolver(origin, {
      traitProbe: greedy,
      limits: { maxProbeBytes: 1024 },
    })
    const failing = () =>
      resolve(
        context(
          bundlePlan([
            requirement({
              id: 'motion',
              role: 'animation',
              expected: { all: [{ id: traitId('model.animations') }] },
              cardinality: 'one',
              required: true,
            }),
          ]),
          byteSource('primary.vxl'),
        ),
      )

    expect(await codeOf(failing)).toBe(COMPANION_BUDGET_EXCEEDED)
    expect(await contextOf(failing)).toMatchObject({ limit: 'probeBytes' })
    // the lease the probe was reading through is still released on the way out
    expect(counters.opens).toBe(counters.releases)
    expect(counters.doubleRelease).toBe(false)
  })

  it('stops at its binding limit', async () => {
    const entries = ['primary.vxl', ...Array.from({ length: 6 }, (_, index) => `f${index}.hva`)]
    const { origin, counters } = fakeOrigin({ entries })
    const resolve = companionResolver(origin, { limits: { maxBindings: 2 } })
    expect(
      await codeOf(() =>
        resolve(
          context(
            bundlePlan([
              requirement({
                id: 'motion',
                role: 'animation',
                cardinality: 'many',
                required: false,
              }),
            ]),
            byteSource('primary.vxl'),
          ),
        ),
      ),
    ).toBe(COMPANION_BUDGET_EXCEEDED)
    expect(counters.opens).toBe(counters.releases)
  })

  it('gives up at its deadline', async () => {
    const { origin } = fakeOrigin({ entries: ['primary.vxl', 'primary.hva'] })
    let clock = 0
    const resolve = companionResolver(origin, {
      deadlineMs: 5,
      now: () => {
        clock += 10
        return clock
      },
    })
    const failing = () =>
      resolve(
        context(
          bundlePlan([
            requirement({ id: 'motion', role: 'animation', cardinality: 'one', required: true }),
          ]),
          byteSource('primary.vxl'),
        ),
      )
    expect(await codeOf(failing)).toBe(COMPANION_BUDGET_EXCEEDED)
    expect(await contextOf(failing)).toMatchObject({ limit: 'deadline' })
  })

  it('cancels in the middle of an enumeration and leaves nothing open', async () => {
    const controller = new AbortController()
    const { origin, counters } = fakeOrigin({
      entries: ['primary.vxl', 'a.hva', 'b.hva', 'c.hva'],
      onEntry: (_logicalId, index) => {
        if (index === 1) controller.abort()
      },
    })
    const resolve = companionResolver(origin)
    expect(
      await codeOf(() =>
        resolve(
          context(
            bundlePlan([
              requirement({
                id: 'motion',
                role: 'animation',
                cardinality: 'many',
                required: false,
              }),
            ]),
            byteSource('primary.vxl'),
            controller.signal,
          ),
        ),
      ),
    ).toBe(CANCELLED_CODE)
    expect(counters.opens).toBe(counters.releases)
    expect(counters.doubleRelease).toBe(false)
  })

  it('cancels between two opens and releases the lease it already took', async () => {
    const controller = new AbortController()
    const { origin, counters } = fakeOrigin({
      entries: ['primary.vxl', 'a.hva', 'b.hva'],
      onOpen: (_logicalId, index) => {
        if (index === 0) controller.abort()
      },
    })
    const resolve = companionResolver(origin)
    expect(
      await codeOf(() =>
        resolve(
          context(
            bundlePlan([
              requirement({
                id: 'motion',
                role: 'animation',
                cardinality: 'one-or-more',
                required: true,
              }),
            ]),
            byteSource('primary.vxl'),
            controller.signal,
          ),
        ),
      ),
    ).toBe(CANCELLED_CODE)
    expect(counters.opens).toBe(counters.releases)
    expect(counters.doubleRelease).toBe(false)
  })

  it('refuses an unknown binding id and cancels an open through the resolved input', async () => {
    const { origin, counters } = fakeOrigin({ entries: ['primary.vxl', 'primary.hva'] })
    const resolve = companionResolver(origin)
    const input = await resolve(
      context(
        bundlePlan([
          requirement({ id: 'motion', role: 'animation', cardinality: 'one', required: true }),
        ]),
        byteSource('primary.vxl'),
      ),
    )

    expect(await codeOf(() => input.openBinding('motion#nothing.hva'))).toBe(
      'x3.host/unknown-asset-input-binding',
    )
    const controller = new AbortController()
    controller.abort()
    expect(await codeOf(() => input.openBinding('motion#primary.hva', controller.signal))).toBe(
      CANCELLED_CODE,
    )
    expect(counters.opens).toBe(counters.releases)
  })
})

describe('a companion pattern rooted at the archive', () => {
  it('names only the root entry, where a bare name matches it in every folder', async () => {
    const { origin } = fakeOrigin({
      primaryLogicalId: 'maps/delta.smf',
      entries: ['maps/delta.smf', 'mapinfo.lua', 'maphelper/mapinfo.lua'],
    })
    const plan = (patterns: readonly string[]) =>
      bundlePlan([requirement({ id: 'info', role: 'map-info', patterns })])
    const resolve = companionResolver(origin)
    expect(
      await codeOf(() => resolve(context(plan(['mapinfo.lua']), byteSource('delta.smf')))),
    ).toBe(COMPANION_AMBIGUOUS)
    const rooted = await resolve(context(plan(['./mapinfo.lua']), byteSource('delta.smf')))
    expect(rooted.bindingsFor('info').map(item => item.bindingId)).toEqual(['info#mapinfo.lua'])
  })
})
