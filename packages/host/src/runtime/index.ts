/** Host definitions, routing and leased-session adapter for executable runtimes. */

import { contractId, diagnostic, type Diagnostic } from '@modkitx-x3/core'
import {
  RUNTIME_PROVIDER_CONTRACT,
  RUNTIME_PROVIDER_MATCHER_PROFILE,
  RUNTIME_SESSION_CONTRACT,
  type RuntimeBudget,
  type RuntimeProvider,
  type RuntimeProviderOfferFacet,
  type RuntimeProviderRequestFacet,
  type RuntimeSession,
} from '@modkitx-x3/sdk/runtime'
import type {
  DefinitionInventoryResult,
  InputSearchScope,
  Lease,
  PermissionGrant,
  ResourceSessionPort,
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
import { createHostServiceResolver, type HostServiceResolver } from '../service-leases.js'
import { FACETLESS_SERVICE_MATCHER_PROFILE } from '../service-definitions.js'

/** Owner id under which both standard runtime definitions are registered. */
export const STANDARD_RUNTIME_OWNER = 'org.modkitx/runtime'

const OFFER_KEYS = new Set(['runtimeIds'])
const REQUEST_KEYS = new Set(['runtimeId'])
const BUDGET_KEYS = new Set(['maxWallTimeMs', 'maxTicks', 'maxMemoryBytes'])

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) return undefined
  const strings = value as string[]
  return new Set(strings).size === strings.length ? strings : undefined
}

function parseOffer(value: unknown): RuntimeProviderOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !OFFER_KEYS.has(key)))
    return undefined
  const runtimeIds = stringList(record['runtimeIds'])
  return runtimeIds === undefined ? undefined : { runtimeIds }
}

function parseRequest(value: unknown): RuntimeProviderRequestFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => !REQUEST_KEYS.has(key)))
    return undefined
  const runtimeId = record['runtimeId']
  return nonEmptyString(runtimeId) ? { runtimeId } : undefined
}

function matchRuntimeFacets(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const offer = parseOffer(context.offerFacet)
  const request = parseRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/runtime-facet-invalid',
          `${context.contract}@${context.major}: runtime request and offer routes must be well formed`,
        ),
      ],
    }
  }
  return offer.runtimeIds.includes(request.runtimeId)
    ? { state: 'match', selectionKey: `runtime=${request.runtimeId}` }
    : { state: 'no-match' }
}

/** Host-trusted deterministic router for runtime-provider offers. */
export const RUNTIME_PROVIDER_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(RUNTIME_PROVIDER_MATCHER_PROFILE),
  major: 1,
  match: matchRuntimeFacets,
})

