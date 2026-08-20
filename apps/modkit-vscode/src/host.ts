/**
 * The VS Code extension host's half of the product (S7 + S9 + S14), with no `vscode` import.
 *
 * `./extension.ts` is the adapter that turns the editor's API into the arguments below; everything
 * that decides anything lives here, so it can be composed and exercised in plain Node:
 *
 *  - **compose** the three realms through `createNodeSubjectServices` — the extension host realm
 *    holds the inventory, the `node-worker` realm is the target codecs are resolved and activated
 *    for, and `serviceDefinitions` stays at its `'bundled'` default. That default is load-bearing:
 *    the writers and syntax providers of the delimited, INI, JSON, TOML, XML and YAML extensions
 *    are service contributions, and a root that registers none of them ships an editor that
 *    silently cannot open half the text formats it claims.
 *  - **open** through `createPathSubjectOpener`, whose roots are the workspace folders. It refuses
 *    a path outside them before any `stat`, which is the whole of this host's file confinement.
 *  - **edit** through `createSubjectEditing` + `createFileEditingBackend` + `createRawWriter` +
 *    `createEvidenceRegistry`, keyed by the snapshot's `sessionId` and handed to `exposeSubjectRpc`
 *    as its `editing` option. The webview receives ids, never authority: the grant snapshot, the
 *    prepared commit and the backend never leave this process.
 *  - **serve** all of it over the single VS Code webview channel (see `./bridge.ts`).
 *
 * Extension roots that fail to load are reported, never swallowed — a broken directory in the
 * `modkit.extensions` setting must not take the editor's Modkit surface down with it.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { Diagnostic } from '@modkitx-x3/core'
import type { PermissionGrant, ResourceBudget } from '@modkitx-x3/sdk'
import {
  createEvidenceRegistry,
  createHostComposition,
  createRawWriter,
  createSubjectEditing,
  exposeSubjectRpc,
  type ExtensionInput,
  type HostComposition,
  type OpenedSubject,
  type SubjectEditing,
  type SubjectOpener,
  type SubjectRpcExposure,
  type SubjectServices,
} from '@modkitx-x3/host'
import {
  createFileEditingBackend,
  createNodeSubjectServices,
  createPathSubjectOpener,
  loadExtensionRoots,
  type ExtensionRootFailure,
  type NodeSubjectServices,
} from '@modkitx-x3/host/node'

import {
  createBridge,
  type Bridge,
  type CloseAnswer,
  type ShellEntry,
  type ShellRequest,
  type WebviewChannel,
} from './bridge.js'
import {
  configuredExtensionRoots,
  dedupeRoots,
  discoverCatalogRoots,
  discoverWorkspaceRoots,
  type DirectoryProbe,
  type ExtensionRootRequestLike,
} from './extension-roots.js'
import {
  createVsCodeDesktopTopology,
  VSCODE_DESKTOP_EXTENSION_REALM,
  VSCODE_DESKTOP_WORKER_REALM,
  VSCODE_WEBVIEW_REALM,
  VSCODE_WORKER_POLICY,
} from './index.js'

/** Module identity of the services root served over the webview channel (nothing to import). */
export const VSCODE_SUBJECT_SERVICES_URL = 'x3-app://vscode/subject-services'
/** Identity the consuming side records for the loaded root; both ends must agree. */
export const VSCODE_SUBJECT_CONTRIBUTION_ID = 'org.modkitx.app.vscode/subject-services'

/**
 * Largest file this host reads into memory for a preview.
 *
 * A file over the limit is refused, never truncated: a codec handed the first 64 MiB of a larger
 * file detects and describes something that is not the file.
 */
export const VSCODE_MAXIMUM_SUBJECT_BYTES = 64 * 1024 * 1024

/** Entries a single directory listing will return before it stops. */
export const VSCODE_MAXIMUM_LISTING = 5_000

/** How many editing arms are kept alive at once; see `rememberEditing`. */
const MAXIMUM_LIVE_EDITING_ARMS = 256

// ---------------------------------------------------------------------------------------------
// composition

/** What loaded from where, and what did not. The output channel and the webview both show it. */
export interface VsCodeExtensionReport {
  /** Coordinates of the first-party catalog that shipped with this build. */
  readonly bundled: readonly string[]
  /** Coordinates of workspace-local and user-configured extensions that loaded. */
  readonly installed: readonly string[]
  /** Roots that did not load, with the reason. A broken one never stops the others. */
  readonly failures: readonly ExtensionRootFailure[]
  /** Settings entries that were not usable as a root at all (malformed, no path). */
  readonly problems: readonly string[]
}

