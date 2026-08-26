/**
 * Modkit viewers as ordinary web components — a real stage inside somebody else's page.
 *
 * The PWA is one consumer of the open path; this is the other. A third-party site loads one module
 * script and writes `<modkit-viewer src="./data/table.csv" view="table">`, and gets exactly what
 * the workbench shows: the build-time attested catalog, the same digest verification, the same
 * module workers. **Nothing evaluates extension code on the page thread** — the execution registry
 * holds the browser worker backend alone, so an embedding page cannot end up running a codec in its
 * own realm even by accident.
 *
 * ## The embedding contract
 *
 * **Assets.** `asset-base` points at a served copy of this app's `dist-app` (the catalog is
 * compiled into `embed.js`; the base supplies `worker-entry.js`, `chunks/*`, `vendor/*`,
 * `extensions/**` and `modkit-ui.css`). It defaults to the directory `embed.js` itself was loaded
 * from, so «host the built app somewhere and point one script tag at it» is the whole deployment.
 *
 * **Origins.** The asset base must be *same-origin* with the embedding page. This is not a
 * preference: `new Worker(url, { type: 'module' })` fetches its script in same-origin mode, so a
 * cross-origin worker entry is refused by the browser however generous the CORS headers are. The
 * element therefore checks the origin *before* it composes anything and states the refusal in its
 * own box (`crossOriginRefusal`) rather than letting a `SecurityError` surface as an empty frame or
 * a load that never settles. Reverse-proxy the assets under your own origin, or copy them there.
 * `src` is a different question, and it has *two* gates rather than one. It is fetched relative to
 * the document, and a cross-origin `src` opens when the file's own server sends CORS headers **and**
 * the embedding page's `connect-src` names that origin. Both halves are proven live; either one
 * missing ends in the element stating the URL and both conditions, because the browser's own
 * message for the rejected fetch is «Failed to fetch» and nothing else.
 *
 * **CSP.** Measured in Chromium, one directive at a time, against the demo page — which ships this
 * policy and is asserted to raise zero `securitypolicyviolation` events (`test/embed.test.ts`):
 *
 *   default-src 'none'; script-src 'self' blob:; worker-src 'self' blob:; connect-src 'self';
 *   img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; font-src 'self'
 *
 * What each part is actually for, and which parts the measurement found load-bearing:
 *
 *  - `script-src 'self'` — the entry and its chunks. `worker-src 'self'` — the module worker, whose
 *    script is a plain same-origin URL.
 *  - `connect-src 'self'` — every fetch this element makes: the file at `src`, the stylesheet, each
 *    attested artifact.
 *  - `img-src 'self' blob: data:` and `media-src 'self' blob:` — what the image, vector and media
 *    stages hand the platform. Dropping `blob:` from `img-src` was the one removal that *did* bite:
 *    the stage still mounts and the picture never paints, with `img-src <- blob` refused.
 *  - `style-src 'self'` — enough, with no `'unsafe-inline'`, because the stylesheet is adopted as a
 *    *constructable* sheet. The `<style>` fallback below is inline style and would need it, which
 *    is stated where it happens.
 *  - `blob:` in `script-src` / `worker-src` — **not exercised** in Chromium. The verified extension
 *    modules do reach the worker as blob URLs, but a dedicated worker whose script is fetched over
 *    http(s) does not inherit the document's policy, so those imports are outside the page's CSP
 *    entirely. Both were removed in turn and nothing was refused. They are kept here because an
 *    engine that *does* inherit into workers would refuse them, and allowing a blob the page itself
 *    minted costs nothing.
 *
 * The shipped `VIEWER_CSP` from `@modkitx-x3/ui` also works verbatim for an embedding page: the
 * test serves the same demo under it and asserts zero refusals, so a host that already applies the
 * viewer policy needs no relaxation to embed one of these.
 *
 * **Styling.** Each element renders into an open shadow root with `modkit-ui.css` adopted inside
 * it, fetched once per asset base. The sheet's `:root` selectors are rewritten to `:host` on the
 * way in (`shadowScopedCss`), because `:root` cannot match inside a shadow tree and the tokens
 * would otherwise resolve to nothing. Consequences, both intended: the host page's styles do not
 * reach modkit's DOM, and modkit's rules touch nothing outside the element. Theme and density are
 * read from `data-mk-theme` / `data-mk-density` on the element itself.
 *
 * **Editing.** `src` and the `file` property stay read-only: neither gives this element authority
 * to write anywhere. A page may explicitly assign a File System Access handle to `fileHandle`;
 * only then are editor ports composed, write permission is requested from a Save click, and the
 * changed bytes are committed back through the same revision-checked browser backend as the PWA.
 *
 * **Extension catalogs.** The bundled catalog is always present. A deployment may additionally
 * compile an origin allowlist into `embed.js`; an element may point `extension-catalog` at a JSON
 * catalog from one of those origins. The page cannot extend the list. Catalog files remain
 * worker-only and every module byte is verified against the catalog's digest before evaluation.
 * A deployment with the default empty list admits no URL catalog at all.
 *
 * The pure half of this module (attribute parsing, asset-base resolution, the stylesheet rewrite,
 * the stage preference, the shared-host keying) is DOM-free and unit-tested in Node; the element
 * class is built inside `defineModkitElements`, so importing this file where `HTMLElement` does not
 * exist is harmless.
 */

