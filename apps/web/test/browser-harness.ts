/**
 * The structural fakes that let the browser host run in Node.
 *
 * Nothing here simulates the product: the *real* worker entry, the *real* bundled extension
 * sources and the *real* host composition are used. What is faked is only what a page would
 * supply — a fetch that serves the extension artifacts off disk, a module `Worker` that runs the
 * published entry, `Blob` + object URLs as a module store, and WebCrypto for the digests.
 *
 * Shared by every `apps/web` suite so the harness is described once and asserted many times.
 */
import { webcrypto } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MessageChannel } from 'node:worker_threads'
import { revisionId, type ArtifactByteSource } from '@modkitx-x3/sdk'
import {
  installBrowserWorkerEntry,
  type BrowserObjectUrlLike,
  type BrowserWorkerLike,
} from '@modkitx-x3/host/browser'
import type { WebDomGlobals } from '../src/subjects.js'

export const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
export const ORIGIN = 'https://pwa.example/app/'

/** Serves `extensions/<name>/…` requests from `extensions/common/<name>/…` on disk. */
export function diskOrigin(): {
  readonly fetched: string[]
  fetch: (url: string) => Promise<{
    readonly ok: boolean
    readonly status: number
    arrayBuffer(): Promise<ArrayBuffer>
  }>
} {
  const fetched: string[] = []
  return {
    fetched,
    fetch: async (url: string) => {
      fetched.push(url)
      const relative = url.startsWith(`${ORIGIN}extensions/`)
        ? url.slice(`${ORIGIN}extensions/`.length)
        : undefined
      const path =
        relative === undefined ? undefined : join(repositoryRoot, 'extensions', 'common', relative)
      const ok = path !== undefined && existsSync(path)
      return {
        ok,
        status: ok ? 200 : 404,
        arrayBuffer: async (): Promise<ArrayBuffer> => {
          if (!ok || path === undefined) throw new Error(`404 ${url}`)
          const bytes = readFileSync(path)
          const copy = new ArrayBuffer(bytes.byteLength)
          new Uint8Array(copy).set(bytes)
          return copy
        },
      }
    },
  }
}

export class FakeBlob {
  readonly size: number
  readonly source: string
  constructor(parts: readonly string[], options: { readonly type: string }) {
    this.source = parts.join('')
    this.size = this.source.length
    void options
  }
}

/**
 * The module store. Declared against the real `BrowserObjectUrlLike` (rather than a hand-shaped
 * parameter that only happens to fit) so this harness is type-checkable: only a blob this file
 * minted carries source text, and anything else mints an empty module rather than being cast.
 */
export const objectUrls: BrowserObjectUrlLike = {
  createObjectURL: blob =>
    `data:text/javascript;base64,${Buffer.from(
      blob instanceof FakeBlob ? blob.source : '',
      'utf8',
    ).toString('base64')}`,
  revokeObjectURL: () => undefined,
}

/** Every worker the harness spawned, as `name ← url`. */
export const spawned: string[] = []

/** A fake DOM Worker whose script is the production entry over a fake worker scope. */
export class FakeWorker implements BrowserWorkerLike {
  private readonly listeners: ((event: { readonly data: unknown }) => void)[] = []
  private closed = false
  constructor(url: string, options: { readonly type: 'module'; readonly name?: string }) {
    spawned.push(`${options.name ?? '?'} ← ${url}`)
    installBrowserWorkerEntry({
      addEventListener: (_t, l) => void this.listeners.push(l),
      removeEventListener: (_t, l) => {
        const index = this.listeners.indexOf(l)
        if (index >= 0) this.listeners.splice(index, 1)
      },
      close: () => void (this.closed = true),
    })
  }
  postMessage(message: unknown, transfer: readonly unknown[]): void {
    void transfer
    if (this.closed) return
    for (const listener of [...this.listeners]) listener({ data: message })
  }
  terminate(): void {
    this.closed = true
  }
  addEventListener(): void {
    // the fake never raises worker errors
  }
}

/** Node module map: bare specifiers → file: URLs of the real sources / built packages. */
export const nodeModuleMap: Readonly<Record<string, string>> = Object.freeze({
  '@modkitx-x3/codec-kit': pathToFileURL(
    join(repositoryRoot, 'extensions', 'codec-kit', 'codec-kit', 'src', 'index.js'),
  ).href,
  '@modkitx-x3/codec-kit/text': pathToFileURL(
    join(repositoryRoot, 'extensions', 'codec-kit', 'codec-kit', 'src', 'text', 'index.js'),
  ).href,
  '@modkitx-x3/core': pathToFileURL(join(repositoryRoot, 'packages', 'core', 'dist', 'index.js'))
    .href,
  '@modkitx-x3/sdk': pathToFileURL(join(repositoryRoot, 'packages', 'sdk', 'dist', 'index.js'))
    .href,
  'modkit-extension-x3-blizzard-mpq/fresh-writer': pathToFileURL(
    join(repositoryRoot, 'extensions', 'blizzard', 'mpq', 'src', 'mpq', 'fresh-writer.js'),
  ).href,
  'modkit-extension-x3-blizzard-mpq/native-preserving': pathToFileURL(
    join(repositoryRoot, 'extensions', 'blizzard', 'mpq', 'src', 'mpq', 'native-preserving.js'),
  ).href,
})

export function domGlobals(fetch: ReturnType<typeof diskOrigin>['fetch']): WebDomGlobals {
  return {
    fetch: fetch as never,
    subtle: webcrypto.subtle as never,
    Blob: FakeBlob as never,
    objectUrls,
    Worker: FakeWorker,
    MessageChannel: MessageChannel as never,
  }
}

export const identity = { operatingSystem: 'windows', architecture: 'x64' } as const
export const probe = { main: [], worker: [], sharedMemory: false } as const

export const budget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

/** Bytes in memory as the random-access source `openSubject` asks for. */
export function memorySource(name: string, bytes: Uint8Array): ArtifactByteSource {
  return {
    kind: 'bytes',
    ref: { id: `memory://web/${name}`, uri: `memory://web/${name}` },
    revision: revisionId(`content-hash.sha256:${name}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

export function fileSource(path: string, name: string): ArtifactByteSource {
  return memorySource(name, new Uint8Array(readFileSync(path)))
}
