/**
 * The contract of the post-open resource session (block 11, slice 11C0, plan item 13).
 *
 * Like the companion suite it sits beside, everything here runs against a *fake* origin backend
 * that counts enumerations, opens and releases. The counting is the point: "the budget is spent
 * once" and "a lease is never stranded" are claims about behaviour, and a suite that only asserted
 * return values could not tell a cached miss from a second full scan of a 666,588-entry namespace.
 */

import { describe, expect, it } from 'vitest'
import { CANCELLED_CODE } from '@modkit/core'
import {
  revisionId,
  type ArtifactSource,
  type InputSearchScope,
  type Lease,
  type LogicalResourceRequirement,
  type ResourceResolution,
} from '@modkit/sdk'
import {
  createResourceSession,
  createModelDependencyResources,
  DEFAULT_RESOURCE_SESSION_LIMITS,
  RESOURCE_BUDGET_EXCEEDED,
  RESOURCE_CYCLE_DETECTED,
  RESOURCE_NOT_ALLOWLISTED,
  RESOURCE_NOT_FOUND,
  RESOURCE_PATH_REFUSED,
  RESOURCE_SCOPE_UNSUPPORTED,
  RESOURCE_SESSION_DISPOSED,
  resourceDiagnosticCode,
} from '../src/resource-session.js'
import type {
  CompanionCaseSensitivity,
  CompanionOrigin,
  CompanionOriginEntry,
} from '../src/input-resolution.js'
import { createNamespaceCompanionOrigin } from '../src/namespace-origin.js'

const SESSION_REVISION = revisionId('provider-token:resource-session-test')

interface FakeOrigin extends CompanionOrigin {
  readonly counts: {
    enumerations: number
    entriesServed: number
    opens: number
    releases: number
  }
  readonly outstanding: () => number
}

function fakeOrigin(
  entries: readonly (string | CompanionOriginEntry)[],
  options: {
    readonly scopes?: readonly InputSearchScope[]
    readonly caseSensitivity?: CompanionCaseSensitivity
    readonly failRelease?: boolean
    readonly honorPrefix?: boolean
  } = {},
): FakeOrigin {
  const listing: CompanionOriginEntry[] = entries.map(entry =>
    typeof entry === 'string' ? { logicalId: entry, size: 16n } : entry,
  )
  const counts = { enumerations: 0, entriesServed: 0, opens: 0, releases: 0 }
  let open = 0
  return {
    primaryLogicalId: 'models/tank.m3',
    caseSensitivity: options.caseSensitivity ?? 'sensitive',
    scopes: options.scopes ?? ['current-mount', 'enclosing-container'],
    counts,
    outstanding: () => open,
    async *enumerate(_scope, enumerationOptions) {
      counts.enumerations += 1
      for (const entry of listing) {
        const fold = (value: string) =>
          options.caseSensitivity === 'insensitive' ? value.toLowerCase() : value
        if (
          options.honorPrefix !== false &&
          !fold(entry.logicalId).startsWith(fold(enumerationOptions.prefix))
        )
          continue
        counts.entriesServed += 1
        yield entry
      }
    },
    open(logicalId: string): Promise<Lease<ArtifactSource>> {
      counts.opens += 1
      open += 1
      const found = listing.find(entry => entry.logicalId === logicalId)
      const uri = `memory://fake-origin/${logicalId}`
      const source: ArtifactSource = {
        kind: 'bytes',
        ref: { id: uri, uri },
        revision: revisionId(`provider-token:${encodeURIComponent(logicalId)}`),
        size: found?.size ?? 0n,
        read: () => Promise.resolve(new Uint8Array(0)),
        async *stream() {
          yield new Uint8Array(0)
        },
      }
      return Promise.resolve({
        value: source,
        release: () => {
          counts.releases += 1
          open -= 1
          return options.failRelease === true
            ? Promise.reject(new Error('release failed'))
            : Promise.resolve()
        },
      })
    },
  }
}

const requirement = (
  id: string,
  logicalId: string,
  extra: Partial<LogicalResourceRequirement> = {},
): LogicalResourceRequirement => ({
  id,
  logicalId,
  role: 'texture',
  scopes: ['current-mount'],
  ...extra,
})

const unresolvedReason = (result: ResourceResolution): string =>
  result.state === 'unresolved' ? result.reason : 'resolved'