export interface VsCodeSubjectHost {
  /** Extension-host realm composition (the inventory) plus the worker realm codecs run in. */
  readonly services: NodeSubjectServices
  /** The bridge realm's composition, for the snapshot the page is allowed to see. */
  readonly webview: HostComposition
  readonly extensions: VsCodeExtensionReport
  readonly supportedExtensions: readonly string[]
  /** Serve the subject RPC and the shell over one webview channel. */
  serve(options: VsCodeServeOptions): VsCodeServed
}

export interface VsCodeSubjectHostOptions {
  /**
   * Directories to look for the first-party catalog in, most specific first. The first candidate
   * that contains any extension wins, so a packaged build never picks up a checkout above it.
   */
  readonly catalogCandidates: readonly string[]
  /** Workspace folders; scanned one level deep for workspace-local extensions. */
  readonly workspaceFolders?: readonly string[]
  /** Raw value of the `modkit.extensions` setting, exactly as the editor returned it. */
  readonly configuredExtensions?: unknown
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /** Injectable for tests; defaults to `node:fs`. */
  readonly probe?: DirectoryProbe
}

const nodeProbe: DirectoryProbe = {
  readDirectory(path) {
    try {
      return readdirSync(path)
    } catch {
      return undefined
    }
  },
  isFile(path) {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
  readJson(path) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as unknown
    } catch {
      // missing, unreadable or malformed — all mean "this is not a declaration we can trust"
      return undefined
    }
  },
  join: (...parts) => join(...parts),
}

export async function createVsCodeSubjectHost(
  options: VsCodeSubjectHostOptions,
): Promise<VsCodeSubjectHost> {
  const probe = options.probe ?? nodeProbe
  const catalogRoots = discoverCatalogRoots(options.catalogCandidates, probe)
  const configured = configuredExtensionRoots(options.configuredExtensions, path => resolve(path))
  const userRequests: readonly ExtensionRootRequestLike[] = dedupeRoots([
    ...discoverWorkspaceRoots(options.workspaceFolders ?? [], probe),
    ...configured.roots,
  ])

  /*
   * The first-party catalog is `bundled`, but deliberately without `allowTrustedInProcess`: the VS
   * Code extension host is a Node process shared with every other installed extension, and running
   * a codec on that thread would put a third party's parser beside everybody's language servers.
   * Portable variants resolve for the `node-worker` realm instead, which is what the topology's
   * third realm exists for.
   */
  const bundled = await loadExtensionRoots(catalogRoots, { origin: 'bundled' })
  const installed = await loadExtensionRoots(userRequests, {
    origin: 'installed',
    claimed: bundled.coordinates,
  })
  const extensionInputs: readonly ExtensionInput[] = [...bundled.inputs, ...installed.inputs]

  const topology = createVsCodeDesktopTopology()
  const services = await createNodeSubjectServices({
    topology,
    realms: { host: VSCODE_DESKTOP_EXTENSION_REALM, workers: VSCODE_DESKTOP_WORKER_REALM },
    extensions: extensionInputs,
    policy: VSCODE_WORKER_POLICY,
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })
  // The bridge realm, composed only so the page can be told what its own realm holds. It shares
  // the topology, so `apps:check`'s claim — the webview holds no extension-host facility — is a
  // statement about the very object the running product hands the page.
  const webview = await createHostComposition({
    topology,
    realmId: VSCODE_WEBVIEW_REALM,
    extensions: extensionInputs,
  })

  const extensions: VsCodeExtensionReport = Object.freeze({
    bundled: bundled.coordinates,
    installed: installed.coordinates,
    failures: Object.freeze([...bundled.failures, ...installed.failures]),
    problems: configured.problems,
  })

  return Object.freeze({
    services,
    webview,
    extensions,
    supportedExtensions: services.supportedExtensions,
    serve: (served: VsCodeServeOptions) => serveVsCode(services, served),
  })
}

// ---------------------------------------------------------------------------------------------
// serving one webview

