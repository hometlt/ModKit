/**
 * Statically linked extensions — `import` as the connection mechanism.
 *
 * The dynamic lane (`loadExtensionRoots`, the web catalog) treats an extension as an *artifact*:
 * files on disk or over HTTP, digest-verified, executed worker-brokered. This module is the other
 * lane the owner asked for: an extension the application imported at build time, present in the
 * process as a module namespace, with no files to verify and no worker to load them in.
 *
 * The trust decision is the import itself. A caller who wrote
 * importing an extension's own `linked` entry has linked that code into their bundle exactly
 * as they linked their own; refusing to run it in-process while running the rest of the bundle
 * in-process would be theatre. So linked contributions run under `trusted-in-process`, the input
 * carries `allowTrustedInProcess: true` **because linking is the artifact-level trust decision**,
 * and the gate still emits its audit notice — this is an audit boundary, not a sandbox, and the
 * notice says so every time.
 *
 * What keeps this honest rather than a bypass:
 *  - only contributions that *declare* a `trusted-in-process` variant are linkable; a
 *    contribution authored worker-only (the PNG encoder writer, for one) is excluded with its
 *    reason, never silently re-declared;
 *  - the linked variant's entrypoint must be present in the module map, or the definition refuses
 *    loudly at build time — there is no path from here to a dynamic import of unverified bytes;
 *  - entrypoint URLs are minted through the same `resolveContainedEntrypoint` the security gate
 *    uses, so the registry key and the gate's resolution cannot drift apart.
 */

import { ModkitError } from '@modkitx-x3/core'
import type { ExtensionInput } from './inventory.js'
import { resolveContainedEntrypoint } from './security/entrypoint.js'

/** A module namespace as `import * as ns` produces it. */
export type LinkedModule = Readonly<Record<string, unknown>>

export interface LinkedContributionInit {
  /** Manifest path inside the (virtual) artifact, e.g. `contributions/codec-png.json`. */
  readonly path: string
  /**
   * The authored manifest document. The linked definition retains only variants that explicitly
   * declare `trusted-in-process`; worker-only contributions become named exclusions.
   */
  readonly manifest: unknown
  /** Optional artifact-lane digest. Static imports are already the linked lane's trust decision. */
  readonly digest?: string
}

export interface LinkedContributionExclusion {
  readonly path: string
  /** Why this contribution cannot be linked (e.g. it declares no trusted-in-process variant). */
  readonly reason: string
}

export interface LinkedExtensionInit {
  /** Diagnostic label — where this definition was generated from. */
  readonly source: string
  /** The extension's `package.json`, verbatim (its `modkit` block is the identity). */
  readonly packageJson: unknown
  /** Relative file listing; derived from contributions and modules when omitted. */
  readonly files?: readonly string[]
  readonly contributions: readonly LinkedContributionInit[]
  /** Contributions of the authored extension that the linked build cannot carry, with reasons. */
  readonly excluded?: readonly LinkedContributionExclusion[]
  /** Optional artifact-lane digest. It does not add evidence to already imported code. */
  readonly artifactDigest?: string
  /** Entrypoint path (as authored, e.g. `./src/index.js`) → imported module namespace. */
  readonly modules: Readonly<Record<string, LinkedModule>>
}

export interface LinkedExtension {
  /** `publisher/id` from the package's `modkit` block. */
  readonly coordinate: string
  readonly input: ExtensionInput
  /** Resolved entrypoint href → module, for the in-process backend's registry. */
  readonly moduleEntries: readonly (readonly [string, LinkedModule])[]
  readonly excluded: readonly LinkedContributionExclusion[]
}

/**
 * A product module compiled into an application rather than installed by Extension Manager.
 *
 * Built-ins intentionally reuse the linked contribution lane: contracts, security decisions and
 * provider resolution stay identical, while the explicit kind lets application and status UI keep
 * product modules separate from user-managed extensions.
 */
export interface BuiltinModule extends LinkedExtension {
  readonly kind: 'builtin'
}

