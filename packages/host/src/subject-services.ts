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

import { compareUtf8, ModkitError, type Diagnostic } from '@modkit/core'
import type {
  ArtifactSource,
  DefinitionInventoryResult,
  HostPolicy,
  OpenIntent,
  PermissionGrant,
  ResourceBudget,
  RuntimeTarget,
  ServiceContractDefinitionRegistry,
  ServiceFacetMatcherProfile,
} from '@modkit/sdk'
import type { DataSourceSurfaceSource } from './execution/index.js'
import type { ExecutionBackendRegistry } from './execution/backend.js'
import {
  CONTRIBUTION_DISABLED_CODE,
  EXTENSION_DISABLED_CODE,
  type ExtensionOrigin,
  type Inventory,
} from './inventory.js'
import {
  createServiceContractDefinitionRegistry,
  createServiceFacetMatcherProfileRegistry,
  registerServiceContractDefinitionsFromInventory,
} from './service-definitions.js'
import { registerStandardEditingDefinitions, WRITER_FACET_MATCHER } from './editing-definitions.js'
import { LANGUAGE_DOCUMENT_MATCHER, registerStandardLanguageDefinitions } from './language/index.js'
import { RUNTIME_PROVIDER_MATCHER, registerStandardRuntimeDefinitions } from './runtime/index.js'
import { SCENE_RENDERER_MATCHER, registerStandardRendererDefinitions } from './renderer/index.js'
import { GAME_INSTALLATION_MATCHER, registerStandardGameDefinitions } from './games/index.js'
import { MOD_WORKSPACE_MATCHER, registerStandardModDefinitions } from './mods/index.js'
import {
  DATA_CATALOG_MATCHER,
  registerStandardDataDefinitions,
  RESOLVED_DATA_WORKSPACE_MATCHER,
} from './data/index.js'
import {
  MAP_PREVIEW_PREPARATION_MATCHER,
  MAP_SEMANTIC_MATCHER,
  registerStandardMapDefinitions,
} from './maps/index.js'
import { openSubject, type OpenSubjectResult, type SubjectInputResolver } from './subject-open.js'

// ---------------------------------------------------------------------------------------------
// the request every host accepts

