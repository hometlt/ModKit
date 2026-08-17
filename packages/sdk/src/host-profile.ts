import {
  canonicalJsonStringify,
  compareUtf8,
  diagnostic,
  isQualifiedId,
  isUInt64String,
  ModkitError,
  uniqueSortedUtf8,
  type Diagnostic,
  type UInt64String,
} from '@modkitx-x3/core'
import {
  LEGACY_HOST_FACILITY_ALIASES,
  STANDARD_HOST_FACILITY_IDS,
} from './host-facilities.generated.js'
import type { PermissionClass } from './manifest/contribution-types.js'
import type { RuntimeTarget } from './resolution/types.js'
import {
  ARCHITECTURES,
  OPERATING_SYSTEMS,
  RUNTIME_ENVIRONMENTS,
} from './schemas/contribution-manifest.js'
import { snapshotJsonWireData } from './manifest/validate.js'

declare const HOST_FACILITY_ID_BRAND: unique symbol

export type StandardHostFacilityId = (typeof STANDARD_HOST_FACILITY_IDS)[number]
export type LegacyHostFacilityAlias = (typeof LEGACY_HOST_FACILITY_ALIASES)[number]
export type ExtensionHostFacilityId = string & { readonly [HOST_FACILITY_ID_BRAND]: true }
export type HostFacilityId =
  StandardHostFacilityId | LegacyHostFacilityAlias | ExtensionHostFacilityId

export const HOST_TRANSPORT_KINDS = Object.freeze([
  'in-process',
  'structured-clone',
  'rpc-handle',
  'stream',
  'transferable-buffer',
  'shared-memory-view',
  'native-process-rpc',
] as const)

export type HostTransportKind = (typeof HOST_TRANSPORT_KINDS)[number]
export type RuntimeTargetBase = Omit<RuntimeTarget, 'hostCapabilities' | 'grantedPermissions'>

export interface HostBudgets {
  readonly maxConcurrentTasks: number
  readonly maxWorkerCount: number
  readonly maxResidentBytes: UInt64String
  readonly maxTransferBytes: UInt64String
  readonly defaultDeadlineMs: number
}

export interface HostPolicyRef {
  readonly id: string
  readonly revision: string
  readonly digest?: string
}

export interface HostRealmProfile {
  readonly schemaVersion: 1
  readonly realmId: string
  readonly revision: string
  readonly target: RuntimeTargetBase
  readonly facilities: readonly HostFacilityId[]
  readonly budgets: HostBudgets
  readonly policy: HostPolicyRef
}

/** Compatibility name used by document 19; profiles are realm-scoped, never whole-app globals. */
export type HostProfile = HostRealmProfile

export interface HostTransportLink {
  readonly fromRealm: string
  readonly toRealm: string
  readonly transports: readonly HostTransportKind[]
}

export interface HostTopology {
  readonly schemaVersion: 1
  readonly topologyId: string
  readonly realms: readonly HostRealmProfile[]
  readonly links: readonly HostTransportLink[]
}

const standardFacilities = new Set<string>(STANDARD_HOST_FACILITY_IDS)
const legacyFacilities = new Set<string>(LEGACY_HOST_FACILITY_ALIASES)
const transportKinds = new Set<string>(HOST_TRANSPORT_KINDS)

export function isStandardHostFacilityId(value: string): value is StandardHostFacilityId {
  return standardFacilities.has(value)
}

export function isHostFacilityId(value: string): value is HostFacilityId {
  return isStandardHostFacilityId(value) || legacyFacilities.has(value) || isQualifiedId(value)
}

export function hostFacilityId(value: string): HostFacilityId {
  if (!isHostFacilityId(value)) {
    throw new ModkitError({
      code: 'x3.sdk/unknown-host-facility',
      message: `unknown unqualified host facility «${value}»`,
      context: {
        facility: value,
        expected: 'standard facility ID or extension-owned qualified publisher/name ID',
      },
    })
  }
  return value as HostFacilityId
}