describe('resource session — resolution', () => {
  it('resolves a present resource, pins its revision and records provenance', async () => {
    const origin = fakeOrigin(['textures/hull.dds'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      const result = await session.resolve(requirement('r1', 'textures/hull.dds'))
      expect(result.state).toBe('resolved')
      if (result.state !== 'resolved') return
      expect(result.revision).toBe(result.lease.value.revision)
      expect(result.provenance).toMatchObject({
        requirementId: 'r1',
        logicalId: 'textures/hull.dds',
        role: 'texture',
        state: 'resolved',
        bytes: 16n,
        cached: false,
      })
      expect(session.provenance()).toHaveLength(1)
      expect(session.revision).toBe(SESSION_REVISION)
      await result.lease.release()
    } finally {
      await session.dispose()
    }
  })

  /*
   * Which layer answered, not merely that something did.
   *
   * A map's load order is the map, then the mods it depends on, then the game's installed storage,
   * and "the texture resolved" hides the difference between a package that carries its own art and
   * one that borrows all of it. The origin names the root; the session carries that name into the
   * provenance, including when it answers the second request from its own cache — a cached hit that
   * forgot where the bytes came from would report a self-contained map as soon as it was read twice.
   */
  it('records which root of the origin answered, and remembers it across a cached hit', async () => {
    const origin = fakeOrigin([
      { logicalId: 'assets/textures/hull.dds', rootId: 'installation' },
      { logicalId: 'assets/textures/local.dds', rootId: 'map' },
    ])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      const borrowed = await session.resolve(requirement('r1', 'assets/textures/hull.dds'))
      const carried = await session.resolve(requirement('r2', 'assets/textures/local.dds'))
      const again = await session.resolve(requirement('r3', 'assets/textures/hull.dds'))
      expect([borrowed, carried, again].map(item => item.provenance.rootId)).toEqual([
        'installation',
        'map',
        'installation',
      ])
      expect(again.provenance.cached).toBe(true)
      for (const item of [borrowed, carried, again])
        if (item.state === 'resolved') await item.lease.release()
    } finally {
      await session.dispose()
    }
  })

  it('leaves the root unnamed for an origin with a single place to look', async () => {
    const origin = fakeOrigin(['textures/hull.dds'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      const result = await session.resolve(requirement('r1', 'textures/hull.dds'))
      expect(result.provenance.rootId).toBeUndefined()
      if (result.state === 'resolved') await result.lease.release()
    } finally {
      await session.dispose()
    }
  })

  it('locates one exact resource within budget despite thousands of adjacent entries', async () => {
    const origin = fakeOrigin([
      ...Array.from({ length: 5000 }, (_, index) => `textures/a-${index}.dds`),
      'other/a.dds',
      'other/b.dds',
      'textures/hull.dds',
      'textures/turret.dds',
    ])
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      limits: { maxEntries: 1 },
    })
    try {
      expect((await session.resolve(requirement('r1', 'textures/hull.dds'))).state).toBe('resolved')
      // Neither adjacent directory entries nor other roots consume this exact lookup's budget.
      expect(origin.counts.entriesServed).toBe(1)
    } finally {
      await session.dispose()
    }
  })

  it('reports a missing resource as a typed outcome rather than an exception', async () => {
    const diagnostics: string[] = []
    const origin = fakeOrigin(['textures/hull.dds'])
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      onDiagnostic: item => diagnostics.push(item.code),
    })
    try {
      const result = await session.resolve(requirement('r1', 'textures/missing.dds'))
      expect(unresolvedReason(result)).toBe('not-found')
      if (result.state !== 'unresolved') return
      // a cross-archive reference is a fact about the corpus, not a defect: information, not error
      expect(result.diagnostic.severity).toBe('information')
      expect(result.diagnostic.code).toBe(RESOURCE_NOT_FOUND)
      expect(result.provenance).toMatchObject({ state: 'unresolved', reason: 'not-found' })
      expect(diagnostics).toEqual([RESOURCE_NOT_FOUND])
    } finally {
      await session.dispose()
    }
  })

  it('serves a repeated hit and a repeated miss from the index, without enumerating again', async () => {
    const origin = fakeOrigin(['textures/hull.dds'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      await session.resolve(requirement('r1', 'textures/hull.dds'))
      await session.resolve(requirement('r2', 'textures/hull.dds'))
      await session.resolve(requirement('r3', 'textures/missing.dds'))
      const repeatMiss = await session.resolve(requirement('r4', 'textures/missing.dds'))
      expect(unresolvedReason(repeatMiss)).toBe('not-found')
      expect(repeatMiss.provenance.cached).toBe(true)
      // one enumeration for the hit, one for the miss; the two repeats add none
      expect(origin.counts.enumerations).toBe(2)
      // a cached *hit* still opens its own lease: two callers must not share one release
      expect(origin.counts.opens).toBe(2)
    } finally {
      await session.dispose()
    }
  })

  it('folds case exactly as the backend declares it', async () => {
    const sensitive = fakeOrigin(['textures/Hull.dds'])
    const insensitive = fakeOrigin(['textures/Hull.dds'], { caseSensitivity: 'insensitive' })
    const strict = createResourceSession({ origin: sensitive, revision: SESSION_REVISION })
    const folding = createResourceSession({ origin: insensitive, revision: SESSION_REVISION })
    try {
      expect(unresolvedReason(await strict.resolve(requirement('r1', 'textures/hull.dds')))).toBe(
        'not-found',
      )
      expect(unresolvedReason(await folding.resolve(requirement('r1', 'textures/hull.dds')))).toBe(
        'resolved',
      )
    } finally {
      await strict.dispose()
      await folding.dispose()
    }
  })
})

describe('resource session — a name is a name, a path is a path', () => {
  it('finds a bare file name anywhere it serves, as the pre-open companion seam does', async () => {
    /*
     * The two seams must agree. A W3D names its texture `fixture.tga` with no directory, and the
     * block-9 companion resolver finds it wherever it lives in the archive; the port used to match
     * the whole logical id and miss it, so the very same reference resolved before `open` and
     * failed after it. A large namespace case could not catch this because it uses path references.
     */
    const origin = fakeOrigin(['art/textures/fixture.tga'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      const result = await session.resolve(requirement('r1', 'fixture.tga'))
      expect(result.state).toBe('resolved')
      if (result.state === 'resolved') {
        // it resolves to the entry's real id, not to the bare name it was asked for
        expect(result.lease.value.ref.uri).toContain('art/textures/fixture.tga')
        await result.lease.release()
      }
    } finally {
      await session.dispose()
    }
  })

  it('holds a path to its own directory instead of matching the file name anywhere', async () => {
    // the mirror rule: naming a place means that place, so a same-named file elsewhere is a miss
    const origin = fakeOrigin(['art/textures/fixture.tga'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      const result = await session.resolve(requirement('r1', 'other/fixture.tga'))
      expect(unresolvedReason(result)).toBe('not-found')
    } finally {
      await session.dispose()
    }
  })
})

describe('resource session — confinement and allowlist', () => {
  it('refuses a logical id that could name something outside the origin', async () => {
    const origin = fakeOrigin(['textures/hull.dds'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      for (const hostile of [
        '../secrets/key.pem',
        '/etc/passwd',
        'C:/Windows/win.ini',
        'a\u0000b',
      ]) {
        const result = await session.resolve(requirement('r', hostile))
        expect(unresolvedReason(result), hostile).toBe('path-refused')
        if (result.state === 'unresolved') {
          expect(result.diagnostic.code).toBe(RESOURCE_PATH_REFUSED)
        }
      }
      // a refused name never reaches the backend at all
      expect(origin.counts.enumerations).toBe(0)
    } finally {
      await session.dispose()
    }
  })

  it('admits only allowlisted prefixes, and aligns them on segments', async () => {
    const origin = fakeOrigin(['textures/hull.dds', 'textures-internal/secret.dds'])
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      allowlist: ['textures'],
    })
    try {
      expect(unresolvedReason(await session.resolve(requirement('r1', 'textures/hull.dds')))).toBe(
        'resolved',
      )
      const sneaky = await session.resolve(requirement('r2', 'textures-internal/secret.dds'))
      // `textures` must not admit `textures-internal`: the prefix is a path, not a string
      expect(unresolvedReason(sneaky)).toBe('not-allowlisted')
      if (sneaky.state === 'unresolved') {
        expect(sneaky.diagnostic.code).toBe(RESOURCE_NOT_ALLOWLISTED)
      }
    } finally {
      await session.dispose()
    }
  })

  it('names an unserved scope instead of pretending to search it', async () => {
    const origin = fakeOrigin(['textures/hull.dds'], { scopes: ['current-mount'] })
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      const result = await session.resolve(
        requirement('r1', 'textures/hull.dds', { scopes: ['sibling-directory'] }),
      )
      expect(unresolvedReason(result)).toBe('scope-unsupported')
      if (result.state === 'unresolved') {
        expect(result.diagnostic.code).toBe(RESOURCE_SCOPE_UNSUPPORTED)
      }
      expect(origin.counts.enumerations).toBe(0)
    } finally {
      await session.dispose()
    }
  })
})