/** One open request as the products issue it; `probe` is the host's own two-phase step. */
export interface SubjectOpenRequest {
  readonly source: ArtifactSource
  readonly path: string
  readonly mediaType?: string
  readonly intent: Exclude<OpenIntent, 'probe'>
  readonly grant: PermissionGrant
  readonly budget: ResourceBudget
  /**
   * Host-owned companion resolution for a composite input plan, when the caller knows the trusted
   * origin the subject came from (a confined directory, an archive namespace). Omitted, the open
   * behaves exactly as it did before: a plan with requirements has no resolver and fails closed
   * with `x3.host/input-resolver-required`, and a plan without them never needed one.
   */
  readonly resolveInput?: SubjectInputResolver
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
export { CONTRIBUTION_DISABLED_CODE, EXTENSION_DISABLED_CODE } from './inventory.js'

/**
 * One row per contribution in the inventory, for a settings surface that lists them.
 *
 * Sits beside `supportedExtensionHints` because it answers the same class of question — "what does
 * this inventory hold, for a user to look at" — and lives here rather than in each application
 * because two of them had written the same twenty-five lines. A row keeps *unparsed* records too:
 * a contribution whose envelope did not parse still has a path, and a settings page that silently
 * omitted it would be hiding the one record its owner most needs to see.
 */
export interface InventoryContributionRow {
  /** Qualified contribution id. Absent when the envelope did not parse — then there is no switch. */
  readonly id?: string
  readonly displayName: string
  /** The contract it implements and that contract's major, when the envelope parsed. */
  readonly contract?: string
  readonly contractMajor?: number
  /** `publisher/id` of the extension that ships it. */
  readonly extension: string
  readonly origin: ExtensionOrigin
  readonly activationEligible: boolean
  /** True when this contribution's own switch is off, independent of its owning extension. */
  readonly disabled: boolean
  /** True when the owning extension's switch is off. */
  readonly extensionDisabled: boolean
  /** Manifest path inside the extension — the only identity an unparsed record has. */
  readonly path: string
}

export function describeInventoryContributions(
  inventory: Inventory,
): readonly InventoryContributionRow[] {
  const rows = inventory.extensions.flatMap(extension => {
    const owner = `${extension.manifest.publisher}/${extension.manifest.id}`
    return extension.contributions.map((contribution): InventoryContributionRow => {
      const manifest = contribution.manifest
      return {
        ...(manifest === undefined ? {} : { id: manifest.id }),
        displayName: manifest?.displayName ?? contribution.path,
        ...(manifest === undefined
          ? {}
          : { contract: manifest.contract.id, contractMajor: manifest.contract.major }),
        extension: owner,
        origin: extension.origin,
        activationEligible: contribution.activationEligible,
        disabled: contribution.diagnostics.some(item => item.code === CONTRIBUTION_DISABLED_CODE),
        extensionDisabled: contribution.diagnostics.some(
          item => item.code === EXTENSION_DISABLED_CODE,
        ),
        path: contribution.path,
      }
    })
  })
  return Object.freeze(
    rows.sort((left, right) => {
      const owner = compareUtf8(left.extension, right.extension)
      return owner === 0 ? compareUtf8(left.id ?? left.path, right.id ?? right.path) : owner
    }),
  )
}

export function supportedExtensionHints(inventory: Inventory): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        inventory.extensions.flatMap(extension =>
          extension.contributions.flatMap(contribution => {
            const manifest = contribution.manifest
            if (manifest?.contract.id !== 'modkit/codec-contribution') return []
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
 * this registry — they need an explicit namespace-delegation policy, which is not this. The
 * platform's matcher profiles (editing, language, runtime, renderer, game and mod routing) are
 * always available.
 */
export function createBundledServiceDefinitionRegistry(
  options: BundledServiceDefinitionRegistryOptions = {},
): ServiceContractDefinitionRegistry {
  return createServiceContractDefinitionRegistry({
    matcherProfiles: createServiceFacetMatcherProfileRegistry([
      WRITER_FACET_MATCHER,
      LANGUAGE_DOCUMENT_MATCHER,
      RUNTIME_PROVIDER_MATCHER,
      SCENE_RENDERER_MATCHER,
      GAME_INSTALLATION_MATCHER,
      MOD_WORKSPACE_MATCHER,
      DATA_CATALOG_MATCHER,
      RESOLVED_DATA_WORKSPACE_MATCHER,
      MAP_SEMANTIC_MATCHER,
      MAP_PREVIEW_PREPARATION_MATCHER,
      ...(options.matcherProfiles ?? []),
    ]),
    isNamespaceOwner: () => true,
    validateJsonSchemaRef: () => [],
  })
}

/**
 * Register the platform's standard definitions and then the inventory's service-contract
 * definitions, failing closed: one rejected owner is a refused bootstrap
 * (`x3.host/service-definition-rejected` with the diagnostics), never a partially-defined host.
 * A registry that lacks the standard matcher profiles is rejected here too — use
 * `createBundledServiceDefinitionRegistry` or include all platform matcher profiles.
 */
export async function registerServiceDefinitionsOrThrow(
  inventory: Inventory,
  definitions: ServiceContractDefinitionRegistry,
): Promise<readonly DefinitionInventoryResult[]> {
  const editing = await registerStandardEditingDefinitions(definitions)
  const language = await registerStandardLanguageDefinitions(definitions)
  const runtime = await registerStandardRuntimeDefinitions(definitions)
  const renderer = await registerStandardRendererDefinitions(definitions)
  const games = await registerStandardGameDefinitions(definitions)
  const mods = await registerStandardModDefinitions(definitions)
  const data = await registerStandardDataDefinitions(definitions)
  const maps = await registerStandardMapDefinitions(definitions)
  const registrations = [
    editing,
    language,
    runtime,
    renderer,
    games,
    mods,
    data,
    maps,
    ...(await registerServiceContractDefinitionsFromInventory(inventory, definitions)),
  ]
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
