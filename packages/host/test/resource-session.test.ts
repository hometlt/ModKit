/**
 * The contract of the post-open resource session (block 11, slice 11C0, plan item 13).
 *
 * Like the companion suite it sits beside, everything here runs against a *fake* origin backend
 * that counts enumerations, opens and releases. The counting is the point: "the budget is spent
 * once" and "a lease is never stranded" are claims about behaviour, and a suite that only asserted
 * return values could not tell a cached miss from a second full scan of a 666,588-entry namespace.
 */

import { describe, expect, it } from 'vitest'
import { CANCELLED_CODE } from '@modkitx-x3/core'
import {
  revisionId,
  type ArtifactSource,
  type InputSearchScope,
  type Lease,
  type LogicalResourceRequirement,
  type ResourceResolution,
} from '@modkitx-x3/sdk'
import {
  createResourceSession,
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
        if (!entry.logicalId.startsWith(enumerationOptions.prefix)) continue
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

  it('narrows enumeration by the directory prefix of the logical id', async () => {
    const origin = fakeOrigin([
      'other/a.dds',
      'other/b.dds',
      'textures/hull.dds',
      'textures/turret.dds',
    ])
    const session = createResourceSession({ origin, revision: SESSION_REVISION })
    try {
      await session.resolve(requirement('r1', 'textures/hull.dds'))
      // the two `other/` entries are never served: a big namespace stays a bounded search
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
    const origin = fakeOrigin(['textures/a.dds', 'textures/b.dds', 'textures/c.dds'])
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
      maxEntries: 4096,
    })
    expect(resourceDiagnosticCode('cycle-detected')).toBe(RESOURCE_CYCLE_DETECTED)
  })
})

describe('resource session — lifecycle', () => {
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
