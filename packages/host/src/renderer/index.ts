/** Host definition, routing matcher and activation adapter for the standard scene renderer. */

import { contractId, diagnostic, type Diagnostic } from '@modkit/core'
import {
  SCENE_RENDERER_CONTRACT,
  SCENE_RENDERER_MATCHER_PROFILE,
  type SceneRenderer,
  type SceneRendererAcquireRequest,
  type SceneRendererAcquisition,
  type SceneRendererDiagnostic,
  type SceneRendererOfferFacet,
  type SceneRendererOutputKind,
  type SceneRendererPort,
  type SceneRendererRequestFacet,
} from '@modkit/sdk/renderer'
import type {
  DefinitionInventoryResult,
  JsonValue,
  PermissionGrant,
  ResourceBudget,
  RuntimeTarget,
  ServiceContractDefinitionRegistry,
  ServiceContractDefinitionSpecV1Wire,
  ServiceFacetMatchContext,
  ServiceFacetMatchResult,
  ServiceFacetMatcherProfile,
} from '@modkit/sdk'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import type { Inventory } from '../inventory.js'
import { offersFromInventory } from '../offers.js'
import { resolveServiceProvider } from '../resolution/service-resolver.js'
import { createHostServiceResolver } from '../service-leases.js'

/** Owner id under which the standard scene-renderer definition is registered. */
export const STANDARD_RENDERER_OWNER = 'modkit/renderer'

const OFFER_KEYS = new Set(['rendererIds', 'outputKinds'])
const REQUEST_KEYS = new Set(['rendererId', 'outputKind'])
const OUTPUT_KINDS = new Set<SceneRendererOutputKind>(['rgba8'])

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) return undefined
  const strings = value as string[]
  return new Set(strings).size === strings.length ? strings : undefined
}

function outputKind(value: unknown): SceneRendererOutputKind | undefined {
  return typeof value === 'string' && OUTPUT_KINDS.has(value as SceneRendererOutputKind)
    ? (value as SceneRendererOutputKind)
    : undefined
}

function outputKindList(value: unknown): readonly SceneRendererOutputKind[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const outputKinds = value.flatMap(item => {
    const parsed = outputKind(item)
    return parsed === undefined ? [] : [parsed]
  })
  return outputKinds.length === value.length && new Set(outputKinds).size === outputKinds.length
    ? outputKinds
    : undefined
}

function parseOffer(value: unknown): SceneRendererOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !OFFER_KEYS.has(key)))
    return undefined
  const rendererIds = stringList(record['rendererIds'])
  const outputKinds = outputKindList(record['outputKinds'])
  return rendererIds === undefined || outputKinds === undefined
    ? undefined
    : { rendererIds, outputKinds }
}

function parseRequest(value: unknown): SceneRendererRequestFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !REQUEST_KEYS.has(key)))
    return undefined
  const rendererId = record['rendererId']
  const parsedOutput = outputKind(record['outputKind'])
  if (parsedOutput === undefined || (rendererId !== undefined && !nonEmptyString(rendererId))) {
    return undefined
  }
  return {
    outputKind: parsedOutput,
    ...(rendererId === undefined ? {} : { rendererId }),
  }
}

function matchRendererFacets(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const offer = parseOffer(context.offerFacet)
  const request = parseRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/renderer-facet-invalid',
          `${context.contract}@${context.major}: renderer request and offer routes must be well formed`,
        ),
      ],
    }
  }
  if (!offer.outputKinds.includes(request.outputKind)) return { state: 'no-match' }
  if (request.rendererId !== undefined && !offer.rendererIds.includes(request.rendererId)) {
    return { state: 'no-match' }
  }
  return {
    state: 'match',
    selectionKey: `renderer=${request.rendererId ?? '*'};output=${request.outputKind}`,
  }
}

/** Host-trusted deterministic router for scene-renderer offers. */
export const SCENE_RENDERER_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(SCENE_RENDERER_MATCHER_PROFILE),
  major: 1,
  match: matchRendererFacets,
})

/** Standard renderer-neutral 3D frame definition. */
export const SCENE_RENDERER_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: SCENE_RENDERER_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/scene-renderer-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/scene-renderer-request.v1.schema.json',
      }),
    }),
    matching: Object.freeze({ profile: SCENE_RENDERER_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.render/scene-3d-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'rendererId', 'outputKinds']),
      methods: Object.freeze({
        render: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
      }),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

