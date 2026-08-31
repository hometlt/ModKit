/**
 * The DOM worker script of the browser worker backend — published as
 * `@modkit/host/browser/worker-entry` and spawned by `createDomWorkerRealmFactory` as a
 * module worker. It accepts exactly one init message (`x3.host/worker-init`, port transferred),
 * runs the shared bootstrap core over that port, and closes itself when the host says
 * `terminate`. Anything else on the worker's own message channel is ignored: the protocol lives
 * on the dedicated port, never on `self.postMessage`.
 *
 * Typed structurally against `self`-like globals so the host package keeps compiling without
 * `lib.dom`; a browser supplies the real ones.
 */

import { framePortFromMessagePort, type MessagePortLike } from '../execution/index.js'
import { runBrowserWorkerBootstrap } from './worker-bootstrap-core.js'
import type { BrowserWorkerInitMessage } from './worker-realm.js'

interface WorkerScopeLike {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void
  close(): void
}

function isInit(value: unknown): value is BrowserWorkerInitMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'x3.host/worker-init' &&
    typeof (value as { session?: unknown }).session === 'string' &&
    typeof (value as { moduleUrl?: unknown }).moduleUrl === 'string' &&
    typeof (value as { port?: unknown }).port === 'object'
  )
}

/** Installs the one-shot init listener on a worker scope; returns a disposer (tests). */
export function installBrowserWorkerEntry(scope: WorkerScopeLike): () => void {
  let started = false
  const listener = (event: { readonly data: unknown }) => {
    if (started || !isInit(event.data)) return
    started = true
    scope.removeEventListener('message', listener)
    const init = event.data
    runBrowserWorkerBootstrap({
      port: framePortFromMessagePort(init.port as MessagePortLike),
      session: init.session,
      generation: init.generation,
      limits: init.limits as never,
      foreignSurfaces: init.foreignSurfaces,
      moduleUrl: init.moduleUrl,
      onTerminate: () => scope.close(),
      onFailure: () => scope.close(),
    })
  }
  scope.addEventListener('message', listener)
  return () => scope.removeEventListener('message', listener)
}

// Auto-install only inside a real worker scope (`WorkerGlobalScope` exists there and nowhere
// else — not on a page's main thread, not under Node); tests call `installBrowserWorkerEntry`.
const workerScope = (globalThis as { self?: unknown }).self as WorkerScopeLike | undefined
if (
  workerScope !== undefined &&
  typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === 'function' &&
  typeof workerScope.addEventListener === 'function' &&
  typeof workerScope.close === 'function'
) {
  installBrowserWorkerEntry(workerScope)
}
