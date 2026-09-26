import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { revisionId, type ArtifactByteSource, type ResourceBudget } from '@modkit/sdk'
import {
  buildInventory,
  createCredentialBroker,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
} from '../src/index.js'
import { loadExtensionDirectory } from '../src/node/loader.js'
import { createNodeWorkerBackend } from '../src/node/worker-backend.js'
import { openSubject } from '../src/subject-open.js'
import { workerBackendPolicy } from '../src/execution/worker-policy.js'

// A key the worker must never see: it only reaches the fake service inside the audience.
const SECRET = 'SECRET-MARKER-worker-51c2'
const budget: ResourceBudget = {
  maxInputBytes: 1024n,
  maxDepth: 8,
  maxNodes: 8,
  maxScalarBytes: 1024,
  maxDiagnostics: 8,
}
const bytes = new TextEncoder().encode('CRED')
const source: ArtifactByteSource = {
  kind: 'bytes',
  ref: { id: 'main.creds', uri: 'memory:main.creds' },
  revision: revisionId('provider-token:credentials-worker'),
  size: BigInt(bytes.length),
  read: async (offset, length) => bytes.slice(Number(offset), Number(offset) + length),
  async *stream() {
    yield bytes.slice()
  },
}

describe('credentials through an ordinary Node worker codec', () => {
  let inventory: Awaited<ReturnType<typeof buildInventory>>
  beforeAll(async () => {
    const input = await loadExtensionDirectory(
      join(import.meta.dirname, 'fixtures', 'credentials-worker'),
    )
    inventory = await buildInventory([input], createHostContributionContractRegistry())
  })

  it('checks, signs a request inside the audience and refuses the key itself', async () => {
    const values = new Map([['modkit.credential/org.example/cloud', SECRET]])
    const sent: { url: string; headers: Record<string, string> }[] = []
    const credentials = createCredentialBroker({
      inventory,
      store: {
        get: async key => values.get(key),
        set: async (key, value) => void values.set(key, value),
        delete: async key => void values.delete(key),
      },
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        sent.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } })
        return new Response('pong')
      }) as typeof globalThis.fetch,
    })
    expect(credentials.declared().map(item => item.extension)).toEqual([
      'org.example/credentials-worker',
    ])
    const result = await openSubject({
      inventory,
      source,
      path: 'main.creds',
      intent: 'full',
      target: { environment: 'node-worker', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'credentials-worker', classes: ['read-source'] },
      budget,
      credentials,
      executionBackends: createExecutionBackendRegistry([
        createNodeWorkerBackend({
          bootstrapUrl: new URL('../dist/node/worker-bootstrap.js', import.meta.url),
          policy: workerBackendPolicy({ defaultCallDeadlineMs: 5000, graceMs: 100 }),
        }),
      ]),
    })
    try {
      if (result.state !== 'opened') throw new Error(JSON.stringify(result))
      expect(result.selected.variantId).toBe('worker')
      expect(sent).toEqual([
        { url: 'https://api.example.test/v1/ping', headers: { 'x-api-key': SECRET } },
      ])
      expect(JSON.stringify(result.descriptor)).not.toContain(SECRET)
    } finally {
      if (result.state === 'opened') await result.session.dispose()
    }
  }, 60_000)
})
