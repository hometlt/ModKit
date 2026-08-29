/**
 * Verified module loading for browser hosts (S5): the browser has no `node:module` hooks, so the
 * loader builds the executable module graph itself — every artifact file is fetched once,
 * verified against the inventory's per-file digests, its static import specifiers are rewritten,
 * and the verified bytes become an immutable module URL (a `blob:` URL in the browser, `data:`
 * in tests). Evaluation then imports only URLs whose contents this loader produced, so there is
 * no window between verification and evaluation at all — the blob *is* the verified snapshot.
 *
 * Rules (the same honesty ladder as the Node bootstrap, MK3/32 §6):
 *  - files inside the artifact are verified against `fileDigests` (posix path → `sha256:…`);
 *    a changed file is `x3.host/artifact-digest-mismatch`, an unlisted file or an import escaping
 *    the artifact root is `x3.host/execution-load-rejected`;
 *  - without a digest map only the entrypoint is verified (`entrypointDigest`) and its imports
 *    are refused as `x3.host/artifact-not-pinned`;
 *  - bare specifiers resolve through the app-supplied `resolveBare` map. A URL recognized by
 *    `resolvePinned` enters the same digest-verified graph (cross-root extension dependency); an
 *    unrecognized platform URL is reported as **unverified**, the browser twin of `node_modules`
 *    under SB-1. A bare specifier the map does not know is refused;
 *  - only *static* `import`/`export … from` and literal `import('…')` are rewritten. A dynamic
 *    `import(expression)` cannot be verified ahead of evaluation and is refused. A real ES-module
 *    lexer supplies exact source spans, so strings, comments, regex literals and escapes cannot
 *    hide an executable import or make the rewriter modify an unrelated string.
 *
 * The module is runtime-agnostic (no DOM, no `node:`): digesting, fetching and URL minting are
 * injected, so the pipeline is unit-tested in Node with `data:` URLs and really evaluated there.
 */

import { ModkitError } from '@modkitx-x3/core'
import { parse } from 'es-module-lexer/js'

export interface VerifiedLoaderOptions {
  /** Artifact root URL (href); every verified file must live under it. */
  readonly artifactRoot: string
  /** Posix path relative to `artifactRoot` → `sha256:…`, as inventoried. */
  readonly fileDigests?: Readonly<Record<string, string>>
  /** Digest of the entrypoint bytes when no map exists (entrypoint-only verification). */
  readonly entrypointDigest?: string
  /** Fetches the bytes of one artifact file (browser: `fetch` + `arrayBuffer`). */
  readonly fetchBytes: (url: string, signal?: AbortSignal) => Promise<Uint8Array>
  /** Computes `sha256:<hex>` (browser: WebCrypto `crypto.subtle.digest`). */
  readonly digest: (bytes: Uint8Array) => Promise<string>
  /** Mints an immutable module URL for verified source text (browser: `URL.createObjectURL`). */
  readonly createModuleUrl: (source: string) => string
  /** App-supplied module map for bare specifiers (unverified, SB-1); absent → refused. */
  readonly resolveBare?: (specifier: string) => string | undefined
  /**
   * Recognizes mapped URLs owned by another digest-pinned extension root. Recognized modules use
   * the verified graph path; only unrecognized platform dependencies remain SB-1.
   */
  readonly resolvePinned?: (url: string) => VerifiedModuleRoot | undefined
  /** Ceilings: a hostile artifact cannot make the loader unbounded. */
  readonly maxFiles?: number
  readonly maxTotalBytes?: number
  readonly signal?: AbortSignal
}

export interface VerifiedModuleRoot {
  readonly artifactRoot: string
  readonly fileDigests: Readonly<Record<string, string>>
}

export interface VerifiedModuleGraph {
  /** Module URL of the rewritten entrypoint — the only thing evaluation imports. */
  readonly url: string
  /** Artifact-relative paths that were fetched and verified, in evaluation order. */
  readonly verified: readonly string[]
  /** Bare specifiers rewritten to unpinned platform URLs (verified cross-root imports are absent). */
  readonly unverified: readonly string[]
}

const DEFAULT_MAX_FILES = 256
const DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024

function refused(message: string, context?: Record<string, unknown>): ModkitError {
  return new ModkitError({
    code: 'x3.host/execution-load-rejected',
    message,
    ...(context === undefined ? {} : { context }),
  })
}

interface ScannedModuleSpecifier {
  readonly specifier: string
  /** Exact source span containing only the specifier text, without its quotes. */
  readonly start: number
  readonly end: number
}

const STATIC_IMPORT = 1
const DYNAMIC_IMPORT = 2
const IMPORT_META = 3

/**
 * Parse the ES module surface with a real lexer. Regex/comment stripping is unsafe here because
 * comment-looking text inside strings or regex literals can hide a later executable import. The
 * accepted subset intentionally stays narrow: ordinary static imports/re-exports and dynamic
 * imports whose sole argument is a single- or double-quoted string.
 */
function scanModuleImports(source: string): readonly ScannedModuleSpecifier[] {
  let imports: ReturnType<typeof parse>[0]
  try {
    ;[imports] = parse(source)
  } catch (cause) {
    throw refused('module syntax cannot be parsed safely before evaluation', { cause })
  }
  const result: ScannedModuleSpecifier[] = []
  for (const item of imports) {
    if (item.t === IMPORT_META) continue
    if (item.t !== STATIC_IMPORT && item.t !== DYNAMIC_IMPORT) {
      throw refused('source/defer phase imports are outside the verified JavaScript subset', {
        importType: item.t,
      })
    }
    if (item.n === undefined) {
      throw refused(
        'dynamic import with a non-literal specifier cannot be verified before evaluation',
      )
    }
    if (item.t === STATIC_IMPORT) {
      result.push(Object.freeze({ specifier: item.n, start: item.s, end: item.e }))
      continue
    }
    const raw = source.slice(item.s, item.e)
    const quote = raw[0]
    if ((quote !== "'" && quote !== '"') || raw.at(-1) !== quote || item.a !== -1) {
      throw refused('only a single quoted literal is allowed in dynamic import before evaluation')
    }
    result.push(Object.freeze({ specifier: item.n, start: item.s + 1, end: item.e - 1 }))
  }
  return Object.freeze(result)
}

