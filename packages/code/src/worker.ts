/**
 * Monaco's web-worker location, declared once for every host that mounts this editor.
 *
 * Monaco asks for its worker through `new URL('../../common/services/editorWebWorkerMain.js',
 * import.meta.url)`, which resolves against wherever the bundler happened to place the editor
 * chunk. No host in this repository configured `MonacoEnvironment`, and no build emitted that
 * file: `apps/web/dist-app` contains neither the path nor the script. The failure is invisible
 * until the editor is actually mounted, and then it is a console error rather than a broken
 * screen, because syntax highlighting runs on the main thread and only the worker-backed
 * features — word-based completion, links, colour decorators — quietly stop existing.
 *
 * Registering a factory here removes the guesswork: the host says how to build the worker, and a
 * host that cannot build one says so through `MONACO_WORKER_UNAVAILABLE` instead of letting
 * Monaco fail on a URL nobody serves.
 */

export const MONACO_WORKER_UNAVAILABLE =
  'no Monaco worker factory was installed: completion, links and colour decorators are unavailable'

export interface MonacoWorkerFactory {
  (moduleId: string, label: string): Worker
}

interface MonacoEnvironmentHost {
  MonacoEnvironment?: { getWorker?: MonacoWorkerFactory }
}

/**
 * Install the factory Monaco consults before it falls back to its own relative URL.
 *
 * Idempotent, and it never replaces a factory a host installed first: an application that already
 * knows where its workers live is the better authority than a library default.
 */
export function installMonacoWorkerFactory(factory: MonacoWorkerFactory): void {
  const host = globalThis as unknown as MonacoEnvironmentHost
  const existing = host.MonacoEnvironment
  if (existing?.getWorker !== undefined) return
  host.MonacoEnvironment = { ...existing, getWorker: factory }
}

/** Whether worker-backed editor features can work in this realm right now. */
export function monacoWorkerAvailable(): boolean {
  const host = globalThis as unknown as MonacoEnvironmentHost
  return host.MonacoEnvironment?.getWorker !== undefined
}
