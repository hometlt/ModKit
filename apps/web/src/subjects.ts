/**
 * The PWA's product open path (S6): bundled extensions attested at build time (the generated
 * catalog), served under the app origin, activated `worker-brokered` in module workers through
 * the browser worker backend, and opened by the one host pipeline (`openSubject`) for the
 * **worker realm's target** — exactly the shape Electron uses, with the browser as the host.
 *
 * Nothing here evaluates extension code on the page thread: the execution registry holds the
 * worker backend only, and the gate refuses (never downgrades) a variant that has no boundary in
 * this host. DOM globals are injected structurally so this file is unit-tested in Node with
 * fakes and used unchanged in the page.
 */

import type { Diagnostic } from '@modkitx-x3/core'
import type {
  ArtifactByteSource,
  OpenIntent,
  PermissionGrant,
  ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  createHostComposition,
  openSubject,
  type ExecutionBackendRegistry,
  type ExtensionInput,
  type HostComposition,
  type OpenSubjectResult,
} from '@modkitx-x3/host'
import {
  createBrowserExecutionBackends,
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
  createWebTopology,
  probeWebFacilities,
  WEB_MAIN_REALM,
  WEB_WORKER_REALM,
  type WebFacilityProbe,
  type WebRuntimeIdentity,
} from './index.js'

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
    execution: { origin: 'bundled', allowTrustedInProcess: false },
  }))
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
  readonly identity: WebRuntimeIdentity
  readonly dom: WebDomGlobals
  readonly probe?: WebFacilityProbe
  /** Overrides the module map (tests point bare specifiers at file: URLs). */
  readonly moduleMap?: Readonly<Record<string, string>>
  readonly workerUrl?: string
  readonly policy?: BrowserWorkerPolicy
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

export interface WebSubjectServices {
  readonly main: HostComposition
  readonly worker: HostComposition
  readonly executionBackends: ExecutionBackendRegistry
  /** Execution profiles this host can honour — `worker-brokered` only. */
  readonly executionProfiles: readonly string[]
  /** Lowercase extension hints for the picker; detection remains inventory-owned. */
  readonly supportedExtensions: readonly string[]
  open(request: {
    readonly source: ArtifactByteSource
    readonly path: string
    readonly mediaType?: string
    readonly intent: Exclude<OpenIntent, 'probe'>
    readonly grant: PermissionGrant
    readonly budget: ResourceBudget
    readonly signal?: AbortSignal
  }): Promise<OpenSubjectResult>
}

export async function createWebSubjectServices(
  options: WebSubjectServicesOptions,
): Promise<WebSubjectServices> {
  const probe = options.probe ?? probeWebFacilities()
  const topology = createWebTopology(options.identity, probe)
  const extensions = catalogToExtensionInputs(options.catalog, options.baseUrl)
  const executionBackends = createBrowserExecutionBackends({
    workerUrl: options.workerUrl ?? new URL(WEB_WORKER_ENTRY, options.baseUrl).href,
    Worker: options.dom.Worker,
    MessageChannel: options.dom.MessageChannel,
    fetch: options.dom.fetch,
    subtle: options.dom.subtle,
    Blob: options.dom.Blob,
    objectUrls: options.dom.objectUrls,
    moduleMap: options.moduleMap ?? resolveModuleMap(options.baseUrl),
    policy: options.policy ?? DEFAULT_BROWSER_WORKER_POLICY,
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })
  const [main, worker] = await Promise.all([
    createHostComposition({ topology, realmId: WEB_MAIN_REALM, extensions, executionBackends }),
    createHostComposition({ topology, realmId: WEB_WORKER_REALM, extensions, executionBackends }),
  ])
  const supportedExtensions = Object.freeze(
    [
      ...new Set(
        main.inventory.extensions.flatMap(extension =>
          extension.contributions.flatMap(contribution => {
            const manifest = contribution.manifest
            if (manifest?.contract.id !== 'org.modkitx/codec-contribution') return []
            const spec = manifest.spec as { readonly match?: { readonly extensions?: unknown } }
            return Array.isArray(spec.match?.extensions)
              ? spec.match.extensions.filter(
                  (value): value is string => typeof value === 'string' && value.length > 0,
                )
              : []
          }),
        ),
      ),
    ].sort(),
  )
  const services: WebSubjectServices = {
    main,
    worker,
    executionBackends,
    executionProfiles: executionBackends.profiles,
    supportedExtensions,
    // codecs are resolved and activated for the worker realm: portable variants, worker-brokered
    open: request =>
      openSubject({
        inventory: main.inventory,
        target: worker.target,
        executionBackends,
        ...request,
      }),
  }
  return Object.freeze(services)
}