export function hostFacilityDiagnostics(
  values: readonly string[] | undefined,
  path: readonly (string | number)[] = [],
): Diagnostic[] {
  if (values === undefined) return []
  const diagnostics: Diagnostic[] = []
  values.forEach((value, index) => {
    if (!isHostFacilityId(value)) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/unknown-host-facility',
          `unknown unqualified host facility «${value}»`,
          [...path, index],
          { facility: value },
        ),
      )
    } else if (legacyFacilities.has(value)) {
      diagnostics.push(
        diagnostic(
          'warning',
          'x3.sdk/legacy-host-facility',
          `host facility «${value}» is a transitional compatibility alias`,
          [...path, index],
          { facility: value },
        ),
      )
    }
  })
  return diagnostics
}

function invalidProfile(message: string, context?: Record<string, unknown>): never {
  throw new ModkitError({
    code: 'x3.sdk/invalid-host-profile',
    message,
    ...(context === undefined ? {} : { context }),
  })
}

function exactKeys(value: object, allowed: readonly string[], field: string): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key))
  if (extra.length > 0) invalidProfile(`${field} contains unsupported fields`, { field, extra })
}

function nonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) return invalidProfile(`${field} must not be empty`, { field })
  return value
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    return invalidProfile(`${field} must be a non-negative safe integer`, { field, value })
  }
  return value
}

function bytes(value: UInt64String, field: string): UInt64String {
  if (!isUInt64String(value))
    return invalidProfile(`${field} must be an unsigned 64-bit string`, { field })
  return value
}

function normalizeStrings(values: readonly string[]): readonly string[] {
  return Object.freeze(uniqueSortedUtf8(values.map(value => nonEmpty(value, 'target list value'))))
}

export function createHostRealmProfile(profile: HostRealmProfile): HostRealmProfile {
  const snapshot = snapshotJsonWireData(profile)
  exactKeys(
    snapshot,
    ['schemaVersion', 'realmId', 'revision', 'target', 'facilities', 'budgets', 'policy'],
    'profile',
  )
  if (snapshot.schemaVersion !== 1) invalidProfile('host profile schemaVersion must be 1')
  exactKeys(
    snapshot.target,
    [
      'environment',
      'operatingSystem',
      'architecture',
      'webApis',
      'externalTools',
      'hostCapabilities',
      'grantedPermissions',
    ],
    'target',
  )
  exactKeys(
    snapshot.budgets,
    [
      'maxConcurrentTasks',
      'maxWorkerCount',
      'maxResidentBytes',
      'maxTransferBytes',
      'defaultDeadlineMs',
    ],
    'budgets',
  )
  exactKeys(snapshot.policy, ['id', 'revision', 'digest'], 'policy')
  const rawTarget = snapshot.target as RuntimeTargetBase & Record<string, unknown>
  if ('hostCapabilities' in rawTarget || 'grantedPermissions' in rawTarget) {
    return invalidProfile(
      'target.hostCapabilities and target.grantedPermissions are projections and cannot be authored in a host profile',
    )
  }
  if (!(RUNTIME_ENVIRONMENTS as readonly string[]).includes(rawTarget.environment)) {
    invalidProfile('target.environment is not registered', { environment: rawTarget.environment })
  }
  const operatingSystem = rawTarget.operatingSystem as string
  if (
    operatingSystem === 'any' ||
    !(OPERATING_SYSTEMS as readonly string[]).includes(operatingSystem)
  ) {
    invalidProfile('target.operatingSystem must be concrete', {
      operatingSystem: rawTarget.operatingSystem,
    })
  }
  const architecture = rawTarget.architecture as string
  if (architecture === 'any' || !(ARCHITECTURES as readonly string[]).includes(architecture)) {
    invalidProfile('target.architecture must be concrete', { architecture: rawTarget.architecture })
  }
  const facilities = uniqueSortedUtf8(snapshot.facilities.map(value => hostFacilityId(value)))
  const target: RuntimeTargetBase = Object.freeze({
    environment: rawTarget.environment,
    operatingSystem: rawTarget.operatingSystem,
    architecture: rawTarget.architecture,
    ...(rawTarget.webApis === undefined ? {} : { webApis: normalizeStrings(rawTarget.webApis) }),
    ...(rawTarget.externalTools === undefined
      ? {}
      : { externalTools: normalizeStrings(rawTarget.externalTools) }),
  })
  const budgets: HostBudgets = Object.freeze({
    maxConcurrentTasks: count(snapshot.budgets.maxConcurrentTasks, 'budgets.maxConcurrentTasks'),
    maxWorkerCount: count(snapshot.budgets.maxWorkerCount, 'budgets.maxWorkerCount'),
    maxResidentBytes: bytes(snapshot.budgets.maxResidentBytes, 'budgets.maxResidentBytes'),
    maxTransferBytes: bytes(snapshot.budgets.maxTransferBytes, 'budgets.maxTransferBytes'),
    defaultDeadlineMs: count(snapshot.budgets.defaultDeadlineMs, 'budgets.defaultDeadlineMs'),
  })
  const policy: HostPolicyRef = Object.freeze({
    id: nonEmpty(snapshot.policy.id, 'policy.id'),
    revision: nonEmpty(snapshot.policy.revision, 'policy.revision'),
    ...(snapshot.policy.digest === undefined
      ? {}
      : { digest: nonEmpty(snapshot.policy.digest, 'policy.digest') }),
  })
  return Object.freeze({
    schemaVersion: 1,
    realmId: nonEmpty(snapshot.realmId, 'realmId'),
    revision: nonEmpty(snapshot.revision, 'revision'),
    target,
    facilities: Object.freeze(facilities),
    budgets,
    policy,
  })
}