describe('resource session — budgets and cycles', () => {
  it('stops at the entry budget instead of scanning a namespace whole', async () => {
    const origin = fakeOrigin(['textures/a.dds', 'textures/b.dds', 'textures/c.dds'], {
      honorPrefix: false,
    })
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      limits: { maxEntries: 2 },
    })
    try {
      const result = await session.resolve(requirement('r1', 'textures/c.dds'))
      expect(unresolvedReason(result)).toBe('budget-exceeded')
      if (result.state === 'unresolved') {
        expect(result.diagnostic.code).toBe(RESOURCE_BUDGET_EXCEEDED)
      }
    } finally {
      await session.dispose()
    }
  })

  it('refuses to exceed the byte budget, and releases the lease it had to open to find out', async () => {
    const origin = fakeOrigin([{ logicalId: 'textures/huge.dds', size: 4096n }])
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      limits: { maxBytes: 1024n },
    })
    try {
      const result = await session.resolve(requirement('r1', 'textures/huge.dds'))
      expect(unresolvedReason(result)).toBe('budget-exceeded')
      expect(origin.counts.opens).toBe(1)
      expect(origin.counts.releases).toBe(1)
      expect(origin.outstanding()).toBe(0)
    } finally {
      await session.dispose()
    }
  })

  it('refuses to hold more resources than the session limit', async () => {
    const origin = fakeOrigin(['textures/a.dds', 'textures/b.dds'])
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      limits: { maxResources: 1 },
    })
    try {
      expect(unresolvedReason(await session.resolve(requirement('r1', 'textures/a.dds')))).toBe(
        'resolved',
      )
      expect(unresolvedReason(await session.resolve(requirement('r2', 'textures/b.dds')))).toBe(
        'budget-exceeded',
      )
    } finally {
      await session.dispose()
    }
  })

  it('detects a resource that references itself through its parent chain', async () => {
    const origin = fakeOrigin(['textures/a.dds', 'textures/b.dds'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      await session.resolve(requirement('r1', 'textures/a.dds'))
      await session.resolve(requirement('r2', 'textures/b.dds', { parentResourceId: 'r1' }))
      const loop = await session.resolve(
        requirement('r3', 'textures/a.dds', { parentResourceId: 'r2' }),
      )
      expect(unresolvedReason(loop)).toBe('cycle-detected')
      if (loop.state === 'unresolved') {
        expect(loop.diagnostic.code).toBe(RESOURCE_CYCLE_DETECTED)
        expect(loop.diagnostic.message).toContain('textures/b.dds -> textures/a.dds')
      }
    } finally {
      await session.dispose()
    }
  })

  it('stops a chain that is deeper than the depth budget', async () => {
    const origin = fakeOrigin(['textures/a.dds', 'textures/b.dds', 'textures/c.dds'])
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      limits: { maxDepth: 1 },
    })
    try {
      await session.resolve(requirement('r1', 'textures/a.dds'))
      await session.resolve(requirement('r2', 'textures/b.dds', { parentResourceId: 'r1' }))
      const deep = await session.resolve(
        requirement('r3', 'textures/c.dds', { parentResourceId: 'r2' }),
      )
      expect(unresolvedReason(deep)).toBe('budget-exceeded')
    } finally {
      await session.dispose()
    }
  })

  it('exposes the default limits it applies', () => {
    expect(DEFAULT_RESOURCE_SESSION_LIMITS).toMatchObject({
      maxResources: 256,
      maxDepth: 8,
      maxEntries: 65_536,
    })
    expect(resourceDiagnosticCode('cycle-detected')).toBe(RESOURCE_CYCLE_DETECTED)
  })
})