import {
  revisionId,
  type AnyDescriptor,
  type ArtifactByteSource,
  type OperationSession,
  type PermissionGrant,
} from '@modkitx-x3/sdk'
import type { OpenedSubject, SubjectEditorPorts } from '@modkitx-x3/host'
import type {
  BrowserBlobConstructorLike,
  BrowserMessageChannelConstructorLike,
  BrowserObjectUrlLike,
} from '@modkitx-x3/host/browser'
import {
  createCodecPreview,
  EXPLORER_MAXIMUM_BYTES,
  type ExplorerEntry,
  type PreviewHandle,
  type PreviewSession,
  type PreviewStage,
} from '@modkitx-x3/ui/explorer'
import { element, setPart, setState, setViewerText } from '@modkitx-x3/ui/viewer'

import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import {
  createSingleFileAccess,
  isWritableHandle,
  type WebBlobSlice,
  type WebFileHandleLike,
  type WebFileLike,
  type WebWritableFileHandleLike,
} from './files.js'
import {
  createWebEditingArm,
  describeEditability,
  requestWriteAccess,
  sourceRevisionToken,
  sourceUriFor,
  type WebEditingArm,
} from './editing.js'
import {
  createWebSubjectServices,
  type WebExtensionCatalog,
  type WebSubjectServices,
} from './subjects.js'
import { createWebPreviewStages, stageIdOf, WEB_PREVIEW_FALLBACK } from './views.js'

/** The element name this module registers by default. */
export const MODKIT_VIEWER_TAG = 'modkit-viewer'

/**
 * What an element is doing, mirrored to `data-mk-state` on the element itself.
 *
 * On the element rather than only inside the shadow root, so a host page can style or await it
 * without reaching through the boundary: `modkit-viewer[data-mk-state='error']` is a selector the
 * embedding page owns.
 */
export type EmbedState = 'empty' | 'loading' | 'ready' | 'error'

/** Largest file an embedded viewer reads into memory. The workbench's own ceiling. */
export const EMBED_MAXIMUM_BYTES = EXPLORER_MAXIMUM_BYTES

/**
 * The element's own chrome inside the shadow root. Tokens only, no literals.
 *
 * The `:host` block is half layout and half defence. A shadow root blocks the host page's
 * *selectors* but not its *inheritance*: `body { text-transform: uppercase; letter-spacing: .1em }`
 * reaches straight through the boundary and would arrive as uppercase, letter-spaced hex dumps. So
 * every inherited text property is reset at the host and re-stated from tokens on the frame. What
 * is deliberately **not** reset is what a page should still control: `visibility` (a hidden
 * container must hide the viewer too), `direction` and `writing-mode` (an RTL page means it), and
 * anything a page sets on the element itself — a rule in the outer tree always beats `:host`, so
 * `modkit-viewer { block-size: 30rem }` still works.
 */
export const EMBED_CHROME_CSS = `
:host {
  display: block;
  box-sizing: border-box;
  min-block-size: 12rem;
  color: initial;
  font: initial;
  letter-spacing: initial;
  word-spacing: initial;
  text-align: initial;
  text-indent: initial;
  text-transform: initial;
  text-shadow: initial;
  white-space: initial;
  list-style: initial;
  tab-size: initial;
}
:host([hidden]) {
  display: none;
}
.modkit-embed {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-2);
  box-sizing: border-box;
  block-size: 100%;
  min-block-size: inherit;
  padding: var(--mk-space-2);
  color: var(--mk-color-fg);
  background: var(--mk-color-surface);
  border: 1px solid var(--mk-color-border);
  border-radius: var(--mk-radius-md);
  font-family: var(--mk-font-sans);
  font-size: var(--mk-font-size-md);
  line-height: var(--mk-line-normal);
}
.modkit-embed__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mk-space-2);
}
.modkit-embed__title {
  overflow: hidden;
  color: var(--mk-color-fg-muted);
  font-size: var(--mk-font-size-sm);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.modkit-embed__stage {
  flex: 1 1 auto;
  min-block-size: 0;
  overflow: auto;
}
.modkit-embed__status {
  color: var(--mk-color-fg-muted);
  font-size: var(--mk-font-size-sm);
}
.modkit-embed__status[data-mk-state~='error'] {
  padding: var(--mk-space-2);
  color: var(--mk-status-error-fg);
  border: 1px solid var(--mk-status-error-border);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-status-error-bg);
}
.modkit-embed__status[hidden] {
  display: none;
}
`

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// ---------------------------------------------------------------------------------------------
// the pure half: attributes, asset base, stylesheet scoping, stage preference

/** Replaced with a JSON array by the web build; source/test imports fail closed to an empty list. */
declare const __MODKIT_EMBED_EXTENSION_ORIGINS__: unknown

const compiledExtensionOrigins: unknown =
  typeof __MODKIT_EMBED_EXTENSION_ORIGINS__ === 'undefined'
    ? []
    : __MODKIT_EMBED_EXTENSION_ORIGINS__

/** URL-catalog origins approved by the deployer that built this exact `embed.js`. */
export const EMBED_EXTENSION_ORIGINS: readonly string[] = Object.freeze(
  Array.isArray(compiledExtensionOrigins)
    ? compiledExtensionOrigins.flatMap(value => {
        if (typeof value !== 'string') return []
        try {
          const url = new URL(value)
          return url.protocol === 'http:' || url.protocol === 'https:' ? [url.origin] : []
        } catch {
          return []
        }
      })
    : [],
)

/** Resolve the page-authored catalog attribute; the trust decision is deliberately separate. */
export function resolveExtensionCatalogUrl(attribute: string, documentBase: string): string {
  return new URL(attribute, documentBase).href
}

/**
 * Refuse a URL whose origin was not compiled into this deployment.
 *
 * `allowedOrigins` exists for the pure contract test. The element never reads an allowlist from
 * an attribute or property and always calls this with the frozen build constant above.
 */
