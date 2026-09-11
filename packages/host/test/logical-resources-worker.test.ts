import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '@modkit/core'
import {
  revisionId,
  type ArtifactByteSource,
  type ResourceBudget,
  type ResourceSessionPort,
} from '@modkit/sdk'
import {
  buildInventory,
  createHostContributionContractRegistry,
  createExecutionBackendRegistry,
} from '../src/index.js'
import { loadExtensionDirectory } from '../src/node/loader.js'
import {
  createNodeWorkerBackend,
  WORKER_SHARED_PROCESS_DIAGNOSTIC,
} from '../src/node/worker-backend.js'
import { createCompanionInputResolver } from '../src/input-resolution.js'
import { openSubject } from '../src/subject-open.js'
import { workerBackendPolicy } from '../src/execution/worker-policy.js'

const revision = revisionId('provider-token:logical-worker-source')
const budget: ResourceBudget = {
  maxInputBytes: 1024n,
  maxDepth: 8,
  maxNodes: 8,
  maxScalarBytes: 1024,
  maxDiagnostics: 8,
}
function source(
  bytes: Uint8Array,
  name: string,
  read?: ArtifactByteSource['read'],
): ArtifactByteSource {
  return {
    kind: 'bytes',
    ref: { id: name, uri: `memory:${name}` },
    revision,
    size: BigInt(bytes.length),
    read: read ?? (async (offset, length) => bytes.slice(Number(offset), Number(offset) + length)),
    async *stream() {
      yield bytes.slice()
    },
  }
}

