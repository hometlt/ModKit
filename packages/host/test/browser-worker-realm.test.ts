/**
 * S5b: the DOM wiring of the browser worker backend, exercised with structural fakes that behave
 * like the platform: a fake `Worker` whose "script" is the production `installBrowserWorkerEntry`
 * over a real Node `MessageChannel`, `fetch` served from memory, Node's WebCrypto as `subtle`,
 * `data:` module URLs as the blob store. `createBrowserExecutionBackends` then activates the
 * fixture codec end to end through the backend SPI — the same product path a page would take.
 */
import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import type { Diagnostic } from '@modkit/core'
import type { ContributionContext, ResourceBudget } from '@modkit/sdk'
import type { MessagePortLike } from '../src/execution/index.js'
import {
  activateExecutionBackend,
  type ExecutionBackendActivation,
  type ExecutionModuleLease,
} from '../src/execution/backend.js'
import {
  browserLoaderHooks,
  createBrowserExecutionBackends,
  type BrowserWorkerConstructorLike,
  type BrowserWorkerInitMessage,
  type BrowserWorkerLike,
} from '../src/browser/worker-realm.js'
import { installBrowserWorkerEntry } from '../src/browser/worker-entry.js'
import { WORKER_SHARED_ORIGIN_DIAGNOSTIC } from '../src/browser/worker-backend.js'
import type { ActivationTicket } from '../src/security/gate.js'

const fixtureRoot = new URL('./fixtures/worker-codec/', import.meta.url)
const ORIGIN = 'https://app.example/'
const ROOT = `${ORIGIN}ext/worker-codec/`
const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/** In-memory origin: fetch answers for artifact files, 404 otherwise. */
function origin(files: Record<string, Uint8Array>) {
  const fetched: string[] = []
  return {
    fetched,
    fetch: async (url: string) => {
      fetched.push(url)
      const body = files[url]
      return {
        ok: body !== undefined,
        status: body === undefined ? 404 : 200,
        arrayBuffer: async (): Promise<ArrayBuffer> => {
          if (body === undefined) throw new Error('404')
          const copy = new ArrayBuffer(body.byteLength)
          new Uint8Array(copy).set(body)
          return copy
        },
      }
    },
  }
}

/** A `blob:` store over data URLs — mints and revokes like `URL.createObjectURL`. */
function objectUrls() {
  const live = new Set<string>()
  return {
    live,
    createObjectURL: (blob: { readonly size: number; readonly source?: string }) => {
      const url = `data:text/javascript;base64,${Buffer.from(blob.source ?? '', 'utf8').toString('base64')}`
      live.add(url)
      return url
    },
    revokeObjectURL: (url: string) => void live.delete(url),
  }
}
class FakeBlob {
  readonly size: number
  readonly source: string
  constructor(parts: readonly string[], options: { readonly type: string }) {
    this.source = parts.join('')
    this.size = this.source.length
    void options
  }
}

const closers: (() => void)[] = []
afterEach(() => {
  for (const close of closers.splice(0)) close()
})

/**
 * A fake DOM `Worker`: constructing it "loads" the entry script by installing the production
 * entry on a fake worker scope; `postMessage(init, [port])` is the page's init message.
 */
function fakeWorkerConstructor(spawned: { count: number; names: string[] }) {
  const Ctor: BrowserWorkerConstructorLike = class implements BrowserWorkerLike {
    private readonly listeners: ((event: { readonly data: unknown }) => void)[] = []
    private closed = false
    constructor(url: string, options: { readonly type: 'module'; readonly name?: string }) {
      spawned.count += 1
      spawned.names.push(`${options.name ?? '?'} ← ${url}`)
      const scope = {
        addEventListener: (
          _type: 'message',
          listener: (event: { readonly data: unknown }) => void,
        ) => void this.listeners.push(listener),
        removeEventListener: (
          _type: 'message',
          listener: (event: { readonly data: unknown }) => void,
        ) => {
          const index = this.listeners.indexOf(listener)
          if (index >= 0) this.listeners.splice(index, 1)
        },
        close: () => {
          this.closed = true
        },
      }
      installBrowserWorkerEntry(scope)
    }
    postMessage(message: unknown, transfer: readonly unknown[]): void {
      void transfer // structured clone is a no-op here: the fake scope shares this thread
      if (this.closed) return
      for (const listener of [...this.listeners]) listener({ data: message })
    }
    terminate(): void {
      this.closed = true
    }
    addEventListener(): void {
      // the fake never raises worker errors; the production factory tolerates its absence too
    }
  }
  return Ctor
}

const budget: ResourceBudget = {
  maxInputBytes: '1048576',
  maxDepth: 8,
  maxNodes: 1000,
  maxScalarBytes: 4096,
  maxDiagnostics: 16,
} as unknown as ResourceBudget

const leases: ExecutionModuleLease[] = []
afterEach(async () => {
  for (const lease of leases.splice(0)) await lease.release().catch(() => undefined)
})