export interface BuiltinModuleInit extends Omit<LinkedExtensionInit, 'packageJson' | 'source'> {
  /** Stable protocol coordinate used for contribution ownership and diagnostics. */
  readonly coordinate: `${string}/${string}`
  /** The package metadata shown by diagnostics and release tooling. */
  readonly packageJson?: Readonly<Record<string, unknown>>
  /** Diagnostic label; defaults to `builtin:<coordinate>`. */
  readonly source?: string
}

interface VariantShape {
  readonly entrypoint?: unknown
  readonly executionProfile?: unknown
}

const variantsOf = (manifest: unknown): readonly VariantShape[] => {
  const list = (manifest as { runtimeVariants?: unknown }).runtimeVariants
  return Array.isArray(list) ? (list as VariantShape[]) : []
}

const refuse = (message: string, context: Record<string, string>): never => {
  throw new ModkitError({ code: 'x3.host/linked-extension-invalid', message, context })
}

/**
 * Build one linked extension from generated (or hand-assembled) data plus imported modules.
 *
 * Pure and platform-neutral: digests arrive precomputed, URLs are minted deterministically, and
 * the result is inert data plus module references — nothing here imports, fetches or hashes.
 */
export function defineLinkedExtension(init: LinkedExtensionInit): LinkedExtension {
  const modkit = (init.packageJson as { modkit?: { publisher?: unknown; id?: unknown } }).modkit
  const publisher = typeof modkit?.publisher === 'string' ? modkit.publisher : undefined
  const id = typeof modkit?.id === 'string' ? modkit.id : undefined
  if (publisher === undefined || id === undefined) {
    refuse('linked extension package.json carries no modkit publisher/id', {
      source: init.source,
    })
  }
  const coordinate = `${publisher}/${id}`
  const automaticExcluded: LinkedContributionExclusion[] = []
  const contributions = init.contributions.flatMap(contribution => {
    const variants = variantsOf(contribution.manifest)
    if (variants.length === 0) return [contribution]
    const trusted = variants.filter(variant => variant.executionProfile === 'trusted-in-process')
    if (trusted.length === 0) {
      const manifestId = (contribution.manifest as { id?: unknown }).id
      automaticExcluded.push({
        path: contribution.path,
        reason: `${typeof manifestId === 'string' ? manifestId : contribution.path} declares no trusted-in-process variant, and linked code runs in-process by definition`,
      })
      return []
    }
    const manifest = contribution.manifest as Readonly<Record<string, unknown>>
    return [{ ...contribution, manifest: { ...manifest, runtimeVariants: trusted } }]
  })
  const files =
    init.files ??
    Object.freeze([
      'package.json',
      ...contributions.map(item => item.path),
      ...Object.keys(init.modules).map(path => path.replace(/^\.\//u, '')),
    ])
  const artifactDigest = init.artifactDigest ?? `linked:${coordinate}`
  /*
   * The authority host is the coordinate with `/` flattened: URL authorities cannot carry one,
   * and the coordinate grammar (`publisher/id`, both dot-separated words) maps injectively.
   */
  const artifactRoot = new URL(`modkit-linked://${publisher}.${id}/`.toLowerCase())

  const moduleEntries: (readonly [string, LinkedModule])[] = []
  for (const contribution of contributions) {
    for (const variant of variantsOf(contribution.manifest)) {
      if (variant.executionProfile !== 'trusted-in-process') {
        refuse('a linked contribution may declare only trusted-in-process variants', {
          source: init.source,
          path: contribution.path,
        })
      }
      const entrypoint = typeof variant.entrypoint === 'string' ? variant.entrypoint : ''
      const module = init.modules[entrypoint]
      if (module === undefined) {
        refuse(`linked variant entrypoint «${entrypoint}» has no imported module`, {
          source: init.source,
          path: contribution.path,
        })
        continue
      }
      // the same resolution the gate performs, so the backend's key cannot drift from it
      moduleEntries.push([resolveContainedEntrypoint(artifactRoot, entrypoint).href, module])
    }
  }

  const input: ExtensionInput = Object.freeze({
    source: init.source,
    containers: Object.freeze({ packageJson: init.packageJson }),
    files: Object.freeze([...files]),
    documents: new Map(contributions.map(item => [item.path, item.manifest])),
    documentDigests: new Map(
      contributions.map(item => [item.path, item.digest ?? `linked:${coordinate}:${item.path}`]),
    ),
    artifact: Object.freeze({
      inventoryRecordId: `linked:${coordinate}`,
      artifactDigest,
      artifactRoot,
      // the bytes cannot change under a linked artifact: they are the caller's own bundle
      verifyArtifactDigest: (expected: string) => expected === artifactDigest,
    }),
    /*
     * `allowTrustedInProcess: true` is the point, not an oversight: linking is the artifact-level
     * trust decision (see the module header). The gate still refuses any variant that is not
     * declared `trusted-in-process`, and still emits its audit notice on every activation.
     */
    execution: Object.freeze({ origin: 'bundled' as const, allowTrustedInProcess: true }),
  })

  return Object.freeze({
    coordinate,
    input,
    moduleEntries: Object.freeze(moduleEntries),
    excluded: Object.freeze([...automaticExcluded, ...(init.excluded ?? [])]),
  })
}

/** Define a statically imported product module without presenting it as an installable extension. */
export function defineBuiltinModule(init: BuiltinModuleInit): BuiltinModule {
  const parts = init.coordinate.split('/')
  if (parts.length !== 2 || parts.some(part => part.length === 0)) {
    refuse('built-in module coordinate must be publisher/id', { coordinate: init.coordinate })
  }
  const [publisher = '', id = ''] = parts
  const packageJson = init.packageJson ?? {}
  const existingModkit = (packageJson as { readonly modkit?: unknown }).modkit
  const modkit =
    typeof existingModkit === 'object' && existingModkit !== null
      ? (existingModkit as Readonly<Record<string, unknown>>)
      : {}
  const linked = defineLinkedExtension({
    source: init.source ?? `builtin:${init.coordinate}`,
    packageJson: {
      ...packageJson,
      modkit: {
        ...modkit,
        schemaVersion: modkit.schemaVersion ?? 1,
        publisher,
        id,
        contributionManifests:
          modkit.contributionManifests ??
          init.contributions.map(item => `./${item.path.replace(/^\.\//u, '')}`),
      },
    },
    ...(init.files === undefined ? {} : { files: init.files }),
    contributions: init.contributions,
    ...(init.excluded === undefined ? {} : { excluded: init.excluded }),
    artifactDigest: init.artifactDigest ?? `builtin:${init.coordinate}`,
    modules: init.modules,
  })
  return Object.freeze({ ...linked, kind: 'builtin' as const })
}

export interface LinkedExtensionSet {
  readonly inputs: readonly ExtensionInput[]
  /** Entrypoint href → module, the registry a linked in-process backend serves from. */
  readonly modules: ReadonlyMap<string, LinkedModule>
  readonly coordinates: readonly string[]
  readonly excluded: readonly (LinkedContributionExclusion & { readonly coordinate: string })[]
}

/** Collate linked extensions for a composition: inputs in order, one module registry, no dupes. */
export function linkedExtensionInputs(linked: readonly LinkedExtension[]): LinkedExtensionSet {
  const modules = new Map<string, LinkedModule>()
  const seen = new Set<string>()
  const inputs: ExtensionInput[] = []
  const coordinates: string[] = []
  const excluded: (LinkedContributionExclusion & { coordinate: string })[] = []
  for (const extension of linked) {
    if (seen.has(extension.coordinate)) {
      // first wins, exactly as the directory loaders resolve a coordinate conflict
      continue
    }
    seen.add(extension.coordinate)
    inputs.push(extension.input)
    coordinates.push(extension.coordinate)
    for (const [href, module] of extension.moduleEntries) modules.set(href, module)
    for (const item of extension.excluded)
      excluded.push({ ...item, coordinate: extension.coordinate })
  }
  return Object.freeze({
    inputs: Object.freeze(inputs),
    modules,
    coordinates: Object.freeze(coordinates),
    excluded: Object.freeze(excluded),
  })
}
