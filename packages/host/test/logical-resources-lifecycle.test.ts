import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildInventory,
  createHostContributionContractRegistry,
  createExecutionBackendRegistry,
} from '@modkit/host'
import { loadExtensionDirectory } from '@modkit/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type CodecModule,
  type LogicalResourceDiscoveryResult,
  type LogicalResourcePort,
  type ResourceBudget,
} from '@modkit/sdk'
import { openSubject } from '../src/subject-open.js'
import { createCompanionInputResolver } from '../src/input-resolution.js'

const budget: ResourceBudget = {
  maxInputBytes: 1024n,
  maxDepth: 8,
  maxNodes: 8,
  maxScalarBytes: 256,
  maxDiagnostics: 8,
}
const revision = revisionId('provider-token:logical-subject')
const request = { role: 'sidecar', extension: '.m3a' } as const
const requirement = {
  id: 'walk',
  role: 'sidecar',
  logicalId: 'walk.m3a',
  scopes: ['current-mount'],
} as const
const source: ArtifactByteSource = {
  kind: 'bytes',
  ref: { id: 'GrantsRoot', uri: 'memory:GrantsRoot' },
  revision,
  size: 6n,
  async read(offset, length) {
    return new TextEncoder().encode('GRANTS').slice(Number(offset), Number(offset) + length)
  },
  async *stream() {
    yield new TextEncoder().encode('GRANTS')
  },
}

describe('logical resources bind between open and the initial descriptor', () => {
  let inventory: Awaited<ReturnType<typeof buildInventory>>
  beforeAll(async () => {
    const input = await loadExtensionDirectory(
      join(import.meta.dirname, 'fixtures', 'subject-open-grants-extension'),
    )
    inventory = await buildInventory(
      [{ ...input, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
      createHostContributionContractRegistry(),
    )
  })

  it.each(['ok', 'revision', 'descriptor', 'expired-grant', 'self-disposed'] as const)(
    'preserves post-open ownership on %s path',
    async failure => {
      const stages: string[] = []
      const now = Date.now()
      const clock = vi.spyOn(Date, 'now')
      const release = vi.fn(async () => undefined)
      const resolver = createCompanionInputResolver({
        primaryLogicalId: 'GrantsRoot',
        caseSensitivity: 'sensitive',
        scopes: ['current-mount'],
        async *enumerate() {
          yield { logicalId: 'walk.m3a' }
        },
        async open() {
          return { value: source, release }
        },
      })
      const openResources = resolver.openResources
      if (openResources === undefined) throw new Error('Expected post-open resolver')
      const disposed = vi.fn(async () => undefined)
      resolver.openResources = options => {
        stages.push('bind')
        const resources = openResources(options)
        return {
          ...resources,
          async dispose() {
            await disposed()
            await resources.dispose()
          },
        }
      }
      let port: LogicalResourcePort | undefined
      const discover = vi.fn(async (): Promise<LogicalResourceDiscoveryResult> => ({
        state: 'complete',
        candidates: [
          { logicalId: 'walk.m3a', expectedRevision: revision, size: 6n, rootId: 'test' },
        ],
        receipt: { complete: true, pages: 1, entries: 1, candidates: 1, bytes: 6n },
      }))
      const policy = { ...request, extension: '.m3a', discover }
      const policies = [policy]
      const executionBackends = createExecutionBackendRegistry([
        {
          profile: 'trusted-in-process',
          supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
          async activate(context) {
            // The request array, selector record and callback change after open has yielded.
            // The initial policy snapshot must still select the original registration.
            policies.length = 0
            policy.extension = '.other'
            policy.discover = vi.fn(async (): Promise<LogicalResourceDiscoveryResult> => {
              throw new Error('Replacement callback must not execute')
            })
            const module = (await import(context.entrypoint.href)) as CodecModule
            return {
              module: {
                abiVersion: 1,
                createCodec(ctx: Parameters<CodecModule['createCodec']>[0]) {
                  port = ctx.logicalResources
                  const codec = module.createCodec(ctx)
                  return {
                    ...codec,
                    async open(...args: Parameters<typeof codec.open>) {
                      stages.push('open')
                      expect(await port?.discover(request)).toMatchObject({
                        state: 'refused',
                        reason: 'context-unavailable',
                      })
                      const session = await codec.open(...args)
                      let selfDisposed = false
                      return {
                        ...session,
                        state: () => (selfDisposed ? 'disposed' : session.state()),
                        revision:
                          failure === 'revision'
                            ? revisionId('provider-token:wrong')
                            : session.revision,
                        async descriptor() {
                          stages.push('descriptor')
                          expect(await port?.discover(request)).toMatchObject({ state: 'complete' })
                          const resolved = await port?.resolve(requirement)
                          if (
                            resolved?.state !== 'resolved' ||
                            resolved.lease.value.kind !== 'bytes'
                          )
                            throw new Error('No sidecar bytes')
                          expect(await resolved.lease.value.read(0n, 6)).toEqual(
                            new TextEncoder().encode('GRANTS'),
                          )
                          await resolved.lease.release()
                          if (failure === 'descriptor')
                            throw new Error('Intentional descriptor failure')
                          if (failure === 'expired-grant') clock.mockReturnValue(now + 20_000)
                          if (failure === 'self-disposed') selfDisposed = true
                          return session.descriptor()
                        },
                        async dispose() {
                          stages.push('dispose')
                          expect(await port?.discover(request)).toMatchObject({
                            state: 'refused',
                            reason: 'context-unavailable',
                          })
                          await session.dispose()
                        },
                      }
                    },
                  }
                },
              },
              release: async () => undefined,
            }
          },
        },
      ])
      const result = await openSubject({
        inventory,
        source,
        path: 'GrantsRoot',
        intent: 'full',
        target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
        // This existing fixture declares write-source; use its admitted grant so this test reaches open.
        grant: {
          id: `logical-${failure}`,
          classes: ['read-source', 'write-source'],
          expiresAt: new Date(now + 10_000).toISOString(),
        },
        budget,
        executionBackends,
        resolveInput: resolver,
        logicalResourceDiscovery: policies,
      }).finally(() => clock.mockRestore())
      expect(stages, JSON.stringify(result.diagnostics)).not.toEqual([])
      if (failure === 'ok') {
        expect(result.state).toBe('opened')
        if (result.state !== 'opened') throw new Error(JSON.stringify(result.diagnostics))
        expect(stages).toEqual(['open', 'bind', 'descriptor'])
        await result.session.dispose()
        await result.session.dispose()
      } else expect(result.state).toBe('unresolved')
      expect(stages).toEqual(
        failure === 'revision' ? ['open', 'dispose'] : ['open', 'bind', 'descriptor', 'dispose'],
      )
      expect(disposed).toHaveBeenCalledTimes(failure === 'revision' ? 0 : 1)
      expect(release).toHaveBeenCalledTimes(failure === 'revision' ? 0 : 1)
      expect(discover).toHaveBeenCalledTimes(failure === 'revision' ? 0 : 1)
      expect(await port?.discover(request)).toMatchObject({
        state: 'refused',
        reason: 'context-unavailable',
      })
    },
  )
})
