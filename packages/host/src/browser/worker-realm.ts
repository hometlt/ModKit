/**
 * The DOM half of the browser worker backend (S5b): the loader hooks bound to `fetch`, WebCrypto
 * and `blob:` URLs, the realm factory that spawns a module `Worker` with a dedicated
 * `MessageChannel`, and the registry helper a browser composition root calls. Everything DOM is
 * typed structurally (the host package compiles without `lib.dom`, like `./sources.ts`), so the
 * shapes are explicit and a test can inject fakes; in a page the globals are passed as-is.
 *
 * Honest positioning: browsers expose no V8 resource-limit API for workers, so the policy is
 * deadlines and grace; the worker shares the page origin (`x3.host/worker-shared-origin`).
 * There is deliberately no `trusted-in-process` backend here — a browser host never evaluates
 * extension code on the main thread.
 */

import type { Diagnostic } from '@modkit/core'
import {
  createExecutionBackendRegistry,
  type ExecutionBackendRegistry,
} from '../execution/backend.js'
import {
  framePortFromMessagePort,
  type DataSourceSurfaceSource,
  type MessagePortLike,
} from '../execution/index.js'
import {
  createBrowserWorkerBackend,
  type BrowserWorkerPolicy,
  type BrowserWorkerRealmFactory,
  type BrowserWorkerRealmHandle,
} from './worker-backend.js'
import type { VerifiedLoaderOptions, VerifiedModuleRoot } from './verified-loader.js'

// ---------------------------------------------------------------------------------------------
// structural DOM shapes

export interface BrowserResponseLike {
  readonly ok: boolean
  readonly status: number
  arrayBuffer(): Promise<ArrayBuffer>
}
export type BrowserFetchLike = (
  url: string,
  init?: { readonly signal?: AbortSignal },
) => Promise<BrowserResponseLike>
export interface BrowserSubtleCryptoLike {
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>
}
export interface BrowserBlobLike {
  readonly size: number
}
export type BrowserBlobConstructorLike = new (
  parts: readonly string[],
  options: { readonly type: string },
) => BrowserBlobLike
export interface BrowserObjectUrlLike {
  createObjectURL(blob: BrowserBlobLike): string
  revokeObjectURL(url: string): void
}
export interface BrowserWorkerLike {
  postMessage(message: unknown, transfer: readonly unknown[]): void
  terminate(): void
  addEventListener?(type: 'error', listener: (event: unknown) => void): void
}
export type BrowserWorkerConstructorLike = new (
  url: string,
  options: { readonly type: 'module'; readonly name?: string },
) => BrowserWorkerLike
export interface BrowserMessageChannelLike {
  readonly port1: MessagePortLike
  readonly port2: MessagePortLike
}
export type BrowserMessageChannelConstructorLike = new () => BrowserMessageChannelLike

// ---------------------------------------------------------------------------------------------
// loader hooks

export interface BrowserLoaderHookOptions {
  readonly fetch: BrowserFetchLike
  readonly subtle: BrowserSubtleCryptoLike
  readonly Blob: BrowserBlobConstructorLike
  readonly objectUrls: BrowserObjectUrlLike
  /** Bare specifier → module URL (unverified, SB-1); absent bare specifiers are refused. */
  readonly moduleMap?: Readonly<Record<string, string>>
  /** Digest-pinned extension roots whose mapped exports stay on the verified loader path. */
  readonly verifiedModuleRoots?: readonly VerifiedModuleRoot[]
}

/** Binds the verified loader to `fetch`, WebCrypto SHA-256 and `blob:` module URLs. */
export function browserLoaderHooks(options: BrowserLoaderHookOptions): Pick<
  VerifiedLoaderOptions,
  'fetchBytes' | 'digest' | 'createModuleUrl' | 'resolveBare' | 'resolvePinned'
