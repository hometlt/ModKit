/**
 * Subject services — the one product shape every host uses to open subjects (S7).
 *
 * Electron, the PWA, the CLI, the server and the automation host all do the same thing after
 * composing their realms: hold the inventory of the privileged realm, resolve and activate codecs
 * for the realm they *run* in (worker threads / module workers), and hand the result of
 * `openSubject` to whoever asked. Before S7 each host re-implemented that in place (and two of
 * them copied the extension-hint extraction). This module is the single implementation; the
 * hosts keep only what is theirs — topology, realm ids, policy, the way they load extensions.
 *
 * Nothing here decides trust: `allowTrustedInProcess` stays on each `ExtensionInput`, the gate
 * refuses (never downgrades) a variant that has no executable boundary for the target, and the
 * bundled definition registry below is only for inputs the host already vouches for.
 */

import { ModkitError, type Diagnostic } from '@modkitx-x3/core'
import type {
  ArtifactByteSource,
  DefinitionInventoryResult,
  HostPolicy,
  OpenIntent,
  PermissionGrant,
  ResourceBudget,
  RuntimeTarget,
  ServiceContractDefinitionRegistry,
  ServiceFacetMatcherProfile,
} from '@modkitx-x3/sdk'
import type { DataSourceSurfaceSource } from './execution/index.js'
import type { ExecutionBackendRegistry } from './execution/backend.js'
import type { Inventory } from './inventory.js'
import {
  createServiceContractDefinitionRegistry,
  createServiceFacetMatcherProfileRegistry,
  registerServiceContractDefinitionsFromInventory,
} from './service-definitions.js'
import { openSubject, type OpenSubjectResult } from './subject-open.js'

// ---------------------------------------------------------------------------------------------
// the request every host accepts

/** One open request as the products issue it; `probe` is the host's own two-phase step. */
export interface SubjectOpenRequest {
  readonly source: ArtifactByteSource
  readonly path: string
  readonly mediaType?: string
  readonly intent: Exclude<OpenIntent, 'probe'>
  readonly grant: PermissionGrant
  readonly budget: ResourceBudget
  readonly signal?: AbortSignal
}

export interface SubjectServices {
  /** The inventory subjects are resolved against (the privileged realm's). */
  readonly inventory: Inventory
  /** The target codecs are activated for (the realm they run in). */
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  /** Execution profiles the registry can honour (`worker-brokered` = codecs run in workers). */
  readonly executionProfiles: readonly string[]
  /** Lowercase extension hints for pickers/shell registration; detection stays inventory-owned. */
  readonly supportedExtensions: readonly string[]
  /** Definitions the sessions' service arms resolve against, when the host registered any. */
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
  open(request: SubjectOpenRequest): Promise<OpenSubjectResult>
}

export interface SubjectServicesOptions {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
  readonly policy?: HostPolicy
  readonly minimumConfidence?: number
  readonly maxCandidates?: number
}

/**
 * The extension hints of every codec contribution in the inventory (`spec.match.extensions`),
 * lowercase, unique, sorted. A hint for a picker — never a detection decision.
 */
export function supportedExtensionHints(inventory: Inventory): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        inventory.extensions.flatMap(extension =>
          extension.contributions.flatMap(contribution => {
            const manifest = contribution.manifest
            if (manifest?.contract.id !== 'org.modkitx/codec-contribution') return []
            const spec = manifest.spec as { readonly match?: { readonly extensions?: unknown } }
            return Array.isArray(spec.match?.extensions)
              ? spec.match.extensions.flatMap(value =>
                  typeof value === 'string' && value.length > 0 ? [value.toLowerCase()] : [],
                )
              : []
          }),
        ),
      ),
    ].sort(),
  )
}

/** Bind an inventory, a target and a backend registry into the product `open`. */
export function createSubjectServices(options: SubjectServicesOptions): SubjectServices {
  const fixed = {
    inventory: options.inventory,
    target: options.target,
    executionBackends: options.executionBackends,
    ...(options.serviceDefinitions === undefined
      ? {}
      : { serviceDefinitions: options.serviceDefinitions }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.minimumConfidence === undefined
      ? {}
      : { minimumConfidence: options.minimumConfidence }),
    ...(options.maxCandidates === undefined ? {} : { maxCandidates: options.maxCandidates }),
  }
  const services: SubjectServices = {
    inventory: options.inventory,
    target: options.target,
    executionBackends: options.executionBackends,
    executionProfiles: options.executionBackends.profiles,
    supportedExtensions: supportedExtensionHints(options.inventory),
    ...(options.serviceDefinitions === undefined
      ? {}
      : { serviceDefinitions: options.serviceDefinitions }),
    open: request => openSubject({ ...fixed, ...request }),
  }
  return Object.freeze(services)
}

// ---------------------------------------------------------------------------------------------
// service-contract definitions of a bundled inventory

export interface BundledServiceDefinitionRegistryOptions {
  /** Additional facet matcher profiles beyond the built-in facetless v1. */
  readonly matcherProfiles?: readonly ServiceFacetMatcherProfile[]
}

/**
 * A definition registry for inputs the host already vouches for (its generated first-party
 * catalog): every inventoried owner is accepted as the namespace owner of what it defines and
 * schema refs are not validated here. Installed/linked extensions must never be promoted through
 * this registry — they need an explicit namespace-delegation policy, which is not this.
 */
export function createBundledServiceDefinitionRegistry(
  options: BundledServiceDefinitionRegistryOptions = {},
): ServiceContractDefinitionRegistry {
  return createServiceContractDefinitionRegistry({
    matcherProfiles: createServiceFacetMatcherProfileRegistry(options.matcherProfiles ?? []),
    isNamespaceOwner: () => true,
    validateJsonSchemaRef: () => [],
  })
}

/**
 * Register the inventory's service-contract definitions and fail closed: one rejected owner is a
 * refused bootstrap (`x3.host/service-definition-rejected` with the diagnostics), never a
 * partially-defined host.
 */
export async function registerServiceDefinitionsOrThrow(
  inventory: Inventory,
  definitions: ServiceContractDefinitionRegistry,
): Promise<readonly DefinitionInventoryResult[]> {
  const registrations = await registerServiceContractDefinitionsFromInventory(
    inventory,
    definitions,
  )
  const rejected = registrations.filter(result => result.state === 'rejected')
  if (rejected.length > 0) {
    const diagnostics: Diagnostic[] = rejected.flatMap(result => result.diagnostics)
    throw new ModkitError({
      code: 'x3.host/service-definition-rejected',
      message: `${rejected.length} service contract definition owner(s) failed closed`,
      context: { diagnostics },
    })
  }
  return registrations
}

/**
 * The method surfaces of the registered definitions, in the shape execution backends read as
 * `foreignSurfaces` (a thunk over this function keeps late registrations visible to workers).
 */
export function serviceDefinitionSurfaces(
  definitions: ServiceContractDefinitionRegistry,
): readonly DataSourceSurfaceSource[] {
  return definitions.list().flatMap(registration =>
    registration.surface === undefined
      ? []
      : [
          {
            contract: registration.contract,
            major: registration.major,
            surface: registration.surface,
          },
        ],
  )
}
