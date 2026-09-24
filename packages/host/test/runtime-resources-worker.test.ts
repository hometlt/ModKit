import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve } from 'node:path'
import { transform } from 'esbuild'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { revisionId, type LogicalResourceRequirement } from '@modkit/sdk'
import type { RuntimeSessionV2 } from '@modkit/sdk/runtime'
import {
  buildInventory,
  createHostContributionContractRegistry,
  createBundledServiceDefinitionRegistry,
  registerServiceDefinitionsOrThrow,
  createExecutionBackendRegistry,
  serviceDefinitionSurfaces,
} from '../src/index.js'
import { loadExtensionDirectory } from '../src/node/loader.js'
import { createNodeWorkerBackend } from '../src/node/worker-backend.js'
import { createResourceSession } from '../src/resource-session.js'
import { openRuntimeSession } from '../src/runtime/index.js'

const activationBudget = {
  maxInputBytes: 1024n,
  maxScalarBytes: 1024,
  maxDepth: 8,
  maxNodes: 16,
  maxDiagnostics: 16,
}
const input: LogicalResourceRequirement = {
  id: 'world',
  logicalId: 'world.uvd',
  role: 'buffer',
  scopes: ['current-mount'],
}
let directory: string
let services: Parameters<typeof openRuntimeSession>[0]['services']

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'modkit-runtime-resources-'))
  const code = await readFile(
    new URL('./fixtures/runtime-resource-provider.ts', import.meta.url),
    'utf8',
  )
  await writeFile(
    join(directory, 'provider.js'),
    (await transform(code, { loader: 'ts', format: 'esm' })).code,
  )
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      name: 'modkit-extension-runtime-resources',
      version: '1.0.0',
      type: 'module',
      license: 'UNLICENSED',
      modkit: {
        schemaVersion: 1,
        publisher: 'org.example',
        id: 'runtime-resources',
        contributionManifests: ['./provider.json'],
      },
    }),
  )
  await writeFile(
    join(directory, 'provider.json'),
    JSON.stringify({
      schemaVersion: 1,
      contract: { id: 'org.modkitx/service-provider-contribution', major: 1 },
      id: 'org.example/runtime-resources',
      displayName: 'Runtime resource test',
      runtimeVariants: [
        {
          variantId: 'worker',
          entrypoint: './provider.js',
          target: { environments: ['node-worker'] },
          executionProfile: 'worker-brokered',
          requestedPermissionClasses: ['read-source'],
        },
      ],
      spec: {
        provides: [
          ...[1, 2].map(major => ({
            offerId: `runtime-v${major}`,
            contract: 'common.runtime/provider',
            major,
            version: `${major}.0.0`,
            facet: { runtimeIds: ['test.resources'] },
          })),
          {
            offerId: 'legacy',
            contract: 'common.runtime/provider',
            major: 1,
            version: '1.0.0',
            facet: { runtimeIds: ['test.legacy-resource'] },
          },
        ],
        lifecycleScope: 'session',
      },
    }),
  )
  const inventory = await buildInventory(
    [await loadExtensionDirectory(directory)],
    createHostContributionContractRegistry(),
  )
  expect(inventory.diagnostics.filter(item => item.severity === 'error')).toEqual([])
  const serviceDefinitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(inventory, serviceDefinitions)
  services = {
    inventory,
    serviceDefinitions,
    target: { environment: 'node-worker', operatingSystem: 'windows', architecture: 'x64' },
    executionBackends: createExecutionBackendRegistry([
      createNodeWorkerBackend({
        bootstrapUrl: new URL('../dist/node/worker-bootstrap.js', import.meta.url),
        foreignSurfaces: () => serviceDefinitionSurfaces(serviceDefinitions),
      }),
    ]),
  }
}, 60_000)
afterAll(async () => {
  if (
    directory !== undefined &&
    dirname(resolve(directory)) === resolve(tmpdir()) &&
    basename(directory).startsWith('modkit-runtime-resources-')
  )
    await rm(directory, { recursive: true, force: true })
})