> & {
  /** Revokes every minted `blob:` URL (call after the worker has imported the graph). */
  revokeAll(): void
} {
  const minted: string[] = []
  const pinnedRoots = (options.verifiedModuleRoots ?? [])
    .map(root => ({
      ...root,
      artifactRoot: root.artifactRoot.endsWith('/') ? root.artifactRoot : `${root.artifactRoot}/`,
    }))
    .sort((left, right) => right.artifactRoot.length - left.artifactRoot.length)
  return {
    fetchBytes: async (url, signal) => {
      const response = await options.fetch(url, signal === undefined ? {} : { signal })
      if (!response.ok) throw new Error(`fetch ${url} failed with status ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
    digest: async bytes => {
      const hash = new Uint8Array(await options.subtle.digest('SHA-256', bytes))
      let hex = ''
      for (const byte of hash) hex += byte.toString(16).padStart(2, '0')
      return `sha256:${hex}`
    },
    createModuleUrl: source => {
      const url = options.objectUrls.createObjectURL(
        new options.Blob([source], { type: 'text/javascript' }),
      )
      minted.push(url)
      return url
    },
    resolveBare: specifier => options.moduleMap?.[specifier],
    resolvePinned: url => pinnedRoots.find(root => url.startsWith(root.artifactRoot)),
    revokeAll: () => {
      for (const url of minted.splice(0)) options.objectUrls.revokeObjectURL(url)
    },
  }
}

// ---------------------------------------------------------------------------------------------
// realm factory

/** The message the worker entry expects first (`./worker-entry.ts`), port transferred. */
export interface BrowserWorkerInitMessage {
  readonly type: 'x3.host/worker-init'
  readonly session: string
  readonly generation: number
  readonly limits: unknown
  readonly foreignSurfaces: readonly DataSourceSurfaceSource[]
  readonly moduleUrl: string
  readonly port: MessagePortLike
}

export interface DomWorkerRealmOptions {
  /** URL of the built worker entry (`@modkit/host/browser/worker-entry`), same origin. */
  readonly workerUrl: string
  readonly Worker: BrowserWorkerConstructorLike
  readonly MessageChannel: BrowserMessageChannelConstructorLike
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

/** Spawns a module worker per activation and hands the backend its `FramePort`. */
export function createDomWorkerRealmFactory(
  options: DomWorkerRealmOptions,
): BrowserWorkerRealmFactory {
  return (spawn): BrowserWorkerRealmHandle => {
    const worker = new options.Worker(options.workerUrl, {
      type: 'module',
      name: `x3-worker:${spawn.session}`,
    })
    const channel = new options.MessageChannel()
    worker.addEventListener?.('error', event => {
      options.onDiagnostic?.({
        code: 'x3.host/worker-crashed',
        severity: 'error',
        message: `browser worker error: ${String(
          (event as { readonly message?: unknown } | undefined)?.message ?? 'unknown',
        )}`,
      })
    })
    const init: BrowserWorkerInitMessage = {
      type: 'x3.host/worker-init',
      session: spawn.session,
      generation: spawn.generation,
      limits: spawn.limits,
      foreignSurfaces: spawn.foreignSurfaces,
      moduleUrl: spawn.moduleUrl,
      port: channel.port2,
    }
    worker.postMessage(init, [channel.port2])
    let terminated = false
    return {
      port: framePortFromMessagePort(channel.port1),
      terminate() {
        if (terminated) return
        terminated = true
        worker.terminate()
        channel.port1.close?.()
      },
    }
  }
}

// ---------------------------------------------------------------------------------------------
// registry helper for browser composition roots

export interface BrowserExecutionBackendsOptions
  extends BrowserLoaderHookOptions, DomWorkerRealmOptions {
  readonly policy?: BrowserWorkerPolicy
  /**
   * Ceilings the verified loader applies to one artifact graph. A host that grants a user's own
   * folder needs to set these — a folder can be a whole drive — and without them here the only way
   * to reach them was to compose the backend registry by hand, which is a lot of surface to
   * duplicate for two numbers.
   */
  readonly maxFiles?: number
  readonly maxTotalBytes?: number
  readonly foreignSurfaces?:
    readonly DataSourceSurfaceSource[] | (() => readonly DataSourceSurfaceSource[])
}

/** The execution backends of a browser host: the worker backend only (nothing runs in-page). */
export function createBrowserExecutionBackends(
  options: BrowserExecutionBackendsOptions,
): ExecutionBackendRegistry {
  const hooks = browserLoaderHooks(options)
  return createExecutionBackendRegistry([
    createBrowserWorkerBackend({
      realm: createDomWorkerRealmFactory(options),
      loader: {
        ...hooks,
        ...(options.maxFiles === undefined ? {} : { maxFiles: options.maxFiles }),
        ...(options.maxTotalBytes === undefined ? {} : { maxTotalBytes: options.maxTotalBytes }),
      },
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      ...(options.foreignSurfaces === undefined
        ? {}
        : { foreignSurfaces: options.foreignSurfaces }),
      ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    }),
  ])
}