/** Standard runtime factory definition. */
export const RUNTIME_PROVIDER_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: RUNTIME_PROVIDER_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkitx.org/x3/runtime-provider-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkitx.org/x3/runtime-provider-request.v1.schema.json',
      }),
    }),
    matching: Object.freeze({ profile: RUNTIME_PROVIDER_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.runtime/provider-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'providerId', 'runtimeIds']),
      methods: Object.freeze({
        createSession: Object.freeze({
          kind: 'lease',
          wrapper: 'lease',
          result: Object.freeze({ contract: RUNTIME_SESSION_CONTRACT, major: 1 }),
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
      }),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

/** Standard nested runtime-session definition. It is materialized only from a provider lease. */
export const RUNTIME_SESSION_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: RUNTIME_SESSION_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({ presence: 'forbidden' }),
    requestFacet: Object.freeze({ presence: 'forbidden' }),
    matching: Object.freeze({ profile: FACETLESS_SERVICE_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.runtime/session-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'sessionId', 'providerId', 'budget']),
      methods: Object.freeze({
        execute: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
        status: Object.freeze({ kind: 'value' }),
      }),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

export const STANDARD_RUNTIME_DEFINITIONS: readonly ServiceContractDefinitionSpecV1Wire[] =
  Object.freeze([RUNTIME_PROVIDER_CONTRACT_DEFINITION, RUNTIME_SESSION_CONTRACT_DEFINITION])

/** Register the standard runtime factory and nested session definitions. */
export function registerStandardRuntimeDefinitions(
  definitions: ServiceContractDefinitionRegistry,
): Promise<DefinitionInventoryResult> {
  return definitions.replaceOwnerInventory(
    STANDARD_RUNTIME_OWNER,
    STANDARD_RUNTIME_DEFINITIONS.map(definition => ({
      definition,
      provenance: {
        ownerExtensionId: STANDARD_RUNTIME_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: `host:${definition.contract}@${definition.major}`,
        manifestDigest: `host:${definition.contract}@${definition.major}`,
        artifactDigest: 'host:standard-runtime-definitions',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-runtime-definitions',
      },
    })),
  )
}

export interface RuntimeHostServices {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
}

/**
 * One logical input passed by the host to a trusted in-process runtime provider.
 *
 * This stays outside the serializable runtime ABI: the paired ResourceSessionPort owns methods
 * and leases and therefore must never be cloned into an RPC request.
 */
export interface RuntimeProviderLogicalInput {
  readonly id: string
  readonly kind: 'source' | 'trigger' | 'definition'
  readonly logicalId: string
  readonly scopes: readonly InputSearchScope[]
  readonly maxBytes: number
}

/** Host-internal, non-wire invocation context for one runtime provider session. */
export interface RuntimeProviderInvocationContext {
  readonly inputs: readonly RuntimeProviderLogicalInput[]
  readonly resources: ResourceSessionPort
}

export interface OpenRuntimeSessionRequest extends RuntimeProviderRequestFacet {
  readonly services: RuntimeHostServices
  readonly sessionId: string
  readonly budget: RuntimeBudget
  readonly grant: PermissionGrant
  /** Host activation budget; distinct from the executable session's numeric budget. */
  readonly activationBudget: ResourceBudget
  /** Only trusted in-process providers may receive this non-serializable context. */
  readonly providerInvocation?: RuntimeProviderInvocationContext
  readonly signal?: AbortSignal
}

export type RuntimeSessionResolution =
  | Readonly<{
      state: 'resolved'
      providerId: string
      session: RuntimeSession
      diagnostics: readonly Diagnostic[]
      release(): Promise<void>
    }>
  | Readonly<{
      state: 'unresolved'
      diagnostics: readonly Diagnostic[]
    }>

function isRuntimeBudget(value: unknown): value is RuntimeBudget {
  const record = recordOf(value)
  return (
    record !== undefined &&
    Object.keys(record).length === BUDGET_KEYS.size &&
    Object.keys(record).every(key => BUDGET_KEYS.has(key)) &&
    nonNegativeSafeInteger(record['maxWallTimeMs']) &&
    nonNegativeSafeInteger(record['maxTicks']) &&
    nonNegativeSafeInteger(record['maxMemoryBytes'])
  )
}

function sameBudget(left: RuntimeBudget, right: RuntimeBudget): boolean {
  return (
    left.maxWallTimeMs === right.maxWallTimeMs &&
    left.maxTicks === right.maxTicks &&
    left.maxMemoryBytes === right.maxMemoryBytes
  )
}

function isRuntimeProvider(value: unknown): value is RuntimeProvider {
  const record = recordOf(value)
  return (
    record?.['contract'] === RUNTIME_PROVIDER_CONTRACT &&
    nonEmptyString(record['providerId']) &&
    stringList(record['runtimeIds']) !== undefined &&
    typeof record['createSession'] === 'function'
  )
}

function isRuntimeSession(value: unknown): value is RuntimeSession {
  const record = recordOf(value)
  return (
    record?.['contract'] === RUNTIME_SESSION_CONTRACT &&
    nonEmptyString(record['sessionId']) &&
    nonEmptyString(record['providerId']) &&
    isRuntimeBudget(record['budget']) &&
    typeof record['execute'] === 'function' &&
    typeof record['status'] === 'function'
  )
}

function isRuntimeSessionLease(value: unknown): value is Lease<RuntimeSession> {
  const record = recordOf(value)
  return isRuntimeSession(record?.['value']) && typeof record?.['release'] === 'function'
}

async function releaseUnknownLease(value: unknown): Promise<void> {
  const release = recordOf(value)?.['release']
  if (typeof release === 'function') await release.call(value)
}

async function unresolvedAfterRelease(
  resolver: HostServiceResolver,
  diagnostics: readonly Diagnostic[],
): Promise<RuntimeSessionResolution> {
  await resolver.release()
  return { state: 'unresolved', diagnostics }
}

/** Resolve a runtime provider and open one resource-bounded executable session. */
export async function openRuntimeSession(
  request: OpenRuntimeSessionRequest,
): Promise<RuntimeSessionResolution> {
  if (!nonEmptyString(request.runtimeId) || !nonEmptyString(request.sessionId)) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/runtime-session-request-invalid',
          'runtimeId and sessionId must both be non-empty strings',
        ),
      ],
    }
  }
  if (!isRuntimeBudget(request.budget)) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/runtime-budget-invalid',
          'runtime budgets must be non-negative safe integers',
        ),
      ],
    }
  }
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/runtime-provider-unavailable',
          'this host registered no service-contract definitions, so runtimes cannot be resolved',
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
    budgets: request.activationBudget,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  try {
    const providerLease = await resolver.port.resolve({
      contract: RUNTIME_PROVIDER_CONTRACT,
      major: 1,
      facet: { runtimeId: request.runtimeId },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const provider = providerLease.value
    if (!isRuntimeProvider(provider) || !provider.runtimeIds.includes(request.runtimeId)) {
      return unresolvedAfterRelease(resolver, [
        ...resolver.diagnostics,
        diagnostic(
          'error',
          'x3.host/runtime-provider-invalid',
          `the selected provider does not implement ${RUNTIME_PROVIDER_CONTRACT}@1 for ${request.runtimeId}`,
        ),
      ])
    }

    const providerActivation = resolver.activationFacts.findLast(
      fact =>
        fact.providerId === provider.providerId &&
        fact.contract === RUNTIME_PROVIDER_CONTRACT &&
        fact.major === 1,
    )
    if (
      request.providerInvocation !== undefined &&
      providerActivation?.executionProfile !== 'trusted-in-process'
    ) {
      return unresolvedAfterRelease(resolver, [
        ...resolver.diagnostics,
        diagnostic(
          'error',
          'x3.host/runtime-provider-invocation-boundary',
          `runtime provider ${provider.providerId} runs as ${providerActivation?.executionProfile ?? 'an unknown execution profile'}; non-serializable ResourceSession invocation context is restricted to gate-admitted trusted-in-process providers`,
          [provider.providerId],
          {
            executionProfile: providerActivation?.executionProfile ?? 'unknown',
            runtimeVariant: providerActivation?.runtimeVariant ?? 'unknown',
          },
        ),
      ])
    }

    const createRequest = {
      sessionId: request.sessionId,
      budget: request.budget,
      ...(request.providerInvocation === undefined
        ? {}
        : { providerInvocation: request.providerInvocation }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    }
    const candidate: unknown = await provider.createSession(createRequest)
    if (
      !isRuntimeSessionLease(candidate) ||
      candidate.value.sessionId !== request.sessionId ||
      candidate.value.providerId !== provider.providerId ||
      !sameBudget(candidate.value.budget, request.budget)
    ) {
      await releaseUnknownLease(candidate)
      return unresolvedAfterRelease(resolver, [
        ...resolver.diagnostics,
        diagnostic(
          'error',
          'x3.host/runtime-session-invalid',
          `runtime provider ${provider.providerId} returned an invalid session lease`,
        ),
      ])
    }

    let released = false
    return Object.freeze({
      state: 'resolved',
      providerId: provider.providerId,
      session: candidate.value,
      diagnostics: Object.freeze([
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/runtime-provider-selected',
          `selected ${provider.providerId} for runtime ${request.runtimeId}`,
        ),
      ]),
      async release(): Promise<void> {
        if (released) return
        released = true
        let sessionError: unknown
        try {
          await candidate.release()
        } catch (error) {
          sessionError = error
        }
        try {
          await resolver.release()
        } catch (error) {
          sessionError ??= error
        }
        if (sessionError !== undefined) throw sessionError
      },
    })
  } catch (error) {
    await resolver.release()
    return {
      state: 'unresolved',
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/runtime-provider-unresolved',
          `no runtime provider resolved for ${request.runtimeId} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  }
}
