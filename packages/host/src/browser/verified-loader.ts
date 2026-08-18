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
 *  - bare specifiers resolve through the app-supplied `resolveBare` map and are rewritten to the
 *    returned URL **unverified** — the browser twin of `node_modules` under SB-1 (dependency
 *    digests are SB-4); a bare specifier the map does not know is refused;
 *  - only *static* `import`/`export … from` and literal `import('…')` are rewritten. A dynamic
 *    `import(expression)` cannot be verified ahead of evaluation and is refused. The specifier
 *    scanner is deliberately conservative: a missed rewrite can only leave a relative specifier
 *    inside a base-less module URL, which fails module resolution — mis-parsing degrades to
 *    refusal or a load error, never to unverified execution.
 *
 * The module is runtime-agnostic (no DOM, no `node:`): digesting, fetching and URL minting are
 * injected, so the pipeline is unit-tested in Node with `data:` URLs and really evaluated there.
 */

import { ModkitError } from '@modkitx-x3/core'

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
  /** Ceilings: a hostile artifact cannot make the loader unbounded. */
  readonly maxFiles?: number
  readonly maxTotalBytes?: number
  readonly signal?: AbortSignal
}

export interface VerifiedModuleGraph {
  /** Module URL of the rewritten entrypoint — the only thing evaluation imports. */
  readonly url: string
  /** Artifact-relative paths that were fetched and verified, in evaluation order. */
  readonly verified: readonly string[]
  /** Bare specifiers that were rewritten through the module map (unverified, reported honestly). */
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

/**
 * Static ES module specifier scan. Comments are stripped first (string-aware enough for the
 * fail-closed contract documented above); matched are `import|export … from '…'`, bare
 * `import '…'`, and literal `import('…')`. A non-literal dynamic import refuses the file.
 */
export function scanModuleSpecifiers(source: string): readonly string[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/(^|[^:])\/\/[^\n]*/gu, '$1')
  if (/\bimport\s*\(\s*[^'")\s]/u.test(stripped)) {
    throw refused(
      'dynamic import with a non-literal specifier cannot be verified before evaluation',
    )
  }
  const specifiers: string[] = []
  const pattern =
    /\b(?:import|export)\s+(?:[\s\S]*?\bfrom\s+)?(['"])([^'"\n]+)\1|\bimport\s*\(\s*(['"])([^'"\n]+)\3\s*\)/gu
  for (const match of stripped.matchAll(pattern)) {
    const specifier = match[2] ?? match[4]
    if (specifier !== undefined) specifiers.push(specifier)
  }
  return specifiers
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
  const root = options.artifactRoot.endsWith('/')
    ? options.artifactRoot
    : `${options.artifactRoot}/`
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES
  const verified: string[] = []
  const unverified = new Set<string>()
  const built = new Map<string, string>() // absolute file URL → module URL
  const visiting = new Set<string>()
  let totalBytes = 0
  let files = 0

  const relativePath = (href: string): string => {
    if (!href.startsWith(root)) {
      throw refused(`module ${href} escapes the artifact root`, { href })
    }
    return decodeURIComponent(href.slice(root.length))
  }

  const entryHref = new URL(entrypoint, root).href
  const entryRelative = relativePath(entryHref)

  async function build(href: string): Promise<string> {
    const existing = built.get(href)
    if (existing !== undefined) return existing
    if (visiting.has(href)) {
      throw refused(
        `import cycle at ${relativePath(href)}; an immutable module graph cannot represent it`,
      )
    }
    visiting.add(href)
    const relative = relativePath(href)
    if (options.fileDigests === undefined && href !== entryHref) {
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
      options.fileDigests === undefined ? options.entrypointDigest : options.fileDigests[relative]
    if (options.fileDigests !== undefined && expected === undefined) {
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
    for (const specifier of scanModuleSpecifiers(source)) {
      let target: string
      if (isRelative(specifier)) {
        target = await build(new URL(specifier, href).href)
      } else {
        const mapped = options.resolveBare?.(specifier)
        if (mapped === undefined) {
          throw refused(
            `bare specifier «${specifier}» is not in the host module map (dependencies load unverified only through the map, SB-1)`,
            { specifier },
          )
        }
        unverified.add(specifier)
        target = mapped
      }
      source = source.split(`'${specifier}'`).join(`'${target}'`)
      source = source.split(`"${specifier}"`).join(`"${target}"`)
    }
    const url = options.createModuleUrl(source)
    built.set(href, url)
    visiting.delete(href)
    verified.push(relative)
    return url
  }

  const url = await build(entryHref)
  void entryRelative
  return Object.freeze({
    url,
    verified: Object.freeze(verified),
    unverified: Object.freeze([...unverified].sort()),
  })
}
