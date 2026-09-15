/** Host routing for generic subject-independent extension operations. */

import {
  canonicalJsonStringify,
  contractId,
  diagnostic,
  isDottedId,
  isQualifiedId,
  type Diagnostic,
} from '@modkit/core'
import {
  PERMISSION_CLASSES,
  snapshotJsonWireData,
  SERVICE_OPERATION_MATCHER_PROFILE,
  SERVICE_OPERATION_PROVIDER_CONTRACT,
  type JsonValue,
  type PermissionGrant,
  type ResourceBudget,
  type RuntimeTarget,
  type ServiceContractDefinitionRegistry,
  type ServiceContractDefinitionSpecV1Wire,
  type ServiceFacetMatchContext,
  type ServiceFacetMatchResult,
  type ServiceFacetMatcherProfile,
  type ServiceOperationDescriptor,
  type ServiceOperationProvider,
  type ServiceOperationProviderOfferFacet,
  type ServiceOperationProviderRequestFacet,
  type ServiceOperationResult,
} from '@modkit/sdk'
import type { ExecutionBackendRegistry } from './execution/backend.js'
import type { Inventory } from './inventory.js'
import { createHostServiceResolver } from './service-leases.js'
import { createServiceOperationSchemaValidator } from './service-operation-schema.js'

export const STANDARD_SERVICE_OPERATION_OWNER = 'modkit/service-operations'

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

function operationIds(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmpty)) return undefined
  return new Set(value).size === value.length ? value : undefined
}

function parseOffer(value: unknown): ServiceOperationProviderOfferFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => key !== 'operationIds')) return undefined
  const ids = operationIds(record['operationIds'])
  return ids === undefined ? undefined : { operationIds: ids }
}

function parseRequest(value: unknown): ServiceOperationProviderRequestFacet | undefined {
  const record = recordOf(value)
  if (record === undefined || Object.keys(record).some(key => key !== 'operationId')) return undefined
  return nonEmpty(record['operationId']) ? { operationId: record['operationId'] } : undefined
}

function matchServiceOperation(context: ServiceFacetMatchContext): ServiceFacetMatchResult {
  const offer = parseOffer(context.offerFacet)
  const request = parseRequest(context.requestFacet)
  if (offer === undefined || request === undefined) {
    return {
      state: 'invalid',
      diagnostics: [
        diagnostic(
          'error',
          'x3.host/service-operation-facet-invalid',
          `${context.contract}@${context.major}: operation request and offer routes must be well formed`,
        ),
      ],
    }
  }
  return offer.operationIds.includes(request.operationId)
    ? { state: 'match', selectionKey: `operation=${request.operationId}` }
    : { state: 'no-match' }
}

export const SERVICE_OPERATION_MATCHER: ServiceFacetMatcherProfile = Object.freeze({
  profile: contractId(SERVICE_OPERATION_MATCHER_PROFILE),
  major: 1,
  match: matchServiceOperation,
})

export const SERVICE_OPERATION_PROVIDER_CONTRACT_DEFINITION: ServiceContractDefinitionSpecV1Wire =
  Object.freeze({
    schemaVersion: 1,
    kind: 'service',
    contract: SERVICE_OPERATION_PROVIDER_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/service-operation-provider-offer.v1.schema.json',
      }),
    }),
    requestFacet: Object.freeze({
      presence: 'required',
      schema: Object.freeze({
        $ref: 'https://schemas.modkit.org/x3/service-operation-provider-request.v1.schema.json',
      }),
    }),
    matching: Object.freeze({ profile: SERVICE_OPERATION_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: 'common.runtime/operation-provider-v1',
    surface: Object.freeze({
      fields: Object.freeze(['contract', 'providerId', 'operations']),
      methods: Object.freeze({
        invoke: Object.freeze({
          kind: 'value',
          signal: Object.freeze({ arg: 0, key: 'signal' }),
        }),
      }),
    }),
  }) as ServiceContractDefinitionSpecV1Wire