async function open(
  options: {
    inputs?: readonly LogicalResourceRequirement[]
    permission?: boolean
    maxMemoryBytes?: number
    abort?: boolean
    major?: 1 | 2
    runtimeId?: string
  } = {},
) {
  const revision = revisionId('provider-token:runtime-input')
  const release = vi.fn(async () => undefined)
  const controller = new AbortController()
  const opened = vi.fn()
  const resources = createResourceSession({
    sessionId: 'owned-runtime-resources',
    revision,
    origin: {
      primaryLogicalId: 'main.uvp',
      scopes: ['current-mount'],
      caseSensitivity: 'sensitive',
      async *enumerate() {
        yield { logicalId: input.logicalId, size: 4n }
      },
      async open() {
        opened()
        return {
          value: {
            kind: 'bytes' as const,
            ref: { id: 'world', uri: 'memory:world' },
            revision,
            size: 4n,
            async read(_offset: bigint, _length: number, signal?: AbortSignal) {
              if (options.abort) {
                return await new Promise<Uint8Array>((_resolve, reject) => {
                  if (signal === undefined) {
                    reject(new Error('Missing read signal'))
                    return
                  }
                  signal.addEventListener('abort', () => reject(signal.reason), { once: true })
                  controller.abort()
                })
              }
              return new Uint8Array([1, 2, 3, 4])
            },
            async *stream() {
              yield new Uint8Array([1, 2, 3, 4])
            },
          },
          release,
        }
      },
    },
  })
  const result = await openRuntimeSession({
    services,
    runtimeId: options.runtimeId ?? 'test.resources',
    sessionId: 'worker-runtime',
    providerMajor: options.major ?? 1,
    budget: { maxWallTimeMs: 1000, maxTicks: 10, maxMemoryBytes: options.maxMemoryBytes ?? 1024 },
    activationBudget,
    grant: {
      id: 'runtime-resources',
      classes: options.permission === false ? [] : ['read-source'],
    },
    resourceInvocation: { inputs: options.inputs ?? [input], resources },
    signal: controller.signal,
  })
  return { result, resources, release, opened }
}

describe('Runtime inputs over the production worker resource broker', () => {
  it('refuses a provider that would silently ignore resource inputs', async () => {
    const f = await open({ runtimeId: 'test.legacy-resource' })
    expect(f.result.state).toBe('unresolved')
    expect(
      f.result.diagnostics.some(d => d.code === 'x3.host/runtime-input-mode-unsupported'),
    ).toBe(true)
    expect(f.opened).not.toHaveBeenCalled()
    expect(f.resources.state()).toBe('disposed')
  })
  it('negotiates v2 and transports typed snapshots, step and async events over the same worker', async () => {
    const f = await open({ major: 2 })
    expect(f.result.state, JSON.stringify(f.result.diagnostics)).toBe('resolved')
    if (f.result.state !== 'resolved') return
    const session = f.result.session as RuntimeSessionV2
    try {
      expect(await session.step(3)).toMatchObject({ outcome: 'stepped', status: { ticks: 3 } })
      const snapshot = await session.snapshot()
      expect(snapshot.outcome).toBe('captured')
      if (snapshot.outcome !== 'captured') return
      expect(snapshot.snapshot.bytes).toBeInstanceOf(Uint8Array)
      await session.step(2)
      expect(await session.restore(snapshot.snapshot)).toMatchObject({
        outcome: 'restored',
        status: { ticks: 3 },
      })
      expect(await session.stateHash()).toMatchObject({ stateHash: 'test:03' })
      const events = []
      for await (const event of session.events(1)) events.push(event)
      expect(events.map(event => event.sequence)).toEqual([2, 3])
    } finally {
      await f.result.release()
    }
    expect(f.release).toHaveBeenCalledTimes(1)
  })
  it('passes descriptors and reads bytes, then releases the owned resource session exactly once', async () => {
    const f = await open()
    expect(f.result.state, JSON.stringify(f.result.diagnostics)).toBe('resolved')
    if (f.result.state !== 'resolved') return
    try {
      expect(
        await f.result.session.execute({
          entrypoint: 'read',
          resources: { ticks: 0, wallTimeMs: 0, memoryBytes: 0 },
        }),
      ).toMatchObject({ state: 'completed', value: [1, 2, 3, 4] })
    } finally {
      await f.result.release()
      await f.result.release()
    }
    expect(f.resources.state()).toBe('disposed')
    expect(f.release).toHaveBeenCalledTimes(1)
  })
  it.each([{ inputs: [{ ...input, id: 'fail' }] }, { maxMemoryBytes: 2 }, { abort: true }])(
    'reclaims resources after initialization failure, budget refusal or cancellation: %j',
    async options => {
      const f = await open(options)
      expect(f.result.state).toBe('unresolved')
      expect(f.resources.state()).toBe('disposed')
      expect(f.release).toHaveBeenCalledTimes(1)
    },
  )
  it('does not grant reads when the caller has no permission', async () => {
    const f = await open({ permission: false })
    expect(f.result.state).toBe('unresolved')
    expect(f.opened).not.toHaveBeenCalled()
    expect(f.resources.state()).toBe('disposed')
  })
  it.each([[input, input], [{ ...input, logicalId: '../escape' }]])(
    'rejects malformed descriptors before activation: %j',
    async (...inputs) => {
      const f = await open({ inputs })
      expect(f.result.state).toBe('unresolved')
      expect(f.result.diagnostics[0]?.code).toBe('x3.host/runtime-input-invalid')
      expect(f.opened).not.toHaveBeenCalled()
      expect(f.resources.state()).toBe('disposed')
    },
  )
})
