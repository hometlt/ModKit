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
import { revisionId, type ArtifactByteSource } from '@modkit/sdk'
import {
  installBrowserWorkerEntry,
  type BrowserObjectUrlLike,
  type BrowserWorkerLike,
} from '@modkit/host/browser'
import type { WebDomGlobals } from '../src/subjects.js'

export const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
export const ORIGIN = 'https://pwa.example/app/'

/** Serves the exact built PWA artifact tree, including renamed/grouped extension source roots. */
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
        relative === undefined
          ? undefined
          : join(repositoryRoot, 'apps', 'web', 'dist-app', 'extensions', relative)
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
  '@modkit/codec-kit': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'index.js'),
  ).href,
  '@modkit/codec-kit/text': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'text', 'index.js'),
  ).href,
  '@modkit/codec-kit/checksum': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'checksum', 'index.js'),
  ).href,
  '@modkit/codec-kit/crypto/blowfish': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'crypto', 'blowfish.js'),
  ).href,
  '@modkit/codec-kit/crypto/aes': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'crypto', 'aes.js'),
  ).href,
  '@modkit/codec-kit/crypto/sha1-digest': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'crypto', 'sha1-digest.js'),
  ).href,
  '@modkit/codec-kit/audio': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'audio', 'index.js'),
  ).href,
  '@modkit/codec-kit/compression/bounded': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'compression', 'bounded.js'),
  ).href,
  '@modkit/codec-kit/compression/pkware-dcl': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'compression', 'pkware-dcl.js'),
  ).href,
  '@modkit/codec-kit/compression/inflate': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'compression', 'inflate.js'),
  ).href,
  '@modkit/codec-kit/compression/lz4': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'compression', 'lz4.js'),
  ).href,
  '@modkit/codec-kit/compression/refpack': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'compression', 'refpack.js'),
  ).href,
  '@modkit/codec-kit/compression/zstd': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'compression', 'zstd.js'),
  ).href,
  '@modkit/codec-kit/model/draco': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'model', 'draco.js'),
  ).href,
  '@modkit/codec-kit/model/bounds': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'model', 'bounds.js'),
  ).href,
  '@modkit/codec-kit/model-math/transform': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'model-math', 'transform.js'),
  ).href,
  '@modkit/codec-kit/model/skeleton': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'model', 'skeleton.js'),
  ).href,
  '@modkit/codec-kit/model/sources': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'model', 'sources.js'),
  ).href,
  '@modkit/codec-kit/model/animation': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'model', 'animation.js'),
  ).href,
  '@modkit/codec-kit/model/skinning': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'model', 'skinning.js'),
  ).href,
  '@modkit/codec-kit/model-math/sequence-pose': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'model-math', 'sequence-pose.js'),
  ).href,
  '@modkit/codec-kit/model-math/effects-sim': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'model-math', 'effects-sim.js'),
  ).href,
  '@modkit/codec-kit/raster': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'raster', 'index.js'),
  ).href,
  '@modkit/codec-kit/raster/palette': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'raster', 'palette.js'),
  ).href,
  '@modkit/codec-kit/texture/bc': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'texture', 'bc.js'),
  ).href,
  '@modkit/codec-kit/texture/gl-compressed': pathToFileURL(
    join(repositoryRoot, 'packages', 'codec-kit', 'dist', 'texture', 'gl-compressed.js'),
  ).href,
  '@modkit/core': pathToFileURL(join(repositoryRoot, 'packages', 'core', 'dist', 'index.js')).href,
  '@modkit/sdk': pathToFileURL(join(repositoryRoot, 'packages', 'sdk', 'dist', 'index.js')).href,
  '@modkit/uv/model/materializer': pathToFileURL(
    join(repositoryRoot, 'packages', 'uv', 'dist', 'model', 'materializer.js'),
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
