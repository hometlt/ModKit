/**
 * The PWA's product open path (S6): bundled extensions attested at build time (the generated
 * catalog), served under the app origin, activated `worker-brokered` in module workers through
 * the browser worker backend, and opened by the one host pipeline (`openSubject`) for the
 * **worker realm's target** — exactly the shape Electron uses, with the browser as the host.
 *
 * Since S12-web the composition also takes the folders a user granted (`./extension-roots.ts`).
 * They join the same pipeline on the same terms — worker-only, verified per file before
 * evaluation — and differ in exactly one respect, which the UI must keep visible: a catalog
 * digest is a build-time attestation by a third party, a user-folder digest is this page's own
 * measurement of bytes the user pointed it at. Neither buys page-thread execution; nothing here
 * evaluates extension code on the page thread at all, because the execution registry holds the
 * worker backend only and the gate refuses (never downgrades) a variant with no boundary here.
 *
 * DOM globals are injected structurally so this file is unit-tested in Node with fakes and used
 * unchanged in the page.
 */

import type { Diagnostic } from '@modkitx-x3/core'
import type { ServiceContractDefinitionRegistry } from '@modkitx-x3/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  createSubjectServices,
  registerServiceDefinitionsOrThrow,
  serviceDefinitionSurfaces,
  type ExtensionInput,
  type ExtensionOrigin,
  type HostComposition,
  type SubjectServices,
} from '@modkitx-x3/host'
import {
  browserLoaderHooks,
  createBrowserWorkerBackend,
  createDomWorkerRealmFactory,
  DEFAULT_BROWSER_WORKER_POLICY,
  type BrowserBlobConstructorLike,
  type BrowserFetchLike,
  type BrowserMessageChannelConstructorLike,
  type BrowserObjectUrlLike,
  type BrowserSubtleCryptoLike,
  type BrowserWorkerConstructorLike,
  type BrowserWorkerPolicy,
} from '@modkitx-x3/host/browser'
import {
  containerCoordinate,
  extensionCoordinate,
  isUserExtensionUrl,
  NO_USER_EXTENSION_ROOTS,
  type LoadedUserExtensionRoots,
  type UserExtensionRootFailure,
} from './extension-roots.js'
import {
  createWebTopology,
  probeWebFacilities,
  WEB_MAIN_REALM,
  WEB_WORKER_REALM,
  type WebFacilityProbe,
  type WebRuntimeIdentity,
} from './index.js'
import { createWebCommandProtocol, type WebCommandProtocol } from './commands.js'

// ---------------------------------------------------------------------------------------------
// the generated catalog → ExtensionInput

/** Shape of `apps/web/generated/extension-catalog.js` (emitted by scripts/emit-web-catalog.mjs). */
export interface WebExtensionCatalog {
  readonly schemaVersion: 1
  readonly extensions: readonly WebExtensionCatalogEntry[]
  readonly excluded: readonly { readonly name: string; readonly reason: string }[]
}

export interface WebExtensionCatalogEntry {
  readonly name: string
  readonly source: string
  /** Path under the app origin where the artifact files are served (`extensions/<name>/`). */
  readonly artifactRoot: string
  readonly containers: ExtensionInput['containers']
  readonly files: readonly string[]
  readonly documents: readonly (readonly [string, unknown])[]
  readonly documentDigests: readonly (readonly [string, string])[]
  readonly artifact: {
    readonly inventoryRecordId: string
    readonly artifactDigest: string
    readonly fileDigests: Readonly<Record<string, string>>
  }
}

/**
 * Turns the catalog into host inputs. `verifyArtifactDigest` compares against the build-time
 * attestation: the page cannot re-hash a served artifact cheaply, and it does not need to — the
 * browser worker backend re-verifies every file's bytes against `fileDigests` right before it
 * becomes evaluable (verify-then-snapshot), so a served file that drifted from the attestation is
 * refused at load with `x3.host/artifact-digest-mismatch`. Nothing is trusted in-process.
 */