describe('resource session — lifecycle', () => {
  it('reclaims resource budget on caller release and never releases it again on dispose', async () => {
    const origin = fakeOrigin(['textures/a.dds', 'textures/b.dds'])
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      limits: { maxResources: 1 },
    })
    const first = await session.resolve(requirement('r1', 'textures/a.dds'))
    expect(first.state).toBe('resolved')
    if (first.state !== 'resolved') return
    await first.lease.release()
    // idempotence belongs to the session's returned lease even if its backend is less defensive
    await first.lease.release()

    const second = await session.resolve(requirement('r2', 'textures/b.dds'))
    expect(second.state).toBe('resolved')
    if (second.state !== 'resolved') return
    await second.lease.release()
    expect(origin.counts.releases).toBe(2)
    expect(origin.outstanding()).toBe(0)

    await session.dispose()
    expect(origin.counts.releases).toBe(2)
  })

  it('releases every outstanding lease on dispose, and is idempotent', async () => {
    const origin = fakeOrigin(['textures/a.dds', 'textures/b.dds'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    await session.resolve(requirement('r1', 'textures/a.dds'))
    await session.resolve(requirement('r2', 'textures/b.dds'))
    expect(origin.outstanding()).toBe(2)

    await session.dispose()
    expect(origin.outstanding()).toBe(0)
    expect(origin.counts.releases).toBe(2)
    expect(session.state()).toBe('disposed')

    await session.dispose()
    // a second dispose releases nothing twice
    expect(origin.counts.releases).toBe(2)
  })

  it('releases the rest even when one release fails, and still reports the failure', async () => {
    const origin = fakeOrigin(['textures/a.dds', 'textures/b.dds'], { failRelease: true })
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    await session.resolve(requirement('r1', 'textures/a.dds'))
    await session.resolve(requirement('r2', 'textures/b.dds'))

    // a backend that throws on release must not strand the other lease behind it
    await expect(session.dispose()).rejects.toThrow('release failed')
    expect(origin.counts.releases).toBe(2)
    expect(origin.outstanding()).toBe(0)
    expect(session.state()).toBe('disposed')
  })

  it('resolves nothing after disposal, and says why', async () => {
    const origin = fakeOrigin(['textures/a.dds'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    await session.dispose()
    const result = await session.resolve(requirement('r1', 'textures/a.dds'))
    expect(unresolvedReason(result)).toBe('session-disposed')
    if (result.state === 'unresolved') {
      expect(result.diagnostic.code).toBe(RESOURCE_SESSION_DISPOSED)
    }
    expect(origin.counts.enumerations).toBe(0)
  })

  it('propagates cancellation rather than answering with a fabricated outcome', async () => {
    const origin = fakeOrigin(['textures/a.dds'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    const controller = new AbortController()
    controller.abort()
    try {
      await expect(
        session.resolve(requirement('r1', 'textures/a.dds'), controller.signal),
      ).rejects.toMatchObject({ code: CANCELLED_CODE })
      expect(origin.counts.enumerations).toBe(0)
    } finally {
      await session.dispose()
    }
  })
})

/**
 * Block 12 item 7 — the half of the conformance the 11C0 suite did not cover.
 *
 * Budgets, cancellation, cycles, allowlist and confinement were proved above. What was missing is
 * everything about *trust in what the session reports*: that its cache cannot be made to hand back
 * stale bytes, that its provenance cannot be rewritten by the caller it hands records to, that two
 * sessions over one origin share nothing, and that tearing one down under load strands nothing.
 */
describe('resource session — cache integrity', () => {
  it('caches where a resource is, never what it contains', async () => {
    /*
     * The poisoning question, asked precisely. The session's index exists to stop a second
     * enumeration of a 666,588-entry namespace — it is a *location* index. If it also cached the
     * lease or the bytes, a resource replaced between two resolutions would be served from the
     * first read and the caller could not tell. So the second resolution must reuse the location
     * (`cached: true`, no new enumeration) and still open the resource again, carrying whatever
     * revision the origin gives it now.
     */
    const entries = [{ logicalId: 'textures/hull.dds', size: 16n }]
    let generation = 0
    const counts = { enumerations: 0, entriesServed: 0, opens: 0, releases: 0 }
    let open = 0
    const origin: FakeOrigin = {
      primaryLogicalId: 'models/tank.m3',
      caseSensitivity: 'sensitive',
      scopes: ['current-mount'],
      counts,
      outstanding: () => open,
      async *enumerate(_scope, options) {
        counts.enumerations += 1
        for (const entry of entries) {
          if (!entry.logicalId.startsWith(options.prefix)) continue
          counts.entriesServed += 1
          yield entry
        }
      },
      open(logicalId: string): Promise<Lease<ArtifactSource>> {
        counts.opens += 1
        open += 1
        // the backing content changed between resolutions; its revision changes with it
        generation += 1
        const uri = `memory://poison/${logicalId}`
        const source: ArtifactSource = {
          kind: 'bytes',
          ref: { id: uri, uri },
          revision: revisionId(
            `provider-token:${encodeURIComponent(logicalId)}-generation-${generation}`,
          ),
          size: 16n,
          read: () => Promise.resolve(new Uint8Array(0)),
          async *stream() {
            yield new Uint8Array(0)
          },
        }
        return Promise.resolve({
          value: source,
          release: () => {
            counts.releases += 1
            open -= 1
            return Promise.resolve()
          },
        })
      },
    }
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      const first = await session.resolve(requirement('r1', 'textures/hull.dds'))
      const second = await session.resolve(requirement('r2', 'textures/hull.dds'))
      if (first.state !== 'resolved' || second.state !== 'resolved') throw new Error('unresolved')

      // one enumeration for two lookups: the location index did its job
      expect(origin.counts.enumerations).toBe(1)
      expect(first.provenance.cached).toBe(false)
      expect(second.provenance.cached).toBe(true)
      // and two opens, with two different revisions: the content was never cached
      expect(origin.counts.opens).toBe(2)
      expect(second.revision).not.toBe(first.revision)
      expect(second.provenance.revision).toBe(second.revision)
      // the session's own revision pins the plane and never moves under it
      expect(session.revision).toBe(SESSION_REVISION)
    } finally {
      await session.dispose()
    }
  })

  it('keeps a cached miss a miss, and marks it as not re-checked', async () => {
    /*
     * The mirror case, and the honest cost of caching a negative: within one session a resource
     * that was absent stays absent. That is not a defect to fix by re-enumerating — the session
     * pins one revision of the resource plane, and a file appearing mid-session belongs to a
     * different plane. What matters is that the answer is recorded as cached, so a reader of the
     * provenance can see it was not looked for a second time.
     */
    const listing: CompanionOriginEntry[] = []
    const counts = { enumerations: 0, entriesServed: 0, opens: 0, releases: 0 }
    const origin: FakeOrigin = {
      primaryLogicalId: 'models/tank.m3',
      caseSensitivity: 'sensitive',
      scopes: ['current-mount'],
      counts,
      outstanding: () => 0,
      async *enumerate(_scope, options) {
        counts.enumerations += 1
        for (const entry of listing) {
          if (!entry.logicalId.startsWith(options.prefix)) continue
          counts.entriesServed += 1
          yield entry
        }
      },
      open(): Promise<Lease<ArtifactSource>> {
        throw new Error('a missing resource must never be opened')
      },
    }
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      expect(unresolvedReason(await session.resolve(requirement('r1', 'late.dds')))).toBe(
        'not-found',
      )
      listing.push({ logicalId: 'late.dds', size: 16n })
      const second = await session.resolve(requirement('r2', 'late.dds'))
      expect(unresolvedReason(second)).toBe('not-found')
      expect(origin.counts.enumerations).toBe(1)
      if (second.state === 'unresolved') expect(second.provenance.cached).toBe(true)
    } finally {
      await session.dispose()
    }
  })
})

describe('resource session — provenance cannot be rewritten by its reader', () => {
  it('hands out frozen records, so a caller cannot turn a miss into a hit', async () => {
    /*
     * The provenance a caller receives is the same evidence the session keeps and a projection
     * receipt is later built from. A mutable record shared between the two means the caller can
     * edit the host's own history — and provenance a reader can edit is not provenance.
     */
    const origin = fakeOrigin([])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      const result = await session.resolve(requirement('r1', 'textures/missing.dds'))
      if (result.state !== 'unresolved') throw new Error('expected a miss')
      const record = result.provenance as unknown as { state: string; bytes?: bigint }
      expect(() => {
        record.state = 'resolved'
      }).toThrow(TypeError)
      expect(() => {
        record.bytes = 999n
      }).toThrow(TypeError)
      expect(session.provenance()[0]?.state).toBe('unresolved')
    } finally {
      await session.dispose()
    }
  })

  it('takes its own copy of the requirement scopes, so a later edit cannot rewrite history', async () => {
    const origin = fakeOrigin(['textures/a.dds'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      const scopes: InputSearchScope[] = ['current-mount']
      await session.resolve({
        id: 'r1',
        logicalId: 'textures/a.dds',
        role: 'texture',
        scopes,
      })
      // the caller widens its own array afterwards; the record must not follow
      scopes.push('sibling-directory')
      expect(session.provenance()[0]?.scopes).toEqual(['current-mount'])
      expect(() => {
        ;(session.provenance() as unknown as unknown[]).push({})
      }).toThrow(TypeError)
    } finally {
      await session.dispose()
    }
  })
})

describe('resource session — concurrency and teardown', () => {
  it('checks current authorization even for a cached resource', async () => {
    const origin = fakeOrigin(['texture.dds'])
    let authorized = true
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      isAuthorized: () => authorized,
    })
    try {
      const first = await session.resolve(requirement('first', 'texture.dds'))
      if (first.state !== 'resolved') throw new Error('initial grant should resolve')
      await first.lease.release()
      authorized = false
      expect(await session.resolve(requirement('revoked', 'texture.dds'))).toMatchObject({
        state: 'unresolved',
        reason: 'permission-missing',
      })
      expect(origin.counts.opens).toBe(1)
    } finally {
      await session.dispose()
    }
  })

  it('stops namespace paging at its entry budget before the backend collects the whole prefix', async () => {
    let pages = 0
    const origin = createNamespaceCompanionOrigin({
      primaryLogicalId: 'model.m3',
      containerRevision: SESSION_REVISION,
      pageLimit: 2,
      namespace: {
        async list(_prefix, page) {
          pages++
          const offset = Number(page.cursor ?? 0)
          return {
            items: Array.from({ length: 2 }, (_, i) => ({
              id: `${offset + i}`,
              path: `t${offset + i}.dds`,
              name: `t${offset + i}.dds`,
              kind: 'file' as const,
              revision: SESSION_REVISION,
              size: 1n,
            })),
            nextCursor: String(offset + 2),
          }
        },
        async openEntry() {
          throw new Error('budget refusal must precede open')
        },
      },
      async extract() {
        throw new Error('budget refusal must precede extract')
      },
    })
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      limits: { maxEntries: 3 },
    })
    try {
      expect(await session.resolve(requirement('missing', 'absent.dds'))).toMatchObject({
        state: 'unresolved',
        reason: 'budget-exceeded',
      })
      expect(pages).toBe(2)
    } finally {
      await session.dispose()
    }
  })

  it('refuses a repeated empty namespace cursor with a named budget outcome', async () => {
    let pages = 0
    const origin = createNamespaceCompanionOrigin({
      primaryLogicalId: 'model.m3',
      containerRevision: SESSION_REVISION,
      namespace: {
        async list() {
          pages++
          return { items: [], nextCursor: 'same' }
        },
        async openEntry() {
          throw new Error('not found')
        },
      },
      async extract() {
        throw new Error('not found')
      },
    })
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      expect(await session.resolve(requirement('missing', 'absent.dds'))).toMatchObject({
        state: 'unresolved',
        reason: 'budget-exceeded',
      })
      expect(pages).toBe(2)
    } finally {
      await session.dispose()
    }
  })

  it('reserves resource slots before awaiting origin opens', async () => {
    const backing = fakeOrigin(['texture.dds'])
    const origin: CompanionOrigin = {
      ...backing,
      async open(id, signal) {
        await Promise.resolve()
        return backing.open(id, signal)
      },
    }
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      limits: { maxResources: 2 },
    })
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => session.resolve(requirement(`r${i}`, 'texture.dds'))),
      )
      expect(results.filter(item => item.state === 'resolved')).toHaveLength(2)
      expect(results.filter(item => unresolvedReason(item) === 'budget-exceeded')).toHaveLength(6)
      expect(backing.counts.opens).toBe(2)
      expect(backing.outstanding()).toBe(2)
    } finally {
      await session.dispose()
      expect(backing.outstanding()).toBe(0)
    }
  })

  it('releases a late open after caller cancellation and returns its reserved slot', async () => {
    const backing = fakeOrigin(['texture.dds'])
    const controller = new AbortController()
    let cancel = true
    const origin: CompanionOrigin = {
      ...backing,
      async open(id) {
        const lease = await backing.open(id)
        if (cancel) controller.abort()
        return lease
      },
    }
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      limits: { maxResources: 1 },
    })
    try {
      await expect(
        session.resolve(requirement('cancel', 'texture.dds'), controller.signal),
      ).rejects.toBeDefined()
      expect(backing.outstanding()).toBe(0)
      cancel = false
      expect((await session.resolve(requirement('retry', 'texture.dds'))).state).toBe('resolved')
    } finally {
      await session.dispose()
      expect(backing.outstanding()).toBe(0)
    }
  })

  it('does not reuse hits or misses across different ordered scopes', async () => {
    const backing = fakeOrigin(['mount/a.dds', 'container/a.dds'])
    const origin: CompanionOrigin = {
      ...backing,
      async *enumerate(scope) {
        if (scope === 'current-mount') yield { logicalId: 'mount/a.dds' }
        if (scope === 'enclosing-container') {
          yield { logicalId: 'container/a.dds' }
          yield { logicalId: 'container/b.dds' }
        }
      },
    }
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      const mount = await session.resolve(requirement('mount', 'a.dds'))
      const container = await session.resolve(
        requirement('container', 'a.dds', { scopes: ['enclosing-container'] }),
      )
      if (mount.state !== 'resolved' || container.state !== 'resolved')
        throw new Error('expected both scopes')
      expect(mount.lease.value.ref.id).toContain('/mount/a.dds')
      expect(container.lease.value.ref.id).toContain('/container/a.dds')
      expect(container.provenance.cached).toBe(false)
      expect(unresolvedReason(await session.resolve(requirement('miss', 'b.dds')))).toBe(
        'not-found',
      )
      const found = await session.resolve(
        requirement('other-scope', 'b.dds', { scopes: ['enclosing-container'] }),
      )
      expect(found.state).toBe('resolved')
      const first = await session.resolve(
        requirement('first', 'a.dds', { scopes: ['current-mount', 'enclosing-container'] }),
      )
      const reverse = await session.resolve(
        requirement('reverse', 'a.dds', { scopes: ['enclosing-container', 'current-mount'] }),
      )
      if (first.state !== 'resolved' || reverse.state !== 'resolved')
        throw new Error('expected precedence')
      expect(first.lease.value.ref.id).not.toBe(reverse.lease.value.ref.id)
    } finally {
      await session.dispose()
    }
  })

  it('pins first-observed revisions when requested and releases changed content', async () => {
    const backing = fakeOrigin(['texture.dds'])
    let revision = 1
    const origin: CompanionOrigin = {
      ...backing,
      async open(id) {
        const lease = await backing.open(id)
        return {
          ...lease,
          value: { ...lease.value, revision: revisionId(`provider-token:r${revision}`) },
        }
      },
    }
    const session = createResourceSession({
      origin,
      revision: SESSION_REVISION,
      revisionPolicy: 'pin',
    })
    try {
      const first = await session.resolve(requirement('first', 'texture.dds'))
      if (first.state !== 'resolved') throw new Error('expected initial content')
      await first.lease.release()
      revision++
      const changed = await session.resolve(requirement('changed', 'texture.dds'))
      expect(changed).toMatchObject({ state: 'unresolved', reason: 'source-revision-changed' })
      expect(backing.outstanding()).toBe(0)
      const fresh = createResourceSession({
        origin,
        revision: SESSION_REVISION,
        revisionPolicy: 'pin',
      })
      try {
        expect((await fresh.resolve(requirement('fresh', 'texture.dds'))).state).toBe('resolved')
      } finally {
        await fresh.dispose()
      }
    } finally {
      await session.dispose()
    }
  })

  it('keeps two sessions over one origin independent in cache, budget and leases', async () => {
    const origin = fakeOrigin(['textures/a.dds', 'textures/b.dds'])
    const left = createResourceSession({ origin, revision: SESSION_REVISION, sessionId: 'left' })
    const right = createResourceSession({
      origin,
      revision: revisionId('provider-token:other-plane'),
      sessionId: 'right',
    })
    try {
      await left.resolve(requirement('r1', 'textures/a.dds'))
      await right.resolve(requirement('r1', 'textures/a.dds'))
      // each session pays for its own lookup: a shared index would have made the second free
      expect(origin.counts.enumerations).toBe(2)
      expect(origin.outstanding()).toBe(2)
      expect(left.sessionId).not.toBe(right.sessionId)
      expect(left.revision).not.toBe(right.revision)

      await left.dispose()
      // one session's teardown releases exactly its own leases
      expect(origin.outstanding()).toBe(1)
      expect(right.state()).toBe('live')
      const stillWorks = await right.resolve(requirement('r2', 'textures/b.dds'))
      expect(stillWorks.state).toBe('resolved')
    } finally {
      await right.dispose()
      expect(origin.outstanding()).toBe(0)
    }
  })

  it('strands no lease when a teardown lands in the middle of a burst of resolutions', async () => {
    /*
     * Teardown under load. Sixty-four resolutions are started at once and the session is disposed
     * while they are in flight, so every interleaving is exercised: one that already took its
     * lease, one inside `open`, and one that has not started. The claim is not that a particular
     * number succeed — that is a race, and asserting it would be asserting the scheduler. The claim
     * is that when the dust settles the origin holds nothing, every outcome is either a resolution
     * or the coded `session-disposed`, and the provenance accounts for all of them.
     */
    const entries = Array.from({ length: 64 }, (_, index) => `textures/t${index}.dds`)
    const origin = fakeOrigin(entries)
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    const inFlight = entries.map(async (logicalId, index) =>
      session.resolve(requirement(`r${index}`, logicalId)),
    )
    await session.dispose()
    const settled = await Promise.allSettled(inFlight)

    for (const outcome of settled) {
      expect(outcome.status).toBe('fulfilled')
      if (outcome.status !== 'fulfilled') continue
      if (outcome.value.state === 'unresolved') {
        expect(outcome.value.reason).toBe('session-disposed')
      }
    }
    // the invariant that matters: nothing is still open, and nothing was released twice
    expect(origin.outstanding()).toBe(0)
    expect(origin.counts.releases).toBe(origin.counts.opens)
    expect(session.state()).toBe('disposed')
    expect(session.provenance().length).toBe(entries.length)

    // and a session torn down mid-burst still refuses everything afterwards
    const after = await session.resolve(requirement('late', 'textures/t0.dds'))
    expect(unresolvedReason(after)).toBe('session-disposed')
  })
})