export function extensionCatalogRefusal(
  catalogUrl: string,
  allowedOrigins: readonly string[] = EMBED_EXTENSION_ORIGINS,
): string | undefined {
  let url: URL
  try {
    url = new URL(catalogUrl)
  } catch {
    return `extension-catalog «${catalogUrl}» is not a valid URL.`
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `extension-catalog must use http or https; ${url.protocol} is not admitted.`
  }
  const allowed = new Set(
    allowedOrigins.flatMap(value => {
      try {
        return [new URL(value).origin]
      } catch {
        return []
      }
    }),
  )
  if (allowed.has(url.origin)) return undefined
  return (
    `The extension catalog origin ${url.origin} is not in this embed.js build-time allowlist. ` +
    'The embedding page cannot add an origin; the deployer must rebuild embed.js with it.'
  )
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const strings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value)
const pairs = (value: unknown, check: (item: unknown) => boolean): boolean =>
  Array.isArray(value) &&
  value.every(
    item =>
      Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && check(item[1]),
  )

/** Fail-closed structural boundary for a catalog fetched as untyped JSON. */
export function parseWebExtensionCatalog(value: unknown): WebExtensionCatalog {
  if (
    !record(value) ||
    value['schemaVersion'] !== 1 ||
    !Array.isArray(value['extensions']) ||
    !Array.isArray(value['excluded'])
  ) {
    throw new TypeError('extension catalog must be a schemaVersion 1 object with array entries')
  }
  for (const excluded of value['excluded']) {
    if (
      !record(excluded) ||
      typeof excluded['name'] !== 'string' ||
      typeof excluded['reason'] !== 'string'
    ) {
      throw new TypeError('extension catalog exclusions require string name and reason fields')
    }
  }
  for (const entry of value['extensions']) {
    if (
      !record(entry) ||
      typeof entry['name'] !== 'string' ||
      typeof entry['source'] !== 'string' ||
      typeof entry['artifactRoot'] !== 'string' ||
      !record(entry['containers']) ||
      !strings(entry['files']) ||
      !pairs(entry['documents'], () => true) ||
      !pairs(entry['documentDigests'], digest) ||
      !record(entry['artifact']) ||
      typeof entry['artifact']['inventoryRecordId'] !== 'string' ||
      !digest(entry['artifact']['artifactDigest']) ||
      !record(entry['artifact']['fileDigests']) ||
      !Object.values(entry['artifact']['fileDigests']).every(digest)
    ) {
      throw new TypeError('extension catalog contains a malformed extension entry')
    }
  }
  return value as unknown as WebExtensionCatalog
}

/**
 * Where this element's assets live, always with a trailing slash.
 *
 * An `asset-base` attribute is resolved against the *document*, because that is the base every
 * other URL on the page is written against. Absent, the default is the directory `embed.js` itself
 * came from — the deployment story is then «serve `dist-app`, point one script tag at it».
 */
export function resolveAssetBase(
  attribute: string | undefined,
  scriptUrl: string,
  documentBase: string,
): string {
  const resolved =
    attribute === undefined || attribute === ''
      ? new URL('./', scriptUrl)
      : new URL(attribute, documentBase)
  const href = resolved.href
  return href.endsWith('/') ? href : `${href}/`
}

/**
 * Why this element will not compose a host here, or `undefined` when it may.
 *
 * Stated up front rather than discovered on the first `new Worker(...)`: the worker script is
 * fetched in same-origin mode, so a cross-origin asset base is not a CORS problem a server can fix.
 */
export function crossOriginRefusal(assetBase: string, pageOrigin: string): string | undefined {
  let origin: string
  try {
    origin = new URL(assetBase).origin
  } catch {
    return `asset-base «${assetBase}» is not a URL this page can resolve.`
  }
  if (origin === pageOrigin) return undefined
  return (
    `The modkit assets at ${origin} are cross-origin to this page (${pageOrigin}). A module ` +
    'worker script is fetched in same-origin mode, so no CORS header can make that work: serve ' +
    'the modkit assets from this origin (copy or reverse-proxy them) and point asset-base there.'
  )
}

/** The display / detection name: the `name` attribute, else the basename of `src`. */
export function displayNameFor(
  src: string | undefined,
  name: string | undefined,
  documentBase: string,
): string {
  if (name !== undefined && name !== '') return name
  if (src === undefined || src === '') return 'file'
  try {
    const last = new URL(src, documentBase).pathname.split('/').pop()
    return last === undefined || last === '' ? 'file' : decodeURIComponent(last)
  } catch {
    return 'file'
  }
}

/**
 * The stage list with one id moved to the front.
 *
 * `createCodecPreview` mounts the first *applicable* stage, so preference is expressed by order and
 * nothing else has to change. An id no stage carries, or one whose contract this subject does not
 * publish, therefore falls back to the resolver's own default — and the picker still offers every
 * stage, because the list is reordered rather than filtered.
 */
export function preferStage(
  stages: readonly PreviewStage[],
  preferred: string | undefined,
): readonly PreviewStage[] {
  if (preferred === undefined || preferred === '') return stages
  const chosen = stages.filter(stage => stageIdOf(stage) === preferred)
  if (chosen.length === 0) return stages
  return Object.freeze([...chosen, ...stages.filter(stage => stageIdOf(stage) !== preferred)])
}

/*
 * No stylesheet rewriting here any more: the token generator now emits every token block with a
 * ":root, :host" selector list, so the shipped sheet is shadow-capable as fetched. The contract
 * test asserts that on the shipped bytes — if the generator regresses to bare :root, that test
 * goes red, not this element.
 */