export function registerStandardServiceOperationDefinitions(
  definitions: ServiceContractDefinitionRegistry,
) {
  return definitions.replaceOwnerInventory(STANDARD_SERVICE_OPERATION_OWNER, [
    {
      definition: SERVICE_OPERATION_PROVIDER_CONTRACT_DEFINITION,
      provenance: {
        ownerExtensionId: STANDARD_SERVICE_OPERATION_OWNER,
        extensionVersion: '1.0.0',
        inventoryRecordId: 'host:common.runtime/operation-provider@1',
        manifestDigest: 'host:common.runtime/operation-provider@1',
        artifactDigest: 'host:standard-service-operation-definition',
        artifactRoot: 'host:',
        manifestPath: 'host:standard-service-operation-definition',
      },
    },
  ])
}

export interface ServiceOperationHostServices {
  readonly inventory: Inventory
  readonly target: RuntimeTarget
  readonly executionBackends: ExecutionBackendRegistry
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
}

export interface InvokeServiceOperationRequest {
  readonly services: ServiceOperationHostServices
  /** Additional runtime realms to try when the primary target has no compatible provider. */
  readonly alternateTargets?: readonly RuntimeTarget[]
  readonly operationId: string
  readonly input: JsonValue
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  /** Optional caller policy. Omission permits every descriptor effect class. */
  readonly allowedEffects?: readonly ServiceOperationDescriptor['effects'][]
  readonly signal?: AbortSignal
}