/*
 * A game's own fallback spelling: Warzone 2100 loads a `.png` texture key as its `.ktx2` when no
 * `.png` is there, and a mod's `.png` still wins over the shipped `.ktx2`.
 */
describe('resource session — alternatives', () => {
  it('tries the alternatives in order only while the last one was not found', async () => {
    const origin = fakeOrigin(['texpages/page-89.ktx2', 'texpages/page-90.png', 'texpages/page-90.ktx2'])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      const shipped = await session.resolve(
        requirement('ground', 'texpages/page-89.png', { alternatives: ['texpages/page-89.ktx2'] }),
      )
      expect(shipped.state).toBe('resolved')
      if (shipped.state !== 'resolved') return
      expect(shipped.provenance).toMatchObject({ requirementId: 'ground', logicalId: 'texpages/page-89.ktx2' })
      await shipped.lease.release()
      const modded = await session.resolve(
        requirement('mod', 'texpages/page-90.png', { alternatives: ['texpages/page-90.ktx2'] }),
      )
      expect(modded.state === 'resolved' && modded.provenance.logicalId).toBe('texpages/page-90.png')
      if (modded.state === 'resolved') await modded.lease.release()
      const missing = await session.resolve(
        requirement('none', 'texpages/page-91.png', { alternatives: ['texpages/page-91.ktx2'] }),
      )
      expect(unresolvedReason(missing)).toBe('not-found')
      expect(missing.provenance.logicalId).toBe('texpages/page-91.ktx2')
    } finally {
      await session.dispose()
    }
  })
})