/**
 * Compose once per asset base, share for the page's lifetime.
 *
 * Not reference-counted, deliberately. Composing a host spawns module workers and re-verifies every
 * attested artifact's bytes; a page that moves a `<modkit-viewer>` between containers fires
 * disconnect/connect and would pay all of that again, and tearing a host down while an open is in
 * flight would have to cancel work the element no longer owns. What *is* released per element is
 * the thing that actually holds memory: the opened subject's session, disposed when the element's
 * preview unmounts. The host is a few workers and an inventory, and it stays.
 */
export function shareByAssetBase<Value>(
  cache: Map<string, Promise<Value>>,
  assetBase: string,
  create: (assetBase: string) => Promise<Value>,
): Promise<Value> {
  const known = cache.get(assetBase)
  if (known !== undefined) return known
  const created = create(assetBase)
  cache.set(assetBase, created)
  // A failed composition must not be cached as the answer for the rest of the page's life.
  created.catch(() => cache.delete(assetBase))
  return created
}

// ---------------------------------------------------------------------------------------------
// the shared host

/** Stylesheets for one asset base, in whichever of the two forms this browser supports. */
export interface EmbedStyles {
  /** Constructable sheets, ready to adopt. Absent when the browser has no `CSSStyleSheet()`. */
  readonly sheets?: readonly CSSStyleSheet[]
  /** The same CSS as text, for the `<style>` element fallback. */
  readonly text: string
}

/** Everything the elements on one asset base share. */
export interface EmbedHost {
  readonly assetBase: string
  readonly services: WebSubjectServices
  readonly stages: readonly PreviewStage[]
  readonly styles: EmbedStyles
  /**
   * Live operation sessions by descriptor identity. The container stage asks for one by descriptor
   * (`WebViewContext`), exactly as it does in the workbench: `createCodecPreview` hands a viewer a
   * descriptor and nothing else, so whoever opened the subject has to keep the session reachable.
   */
  readonly operations: Map<string, OperationSession>
}

const embedHosts = new Map<string, Promise<EmbedHost>>()
const embedLifecycleScopes = new WeakSet<object>()

/**
 * Dispose every shared host once for the page, not once per custom element.
 *
 * Elements with the same asset/catalog pair deliberately share one cached host; tying disposal to
 * `disconnectedCallback` would let removing one element kill the sessions of its siblings. The
 * page lifecycle is the owner of this cache, so pagehide is the one terminal boundary.
 */
export async function disposeEmbedHosts(): Promise<void> {
  const pending = [...embedHosts.values()]
  embedHosts.clear()
  const settled = await Promise.allSettled(pending)
  await Promise.allSettled(
    settled.flatMap(item => (item.status === 'fulfilled' ? [item.value.services.dispose()] : [])),
  )
}

/** Install the one pagehide hook for a lifecycle scope. Exported for wiring-only smoke tests. */
export function installEmbedHostLifecycle(
  scope: object & {
    addEventListener?: (
      type: string,
      listener: () => void,
      options?: { readonly once?: boolean },
    ) => void
  } = globalThis,
): boolean {
  if (embedLifecycleScopes.has(scope) || scope.addEventListener === undefined) return false
  embedLifecycleScopes.add(scope)
  scope.addEventListener('pagehide', () => void disposeEmbedHosts(), { once: true })
  return true
}

/** Identity of a mounted descriptor — the key a stage can look its session up by. */
const descriptorKey = (descriptor: AnyDescriptor): string =>
  `${descriptor.subjectUri} :: ${descriptor.revision}`

async function loadStyles(assetBase: string): Promise<EmbedStyles> {
  const response = await fetch(new URL('modkit-ui.css', assetBase).href)
  if (!response.ok) {
    throw new Error(`modkit-ui.css could not be fetched from ${assetBase} (${response.status})`)
  }
  const text = `${await response.text()}\n${EMBED_CHROME_CSS}`
  if (typeof CSSStyleSheet !== 'function') return { text }
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(text)
    return { sheets: Object.freeze([sheet]), text }
  } catch {
    /*
     * No constructable stylesheets (older Safari, and any engine that refuses `replaceSync`). The
     * element then appends a `<style>` into its own shadow root with the same text. It is scoped
     * identically — a `<style>` in a shadow root does not escape it — and differs in exactly one
     * way worth stating: it is an inline stylesheet, so a host page under `style-src 'self'` alone
     * will see it refused and must allow `'unsafe-inline'` (or use a browser from this decade).
     */
    return { text }
  }
}

async function fetchExtensionCatalog(catalogUrl: string): Promise<WebExtensionCatalog> {
  let response: Response
  try {
    response = await fetch(catalogUrl, { credentials: 'omit' })
  } catch (error) {
    throw new Error(`extension catalog ${catalogUrl} could not be fetched: ${describe(error)}`)
  }
  if (!response.ok) {
    throw new Error(
      `extension catalog ${catalogUrl} could not be fetched (${response.status} ${response.statusText})`,
    )
  }
  try {
    return parseWebExtensionCatalog(await response.json())
  } catch (error) {
    throw new Error(`extension catalog ${catalogUrl} is invalid: ${describe(error)}`)
  }
}