export interface VsCodeServeOptions {
  readonly channel: WebviewChannel
  /** Endpoint identity; the page must connect with the same pair. */
  readonly session: string
  /**
   * Directories the page may name. Read on every request, so opening another workspace folder
   * widens the grant without rebuilding anything.
   */
  readonly roots: () => readonly string[]
  /** The grant every open runs under. Defaults to `read-source` only. */
  readonly grant?: PermissionGrant
  readonly budget?: ResourceBudget
  /** Confirm discarding unsaved work; a webview iframe cannot show a modal of its own. */
  readonly confirmClose?: (message: string, savable: boolean) => Promise<CloseAnswer>
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

export interface VsCodeServed {
  readonly bridge: Bridge
  readonly exposure: SubjectRpcExposure
  /** Ask the page to open this path in a tab. */
  open(path: string): void
  /** Push the current granted folders; called again when the workspace changes. */
  publishRoots(): void
  /** Show one line in the page's status area (an extension that failed to load, say). */
  notice(text: string, severity?: 'info' | 'error'): void
  close(reason: string): Promise<void>
}

const DEFAULT_OPEN_BUDGET: ResourceBudget = Object.freeze({
  maxInputBytes: BigInt(VSCODE_MAXIMUM_SUBJECT_BYTES),
  maxDepth: 256,
  maxNodes: 1_000_000,
  maxScalarBytes: VSCODE_MAXIMUM_SUBJECT_BYTES,
  maxDiagnostics: 10_000,
  deadlineMs: 30_000,
})

/** The same confinement `createPathSubjectOpener` applies, for the listing and reading paths. */
export function withinRoots(roots: readonly string[], path: string): boolean {
  return roots.some(root => {
    const rel = relative(resolve(root), path)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

function requireInside(roots: readonly string[], requested: string): string {
  const path = resolve(requested)
  if (roots.length === 0 || !withinRoots(roots, path)) {
    throw new Error(`«${requested}» is outside the folders this window granted`)
  }
  return path
}

function serveVsCode(services: NodeSubjectServices, options: VsCodeServeOptions): VsCodeServed {
  const bridge = createBridge({
    channel: options.channel,
    idPrefix: 'host',
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })

  /*
   * S14: this side owns the editing authority. The backend is confined to the same roots the
   * opener is, so a subject outside them could not be written even if a session id for it existed.
   */
  const editingBackend = createFileEditingBackend({
    roots: () => options.roots().map(root => resolve(root)),
  })
  const evidence = createEvidenceRegistry()
  /** The writer for editors that know nothing about the format (plain text, hex). */
  const rawWriter = createRawWriter()
  const editingBySession = new Map<string, SubjectEditing>()

  /**
   * Arms are kept until the window closes, because nothing on the wire says "this tab is gone":
   * the page releases the *session* lease, and the editing arm is a separate lease it may take
   * again. A bound keeps a very long session from growing without limit; the oldest arm is the one
   * whose tab was opened longest ago.
   */
  const rememberEditing = (sessionId: string, editing: SubjectEditing): void => {
    editingBySession.set(sessionId, editing)
    while (editingBySession.size > MAXIMUM_LIVE_EDITING_ARMS) {
      const oldest = editingBySession.keys().next()
      if (oldest.done === true) break
      editingBySession.delete(oldest.value)
    }
  }

  const openSubject: SubjectOpener = async (requested, signal) => {
    /*
     * `createPathSubjectOpener` hides the `OpenedSubject` behind its snapshot, and
     * `createSubjectEditing` needs it. Rather than re-implementing the opener to get at it, the
     * services object it is handed is wrapped for the duration of this one call: the open path,
     * the confinement and the snapshot stay the shared ones, and the result is captured on the way
     * past.
     */
    let opened: OpenedSubject | undefined
    const capturing: SubjectServices = {
      ...services,
      open: async request => {
        const result = await services.open(request)
        if (result.state === 'opened') opened = result
        return result
      },
    }
    const opener = createPathSubjectOpener({
      subjects: capturing,
      roots: options.roots(),
      grant: options.grant ?? { id: 'vscode', classes: ['read-source'] },
      budget: options.budget ?? DEFAULT_OPEN_BUDGET,
    })
    const answer = await opener(requested, signal)
    if (answer.snapshot.state !== 'opened' || opened === undefined) return answer

    const sessionId = answer.snapshot.sessionId
    try {
      rememberEditing(
        sessionId,
        createSubjectEditing({
          opened,
          // `write-source` is what `commit` checks for; the open above ran read-only.
          grant: { id: `vscode:${sessionId}`, classes: ['read-source', 'write-source'] },
          backendFor: () => editingBackend,
          evidenceFor: plan => evidence.evidenceFor(plan),
          writer: rawWriter,
        }),
      )
    } catch (error) {
      // A subject shape editing does not support yet (a bundle, a namespace) still opens
      // read-only; the page sees `edit()` refuse and hides the editor stages.
      options.onDiagnostic?.({
        code: 'x3.app/vscode-subject-not-editable',
        message: `${basename(requested)} opened without an editing arm: ${describe(error)}`,
      })
    }
    return answer
  }

  const exposure = exposeSubjectRpc({
    port: bridge.port,
    listener: 'emitter-value',
    session: options.session,
    open: openSubject,
    editing: sessionId => editingBySession.get(sessionId),
    moduleUrl: VSCODE_SUBJECT_SERVICES_URL,
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })

  bridge.serve(async (request: ShellRequest): Promise<unknown> => {
    const roots = options.roots().map(root => resolve(root))
    switch (request.op) {
      case 'list':
        return listDirectory(roots, request.path)
      case 'read':
        return readEntry(roots, request.path, request.maxBytes)
      case 'confirm':
        // No adapter means no way to ask, and discarding silently is the one answer that loses
        // work — so an unanswerable prompt keeps the tab open.
        return (await options.confirmClose?.(request.message, request.savable)) ?? 'cancel'
      default:
        throw new Error('unknown shell request')
    }
  })

  // The page's own status line, mirrored so the output channel records what the user saw.
  bridge.onEvent(event => {
    if (event.op !== 'status') return
    options.onDiagnostic?.({ code: 'x3.app/vscode-webview-status', message: event.text })
  })

  return {
    bridge,
    exposure,
    open(path: string) {
      bridge.emit({ op: 'open', path: resolve(path), name: basename(path) })
    },
    publishRoots() {
      bridge.emit({
        op: 'roots',
        roots: options.roots().map(root => {
          const absolute = resolve(root)
          return { id: absolute, label: basename(absolute) || absolute }
        }),
      })
    },
    notice(text: string, severity: 'info' | 'error' = 'info') {
      bridge.emit({ op: 'notice', text, severity })
    },
    async close(reason: string) {
      bridge.dispose()
      editingBySession.clear()
      await exposure.close(reason)
    },
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

async function listDirectory(
  roots: readonly string[],
  requested: string | undefined,
): Promise<readonly ShellEntry[]> {
  if (requested === undefined) {
    // The root listing is the set of granted folders themselves.
    const out: ShellEntry[] = []
    for (const root of roots) {
      out.push({ id: root, name: basename(root) || root, directory: true })
    }
    return out
  }
  const path = requireInside(roots, requested)
  const entries = await readdir(path, { withFileTypes: true })
  const out: ShellEntry[] = []
  for (const entry of entries.slice(0, VSCODE_MAXIMUM_LISTING)) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      out.push({ id: child, name: entry.name, directory: true })
      continue
    }
    if (!entry.isFile()) continue
    let size: number | undefined
    try {
      size = Number((await stat(child)).size)
    } catch {
      size = undefined
    }
    out.push({
      id: child,
      name: entry.name,
      directory: false,
      ...(size === undefined ? {} : { size }),
    })
  }
  return out
}

async function readEntry(
  roots: readonly string[],
  requested: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const path = requireInside(roots, requested)
  const limit = Math.min(
    Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : VSCODE_MAXIMUM_SUBJECT_BYTES,
    VSCODE_MAXIMUM_SUBJECT_BYTES,
  )
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`«${basename(path)}» is not a file`)
  if (Number(info.size) > limit) {
    throw new Error(
      `${basename(path)} is ${(Number(info.size) / (1024 * 1024)).toFixed(1)} MiB, over the ` +
        `${(limit / (1024 * 1024)).toFixed(0)} MiB this host will read into memory`,
    )
  }
  const bytes = await readFile(path)
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice()
}

/** Candidate directories the first-party catalog may live in, most specific first. */
export function catalogCandidates(
  extensionRoot: string,
  repositoryRoot?: string,
): readonly string[] {
  const candidates = [
    join(extensionRoot, 'extensions'),
    join(extensionRoot, 'dist-app', 'extensions'),
  ]
  if (repositoryRoot !== undefined) candidates.push(join(repositoryRoot, 'extensions', 'common'))
  return Object.freeze(candidates.filter(path => existsSync(path)))
}