describe('model dependency resources — caller context', () => {
  function ports(
    nativeFiles: string[],
    parentFiles: string[],
    nativeScopes: InputSearchScope[] = ['sibling-directory', 'enclosing-container'],
    parentScopes: InputSearchScope[] = ['current-mount', 'workspace-dependency-layer', 'explicit-user-selection'],
  ) {
    const nativeOrigin = fakeOrigin(nativeFiles, { scopes: nativeScopes })
    const parentOrigin = fakeOrigin(parentFiles, { scopes: parentScopes })
    const native = createResourceSession({ origin: nativeOrigin, revision: SESSION_REVISION, sessionId: 'native' })
    const parent = createResourceSession({ origin: parentOrigin, revision: SESSION_REVISION, sessionId: 'parent' })
    const calls: string[] = []
    const wrapped = (port: typeof native, name: string) => ({
      ...port,
      resolve: async (req: LogicalResourceRequirement, signal?: AbortSignal) => {
        calls.push(`${name}:${req.scopes.join(',')}`)
        return port.resolve(req, signal)
      },
    })
    return {
      native,
      parent,
      nativeOrigin,
      parentOrigin,
      calls,
      view: createModelDependencyResources(wrapped(parent, 'parent'), wrapped(native, 'native')),
    }
  }

  it.each([
    ['sibling-directory', 'workspace-dependency-layer'],
    ['workspace-dependency-layer', 'sibling-directory'],
    ['enclosing-container', 'current-mount'],
    ['current-mount', 'enclosing-container'],
    ['explicit-user-selection', 'enclosing-container'],
  ] as InputSearchScope[][])('preserves requested priority with conflicts in both contexts (%s)', async (...scopes) => {
    const p = ports(['textures/shared.dds'], ['textures/shared.dds'])
    try {
      const result = await p.view.resolve({ ...requirement('conflict', 'textures/shared.dds'), scopes })
      expect(result.state).toBe('resolved')
      expect(p.calls).toEqual([`${['sibling-directory', 'enclosing-container'].includes(scopes[0]!) ? 'native' : 'parent'}:${scopes[0]}`])
      if (result.state === 'resolved') await result.lease.release()
    } finally {
      await p.view.dispose()
      await p.native.dispose()
      await p.parent.dispose()
    }
  })

  it('finds a workspace-only DDS after a native miss without widening scopes', async () => {
    const p = ports([], ['textures/workspace.dds'])
    try {
      const result = await p.view.resolve({
        ...requirement('workspace', 'textures/workspace.dds'),
        scopes: ['sibling-directory', 'workspace-dependency-layer'],
      })
      expect(result.state).toBe('resolved')
      expect(p.calls).toEqual(['native:sibling-directory', 'parent:workspace-dependency-layer'])
      if (result.state === 'resolved') await result.lease.release()
    } finally {
      await p.view.dispose()
      await p.native.dispose()
      await p.parent.dispose()
    }
  })

  it.each([RESOURCE_NOT_ALLOWLISTED, RESOURCE_BUDGET_EXCEEDED, RESOURCE_PATH_REFUSED])(
    'stops at terminal native refusal %s', async code => {
      const p = ports([], ['textures/shared.dds'])
      const refusing = {
        ...p.native,
        resolve: async (req: LogicalResourceRequirement) => ({
          state: 'unresolved',
          reason: 'not-allowlisted',
          diagnostic: { code, severity: 'error', message: 'refused' },
          provenance: {
            requirementId: req.id,
            logicalId: req.logicalId,
            role: req.role,
            state: 'unresolved',
            reason: 'not-allowlisted',
            scopes: req.scopes,
            cached: false,
          },
        } as ResourceResolution),
      }
      const view = createModelDependencyResources({
        ...p.parent,
        resolve: async (req: LogicalResourceRequirement) => {
          p.calls.push('parent')
          return p.parent.resolve(req)
        },
      }, refusing)
      try {
        const result = await view.resolve({
          ...requirement('terminal', 'textures/shared.dds'),
          scopes: ['sibling-directory', 'workspace-dependency-layer'],
        })
        expect(result.state).toBe('unresolved')
        expect(p.calls).toEqual([])
      } finally {
        await view.dispose()
        await p.native.dispose()
        await p.parent.dispose()
      }
    },
  )

  it('borrows sessions and leases without taking disposal ownership', async () => {
    const p = ports(['textures/shared.dds'], [])
    const result = await p.view.resolve({
      ...requirement('borrow', 'textures/shared.dds'),
      scopes: ['sibling-directory'],
    })
    expect(result.state).toBe('resolved')
    await p.view.dispose()
    expect(p.native.state()).toBe('live')
    expect(p.parent.state()).toBe('live')
    expect(p.nativeOrigin.counts.releases).toBe(0)
    await expect(p.view.resolve(requirement('closed', 'textures/shared.dds'))).rejects.toThrow(/disposed/)
    if (result.state === 'resolved') await result.lease.release()
    expect(p.nativeOrigin.counts.releases).toBe(1)
    await p.native.dispose()
    await p.parent.dispose()
    expect(p.nativeOrigin.counts.releases).toBe(1)
  })
})