export function catalogToExtensionInputs(
  catalog: WebExtensionCatalog,
  baseUrl: string | URL,
  origin: ExtensionOrigin = 'bundled',
): readonly ExtensionInput[] {
  const base = new URL(baseUrl)
  return catalog.extensions.map(entry => ({
    source: entry.source,
    containers: entry.containers,
    files: entry.files,
    documents: new Map(entry.documents),
    documentDigests: new Map(entry.documentDigests),
    artifact: {
      inventoryRecordId: entry.artifact.inventoryRecordId,
      artifactDigest: entry.artifact.artifactDigest,
      artifactRoot: new URL(entry.artifactRoot, base),
      verifyArtifactDigest: expected => expected === entry.artifact.artifactDigest,
      fileDigests: entry.artifact.fileDigests,
    },
    execution: { origin, allowTrustedInProcess: false },
  }))
}

/** A catalog fetched from a deployer-approved URL, resolved relative to its own document. */
export interface WebExtensionCatalogSource {
  readonly catalog: WebExtensionCatalog
  readonly baseUrl: string | URL
}

/**
 * Coordinates the attested catalog claims.
 *
 * Pass these to `loadUserExtensionRoots` as `claimed`: the catalog is loaded first, so a user
 * folder declaring the same `publisher/id` is the second claimant and is reported rather than
 * silently shadowing (or being shadowed by) the bundled one.
 */
export function catalogCoordinates(catalog: WebExtensionCatalog): readonly string[] {
  const coordinates: string[] = []
  for (const entry of catalog.extensions) {
    const coordinate = containerCoordinate(entry.containers)
    if (coordinate !== undefined) coordinates.push(coordinate)
  }
  return Object.freeze(coordinates)
}

// ---------------------------------------------------------------------------------------------
// the worker module map

/**
 * Bare specifiers a codec module may import inside the worker, mapped to the vendor bundles the
 * build emits (apps/web/scripts/build.mjs, one esbuild graph with code splitting so `core` is one
 * instance across the vendors and the worker entry). Unverified by design (SB-1, dependencies);
 * anything not listed here is refused by the loader.
 */
export const WEB_WORKER_MODULE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '@modkitx-x3/codec-kit': 'vendor/codec-kit/index.js',
  '@modkitx-x3/codec-kit/text': 'vendor/codec-kit/text/index.js',
  '@modkitx-x3/core': 'vendor/core/index.js',
  '@modkitx-x3/sdk': 'vendor/sdk/index.js',
})

/** The published worker entry as the build serves it. */
export const WEB_WORKER_ENTRY = 'worker-entry.js'

export function resolveModuleMap(
  baseUrl: string | URL,
  map: Readonly<Record<string, string>> = WEB_WORKER_MODULE_MAP,
): Readonly<Record<string, string>> {
  const base = new URL(baseUrl)
  return Object.freeze(
    Object.fromEntries(
      Object.entries(map).map(([specifier, path]) => [specifier, new URL(path, base).href]),
    ),
  )
}

// ---------------------------------------------------------------------------------------------
// subject services

export interface WebDomGlobals {
  readonly fetch: BrowserFetchLike
  readonly subtle: BrowserSubtleCryptoLike
  readonly Blob: BrowserBlobConstructorLike
  readonly objectUrls: BrowserObjectUrlLike
  readonly Worker: BrowserWorkerConstructorLike
  readonly MessageChannel: BrowserMessageChannelConstructorLike
}

