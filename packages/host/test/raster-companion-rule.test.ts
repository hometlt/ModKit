/**
 * The codec's own search rule, applied to a viewer's logical raster read.
 *
 * A viewer asks for a texture by the name the document spells and by role. It does not get to
 * decide which mounts are searched, nor that a model carried out of its mod keeps naming
 * `Assets/Textures/Foo.dds` while the file now sits beside it. Both of those are the opening
 * codec's answer, taken from the requirements its `planInput` returned, and this pins them:
 * the scopes the codec listed replace the caller's, and the spellings are tried in its order.
 */

import { describe, expect, it } from 'vitest'
import { revisionId, type LogicalResourceRequirement, type ResourceSessionPort } from '@modkit/sdk'
import { diagnostic } from '@modkit/core'
import { createSubjectRasterResources } from '../src/raster-resources.js'

const budget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 10_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

/** Resolves nothing, so the whole ladder is walked and every rung is recorded. */
function recordingSession(): {
  readonly port: ResourceSessionPort
  readonly asked: { logicalId: string; scopes: readonly string[] }[]
} {
  const asked: { logicalId: string; scopes: readonly string[] }[] = []
  const port: ResourceSessionPort = {
    sessionId: 'recording',
    revision: revisionId('provider-token:recording'),
    state: () => 'live',
    async resolve(requirement: LogicalResourceRequirement) {
      asked.push({ logicalId: requirement.logicalId, scopes: [...requirement.scopes] })
      const provenance = {
        requirementId: requirement.id,
        logicalId: requirement.logicalId,
        role: requirement.role,
        state: 'unresolved' as const,
        reason: 'not-found' as const,
        cached: false,
        scopes: requirement.scopes,
      }
      return {
        state: 'unresolved' as const,
        reason: 'not-found' as const,
        diagnostic: diagnostic('warning', 'test/not-found', 'nothing here'),
        provenance,
      }
    },
    provenance: () => [],
    dispose: async () => undefined,
  }
  return { port, asked }
}

function read(options: {
  readonly rule?: Parameters<typeof createSubjectRasterResources>[0]['companionRule']
}) {
  const { port, asked } = recordingSession()
  const raster = createSubjectRasterResources({
    state: { live: true, reservedBytes: 0, resources: port },
    budget,
    isAuthorized: () => true,
    ...(options.rule === undefined ? {} : { companionRule: options.rule }),
    open: async () => {
      throw new Error('the ladder resolved nothing, so no source should ever be opened')
    },
  })
  return { asked, raster }
}

const requirement: LogicalResourceRequirement = {
  id: 'texture-0',
  logicalId: 'Assets/Textures/Foo.dds',
  role: 'texture',
  // What a viewer guesses at. The codec's rule is what must actually be used.
  scopes: ['sibling-directory', 'explicit-user-selection'],
}

describe('raster reads follow the opening codec’s companion rule', () => {
  it('tries the document’s own spelling, then the name under each directory the codec named', async () => {
    const { asked, raster } = read({
      rule: () => ({
        scopes: ['sibling-directory', 'workspace-dependency-layer'],
        directories: ['', 'Textures', 'Assets/Textures'],
      }),
    })

    const result = await raster.read({ kind: 'logical', requirement, maxBytes: 4096 })

    expect(result.state).toBe('unresolved')
    expect(asked.map(item => item.logicalId)).toEqual([
      // verbatim first: a preserved layout is simply right
      'Assets/Textures/Foo.dds',
      // then the name on its own — the model dropped beside its textures
      'Foo.dds',
      'Textures/Foo.dds',
      // `Assets/Textures/Foo.dds` is not asked a second time
    ])
    for (const item of asked) {
      expect(item.scopes).toEqual(['sibling-directory', 'workspace-dependency-layer'])
    }
  })

  it('stops at the first spelling that resolves', async () => {
    const { port, asked } = recordingSession()
    const resolving = {
      ...port,
      async resolve(item: LogicalResourceRequirement) {
        if (item.logicalId !== 'Foo.dds') return port.resolve(item)
        asked.push({ logicalId: item.logicalId, scopes: [...item.scopes] })
        throw new Error('resolved')
      },
    }
    const raster = createSubjectRasterResources({
      state: { live: true, reservedBytes: 0, resources: resolving },
      budget,
      isAuthorized: () => true,
      companionRule: () => ({ scopes: ['sibling-directory'], directories: ['', 'Textures'] }),
      open: async () => {
        throw new Error('unreachable')
      },
    })

    // The stub throws on the rung that would have resolved, which the port reports as a named
    // failure. What is being pinned is that the ladder stopped there and never tried `Textures/`.
    const result = await raster.read({ kind: 'logical', requirement, maxBytes: 4096 })

    expect(result.diagnostics[0]?.code).toBe('x3.host/raster-resource-failed')
    expect(asked.map(item => item.logicalId)).toEqual(['Assets/Textures/Foo.dds', 'Foo.dds'])
  })

  it('leaves the caller’s scopes alone for a role the codec planned nothing for', async () => {
    const { asked, raster } = read({ rule: () => undefined })

    await raster.read({ kind: 'logical', requirement, maxBytes: 4096 })

    expect(asked).toEqual([
      {
        logicalId: 'Assets/Textures/Foo.dds',
        scopes: ['sibling-directory', 'explicit-user-selection'],
      },
    ])
  })
})
