/** Production Node worker transport must retain native ranged-entry fields and lease ownership. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import type { AssetInput, Codec, ContributionContext, ResourceBudget } from '@modkit/sdk'
import {
  activateExecutionBackend,
  closeExecutionBackendRegistry,
  createExecutionBackendRegistry,
  type ExecutionBackendActivation,
} from '../src/execution/backend.js'
import { createNodeWorkerBackend } from '../src/node/worker-backend.js'
import { workerBackendPolicy } from '../src/execution/worker-policy.js'

it('opens and releases a provider-pinned 4GiB artifact through the production worker backend', async () => {
  const temporaryRoot = resolve(process.platform === 'win32' ? 'C:/MKTEMP' : tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'modkit-native-artifact-worker-'))
  const entrypoint = pathToFileURL(join(directory, 'codec.mjs'))
  const bootstrapUrl =
    process.env['MODKIT_TEST_WORKER_BOOTSTRAP'] === undefined
      ? new URL('../dist/node/worker-bootstrap.js', import.meta.url)
      : pathToFileURL(process.env['MODKIT_TEST_WORKER_BOOTSTRAP'])
  const registry = createExecutionBackendRegistry([
    createNodeWorkerBackend({
      bootstrapUrl,
      policy: workerBackendPolicy({ loadDeadlineMs: 10000, graceMs: 300 }),
    }),
  ])
  try {
    await writeFile(
      entrypoint,
      `
export const abiVersion = 1
export function createCodec() {
  let released = 0
  return { async open() { return {
    revision: 'provider-token:session', state: () => 'live',
    descriptor: async () => ({ released }),
    async dataSource() { return { value: {
      list: async () => ({items: []}), openEntry: async () => { throw new Error('legacy ref forbidden') },
      async openEntryArtifactSource() { return { value: {
        kind: 'bytes', ref: {id: 'native', uri: 'native://CAB'}, revision: 'provider-token:native',
        size: 4294967296n, containerContext: {native: 'pinned'},
        async read(offset, length) {
          if (offset !== 4294967294n || length !== 2) throw new Error('unbounded read forbidden')
          return new Uint8Array([7, 8])
        },
      }, async release() { released += 1 } } },
    }, async release() {} } },
    operations: () => ({invoke: async () => ({}), dispose: async () => {}}),
    events: async function* () {}, dispose: async () => {},
  } } }
}
`,
    )
    const lease = await activateExecutionBackend(registry, {
      ticket: { contributionId: 'org.example/native-worker', artifactDigest: 'sha256:fixture' },
      entrypoint,
      artifactRoot: pathToFileURL(`${directory}/`),
      variant: {
        variantId: 'portable',
        executionProfile: 'worker-brokered',
        targets: [],
        entrypoint: 'codec.mjs',
      },
      target: { environment: 'node-worker', os: 'any', arch: 'any' },
      grant: {},
    } as unknown as ExecutionBackendActivation)
    try {
      const budget: ResourceBudget = {
        maxInputBytes: 1024n,
        maxNodes: 100,
        maxDepth: 8,
        maxScalarBytes: 1024,
        maxDiagnostics: 16,
      }
      const createCodec = lease.module['createCodec'] as (context: ContributionContext) => Codec
      const codec = createCodec({
        budgets: budget,
        diagnostics: { report() {} },
        contracts: {},
      } as unknown as ContributionContext)
      const input = {
        originKind: 'single',
        primaryBindingId: 'primary',
        bindings: [],
        revisions: {
          topology: 'single',
          revision: 'provider-token:input',
          bindings: [],
          compositionFingerprint: 'fixture',
        },
        bindingsFor: () => [],
        openBinding: async () => {
          throw new Error('Input not needed')
        },
      } as unknown as AssetInput
      const session = await codec.open(input, 'inspect', budget)
      try {
        const namespace = await session.dataSource('common.view/namespace-entry-source', 1)
        try {
          expect(typeof namespace.value.openEntryArtifactSource).toBe('function')
          const artifact = await namespace.value.openEntryArtifactSource!('CAB')
          expect(artifact.value.size).toBe(2n ** 32n)
          expect(artifact.value.ref).toEqual({ id: 'native', uri: 'native://CAB' })
          expect(artifact.value.revision).toBe('provider-token:native')
          expect(artifact.value.containerContext).toEqual({ native: 'pinned' })
          expect(await artifact.value.read(2n ** 32n - 2n, 2)).toEqual(new Uint8Array([7, 8]))
          await artifact.release()
          await artifact.release()
          expect(await session.descriptor()).toEqual({ released: 1 })
        } finally {
          await namespace.release()
        }
      } finally {
        await session.dispose()
      }
    } finally {
      await lease.release()
    }
  } finally {
    await closeExecutionBackendRegistry(registry)
    if (dirname(resolve(directory)) !== temporaryRoot)
      throw new Error('Worker fixture escaped its temporary root')
    await rm(directory, { recursive: true, force: true })
  }
}, 20000)