/** Register the platform definition before extension-owned definitions are inventoried. */
export function registerStandardRendererDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  const definition = SCENE_RENDERER_CONTRACT_DEFINITION
  return definitions.replaceOwnerInventory(STANDARD_RENDERER_OWNER, [
    {
      definition,
      provenance: {
        ownerExtensionId: STANDARD_RENDERER_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: 'host:standard-renderer-definitions',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-renderer-definitions',
      },
    },
  ])
}

export interface RendererHostServices {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
}

export interface ResolveSceneRendererRequest extends SceneRendererRequestFacet {
  readonly services: RendererHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

export type SceneRendererResolution =
  | Readonly<{
      state: 'resolved'
      renderer: SceneRenderer
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function isSceneRenderer(value: unknown): value is SceneRenderer {
  const record = recordOf(value)
  return (
    record?.['contract'] === SCENE_RENDERER_CONTRACT &&
    nonEmptyString(record['rendererId']) &&
    outputKindList(record['outputKinds']) !== undefined &&
    typeof record['render'] === 'function'
  )
}

/** Resolve and activate a renderer for one output route. */
export async function resolveSceneRenderer(
  request: ResolveSceneRendererRequest,
): Promise<SceneRendererResolution> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/renderer-unavailable',
          'this host registered no service-contract definitions, so renderers cannot be resolved',
        ),
      ],
    }
  }
  const resolver = createHostServiceResolver({
    inventory: request.services.inventory,
    target: request.services.target,
    executionBackends: request.services.executionBackends,
    definitions,
    grant: request.grant,
    budgets: request.budgets,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  const facet: SceneRendererRequestFacet = {
    outputKind: request.outputKind,
    ...(request.rendererId === undefined ? {} : { rendererId: request.rendererId }),
  }
  try {
    const lease = await resolver.port.resolve({
      contract: SCENE_RENDERER_CONTRACT,
      major: 1,
      facet,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    if (
      !isSceneRenderer(lease.value) ||
      !lease.value.outputKinds.includes(request.outputKind) ||
      (request.rendererId !== undefined && lease.value.rendererId !== request.rendererId)
    ) {
      await resolver.release()
      return {
        state: 'unresolved',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/renderer-invalid',
            `the selected provider does not implement ${SCENE_RENDERER_CONTRACT}@1 for ${request.outputKind}`,
          ),
        ],
      }
    }
    return Object.freeze({
      state: 'resolved',
      renderer: lease.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/renderer-selected',
          `selected ${lease.value.rendererId} for ${request.outputKind}`,
        ),
      ]),
      release: () => resolver.release(),
    })
  } catch (error) {
    await resolver.release()
    return {
      state: 'unresolved',
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/renderer-unresolved',
          `no scene renderer resolved for ${request.outputKind} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}

// ---------------------------------------------------------------------------------------------
// selection without activation

/** The offer the standard resolver selects, named so another realm can act on the decision. */
export interface SceneRendererSelection {
  /** The renderer ids the selected offer advertises; the first is the one to instantiate. */
  readonly rendererIds: readonly string[]
  readonly providerId: string
  readonly offerId: string
  readonly extensionId: string
  readonly runtimeVariant: string
  readonly outputKind: SceneRendererOutputKind
}

export type SceneRendererSelectionResult =
  | Readonly<{
      state: 'selected'
      selection: SceneRendererSelection
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{ state: 'unselected'; diagnostics: readonly Diagnostic[] }>

export interface SelectSceneRendererRequest extends SceneRendererRequestFacet {
  readonly services: RendererHostServices
  /** Permission classes the requesting realm holds; folded into the target as resolution does. */
  readonly grant: PermissionGrant
}

/**
 * Run the standard resolver's *selection* and stop before activation.
 *
 * `resolveSceneRenderer` answers "give me a renderer I can call", which requires activating a
 * module in this process. That is the wrong question when the realm that will draw is not this
 * one — a VS Code extension host resolving for its page, say. Activating there would import a
 * WebGL provider into Node, where it can only fail; forwarding every frame back would put a
 * megabyte on the bridge per camera move.
 *
 * So this answers the other question: *which* offer does the standard resolver select for that
 * realm, on the same matcher, the same offers and the same target rules. The answer is an id and
 * a variant — inert data — and the realm that owns the drawing decides whether it can honour it.
 * Nothing here is a second resolution path: `resolveSceneRenderer` and this share
 * `resolveServiceProvider`, so a divergence between what is selected and what is activated is not
 * expressible.
 */
export async function selectSceneRenderer(
  request: SelectSceneRendererRequest,
): Promise<SceneRendererSelectionResult> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unselected',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/renderer-unavailable',
          'this host registered no service-contract definitions, so renderers cannot be selected',
        ),
      ],
    }
  }
  const facet: SceneRendererRequestFacet = {
    outputKind: request.outputKind,
    ...(request.rendererId === undefined ? {} : { rendererId: request.rendererId }),
  }
  const target: RuntimeTarget = {
    ...request.services.target,
    grantedPermissions: [
      ...new Set([...(request.services.target.grantedPermissions ?? []), ...request.grant.classes]),
    ].sort(),
  }
  const result = await resolveServiceProvider(
    {
      contract: { contract: contractId(SCENE_RENDERER_CONTRACT), major: 1 },
      target,
      requestFacet: facet as unknown as JsonValue,
    },
    offersFromInventory(request.services.inventory),
    definitions,
  )
  if (result.state !== 'resolved') {
    return {
      state: 'unselected',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/renderer-unresolved',
          `no scene renderer offer matched ${request.outputKind} for ${target.environment} (${result.reason})`,
        ),
      ],
    }
  }
  const offer = parseOffer(result.selected.resolvedContract.facet)
  if (offer === undefined) {
    return {
      state: 'unselected',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/renderer-facet-invalid',
          `${result.selected.offer.providerId} advertised an unreadable renderer route`,
        ),
      ],
    }
  }
  return Object.freeze({
    state: 'selected',
    selection: Object.freeze({
      rendererIds: offer.rendererIds,
      providerId: result.selected.offer.providerId,
      offerId: result.selected.resolvedContract.offerId,
      extensionId: result.selected.offer.extensionId,
      runtimeVariant: result.selected.offer.runtimeVariant,
      outputKind: request.outputKind,
    }),
    diagnostics: Object.freeze([
      diagnostic(
        'information',
        'x3.host/renderer-selected',
        `selected ${result.selected.offer.providerId} for ${request.outputKind} in ${target.environment}`,
      ),
    ]),
  })
}

// ---------------------------------------------------------------------------------------------
// the port a consumer holds

/**
 * `Diagnostic` carries `hint`, which the contract's own severity vocabulary does not.
 *
 * Mapped rather than widened: the renderer contract crosses the capability RPC and is implemented
 * by third-party providers, so its severity set is part of the wire and adding a fourth member to
 * it for one host's convenience would be a contract change. A hint is advice, so it lands on
 * `information`.
 */
function contractSeverity(severity: Diagnostic['severity']): SceneRendererDiagnostic['severity'] {
  return severity === 'hint' ? 'information' : severity
}

const contractDiagnostics = (
  diagnostics: readonly Diagnostic[],
): readonly SceneRendererDiagnostic[] =>
  Object.freeze(
    diagnostics.map(item =>
      Object.freeze({
        severity: contractSeverity(item.severity),
        code: item.code,
        message: item.message,
      }),
    ),
  )

export interface SceneRendererPortOptions {
  readonly services: RendererHostServices
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
}

/**
 * The one first-party implementation of `SceneRendererPort`: `resolveSceneRenderer`, wrapped.
 *
 * It exists so a consumer can be handed the *ability to obtain* a renderer without being handed the
 * inventory, grant and execution backends that obtaining one requires. That distinction is what
 * lets a DOM viewer in `@modkit/ui` — a package that depends on `@modkit/sdk` and nothing else —
 * request a provider through the standard resolver: the application composes the port on the side
 * that legitimately holds host authority and passes it in, exactly as it passes an export writer.
 *
 * A host with no renderer offer, or one whose realm cannot activate the offers it has, is not an
 * error here: `acquire` returns `unresolved` with the resolver's own diagnostics, and the consumer
 * degrades on a stated reason.
 */
export function createSceneRendererPort(options: SceneRendererPortOptions): SceneRendererPort {
  return Object.freeze({
    async acquire(request: SceneRendererAcquireRequest): Promise<SceneRendererAcquisition> {
      const resolution = await resolveSceneRenderer({
        services: options.services,
        grant: options.grant,
        budgets: options.budgets,
        outputKind: request.outputKind,
        ...(request.rendererId === undefined ? {} : { rendererId: request.rendererId }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      const diagnostics = contractDiagnostics(resolution.diagnostics)
      if (resolution.state !== 'resolved')
        return Object.freeze({ state: 'unresolved', diagnostics })
      return Object.freeze({
        state: 'resolved',
        diagnostics,
        lease: Object.freeze({
          renderer: resolution.renderer,
          release: () => resolution.release(),
        }),
      })
    },
  })
}