describe('logical resources through an ordinary attested Node worker codec', () => {
  let inventory: Awaited<ReturnType<typeof buildInventory>>
  async function open(name = 'main.logical') {
    const bytes = new Uint8Array([10, 20, 30, 40])
    const main = new TextEncoder().encode('GRANTS')
    const controller = new AbortController()
    let readAborted = 0
    let resources: ResourceSessionPort | undefined
    const released = vi.fn(async () => undefined)
    const diagnostics: Diagnostic[] = []
    const discover = vi.fn(async () => ({
      state: 'complete' as const,
      context: { primaryLogicalId: name },
      candidates: [{ logicalId: 'walk.m3a', rootId: 'root', expectedRevision: revision, size: 4n }],
      receipt: { complete: true, pages: 1, entries: 1, candidates: 1, bytes: 4n },
    }))
    const resolver = createCompanionInputResolver({
      primaryLogicalId: name,
      caseSensitivity: 'sensitive',
      scopes: ['current-mount'],
      async *enumerate() {
        yield { logicalId: 'walk.m3a' }
      },
      async open() {
        const read: ArtifactByteSource['read'] | undefined =
          name !== 'abort.logical'
            ? undefined
            : async (_offset, _length, signal) => {
                if (signal === undefined)
                  throw new Error('Read cancellation signal was not forwarded')
                return new Promise((_resolve, reject) => {
                  const abort = () => {
                    readAborted += 1
                    reject(signal.reason)
                  }
                  if (signal.aborted) abort()
                  else signal.addEventListener('abort', abort, { once: true })
                  controller.abort()
                })
              }
        return { value: source(bytes, 'walk.m3a', read), release: released }
      },
    })
    const openResources = resolver.openResources
    if (openResources === undefined) throw new Error('Missing resource session factory')
    resolver.openResources = options => {
      resources = openResources(options)
      return resources
    }
    const result = await openSubject({
      inventory,
      source: source(main, name),
      path: name,
      intent: 'full',
      target: { environment: 'node-worker', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'logical-worker', classes: ['read-source'] },
      budget,
      ...(name === 'abort.logical' ? { signal: controller.signal } : {}),
      resolveInput: resolver,
      logicalResourceDiscovery: [{ role: 'sidecar', extension: '.m3a', discover }],
      executionBackends: createExecutionBackendRegistry([
        createNodeWorkerBackend({
          bootstrapUrl: new URL('../dist/node/worker-bootstrap.js', import.meta.url),
          policy: workerBackendPolicy({
            defaultCallDeadlineMs: name === 'deadline.logical' ? 200 : 2000,
            graceMs: 100,
          }),
          onDiagnostic: diagnostic => {
            diagnostics.push(diagnostic)
          },
        }),
      ]),
    })
    return { result, released, diagnostics, discover, main, bytes, resources, readAborted }
  }
  beforeAll(async () => {
    const input = await loadExtensionDirectory(
      join(import.meta.dirname, 'fixtures', 'logical-resource-worker'),
    )
    inventory = await buildInventory([input], createHostContributionContractRegistry())
    // Charge cold loader/worker initialization to the hook; the asserted test retains its 5 s limit.
    const warmed = await open()
    if (warmed.result.state !== 'opened') throw new Error(JSON.stringify(warmed.result))
    await warmed.result.session.dispose()
  }, 60_000)

  it.each(['main.logical', 'batch.logical'])(
    'initializes %s through host resources and releases bytes before disposal',
    async name => {
      const f = await open(name)
      if (f.result.state !== 'opened') throw new Error(JSON.stringify(f.result))
      try {
        expect(f.result.selected.variantId).toBe('worker')
        expect(f.diagnostics.map(d => d.code)).toContain(WORKER_SHARED_PROCESS_DIAGNOSTIC)
        expect(f.result.descriptor.interpretation).toBe('codec')
        expect(f.discover).toHaveBeenCalledTimes(1)
        expect(f.released).toHaveBeenCalledTimes(1)
        expect(f.result.resources?.provenance()).toMatchObject([
          { logicalId: 'walk.m3a', state: 'resolved', bytes: 4n },
        ])
        expect(f.bytes).toEqual(new Uint8Array([10, 20, 30, 40]))
        expect(f.main).toEqual(new TextEncoder().encode('GRANTS'))
      } finally {
        await f.result.session.dispose()
      }
      expect(f.result.resources?.state()).toBe('disposed')
      expect(f.released).toHaveBeenCalledTimes(1)
    },
  )
  it('refuses a worker session that disposes itself while initializing its descriptor', async () => {
    const f = await open('disposed.logical')
    expect(f.result.state).toBe('unresolved')
    expect(f.result.diagnostics.map(d => d.code)).toContain('x3.host/subject-context-unavailable')
    expect(f.diagnostics.map(d => d.code)).toContain(WORKER_SHARED_PROCESS_DIAGNOSTIC)
    expect(f.discover).toHaveBeenCalledTimes(1)
    expect(f.released).toHaveBeenCalledTimes(1)
    expect(f.bytes).toEqual(new Uint8Array([10, 20, 30, 40]))
  })
  it('cancels descriptor initialization when the ordinary open signal aborts and releases its pending source', async () => {
    const f = await open('abort.logical')
    expect(f.result.state).toBe('unresolved')
    expect(f.readAborted).toBe(1)
    expect(f.resources?.state()).toBe('disposed')
    expect(f.released).toHaveBeenCalledTimes(1)
    expect(f.result.diagnostics.map(d => d.code)).not.toContain('x3.host/rpc-deadline-exceeded')
    expect(f.bytes).toEqual(new Uint8Array([10, 20, 30, 40]))
  })
  it('terminates an uncooperative descriptor through the existing deadline watchdog and releases its source', async () => {
    const f = await open('deadline.logical')
    expect(f.result.state).toBe('unresolved')
    expect(f.result.diagnostics.map(d => d.code)).toContain('x3.host/rpc-deadline-exceeded')
    expect(
      f.diagnostics.some(
        d =>
          d.code === 'x3.host/worker-terminated' && /cancel not honoured.*deadline/.test(d.message),
      ),
    ).toBe(true)
    expect(f.resources?.state()).toBe('disposed')
    expect(f.released).toHaveBeenCalledTimes(1)
  })
})