export function createHostTopology(topology: HostTopology): HostTopology {
  const snapshot = snapshotJsonWireData(topology)
  exactKeys(snapshot, ['schemaVersion', 'topologyId', 'realms', 'links'], 'topology')
  if (snapshot.schemaVersion !== 1) return invalidProfile('host topology schemaVersion must be 1')
  const realms = snapshot.realms.map(createHostRealmProfile)
  realms.sort((left, right) => compareUtf8(left.realmId, right.realmId))
  const realmIds = new Set<string>()
  for (const realm of realms) {
    if (realmIds.has(realm.realmId)) return invalidProfile(`duplicate realmId «${realm.realmId}»`)
    realmIds.add(realm.realmId)
  }
  const links = snapshot.links.map(link => {
    exactKeys(link, ['fromRealm', 'toRealm', 'transports'], 'transport link')
    if (!realmIds.has(link.fromRealm) || !realmIds.has(link.toRealm)) {
      return invalidProfile('transport link references an unknown realm', {
        fromRealm: link.fromRealm,
        toRealm: link.toRealm,
      })
    }
    if (link.fromRealm === link.toRealm) return invalidProfile('transport link must cross realms')
    const transports = uniqueSortedUtf8(link.transports)
    if (transports.length === 0 || transports.some(value => !transportKinds.has(value))) {
      return invalidProfile('transport link must declare known transport kinds')
    }
    return Object.freeze({
      fromRealm: link.fromRealm,
      toRealm: link.toRealm,
      transports: Object.freeze(transports as HostTransportKind[]),
    })
  })
  links.sort((left, right) =>
    compareUtf8(
      `${left.fromRealm}\u0000${left.toRealm}`,
      `${right.fromRealm}\u0000${right.toRealm}`,
    ),
  )
  const seenLinks = new Set<string>()
  for (const link of links) {
    const key = `${link.fromRealm}\u0000${link.toRealm}`
    if (seenLinks.has(key)) return invalidProfile('duplicate directed transport link', { key })
    seenLinks.add(key)
  }
  return Object.freeze({
    schemaVersion: 1,
    topologyId: nonEmpty(snapshot.topologyId, 'topologyId'),
    realms: Object.freeze(realms),
    links: Object.freeze(links),
  })
}

export function runtimeTargetForHostRealm(
  profile: HostRealmProfile,
  grantedPermissions?: readonly PermissionClass[],
): RuntimeTarget {
  const normalized = createHostRealmProfile(profile)
  return Object.freeze({
    ...normalized.target,
    hostCapabilities: normalized.facilities,
    ...(grantedPermissions === undefined
      ? {}
      : { grantedPermissions: Object.freeze([...grantedPermissions]) }),
  })
}

/** Stable JSON input for host-owned cache hashing; no cryptographic API is required in the SDK. */
export function hostRealmCacheKey(profile: HostRealmProfile): string {
  return canonicalJsonStringify(createHostRealmProfile(profile))
}