export function scanModuleSpecifiers(source: string): readonly string[] {
  return Object.freeze(scanModuleImports(source).map(item => item.specifier))
}

const isRelative = (specifier: string) =>
  specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')

/**
 * Fetch → verify → rewrite the graph reachable from `entrypoint`, children first. Cycles between
 * artifact files are refused (an immutable-URL graph cannot represent them); the bundled portable
 * codecs are acyclic by construction.
 */
export async function loadVerifiedModuleGraph(
  entrypoint: string,
  options: VerifiedLoaderOptions,
): Promise<VerifiedModuleGraph> {
  interface RootContext {
    readonly root: string
    readonly fileDigests?: Readonly<Record<string, string>>
    readonly entrypointDigest?: string
  }
  const rootContext = (candidate: VerifiedModuleRoot): RootContext => ({
    root: candidate.artifactRoot.endsWith('/')
      ? candidate.artifactRoot
      : `${candidate.artifactRoot}/`,
    fileDigests: candidate.fileDigests,
  })
  const initial: RootContext = {
    root: options.artifactRoot.endsWith('/') ? options.artifactRoot : `${options.artifactRoot}/`,
    ...(options.fileDigests === undefined ? {} : { fileDigests: options.fileDigests }),
    ...(options.entrypointDigest === undefined
      ? {}
      : { entrypointDigest: options.entrypointDigest }),
  }
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES
  const verified: string[] = []
  const unverified = new Set<string>()
  const built = new Map<string, string>() // absolute file URL → module URL
  const visiting = new Set<string>()
  let totalBytes = 0
  let files = 0

  const relativePath = (href: string, context: RootContext): string => {
    if (!href.startsWith(context.root)) {
      throw refused(`module ${href} escapes the artifact root`, { href })
    }
    return decodeURIComponent(href.slice(context.root.length))
  }

  const entryHref = new URL(entrypoint, initial.root).href
  const entryRelative = relativePath(entryHref, initial)

  async function build(href: string, context: RootContext): Promise<string> {
    const existing = built.get(href)
    if (existing !== undefined) return existing
    if (visiting.has(href)) {
      throw refused(
        `import cycle at ${relativePath(href, context)}; an immutable module graph cannot represent it`,
      )
    }
    visiting.add(href)
    const relative = relativePath(href, context)
    if (context.fileDigests === undefined && href !== entryHref) {
      throw new ModkitError({
        code: 'x3.host/artifact-not-pinned',
        message: `the inventory carries no per-file digests, so ${relative} cannot be verified before evaluation`,
        context: { relative },
      })
    }
    files += 1
    if (files > maxFiles) throw refused(`artifact exceeds the loader ceiling of ${maxFiles} files`)
    const bytes = await options.fetchBytes(href, options.signal)
    totalBytes += bytes.byteLength
    if (totalBytes > maxTotalBytes) {
      throw refused(`artifact exceeds the loader ceiling of ${maxTotalBytes} bytes`)
    }
    const expected =
      context.fileDigests === undefined ? context.entrypointDigest : context.fileDigests[relative]
    if (context.fileDigests !== undefined && expected === undefined) {
      throw refused(`${relative} is not part of the inventoried artifact`, { relative })
    }
    if (expected !== undefined && (await options.digest(bytes)) !== expected) {
      throw new ModkitError({
        code: 'x3.host/artifact-digest-mismatch',
        message: `${relative} changed after the inventory recorded it and will not be evaluated`,
        context: { relative },
      })
    }
    let source = new TextDecoder().decode(bytes)
    // children first: every specifier becomes an immutable URL before this file is minted
    const replacements: {
      readonly start: number
      readonly end: number
      readonly value: string
    }[] = []
    for (const scanned of scanModuleImports(source)) {
      const specifier = scanned.specifier
      let target: string
      if (isRelative(specifier)) {
        target = await build(new URL(specifier, href).href, context)
      } else {
        const mapped = options.resolveBare?.(specifier)
        if (mapped === undefined) {
          throw refused(
            `bare specifier «${specifier}» is not in the host module map (dependencies load unverified only through the map, SB-1)`,
            { specifier },
          )
        }
        const pinned = options.resolvePinned?.(mapped)
        if (pinned === undefined) {
          unverified.add(specifier)
          target = mapped
        } else {
          target = await build(new URL(mapped).href, rootContext(pinned))
        }
      }
      // Replace the exact parsed string-literal span, not every lookalike string in the module.
      replacements.push({
        start: scanned.start - 1,
        end: scanned.end + 1,
        value: JSON.stringify(target),
      })
    }
    for (const replacement of replacements.reverse()) {
      source = `${source.slice(0, replacement.start)}${replacement.value}${source.slice(replacement.end)}`
    }
    const url = options.createModuleUrl(source)
    built.set(href, url)
    visiting.delete(href)
    verified.push(relative)
    return url
  }

  const url = await build(entryHref, initial)
  void entryRelative
  return Object.freeze({
    url,
    verified: Object.freeze(verified),
    unverified: Object.freeze([...unverified].sort()),
  })
}