export interface WebSubjectServicesOptions {
  /** Origin + base path the app is served from; catalog roots and the module map resolve here. */
  readonly baseUrl: string | URL
  readonly catalog: WebExtensionCatalog
  /** Additional attested catalogs. Their code remains worker-only and is inventoried as installed. */
  readonly additionalCatalogs?: readonly WebExtensionCatalogSource[]
  /**
   * Folders the user granted, already loaded by `loadUserExtensionRoots`.
   *
   * Taking the whole load result rather than bare inputs is deliberate: it carries the `fetch`
   * that answers the synthetic artifact URLs, and installing that fetch is not something a
   * composition root should be able to forget. The catalog is loaded first, so a user folder
   * claiming a coordinate the catalog already claims is dropped here too and reported on
   * `userExtensionConflicts` — first wins, second reported, exactly as the Node loader resolves it.
   */
  readonly userExtensions?: LoadedUserExtensionRoots
  readonly identity: WebRuntimeIdentity
  readonly dom: WebDomGlobals
  readonly probe?: WebFacilityProbe
  /**
   * Ceilings the verified loader applies to one artifact's module graph at activation. Left
   * unset it keeps the loader's own defaults; a host that serves user folders may want them
   * tighter, and this is the only way to reach them.
   */
  readonly loaderLimits?: {
    readonly maxFiles?: number
    readonly maxTotalBytes?: number
  }
  /** Overrides the module map (tests point bare specifiers at file: URLs). */
  readonly moduleMap?: Readonly<Record<string, string>>
  readonly workerUrl?: string
  readonly policy?: BrowserWorkerPolicy
  /**
   * Service-contract definitions, exactly as the Node twin takes them: `'bundled'` (default)
   * registers the attested catalog's own definitions into a bundled registry, a registry of the
   * root's own is used as given, and `false` registers none.
   *
   * This is what a codec with a nested provider needs. The structured-text codecs resolve a syntax
   * provider while they open (`common.text/syntax`), and without a definition registry that
   * resolution fails with `x3.host/rpc-bad-argument: arguments do not name a registered surface` —
   * the file simply does not open. Only inputs this host already vouches for reach the bundled
   * registry: it is fed the attested catalog's inventory and nothing else.
   */
  readonly serviceDefinitions?: 'bundled' | false | ServiceContractDefinitionRegistry
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

/** The host's subject services (S7) — `executionProfiles` is `worker-brokered` only here. */
export interface WebSubjectServices extends SubjectServices {
  readonly main: HostComposition
  readonly worker: HostComposition
  /** User folders dropped here because the catalog already claims their coordinate. */
  readonly userExtensionConflicts: readonly UserExtensionRootFailure[]
  /** Versioned shared commands bound to opaque handles authorized in this browser realm. */
  readonly commands: WebCommandProtocol
  /** Terminal page lifecycle: revoke command handles and abort every in-flight command. */
  dispose(): Promise<void>
}

export async function createWebSubjectServices(
  options: WebSubjectServicesOptions,
): Promise<WebSubjectServices> {
  const probe = options.probe ?? probeWebFacilities()
  const topology = createWebTopology(options.identity, probe)
  const catalogInputs = [
    ...catalogToExtensionInputs(options.catalog, options.baseUrl),
    ...(options.additionalCatalogs ?? []).flatMap(source =>
      catalogToExtensionInputs(source.catalog, source.baseUrl, 'installed'),
    ),
  ]
  const user = options.userExtensions ?? NO_USER_EXTENSION_ROOTS
  const protectedPlatformModuleMap = resolveModuleMap(options.baseUrl)
  const suppliedModuleMap = options.moduleMap ?? protectedPlatformModuleMap
  const platformConflictedRoots = new Set<string>()
  const platformModuleConflicts: UserExtensionRootFailure[] = []
  for (const specifier of Object.keys(user.moduleMap)) {
    if (!Object.hasOwn(protectedPlatformModuleMap, specifier)) continue
    const owner = user.moduleMapOwners[specifier]
    if (owner === undefined || platformConflictedRoots.has(owner)) continue
    platformConflictedRoots.add(owner)
    platformModuleConflicts.push({
      root: owner,
      rootId: owner,
      code: 'x3.host/extension-module-map-conflict',
      message: `extension root exports protected platform specifier «${specifier}» and is refused`,
    })
  }
  // First wins, second reported. A caller that passed the catalog's coordinates as `claimed`
  // has already seen these; a caller that did not still cannot end up with two loaded claimants,
  // because resolution order would then decide which extension a user actually gets.
  const claimed = new Set<string>()
  for (const input of catalogInputs) {
    const coordinate = extensionCoordinate(input)
    if (coordinate !== undefined) claimed.add(coordinate)
  }
  const userInputs: ExtensionInput[] = []
  const userExtensionConflicts: UserExtensionRootFailure[] = [...platformModuleConflicts]
  for (const [index, input] of user.inputs.entries()) {
    const rootId = user.rootIds[index] ?? input.source
    if (platformConflictedRoots.has(rootId)) continue
    const coordinate = user.coordinates[index] ?? extensionCoordinate(input)
    if (coordinate !== undefined && claimed.has(coordinate)) {
      userExtensionConflicts.push({
        root: input.source,
        rootId,
        code: 'x3.host/extension-coordinate-conflict',
        message: `«${coordinate}» is already loaded from another root; this one is ignored`,
      })
      continue
    }
    if (coordinate !== undefined) claimed.add(coordinate)
    userInputs.push(input)
  }
  const extensions = [...catalogInputs, ...userInputs]
  const definitions =
    options.serviceDefinitions === false
      ? undefined
      : options.serviceDefinitions === undefined || options.serviceDefinitions === 'bundled'
        ? createBundledServiceDefinitionRegistry()
        : options.serviceDefinitions
  /*
   * The artifact byte source. `user.serve` answers exactly the synthetic
   * `https://user-extension.invalid/<root>/…` URLs of the folders that loaded, from the granted
   * handles; everything else is the page's own fetch. The verified loader, the digests and the
   * blob module URLs are untouched — a user folder is a different *source of bytes*, not a
   * different loading path, which is why there is no second, unverified way in.
   */
  const pageFetch = options.dom.fetch
  const fetch: BrowserFetchLike = (url, init) =>
    isUserExtensionUrl(url) ? user.serve(url, init) : pageFetch(url, init)
  const moduleMapEntries = new Map(Object.entries(suppliedModuleMap))
  for (const specifier of Object.keys(user.moduleMap)) {
    if (!Object.hasOwn(protectedPlatformModuleMap, specifier)) moduleMapEntries.delete(specifier)
  }
  for (const [specifier, url] of Object.entries(user.moduleMap)) {
    const owner = user.moduleMapOwners[specifier]
    if (owner === undefined || platformConflictedRoots.has(owner)) continue
    moduleMapEntries.set(specifier, url)
  }
  const moduleMap = Object.freeze(Object.fromEntries(moduleMapEntries))
  const verifiedModuleRoots = user.verifiedModuleRoots.filter(
    root => !platformConflictedRoots.has(root.rootId),
  )
  /*
   * Composed by hand rather than through `createBrowserExecutionBackends` for one reason: that
   * helper does not forward the verified loader's `maxFiles`/`maxTotalBytes`, and a host that
   * loads folders it did not build needs those ceilings reachable. Everything else here is that
   * helper's body verbatim; if the host package starts forwarding them, this collapses back to
   * the one call.
   */
  const loaderHooks = browserLoaderHooks({
    fetch,
    subtle: options.dom.subtle,
    Blob: options.dom.Blob,
    objectUrls: options.dom.objectUrls,
    moduleMap,
    verifiedModuleRoots,
  })
  const executionBackends = createExecutionBackendRegistry([
    createBrowserWorkerBackend({
      realm: createDomWorkerRealmFactory({
        workerUrl: options.workerUrl ?? new URL(WEB_WORKER_ENTRY, options.baseUrl).href,
        Worker: options.dom.Worker,
        MessageChannel: options.dom.MessageChannel,
        ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
      }),
      loader: {
        ...loaderHooks,
        ...(options.loaderLimits?.maxFiles === undefined
          ? {}
          : { maxFiles: options.loaderLimits.maxFiles }),
        ...(options.loaderLimits?.maxTotalBytes === undefined
          ? {}
          : { maxTotalBytes: options.loaderLimits.maxTotalBytes }),
      },
      policy: options.policy ?? DEFAULT_BROWSER_WORKER_POLICY,
      // Bound late: definitions are inventoried after the backends exist, and workers read the
      // surfaces per spawn.
      ...(definitions === undefined
        ? {}
        : { foreignSurfaces: () => serviceDefinitionSurfaces(definitions) }),
      ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    }),
  ])
  const [main, worker] = await Promise.all([
    createHostComposition({ topology, realmId: WEB_MAIN_REALM, extensions, executionBackends }),
    createHostComposition({ topology, realmId: WEB_WORKER_REALM, extensions, executionBackends }),
  ])
  // Fails closed: one rejected definition owner is a refused bootstrap, never a half-defined host.
  if (definitions !== undefined)
    await registerServiceDefinitionsOrThrow(main.inventory, definitions)
  // codecs are resolved against main's inventory and activated for the worker realm: portable
  // variants, worker-brokered
  const services = createSubjectServices({
    inventory: main.inventory,
    target: worker.target,
    executionBackends,
    ...(definitions === undefined ? {} : { serviceDefinitions: definitions }),
  })
  const commands = createWebCommandProtocol(services)
  return Object.freeze({
    ...services,
    commands,
    dispose: () => commands.dispose(),
    main,
    worker,
    userExtensionConflicts: Object.freeze(userExtensionConflicts),
  })
}