export type ServiceOperationInvocation =
  | Readonly<{
      state: 'invoked'
      descriptor: ServiceOperationDescriptor
      result: ServiceOperationResult
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'refused'
      stage: 'input' | 'permission' | 'policy'
      descriptor: ServiceOperationDescriptor
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{
      state: 'failed'
      stage: 'provider' | 'invoke' | 'result'
      descriptor?: ServiceOperationDescriptor
      diagnostics: readonly Diagnostic[]
    }>
  | Readonly<{ state: 'unresolved'; diagnostics: readonly Diagnostic[] }>

const DESCRIPTOR_KEYS = Object.freeze([
  'schemaVersion',
  'id',
  'title',
  'summary',
  'requiredPermissions',
  'effects',
  'inputSchema',
  'resultSchema',
  'budget',
])
const BUDGET_KEYS = Object.freeze(['maxInputBytes', 'maxOutputBytes', 'maxWallTimeMs'])
const RESULT_KEYS = Object.freeze({
  completed: ['state', 'operationId', 'value', 'diagnostics'],
  refused: ['state', 'operationId', 'code', 'message', 'diagnostics'],
  failed: ['state', 'operationId', 'code', 'message', 'diagnostics'],
} as const)
const DIAGNOSTIC_SEVERITIES = new Set(['error', 'warning', 'information', 'hint'])
const PERMISSIONS = new Set<string>(PERMISSION_CLASSES)
const encoder = new TextEncoder()

function exactKeys(record: Readonly<Record<string, unknown>>, allowed: readonly string[]): boolean {
  const keys = Object.keys(record)
  return keys.length === allowed.length && keys.every(key => allowed.includes(key))
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function jsonBytes(value: unknown): number | undefined {
  try {
    return encoder.encode(canonicalJsonStringify(value)).byteLength
  } catch {
    return undefined
  }
}

function validDiagnostic(value: unknown): value is Diagnostic {
  const record = recordOf(value)
  if (
    record === undefined ||
    typeof record['code'] !== 'string' ||
    !isQualifiedId(record['code']) ||
    typeof record['severity'] !== 'string' ||
    !DIAGNOSTIC_SEVERITIES.has(record['severity']) ||
    typeof record['message'] !== 'string' ||
    record['message'].trim().length === 0
  ) {
    return false
  }
  return jsonBytes(record) !== undefined
}

export type ServiceOperationProviderValidation =
  | Readonly<{ valid: true; provider: ServiceOperationProvider }>
  | Readonly<{ valid: false; reason: string }>

/** Validate and snapshot the complete runtime surface before trusting descriptor metadata. */
export function validateServiceOperationProvider(
  value: unknown,
  requestedOperationId?: string,
): ServiceOperationProviderValidation {
  const record = recordOf(value)
  if (
    record === undefined ||
    record['contract'] !== SERVICE_OPERATION_PROVIDER_CONTRACT ||
    !nonEmpty(record['providerId']) ||
    !isQualifiedId(record['providerId']) ||
    !Array.isArray(record['operations']) ||
    record['operations'].length === 0 ||
    typeof record['invoke'] !== 'function'
  ) {
    return { valid: false, reason: 'provider surface is malformed' }
  }
  const ids = new Set<string>()
  const descriptors: ServiceOperationDescriptor[] = []
  for (const candidate of record['operations']) {
    let snapshot: unknown
    try {
      snapshot = snapshotJsonWireData(candidate)
    } catch {
      return { valid: false, reason: 'operation descriptor is not inert JSON data' }
    }
    const descriptor = recordOf(snapshot)
    const budget = recordOf(descriptor?.['budget'])
    const permissions = descriptor?.['requiredPermissions']
    if (
      descriptor === undefined ||
      !exactKeys(descriptor, DESCRIPTOR_KEYS) ||
      descriptor['schemaVersion'] !== 1 ||
      typeof descriptor['id'] !== 'string' ||
      (!isDottedId(descriptor['id']) && !isQualifiedId(descriptor['id'])) ||
      ids.has(descriptor['id']) ||
      !nonEmpty(descriptor['title']) ||
      !nonEmpty(descriptor['summary']) ||
      !Array.isArray(permissions) ||
      !permissions.every(item => typeof item === 'string' && PERMISSIONS.has(item)) ||
      new Set(permissions).size !== permissions.length ||
      !['none', 'host-state', 'external'].includes(descriptor['effects'] as string) ||
      recordOf(descriptor['inputSchema']) === undefined ||
      recordOf(descriptor['resultSchema']) === undefined ||
      jsonBytes(descriptor['inputSchema']) === undefined ||
      jsonBytes(descriptor['resultSchema']) === undefined ||
      budget === undefined ||
      !exactKeys(budget, BUDGET_KEYS) ||
      !safePositiveInteger(budget['maxInputBytes']) ||
      !safePositiveInteger(budget['maxOutputBytes']) ||
      !safePositiveInteger(budget['maxWallTimeMs'])
    ) {
      return { valid: false, reason: 'operation descriptor is malformed or duplicated' }
    }
    const inputSchema = createServiceOperationSchemaValidator(descriptor['inputSchema'])
    const resultSchema = createServiceOperationSchemaValidator(descriptor['resultSchema'])
    if (!inputSchema.valid || !resultSchema.valid) {
      return {
        valid: false,
        reason: `operation descriptor schema is unsupported: ${!inputSchema.valid ? inputSchema.reason : !resultSchema.valid ? resultSchema.reason : ''}`,
      }
    }
    ids.add(descriptor['id'])
    descriptors.push(descriptor as unknown as ServiceOperationDescriptor)
  }
  if (requestedOperationId !== undefined && !ids.has(requestedOperationId)) {
    return { valid: false, reason: `provider does not describe ${requestedOperationId}` }
  }
  return {
    valid: true,
    provider: Object.freeze({
      contract: SERVICE_OPERATION_PROVIDER_CONTRACT,
      providerId: record['providerId'],
      operations: Object.freeze(descriptors),
      invoke: record['invoke'] as ServiceOperationProvider['invoke'],
    }),
  }
}

export type ServiceOperationResultValidation =
  | Readonly<{ valid: true; result: ServiceOperationResult; outputBytes: number }>
  | Readonly<{ valid: false; reason: string }>

/** Reject malformed, oversized or mismatched results before they cross the host boundary. */
export function validateServiceOperationResult(
  value: unknown,
  operationId: string,
  maximumOutputBytes: number,
  maximumDiagnostics: number,
  resultSchema?: Readonly<Record<string, unknown>>,
): ServiceOperationResultValidation {
  let snapshot: unknown
  try {
    snapshot = snapshotJsonWireData(value)
  } catch {
    return { valid: false, reason: 'provider result is not inert JSON data' }
  }
  const record = recordOf(snapshot)
  const state = record?.['state']
  if (record === undefined || (state !== 'completed' && state !== 'refused' && state !== 'failed')) {
    return { valid: false, reason: 'provider result state is invalid' }
  }
  if (
    !exactKeys(record, RESULT_KEYS[state]) ||
    record['operationId'] !== operationId ||
    !Array.isArray(record['diagnostics']) ||
    record['diagnostics'].length > maximumDiagnostics ||
    !record['diagnostics'].every(validDiagnostic)
  ) {
    return { valid: false, reason: 'provider result shape, operation id or diagnostics are invalid' }
  }
  if (state === 'completed' && resultSchema !== undefined) {
    const validator = createServiceOperationSchemaValidator(resultSchema)
    if (!validator.valid) return { valid: false, reason: validator.reason }
    const reason = validator.validate(record['value'])
    if (reason !== undefined) return { valid: false, reason: `result schema violation: ${reason}` }
  }
  if (
    state !== 'completed' &&
    (!nonEmpty(record['code']) || !isQualifiedId(record['code']) || !nonEmpty(record['message']))
  ) {
    return { valid: false, reason: 'provider failure is missing a qualified code or message' }
  }
  const outputBytes = jsonBytes(record)
  if (outputBytes === undefined) return { valid: false, reason: 'provider result is not JSON-safe' }
  if (outputBytes > maximumOutputBytes) {
    return { valid: false, reason: `provider result exceeds ${maximumOutputBytes} bytes` }
  }
  return { valid: true, result: record as unknown as ServiceOperationResult, outputBytes }
}

export type ServiceOperationCatalogState =
  | 'declared'
  | 'eligible'
  | 'activatable'
  | 'unavailable'

export interface ServiceOperationCatalogEntry {
  readonly operationId: string
  readonly declaredProviderIds: readonly string[]
  readonly eligibleProviderIds: readonly string[]
  readonly state: ServiceOperationCatalogState
  readonly selectedProviderId?: string
  readonly descriptor?: ServiceOperationDescriptor
  readonly diagnostics: readonly Diagnostic[]
}

export interface ServiceOperationCatalogRequest {
  readonly services: ServiceOperationHostServices
  /** Additional runtime realms to inspect when proving activation. */
  readonly alternateTargets?: readonly RuntimeTarget[]
  readonly grant: PermissionGrant
  readonly budgets: ResourceBudget
  readonly offset?: number
  readonly limit: number
  /** False returns the inert declared/eligible catalog without executing extension code. */
  readonly activate?: boolean
  readonly signal?: AbortSignal
}

export interface ServiceOperationCatalog {
  readonly total: number
  readonly offset: number
  readonly complete: boolean
  readonly nextOffset?: number
  readonly entries: readonly ServiceOperationCatalogEntry[]
}

export const SERVICE_OPERATION_CATALOG_MAX_PAGE_ITEMS = 100

interface DeclaredOperation {
  readonly declared: Set<string>
  readonly eligible: Set<string>
}

function declaredServiceOperations(inventory: Inventory): Map<string, DeclaredOperation> {
  const operations = new Map<string, DeclaredOperation>()
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      if (manifest?.contract.id !== 'modkit/service-provider-contribution') continue
      const provides = recordOf(manifest.spec)?.['provides']
      if (!Array.isArray(provides)) continue
      for (const candidate of provides) {
        const offer = recordOf(candidate)
        if (
          offer?.['contract'] !== SERVICE_OPERATION_PROVIDER_CONTRACT ||
          offer['major'] !== 1
        ) {
          continue
        }
        const facet = parseOffer(offer['facet'])
        if (facet === undefined) continue
        for (const operationId of facet.operationIds) {
          const row = operations.get(operationId) ?? {
            declared: new Set<string>(),
            eligible: new Set<string>(),
          }
          row.declared.add(manifest.id)
          if (contribution.activationEligible) row.eligible.add(manifest.id)
          operations.set(operationId, row)
        }
      }
    }
  }
  return operations
}