async function composeEmbedHost(
  assetBase: string,
  extensionCatalogUrl?: string,
): Promise<EmbedHost> {
  const additionalCatalogs =
    extensionCatalogUrl === undefined
      ? []
      : [
          {
            catalog: await fetchExtensionCatalog(extensionCatalogUrl),
            baseUrl: extensionCatalogUrl,
          },
        ]
  const services = await createWebSubjectServices({
    baseUrl: assetBase,
    catalog: WEB_EXTENSION_CATALOG,
    additionalCatalogs,
    identity: embedIdentity(),
    dom: {
      fetch: (url, init) => fetch(url, init),
      subtle: {
        digest: (algorithm, data) =>
          crypto.subtle.digest(algorithm, data as Uint8Array<ArrayBuffer>),
      },
      // the structural DOM shapes take readonly parts / any blob; the platform types are wider
      Blob: Blob as unknown as BrowserBlobConstructorLike,
      objectUrls: URL as unknown as BrowserObjectUrlLike,
      Worker,
      MessageChannel: MessageChannel as unknown as BrowserMessageChannelConstructorLike,
    },
  })
  const operations = new Map<string, OperationSession>()
  const stages = createWebPreviewStages({
    operationsFor: descriptor => operations.get(descriptorKey(descriptor)),
  })
  const styles = await loadStyles(assetBase)
  return Object.freeze({ assetBase, services, stages, styles, operations })
}

/** The one host for this asset/catalog pair, composed on first use. */
export function embedHostFor(assetBase: string, extensionCatalogUrl?: string): Promise<EmbedHost> {
  installEmbedHostLifecycle()
  const key = JSON.stringify([assetBase, extensionCatalogUrl ?? null])
  return shareByAssetBase(embedHosts, key, () => composeEmbedHost(assetBase, extensionCatalogUrl))
}

/** The browser does not report OS/arch portably; a real host adapter supplies this. */
function embedIdentity(): { operatingSystem: 'windows' | 'darwin' | 'linux'; architecture: 'x64' } {
  const agent = navigator.userAgent
  const operatingSystem = agent.includes('Windows')
    ? 'windows'
    : agent.includes('Mac')
      ? 'darwin'
      : 'linux'
  return { operatingSystem, architecture: 'x64' }
}

// ---------------------------------------------------------------------------------------------
// bytes in

/** A `Blob` or `File` as this module reads one. Structural, so a test needs no platform Blob. */
export interface EmbedBlobLike {
  readonly size: number
  readonly name?: string
  readonly lastModified?: number
  slice(start: number, end: number): WebBlobSlice
}

/** One blob presented as the file the explorer's `FileAccess` is built from. */
export function fileLikeFrom(blob: EmbedBlobLike, fallbackName: string): WebFileLike {
  const name = blob.name === undefined || blob.name === '' ? fallbackName : blob.name
  return {
    name,
    size: blob.size,
    lastModified: blob.lastModified ?? 0,
    slice: (start, end) => blob.slice(start, end),
  }
}