describe('browser worker realm — DOM wiring with structural fakes', () => {
  it('loader hooks: fetch → WebCrypto sha256 → blob-store module URLs; revokeAll frees them', async () => {
    const source = new TextEncoder().encode('export const a = 1\n')
    const site = origin({ [`${ROOT}a.mjs`]: source })
    const store = objectUrls()
    const hooks = browserLoaderHooks({
      fetch: site.fetch,
      subtle: webcrypto.subtle as never,
      Blob: FakeBlob as never,
      objectUrls: store,
      moduleMap: { '@vendor/kit': 'data:text/javascript,export%20const%20k%3D1' },
    })
    expect(await hooks.fetchBytes(`${ROOT}a.mjs`)).toEqual(source)
    await expect(hooks.fetchBytes(`${ROOT}missing.mjs`)).rejects.toThrow(/404/u)
    expect(await hooks.digest(source)).toBe(sha256(source))
    const url = hooks.createModuleUrl('export const b = 2\n')
    expect(store.live.has(url)).toBe(true)
    expect(((await import(url)) as { b: number }).b).toBe(2)
    expect(hooks.resolveBare?.('@vendor/kit')).toContain('data:')
    expect(hooks.resolveBare?.('left-pad')).toBeUndefined()
    hooks.revokeAll()
    expect(store.live.size).toBe(0)
  })

  it('createBrowserExecutionBackends: a module Worker is spawned per activation, receives the init message with the transferred port, and the fixture codec probes end to end', async () => {
    const codec = new Uint8Array(readFileSync(new URL('codec.mjs', fixtureRoot)))
    const site = origin({ [`${ROOT}codec.mjs`]: codec })
    const spawned = { count: 0, names: [] as string[] }
    const diagnostics: Diagnostic[] = []
    // the fake Worker's init message needs a real port pair: the constructor below wires the
    // transferred port2 into the entry scope's message flow through the fake postMessage
    const registry = createBrowserExecutionBackends({
      workerUrl: `${ORIGIN}worker-entry.js`,
      Worker: fakeWorkerConstructor(spawned),
      MessageChannel: MessageChannel as never,
      fetch: site.fetch,
      subtle: webcrypto.subtle as never,
      Blob: FakeBlob as never,
      objectUrls: objectUrls(),
      onDiagnostic: diagnostic => void diagnostics.push(diagnostic),
    })
    expect(registry.profiles).toEqual(['worker-brokered'])
    const lease = await activateExecutionBackend(registry, {
      ticket: {
        contributionId: 'org.example/browser-codec',
        artifactDigest: 'sha256:artifact',
      } as unknown as ActivationTicket,
      entrypoint: new URL(`${ROOT}codec.mjs`),
      artifactRoot: new URL(ROOT),
      fileDigests: { 'codec.mjs': sha256(codec) },
      variant: {
        variantId: 'portable',
        executionProfile: 'worker-brokered',
        targets: [],
        entrypoint: 'codec.mjs',
      } as never,
      target: { environment: 'browser-worker', os: 'any', arch: 'any' } as never,
      grant: {} as ExecutionBackendActivation['grant'],
    })
    leases.push(lease)
    expect(spawned.count).toBe(1)
    expect(spawned.names[0]).toContain('worker-entry.js')
    expect(diagnostics.some(item => item.code === WORKER_SHARED_ORIGIN_DIAGNOSTIC)).toBe(true)
    // the whole artifact was fetched exactly once
    expect(site.fetched.filter(url => url.endsWith('codec.mjs'))).toHaveLength(1)

    const createCodec = lease.module['createCodec'] as (c: ContributionContext) => {
      probe(request: unknown): Promise<Record<string, unknown>>
    }
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d])
    const detection = await createCodec({
      budgets: budget,
      diagnostics: { report: () => undefined },
      contracts: {} as ContributionContext['contracts'],
    }).probe({
      source: {
        ref: { kind: 'file', path: '/demo.png' },
        revision: 'rev-1',
        kind: 'bytes',
        size: BigInt(data.length),
        read: async (offset: bigint, length: number) =>
          data.slice(Number(offset), Number(offset) + length),
        stream: async function* () {
          yield data
        },
      },
      plan: { kind: 'bytes', ranges: [], maxBytes: 4 },
    })
    expect(detection['confidence']).toBe(1)
    await lease.release()
  }, 20_000)

  it('the entry accepts exactly one init and ignores foreign messages; a malformed init never starts a bootstrap', () => {
    const listeners: ((event: { readonly data: unknown }) => void)[] = []
    let closed = 0
    const scope = {
      addEventListener: (_t: 'message', l: (event: { readonly data: unknown }) => void) =>
        void listeners.push(l),
      removeEventListener: (_t: 'message', l: (event: { readonly data: unknown }) => void) => {
        const index = listeners.indexOf(l)
        if (index >= 0) listeners.splice(index, 1)
      },
      close: () => void (closed += 1),
    }
    installBrowserWorkerEntry(scope)
    expect(listeners).toHaveLength(1)
    // garbage and near-misses are ignored: the listener stays armed
    listeners[0]?.({ data: 'hello' })
    listeners[0]?.({ data: { type: 'x3.host/worker-init', session: 42 } })
    expect(listeners).toHaveLength(1)
    // a real init consumes the listener (one shot)
    const channel = new MessageChannel()
    closers.push(() => {
      channel.port1.close()
      channel.port2.close()
    })
    const init: BrowserWorkerInitMessage = {
      type: 'x3.host/worker-init',
      session: 'entry-1',
      generation: 1,
      limits: {},
      foreignSurfaces: [],
      moduleUrl: 'data:text/javascript,export%20const%20abiVersion%3D1',
      port: channel.port2 as unknown as MessagePortLike,
    }
    listeners[0]?.({ data: init })
    expect(listeners).toHaveLength(0)
    expect(closed).toBe(0)
  })
})