function validateActivatedProvider(
  inventory: Inventory,
  resolver: ReturnType<typeof createHostServiceResolver>,
  provider: ServiceOperationProvider,
): string | undefined {
  const fact = [...resolver.activationFacts]
    .reverse()
    .find(item => item.contract === SERVICE_OPERATION_PROVIDER_CONTRACT && item.major === 1)
  if (fact === undefined) return 'provider activation facts are missing'
  if (provider.providerId !== fact.providerId) {
    return `runtime provider id ${provider.providerId} does not match activated contribution ${fact.providerId}`
  }
  const advertised = new Set<string>()
  for (const [operationId, row] of declaredServiceOperations(inventory)) {
    if (row.declared.has(fact.providerId)) advertised.add(operationId)
  }
  for (const descriptor of provider.operations) {
    if (!advertised.has(descriptor.id)) {
      return `${fact.providerId} describes unadvertised operation ${descriptor.id}`
    }
    const expanded = descriptor.requiredPermissions.filter(
      permission => !fact.effectiveGrant.classes.includes(permission),
    )
    if (expanded.length > 0) {
      return `${descriptor.id} expands its effective grant with ${expanded.join(', ')}`
    }
  }
  return undefined
}

function validPageInteger(value: number, allowZero: boolean): boolean {
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
}

