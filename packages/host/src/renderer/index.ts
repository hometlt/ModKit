/** Host definition, routing matcher and activation adapter for the standard scene renderer. */

import { contractId, diagnostic, type Diagnostic } from '@modkitx-x3/core'
import {
  SCENE_RENDERER_CONTRACT,
  SCENE_RENDERER_MATCHER_PROFILE,
  type SceneRenderer,
  type SceneRendererOfferFacet,
  type SceneRendererOutputKind,
  type SceneRendererRequestFacet,
} from '@modkitx-x3/sdk/renderer'
import type {
  DefinitionInventoryResult,
  PermissionGrant,
  ResourceBudget,
  RuntimeTarget,
  ServiceContractDefinitionRegistry,
  ServiceContractDefinitionSpecV1Wire,
  ServiceFacetMatchContext,
  ServiceFacetMatchResult,
  ServiceFacetMatcherProfile,
} from '@modkitx-x3/sdk'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import type { Inventory } from '../inventory.js'
import { createHostServiceResolver } from '../service-leases.js'

/** Owner id under which the standard scene-renderer definition is registered. */
export const STANDARD_RENDERER_OWNER = 'org.modkitx/renderer'

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
        $ref: 'https://schemas.modkitx.org/x3/scene-renderer-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkitx.org/x3/scene-renderer-request.v1.schema.json',
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