it('releases a pending borrowed resolution if its model dependency view is disposed', async () => {
  const nativeOrigin = fakeOrigin(['textures/pending.dds'], { scopes: ['sibling-directory'] })
  const parentOrigin = fakeOrigin(['textures/pending.dds'], { scopes: ['workspace-dependency-layer'] })
  const native = createResourceSession({ origin: nativeOrigin, revision: SESSION_REVISION })
  const parent = createResourceSession({ origin: parentOrigin, revision: SESSION_REVISION })
  let complete!: (result: ResourceResolution) => void
  const pending = new Promise<ResourceResolution>(resolve => { complete = resolve })
  let fallbacks = 0
  const view = createModelDependencyResources({
    ...parent,
    resolve: async (req: LogicalResourceRequirement) => {
      fallbacks++
      return parent.resolve(req)
    },
  }, { ...native, resolve: async () => pending })
  const req = requirement('pending', 'textures/pending.dds', {
    scopes: ['sibling-directory', 'workspace-dependency-layer'],
  })
  const request = view.resolve(req)
  await view.dispose()
  const result = await native.resolve({ ...req, scopes: ['sibling-directory'] })
  expect(result.state).toBe('resolved')
  complete(result)
  await expect(request).rejects.toThrow(/disposed/)
  expect(nativeOrigin.counts.releases).toBe(1)
  expect(fallbacks).toBe(0)
  expect(native.state()).toBe('live')
  expect(parent.state()).toBe('live')
  await native.dispose()
  await parent.dispose()
  expect(nativeOrigin.counts.releases).toBe(1)
})