function serviceOperationTargets(
  services: ServiceOperationHostServices,
  alternateTargets: readonly RuntimeTarget[] | undefined,
): readonly RuntimeTarget[] {
  const targets: RuntimeTarget[] = []
  const keys = new Set<string>()
  for (const target of [services.target, ...(alternateTargets ?? [])]) {
    const key = canonicalJsonStringify(target)
    if (keys.has(key)) continue
    keys.add(key)
    targets.push(target)
  }
  return targets
}

/**
 * Discover service operations from inert inventory, then optionally prove current-host activation.
 * Pagination is applied before activation so one page cannot execute providers outside that page.
 */
export async function discoverServiceOperations(
  request: ServiceOperationCatalogRequest,
): Promise<ServiceOperationCatalog> {
  const offset = request.offset ?? 0
  if (
    !validPageInteger(offset, true) ||
    !validPageInteger(request.limit, false) ||
    request.limit > SERVICE_OPERATION_CATALOG_MAX_PAGE_ITEMS
  ) {
    throw new TypeError('service operation catalog offset/limit must be bounded integers')
  }
  const declared = declaredServiceOperations(request.services.inventory)
  const ids = [...declared.keys()].sort()
  const pageIds = ids.slice(offset, offset + request.limit)
  const entries: ServiceOperationCatalogEntry[] = []
  for (const operationId of pageIds) {
    request.signal?.throwIfAborted()
    const row = declared.get(operationId)!
    const declaredProviderIds = Object.freeze([...row.declared].sort())
    const eligibleProviderIds = Object.freeze([...row.eligible].sort())
    if (eligibleProviderIds.length === 0) {
      entries.push(
        Object.freeze({
          operationId,
          declaredProviderIds,
          eligibleProviderIds,
          state: 'declared' as const,
          diagnostics: Object.freeze([
            diagnostic(
              'information',
              'x3.host/service-operation-not-eligible',
              `${operationId} is declared but no contribution is activation-eligible`,
            ),
          ]),
        }),
      )
      continue
    }
    if (request.activate === false || request.services.serviceDefinitions === undefined) {
      entries.push(
        Object.freeze({
          operationId,
          declaredProviderIds,
          eligibleProviderIds,
          state: 'eligible' as const,
          diagnostics: Object.freeze([]),
        }),
      )
      continue
    }
    const unavailableDiagnostics: Diagnostic[] = []
    let activatedEntry: ServiceOperationCatalogEntry | undefined
    for (const target of serviceOperationTargets(request.services, request.alternateTargets)) {
      request.signal?.throwIfAborted()
      const resolver = createHostServiceResolver({
        inventory: request.services.inventory,
        target,
        executionBackends: request.services.executionBackends,
        definitions: request.services.serviceDefinitions,
        grant: request.grant,
        budgets: request.budgets,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      try {
        const lease = await resolver.port.resolve({
          contract: SERVICE_OPERATION_PROVIDER_CONTRACT,
          major: 1,
          facet: { operationId },
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        })
        const checked = validateServiceOperationProvider(lease.value, operationId)
        if (!checked.valid) throw new TypeError(checked.reason)
        const activationMismatch = validateActivatedProvider(
          request.services.inventory,
          resolver,
          checked.provider,
        )
        if (activationMismatch !== undefined) throw new TypeError(activationMismatch)
        const descriptor = checked.provider.operations.find(item => item.id === operationId)
        if (descriptor === undefined) throw new TypeError(`provider omitted ${operationId}`)
        const missingPermissions = descriptor.requiredPermissions.filter(
          item => !request.grant.classes.includes(item),
        )
        if (missingPermissions.length > 0) {
          throw new TypeError(`missing permission classes: ${missingPermissions.join(', ')}`)
        }
        activatedEntry = Object.freeze({
          operationId,
          declaredProviderIds,
          eligibleProviderIds,
          state: 'activatable' as const,
          selectedProviderId: checked.provider.providerId,
          descriptor,
          diagnostics: Object.freeze([...resolver.diagnostics]),
        })
      } catch (error) {
        unavailableDiagnostics.push(
          ...resolver.diagnostics,
          diagnostic(
            'information',
            'x3.host/service-operation-target-unavailable',
            `${operationId} is not activatable for ${target.environment}/${target.operatingSystem}/${target.architecture}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      } finally {
        await resolver.release()
      }
      if (activatedEntry !== undefined) break
    }
    if (activatedEntry !== undefined) {
      entries.push(activatedEntry)
    } else {
      entries.push(
        Object.freeze({
          operationId,
          declaredProviderIds,
          eligibleProviderIds,
          state: 'unavailable' as const,
          diagnostics: Object.freeze([
            ...unavailableDiagnostics,
            diagnostic(
              'information',
              'x3.host/service-operation-unavailable',
              `${operationId} is not activatable in any requested runtime realm`,
            ),
          ]),
        }),
      )
    }
  }
  const nextOffset = offset + pageIds.length
  return Object.freeze({
    total: ids.length,
    offset,
    complete: nextOffset >= ids.length,
    ...(nextOffset < ids.length ? { nextOffset } : {}),
    entries: Object.freeze(entries),
  })
}

/** Resolve, invoke and release one exact extension operation through the common provider plane. */
async function invokeServiceOperationAtTarget(
  request: InvokeServiceOperationRequest,
  target: RuntimeTarget,
): Promise<ServiceOperationInvocation> {
  const definitions = request.services.serviceDefinitions
  if (definitions === undefined) {
    return {
      state: 'unresolved',
      diagnostics: [
        diagnostic(
          'information',
          'x3.host/service-operation-unavailable',
          'this host registered no service-contract definitions',
        ),
      ],
    }
  }
  const resolver = createHostServiceResolver({
    inventory: request.services.inventory,
    target,
    executionBackends: request.services.executionBackends,
    definitions,
    grant: request.grant,
    budgets: request.budgets,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })
  try {
    const lease = await resolver.port.resolve({
      contract: SERVICE_OPERATION_PROVIDER_CONTRACT,
      major: 1,
      facet: { operationId: request.operationId },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const checkedProvider = validateServiceOperationProvider(lease.value, request.operationId)
    if (!checkedProvider.valid) {
      return {
        state: 'failed',
        stage: 'provider',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/service-operation-provider-invalid',
            `the selected operation provider has an invalid runtime surface: ${checkedProvider.reason}`,
          ),
        ],
      }
    }
    const provider = checkedProvider.provider
    const activationMismatch = validateActivatedProvider(
      request.services.inventory,
      resolver,
      provider,
    )
    if (activationMismatch !== undefined) {
      return {
        state: 'failed',
        stage: 'provider',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/service-operation-provider-mismatch',
            activationMismatch,
          ),
        ],
      }
    }
    const descriptor = provider.operations.find(item => item.id === request.operationId)
    if (descriptor === undefined) {
      return {
        state: 'failed',
        stage: 'provider',
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/service-operation-descriptor-missing',
            `the selected provider did not publish ${request.operationId}`,
          ),
        ],
      }
    }
    let stableInput: JsonValue
    try {
      stableInput = snapshotJsonWireData(request.input)
    } catch {
      return {
        state: 'refused',
        stage: 'input',
        descriptor,
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/service-operation-input-invalid',
            'service operation input is not inert JSON data',
          ),
        ],
      }
    }
    const inputBytes = jsonBytes(stableInput)
    const maximumInputBytes = Math.min(
      descriptor.budget.maxInputBytes,
      request.budgets.maxInputBytes > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : Number(request.budgets.maxInputBytes),
    )
    if (inputBytes === undefined || inputBytes > maximumInputBytes) {
      return {
        state: 'refused',
        stage: 'input',
        descriptor,
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/service-operation-input-invalid',
            inputBytes === undefined
              ? 'service operation input is not inert JSON data'
              : `service operation input exceeds ${maximumInputBytes} bytes`,
          ),
        ],
      }
    }
    const inputValidator = createServiceOperationSchemaValidator(descriptor.inputSchema)
    const inputSchemaReason = inputValidator.valid
      ? inputValidator.validate(stableInput)
      : inputValidator.reason
    if (inputSchemaReason !== undefined) {
      return {
        state: 'refused',
        stage: 'input',
        descriptor,
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/service-operation-input-schema-violation',
            `${request.operationId} input is invalid: ${inputSchemaReason}`,
          ),
        ],
      }
    }
    const missingPermissions = descriptor.requiredPermissions.filter(
      item => !request.grant.classes.includes(item),
    )
    if (missingPermissions.length > 0) {
      return {
        state: 'refused',
        stage: 'permission',
        descriptor,
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/service-operation-permission-denied',
            `${request.operationId} requires ${missingPermissions.join(', ')}`,
            undefined,
            { missingPermissions },
          ),
        ],
      }
    }
    if (
      request.allowedEffects !== undefined &&
      !request.allowedEffects.includes(descriptor.effects)
    ) {
      return {
        state: 'refused',
        stage: 'policy',
        descriptor,
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/service-operation-effect-refused',
            `${request.operationId} declares ${descriptor.effects} effects, which caller policy does not allow`,
          ),
        ],
      }
    }
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort(request.signal?.reason)
    request.signal?.addEventListener('abort', abortFromCaller, { once: true })
    const deadline = Math.min(
      descriptor.budget.maxWallTimeMs,
      request.budgets.deadlineMs ?? Number.MAX_SAFE_INTEGER,
    )
    const timer = setTimeout(
      () => controller.abort(new Error(`${request.operationId} exceeded its ${deadline}ms deadline`)),
      deadline,
    )
    let result: unknown
    try {
      result = await Promise.race([
        provider.invoke({
          operationId: request.operationId,
          input: stableInput,
          signal: controller.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => reject(controller.signal.reason ?? new Error('service operation cancelled')),
            { once: true },
          )
        }),
      ])
    } catch (error) {
      return {
        state: 'failed',
        stage: 'invoke',
        descriptor,
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            controller.signal.aborted
              ? 'x3.host/service-operation-cancelled'
              : 'x3.host/service-operation-invoke-failed',
            error instanceof Error ? error.message : String(error),
          ),
        ],
      }
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', abortFromCaller)
    }
    const checkedResult = validateServiceOperationResult(
      result,
      request.operationId,
      descriptor.budget.maxOutputBytes,
      request.budgets.maxDiagnostics,
      descriptor.resultSchema,
    )
    if (!checkedResult.valid) {
      return {
        state: 'failed',
        stage: 'result',
        descriptor,
        diagnostics: [
          ...resolver.diagnostics,
          diagnostic(
            'error',
            'x3.host/service-operation-result-invalid',
            `${request.operationId} returned an invalid result: ${checkedResult.reason}`,
          ),
        ],
      }
    }
    return Object.freeze({
      state: 'invoked' as const,
      descriptor,
      result: checkedResult.result,
      diagnostics: Object.freeze([...resolver.diagnostics]),
    })
  } catch (error) {
    return {
      state: 'unresolved',
      diagnostics: [
        ...resolver.diagnostics,
        diagnostic(
          'information',
          'x3.host/service-operation-unresolved',
          `no provider resolved for ${request.operationId} (${error instanceof Error ? error.message : String(error)})`,
        ),
      ],
    }
  } finally {
    await resolver.release()
  }
}

/** Resolve one operation across the caller's ordered runtime realms. */
export async function invokeServiceOperation(
  request: InvokeServiceOperationRequest,
): Promise<ServiceOperationInvocation> {
  const unresolvedDiagnostics: Diagnostic[] = []
  for (const target of serviceOperationTargets(request.services, request.alternateTargets)) {
    request.signal?.throwIfAborted()
    const result = await invokeServiceOperationAtTarget(request, target)
    if (result.state !== 'unresolved') return result
    unresolvedDiagnostics.push(...result.diagnostics)
  }
  return Object.freeze({
    state: 'unresolved' as const,
    diagnostics: Object.freeze(unresolvedDiagnostics),
  })
}