/** Bytes in memory as the random-access source `openSubject` asks for. */
function bytesSource(
  name: string,
  bytes: Uint8Array,
  token: string,
  sourceUri?: string,
): ArtifactByteSource {
  const uri = sourceUri ?? `memory://modkit-embed/${encodeURIComponent(name)}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(token),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      const start = Number(offset)
      return bytes.slice(start, Math.min(bytes.byteLength, start + length))
    },
    async *stream(range) {
      const start = Number(range?.offset ?? 0n)
      const end = range?.length === undefined ? bytes.byteLength : start + Number(range.length)
      yield bytes.slice(start, Math.min(bytes.byteLength, end))
    },
  }
}

let openCount = 0

/**
 * Open one subject through the shared host, as a `PreviewSession`.
 *
 * The grant carries `write-source` only when the page supplied a writable handle. `undefined`
 * means no codec claimed the file, and `createCodecPreview` then shows its text/hex fallback rather
 * than an empty box.
 */
interface EmbedPreviewSession extends PreviewSession {
  readonly opened: OpenedSubject
  readonly grant: PermissionGrant
}

async function openEmbedSession(
  host: EmbedHost,
  entry: ExplorerEntry,
  bytes: Uint8Array,
  options: {
    readonly token: string
    readonly sourceUri?: string
    readonly writable: boolean
  },
  signal?: AbortSignal,
): Promise<EmbedPreviewSession | undefined> {
  openCount += 1
  const grant: PermissionGrant = {
    id: `modkit-embed-${openCount}`,
    classes: options.writable ? ['read-source', 'write-source'] : ['read-source'],
  }
  const result = await host.services.open({
    source: bytesSource(entry.name, bytes, options.token, options.sourceUri),
    path: entry.name,
    intent: 'full',
    grant,
    budget: {
      maxInputBytes: BigInt(EMBED_MAXIMUM_BYTES),
      maxDepth: 256,
      maxNodes: 1_000_000,
      maxScalarBytes: 64 * 1024 * 1024,
      maxDiagnostics: 10_000,
      deadlineMs: 30_000,
    },
    ...(signal === undefined ? {} : { signal }),
  })
  if (result.state === 'unresolved') return undefined
  /*
   * `AssetSession` answers exactly the questions `PreviewSession` asks, but its `dataSource` is
   * generic over the known contracts while the previewer calls it with plain strings. One narrow
   * structural view keeps that in a single place — the same one the workbench takes.
   */
  const session = result.session as unknown as {
    descriptor(): Promise<Record<string, unknown>>
    dataSource(contract: string, major: number): Promise<{ value: unknown }>
    operations(): OperationSession
    dispose(): Promise<void>
  }
  const key = descriptorKey(result.descriptor)
  const operations = session.operations()
  host.operations.set(key, operations)
  return {
    opened: result,
    grant,
    descriptor: () => session.descriptor(),
    dataSource: (contract: string, major: number) => session.dataSource(contract, major),
    async operations() {
      return operations
    },
    async dispose() {
      host.operations.delete(key)
      await session.dispose()
    },
  }
}

// ---------------------------------------------------------------------------------------------
// the element

export interface DefineModkitElementsOptions {
  /** Element name to register. A page that already owns `modkit-viewer` can rename ours. */
  readonly tagName?: string
  /** Default `asset-base` for elements that declare none. Defaults to this module's own URL. */
  readonly assetBase?: string
  /** Registry to define into. Defaults to the page's `customElements`. */
  readonly registry?: CustomElementRegistry
}

/** Attribute names that make an element reload; everything else is presentation. */
const RELOADING_ATTRIBUTES = Object.freeze(['src', 'name', 'asset-base', 'extension-catalog'])
const OBSERVED_ATTRIBUTES = Object.freeze([
  ...RELOADING_ATTRIBUTES,
  'view',
  'data-mk-theme',
  'data-mk-density',
])

/**
 * Register the modkit elements.
 *
 * Idempotent: registering a name the registry already holds is a no-op, so a page that loads
 * `embed.js` twice (a bundler and a script tag, say) gets one definition rather than an exception.
 * Returns the name that is now defined.
 */
export function defineModkitElements(options: DefineModkitElementsOptions = {}): string {
  const tagName = options.tagName ?? MODKIT_VIEWER_TAG
  const registry = options.registry ?? globalThis.customElements
  const base = globalThis.HTMLElement
  if (registry === undefined || typeof base !== 'function') {
    throw new TypeError('modkit elements need a DOM with customElements and HTMLElement')
  }
  if (registry.get(tagName) !== undefined) return tagName
  const defaultAssetBase = options.assetBase ?? import.meta.url

  class ModkitViewerElement extends base {
    static get observedAttributes(): readonly string[] {
      return OBSERVED_ATTRIBUTES
    }

    readonly #shadow: ShadowRoot
    readonly #frame: HTMLElement
    readonly #title: HTMLElement
    readonly #picker: HTMLSelectElement
    readonly #stage: HTMLElement
    readonly #status: HTMLElement
    #handle: PreviewHandle | undefined
    #abort: AbortController | undefined
    #blob: EmbedBlobLike | undefined
    #fileHandle: WebFileHandleLike | undefined
    #editing: WebEditingArm | undefined
    #styled = false
    /** Bumped by every load; a load whose token is stale mounts nothing. */
    #generation = 0

    constructor() {
      super()
      this.#shadow = this.attachShadow({ mode: 'open' })
      const document = this.ownerDocument
      const frame = document.createElement('div')
      frame.className = 'modkit-embed'
      const header = document.createElement('div')
      header.className = 'modkit-embed__header'
      setPart(header, 'explorer.header')
      const title = element(header, 'span', { part: 'explorer.breadcrumb' })
      title.className = 'modkit-embed__title'
      const picker = document.createElement('select')
      picker.className = 'modkit-embed__picker'
      picker.hidden = true
      picker.setAttribute('aria-label', 'View')
      setPart(picker, 'viewpicker.select')
      header.append(picker)
      const stage = document.createElement('div')
      stage.className = 'modkit-embed__stage'
      setPart(stage, 'explorer.stage')
      const status = document.createElement('output')
      status.className = 'modkit-embed__status'
      setPart(status, 'explorer.status')
      frame.append(header, stage, status)
      this.#shadow.append(frame)
      this.#frame = frame
      this.#title = title
      this.#picker = picker
      this.#stage = stage
      this.#status = status
      picker.addEventListener('change', () => {
        void this.#show(picker.value)
      })
    }

    /**
     * Bytes supplied by the page instead of `src` — a `File` from its own picker, a `Blob` it
     * built. Setting it reloads; `src` is ignored while it is set, because a page that handed us
     * bytes meant those bytes.
     */
    get file(): EmbedBlobLike | undefined {
      return this.#blob
    }

    set file(value: EmbedBlobLike | undefined) {
      this.#blob = value
      if (value !== undefined) this.#fileHandle = undefined
      if (this.isConnected) void this.#load()
    }

    /**
     * A File System Access handle explicitly delegated by the embedding page. Unlike `file`, this
     * may carry write authority; editable stages are offered only when `createWritable` exists.
     */
    get fileHandle(): WebFileHandleLike | undefined {
      return this.#fileHandle
    }

    set fileHandle(value: WebFileHandleLike | undefined) {
      this.#fileHandle = value
      if (value !== undefined) this.#blob = undefined
      if (this.isConnected) void this.#load()
    }

    /** The preferred stage id, reflected to the `view` attribute. */
    get view(): string {
      return this.getAttribute('view') ?? ''
    }

    set view(value: string) {
      if (value === '') this.removeAttribute('view')
      else this.setAttribute('view', value)
    }

    /** The stage on screen right now, or `''` before anything mounted. */
    get activeView(): string {
      return this.#handle?.activeView ?? ''
    }

    /** Stages this subject can be shown as, in the order the picker offers them. */
    get views(): readonly { readonly id: string; readonly label: string }[] {
      return this.#handle?.views ?? []
    }

    connectedCallback(): void {
      this.#mirrorAppearance()
      void this.#load()
    }

    disconnectedCallback(): void {
      // Supersede any load in flight, then release the subject. A page that re-parents the element
      // gets a fresh load on the next connect, which is cheap next to holding a worker session open
      // for a node that may never come back.
      this.#generation += 1
      this.#abort?.abort()
      this.#abort = undefined
      void this.#unmount()
    }

    attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
      if (previous === next) return
      if (name === 'data-mk-theme' || name === 'data-mk-density') {
        this.#mirrorAppearance()
        return
      }
      if (!this.isConnected) return
      if (name === 'view') {
        // A stage switch is not a reopen: when the subject already offers the stage, show it.
        const wanted = next ?? ''
        if (this.#handle?.views.some(view => view.id === wanted) === true) {
          void this.#show(wanted)
          return
        }
      }
      if (name !== 'view' && !RELOADING_ATTRIBUTES.includes(name)) return
      void this.#load()
    }

    /**
     * Theme and density, copied from the element onto the frame.
     *
     * `data-mk-theme` is answered by `:host([data-mk-theme='…'])` in the rewritten sheet, so the
     * element alone would do — but `data-mk-density` is authored as a bare attribute selector
     * (`[data-mk-density='compact']`), which cannot match a shadow host from inside the tree. The
     * frame carries both so one attribute on the element reaches every viewer under it.
     */
    #mirrorAppearance(): void {
      for (const name of ['data-mk-theme', 'data-mk-density']) {
        const value = this.getAttribute(name)
        if (value === null) this.#frame.removeAttribute(name)
        else this.#frame.setAttribute(name, value)
      }
    }

    #say(message: string, state: EmbedState): void {
      setViewerText(this.#status, message, 2000)
      this.#status.hidden = message === ''
      setState(this.#status, state === 'error' ? ['error'] : [])
      this.setAttribute('data-mk-state', state)
    }

    #fail(reason: string): void {
      this.#say(reason, 'error')
      this.dispatchEvent(
        new CustomEvent('modkit-viewer-error', { detail: { reason }, bubbles: false }),
      )
    }

    async #unmount(): Promise<void> {
      const handle = this.#handle
      const editing = this.#editing
      this.#handle = undefined
      this.#editing = undefined
      this.removeAttribute('data-mk-dirty')
      this.#picker.hidden = true
      this.#picker.replaceChildren()
      if (handle !== undefined) {
        try {
          await handle.unmount()
        } catch (error) {
          console.warn('[modkit-viewer] unmount failed', error)
        }
      }
      await editing?.dispose()
      this.#stage.replaceChildren()
    }

    async #show(viewId: string): Promise<void> {
      const handle = this.#handle
      if (handle === undefined || viewId === '' || handle.activeView === viewId) return
      try {
        await handle.show(viewId)
        this.#picker.value = handle.activeView
      } catch (error) {
        this.#fail(`«${viewId}» could not be shown: ${describe(error)}`)
      }
    }

    /** The bytes to open: the `file` property when the page set one, else `src`. */
    async #read(name: string, signal: AbortSignal): Promise<WebFileLike> {
      const fileHandle = this.#fileHandle
      if (fileHandle !== undefined) return fileHandle.getFile()
      const blob = this.#blob
      if (blob !== undefined) return fileLikeFrom(blob, name)
      const src = this.getAttribute('src') ?? ''
      const target = new URL(src, this.ownerDocument.baseURI)
      let response: Response
      try {
        response = await fetch(target.href, { signal })
      } catch (error) {
        if (signal.aborted) throw error
        /*
         * A rejected fetch carries no status and, in Chromium, no URL either — «Failed to fetch»
         * is all a page gets whether the file is missing CORS headers or the embedding page's own
         * `connect-src` refused the origin. Measured (`test/embed.test.ts`), and the reason this
         * says which URL and names both gates: the bare message is not something a reader could
         * act on.
         */
        throw new Error(
          `${target.href} could not be fetched (${describe(error)}). A cross-origin file needs ` +
            "CORS headers from its own server and an entry for its origin in this page's " +
            'content-security-policy connect-src.',
        )
      }
      if (!response.ok) {
        throw new Error(
          `${target.href} could not be fetched (${response.status} ${response.statusText})`,
        )
      }
      return fileLikeFrom(await response.blob(), name)
    }

    async #load(): Promise<void> {
      const generation = (this.#generation += 1)
      this.#abort?.abort()
      const controller = new AbortController()
      this.#abort = controller
      const current = (): boolean => generation === this.#generation && !controller.signal.aborted
      await this.#unmount()
      const name = displayNameFor(
        this.getAttribute('src') ?? undefined,
        this.getAttribute('name') ?? undefined,
        this.ownerDocument.baseURI,
      )
      setViewerText(this.#title, name, 300)
      if (
        this.#fileHandle === undefined &&
        this.#blob === undefined &&
        (this.getAttribute('src') ?? '') === ''
      ) {
        /*
         * Not a failure. A page that appends the element and assigns `.file` a tick later passes
         * through this state, and so does one that will set `src` when its own data arrives.
         */
        this.#say('Waiting for a file: set the src attribute or assign the file property.', 'empty')
        return
      }
      this.#say(`Loading ${name}…`, 'loading')
      try {
        const assetBase = resolveAssetBase(
          this.getAttribute('asset-base') ?? undefined,
          defaultAssetBase,
          this.ownerDocument.baseURI,
        )
        const refusal = crossOriginRefusal(assetBase, this.ownerDocument.location?.origin ?? '')
        if (refusal !== undefined) {
          this.#fail(refusal)
          return
        }
        const catalogAttribute = this.getAttribute('extension-catalog') ?? ''
        let extensionCatalogUrl: string | undefined
        if (catalogAttribute !== '') {
          try {
            extensionCatalogUrl = resolveExtensionCatalogUrl(
              catalogAttribute,
              this.ownerDocument.baseURI,
            )
          } catch {
            this.#fail(
              `extension-catalog «${catalogAttribute}» is not a URL this page can resolve.`,
            )
            return
          }
          const catalogRefusal = extensionCatalogRefusal(extensionCatalogUrl)
          if (catalogRefusal !== undefined) {
            this.#fail(catalogRefusal)
            return
          }
        }
        const host = await embedHostFor(assetBase, extensionCatalogUrl)
        if (!current()) return
        this.#applyStyles(host.styles)
        const file = await this.#read(name, controller.signal)
        if (!current()) return
        // The name the codecs will detect on, which is the honest thing to show in the header: a
        // `file` property carries its own name and it is not the one the attributes implied.
        setViewerText(this.#title, file.name, 300)
        if (file.size > EMBED_MAXIMUM_BYTES) {
          this.#fail(
            `${name} is ${file.size} bytes; this element reads at most ${EMBED_MAXIMUM_BYTES}.`,
          )
          return
        }
        const fileHandle = this.#fileHandle
        const { access, entry } = createSingleFileAccess(file, fileHandle)
        const snapshot = await access.snapshotOf(entry.id, controller.signal)
        const bytes = await access.read(entry.id, EMBED_MAXIMUM_BYTES, controller.signal)
        if (!current()) return
        const editability = await describeEditability(access, entry.id, entry.name)
        const writable =
          editability.editable && snapshot !== undefined && isWritableHandle(fileHandle)
        const token =
          snapshot === undefined
            ? `provider-token:embed-${generation}-${bytes.byteLength}`
            : sourceRevisionToken(snapshot)
        const writableHandles = new Map<string, WebWritableFileHandleLike>()
        const sourceUri = writable ? sourceUriFor(entry.id) : undefined
        if (writable && sourceUri !== undefined) writableHandles.set(sourceUri, fileHandle)
        let editorPorts: SubjectEditorPorts | undefined
        if (writable) {
          const editing = createWebEditingArm({
            inventory: host.services.main.inventory,
            handleFor: sourceId => writableHandles.get(sourceId),
            onNotice: message => {
              if (!current()) return
              this.#say(message, 'ready')
              this.dispatchEvent(
                new CustomEvent('modkit-viewer-edit-status', {
                  detail: { message },
                  bubbles: false,
                }),
              )
            },
            onDirty: (_entryId, dirty) => {
              if (!current()) return
              if (dirty) this.setAttribute('data-mk-dirty', '')
              else this.removeAttribute('data-mk-dirty')
            },
            async ensureWriteAccess() {
              const currentAccess = await describeEditability(access, entry.id, entry.name)
              if (
                currentAccess.state === 'granted' ||
                currentAccess.state === 'no-permission-surface'
              )
                return 'granted'
              if (currentAccess.state !== 'prompt') return 'denied'
              const asked = await requestWriteAccess(access)
              return asked.state === 'granted'
                ? 'granted'
                : asked.state === 'denied'
                  ? 'denied'
                  : 'prompt'
            },
          })
          this.#editing = editing
        }
        /*
         * One previewer per load, because the preferred stage is per element. It is a closure over
         * the shared host's stage list — the stages themselves, the inventory and the workers are
         * composed once per asset base.
         *
         * `editorPorts` appears only after the subject opened under the writable handle's pinned
         * revision. A `src`, Blob or plain File therefore cannot accidentally gain an editor.
         */
        const previewer = createCodecPreview({
          supported: host.services.supportedExtensions,
          stages: preferStage(host.stages, this.getAttribute('view') ?? undefined),
          fallback: WEB_PREVIEW_FALLBACK,
          editorPorts: () => editorPorts,
          openSession: async (openedEntry, openedBytes, signal) => {
            const session = await openEmbedSession(
              host,
              openedEntry,
              openedBytes,
              { token, writable, ...(sourceUri === undefined ? {} : { sourceUri }) },
              signal,
            )
            if (session !== undefined && writable) {
              editorPorts = this.#editing?.editorFor({
                entryId: entry.id,
                name: entry.name,
                opened: session.opened,
                grant: session.grant,
                bytes,
              })?.ports
            }
            return session
          },
        })
        const handle = await previewer.open(this.#stage, entry, bytes, controller.signal)
        if (!current()) {
          await handle?.unmount()
          return
        }
        if (handle === undefined) {
          this.#fail(`${name} could not be shown: no stage matched what the codecs published.`)
          return
        }
        this.#handle = handle
        this.#drawPicker(handle)
        this.#say('', 'ready')
        this.dispatchEvent(
          new CustomEvent('modkit-viewer-ready', {
            detail: { name, view: handle.activeView, views: handle.views.map(view => view.id) },
            bubbles: false,
          }),
        )
      } catch (error) {
        if (!current()) return
        this.#fail(`${name}: ${describe(error)}`)
      }
    }

    #drawPicker(handle: PreviewHandle): void {
      this.#picker.replaceChildren()
      for (const view of handle.views) {
        const option = this.ownerDocument.createElement('option')
        option.value = view.id
        setViewerText(option, view.label, 128)
        this.#picker.append(option)
      }
      this.#picker.value = handle.activeView
      this.#picker.hidden = handle.views.length < 2
    }

    #applyStyles(styles: EmbedStyles): void {
      if (this.#styled) return
      this.#styled = true
      const sheets = styles.sheets
      if (sheets !== undefined) {
        this.#shadow.adoptedStyleSheets = [...sheets]
        return
      }
      const style = this.ownerDocument.createElement('style')
      style.textContent = styles.text
      this.#shadow.prepend(style)
    }
  }

  registry.define(tagName, ModkitViewerElement)
  return tagName
}

/*
 * Self-registration. This module is the `embed.js` entry, and a consumer's whole integration is one
 * script tag — so loading it defines the elements. Guarded, because the same file is compiled into
 * this package's library output and may be imported where there is no DOM at all.
 */
if (
  typeof globalThis.customElements !== 'undefined' &&
  typeof globalThis.HTMLElement === 'function'
)
  defineModkitElements()