import { createContentSourceCompanionOrigin } from '../src/content-source-companion.js'

describe('late resource session — existing content-source exact path owner', () => {
  function exactFixture(mode: 'hidden' | 'miss' | 'unsupported' | 'refused' = 'hidden') {
    const counts = { lookup: 0, list: 0, read: 0 }
    const refusal = Object.assign(new Error('provider refused'), { code: 'x3.fixture/access-denied' })
    const contentSources = {
      async lookup(_root: string, path: string) {
        counts.lookup += 1
        if (mode === 'unsupported') throw new Error('ordinary unsupported probe')
        if (mode === 'refused') throw refusal
        return mode === 'miss' ? undefined : { path, name: '2468', directory: false, size: 3 }
      },
      async list(_root: string, path: string) {
        counts.list += 1
        expect(path).toBe('filedataid')
        return mode === 'hidden' ? [] : [{ path: 'filedataid/2468', name: '2468', directory: false, size: 3 }]
      },
      async read(_root: string, path: string) {
        counts.read += 1
        expect(path.toLowerCase()).toBe('filedataid/2468')
        return Uint8Array.of(1, 2, 3)
      },
    }
    return { counts, refusal, origin: createContentSourceCompanionOrigin({ contentSources, target: { sourceId: 'fixture', path: 'filedataid/126487' } }) }
  }

  it('late actual factory resolves a hidden full path through lookup without listing', async () => {
    const fixture = exactFixture()
    const session = createResourceSession({ origin: fixture.origin, revision: SESSION_REVISION })
    try {
      const result = await session.resolve(requirement('hidden-no-extension', 'filedataid/2468'))
      expect(result.state).toBe('resolved')
      expect(fixture.counts).toEqual({ lookup: 1, list: 0, read: 1 })
      if (result.state === 'resolved') {
        expect(await result.lease.value.read(0n, 3)).toEqual(Uint8Array.of(1, 2, 3))
        await result.lease.release()
      }
    } finally { await session.dispose() }
  })

  it.each(['miss', 'unsupported'] as const)('retains ordinary %s lookup listing fallback', async mode => {
    const fixture = exactFixture(mode)
    const session = createResourceSession({ origin: fixture.origin, revision: SESSION_REVISION })
    try {
      const result = await session.resolve(requirement('fallback', 'filedataid/2468'))
      expect(result.state).toBe('resolved')
      expect(fixture.counts).toEqual({ lookup: 1, list: 1, read: 1 })
      if (result.state === 'resolved') await result.lease.release()
    } finally { await session.dispose() }
  })

  it('does not bypass a structured lookup refusal through a successful listing', async () => {
    const fixture = exactFixture('refused')
    const session = createResourceSession({ origin: fixture.origin, revision: SESSION_REVISION })
    try {
      await expect(session.resolve(requirement('denied', 'filedataid/2468'))).rejects.toBe(fixture.refusal)
      expect(fixture.counts).toEqual({ lookup: 1, list: 0, read: 0 })
    } finally { await session.dispose() }
  })

  it('preserves case policy and cancellation before entering the provider', async () => {
    const fixture = exactFixture()
    const session = createResourceSession({ origin: fixture.origin, revision: SESSION_REVISION })
    try {
      await expect(session.resolve(requirement('aborted', 'filedataid/2468'), AbortSignal.abort())).rejects.toMatchObject({ code: CANCELLED_CODE })
      expect(fixture.counts).toEqual({ lookup: 0, list: 0, read: 0 })
      const result = await session.resolve(requirement('case', 'FileDataID/2468'))
      expect(result.state).toBe('resolved')
      expect(fixture.counts).toEqual({ lookup: 1, list: 0, read: 1 })
      if (result.state === 'resolved') await result.lease.release()
    } finally { await session.dispose() }
  })
})
