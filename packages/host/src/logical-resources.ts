import { diagnostic, ModkitError } from '@modkit/core'
import {
  isRevisionId,
  type ArtifactByteSource,
  type InputSearchScope,
  type LogicalResourceCandidate,
  type LogicalResourceDiscoveryReceipt,
  type LogicalResourceDiscoveryIdentity,
  type LogicalResourceDiscoveryRefusal,
  type LogicalResourceDiscoveryRequest,
  type LogicalResourceDiscoveryResult,
  type LogicalResourcePort,
  type LogicalResourceRequirement,
  type ResourceBudget,
  type ResourceProvenanceRecord,
  type ResourceResolution,
  type ResourceRole,
  type ResourceSessionPort,
  type ResourceUnresolvedReason,
} from '@modkit/sdk'
import { normalizeCompanionLogicalId } from './input-resolution.js'
import { resourceDiagnosticCode } from './resource-session.js'
import { logicalResourceDeadline } from './logical-resource-deadline.js'
import {
  readLogicalResourceBatch,
  type LogicalResourceBatchState,
} from './logical-resource-batch.js'

/** Host-only callback context: the narrowed ceiling, never supplied by the codec. */
export interface HostLogicalResourceDiscoveryContext {
  readonly budget: ResourceBudget
  readonly signal?: AbortSignal
}

/** A host-owned closure over approved namespace roots and bounded searches. */
export interface HostLogicalResourceDiscoveryPolicy extends LogicalResourceDiscoveryRequest {
  discover(context: HostLogicalResourceDiscoveryContext): Promise<LogicalResourceDiscoveryResult>
}

export interface SubjectLogicalResourceState {
  live: boolean
  reservedBytes: number
  resolveCalls: number
  discoveryCalls: number
  resources?: ResourceSessionPort
}

export interface SubjectLogicalResourceOptions {
  readonly state: SubjectLogicalResourceState
  readonly budget: ResourceBudget
  readonly policies?: readonly HostLogicalResourceDiscoveryPolicy[]
  readonly isAuthorized: () => boolean
}

const ROLES: readonly ResourceRole[] = ['texture', 'sidecar', 'buffer']
const SCOPES: readonly InputSearchScope[] = [
  'sibling-directory',
  'current-mount',
  'enclosing-container',
  'workspace-dependency-layer',
  'explicit-user-selection',
]
const REASONS: readonly LogicalResourceDiscoveryRefusal[] = [
  'budget-exceeded',
  'namespace-invalid',
  'size-unavailable',
  'request-invalid',
  'request-unsupported',
  'context-unavailable',
  'permission-missing',
  'deadline-exceeded',
]
const EMPTY_RECEIPT: LogicalResourceDiscoveryReceipt = Object.freeze({
  complete: false,
  pages: 0,
  entries: 0,
  candidates: 0,
  bytes: 0n,
})

function refuseDiscovery(
  reason: LogicalResourceDiscoveryRefusal,
  message: string,
  receipt: LogicalResourceDiscoveryReceipt = EMPTY_RECEIPT,
): LogicalResourceDiscoveryResult {
  return Object.freeze({
    state: 'refused',
    reason,
    message,
    candidates: Object.freeze([] as const),
    receipt,
  })
}

function captureRequest(request: LogicalResourceDiscoveryRequest): LogicalResourceDiscoveryRequest {
  if (
    request === null ||
    typeof request !== 'object' ||
    Object.keys(request).some(key => !['role', 'extension', 'timeoutMs'].includes(key))
  )
    throw new TypeError('Discovery accepts only role, extension and timeoutMs.')
  const { role, extension, timeoutMs } = request
  if (
    !ROLES.includes(role) ||
    typeof extension !== 'string' ||
    !/^\.[a-z0-9][a-z0-9_-]{0,31}$/i.test(extension) ||
    (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0))
  )
    throw new TypeError('Discovery requires a known resource role and literal extension.')
  return Object.freeze({
    role,
    extension: extension.toLowerCase(),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
}

/** Capture registration records before an open can yield; callback closure state remains host-owned. */
export function snapshotLogicalResourceDiscoveryPolicies(
  policies: readonly HostLogicalResourceDiscoveryPolicy[],
): readonly HostLogicalResourceDiscoveryPolicy[] {
  const seen = new Set<string>()
  return Object.freeze(
    Array.from(policies, policy => {
      const { role, extension, timeoutMs, discover } = policy
      const request = captureRequest({
        role,
        extension,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      })
      const key = `${request.role}:${request.extension}`
      if (seen.has(key) || typeof discover !== 'function')
        throw new TypeError(
          'Logical resource policies require unique role/extension pairs and a discover callback.',
        )
      seen.add(key)
      return Object.freeze({ ...request, discover: discover.bind(policy) })
    }),
  )
}

function captureRequirement(
  request: LogicalResourceRequirement,
  maxLength: number,
): LogicalResourceRequirement {
  if (request === null || typeof request !== 'object')
    throw new TypeError('A logical requirement is required.')
  const { id, logicalId, role, scopes, parentResourceId } = request
  const scopeCount = Array.isArray(scopes) ? scopes.length : -1
  if (
    Object.keys(request).some(
      key => !['id', 'logicalId', 'role', 'scopes', 'parentResourceId'].includes(key),
    ) ||
    ![id, logicalId].every(
      value => typeof value === 'string' && value.length > 0 && value.length <= maxLength,
    ) ||
    !ROLES.includes(role) ||
    !Array.isArray(scopes) ||
    !Number.isSafeInteger(scopeCount) ||
    scopeCount < 0 ||
    scopeCount > SCOPES.length ||
    (parentResourceId !== undefined &&
      (typeof parentResourceId !== 'string' ||
        parentResourceId.length === 0 ||
        parentResourceId.length > maxLength))
  )
    throw new TypeError('Invalid bounded logical requirement.')
  const capturedScopes: InputSearchScope[] = []
  for (let index = 0; index < scopeCount; index += 1) {
    const scope = scopes[index]
    if (scope === undefined || !SCOPES.includes(scope))
      throw new TypeError('Unknown resource scope.')
    capturedScopes.push(scope)
  }
  return Object.freeze({
    id,
    logicalId,
    role,
    scopes: Object.freeze(capturedScopes),
    ...(parentResourceId === undefined ? {} : { parentResourceId }),
  })
}

function copyProvenance(record: ResourceProvenanceRecord): ResourceProvenanceRecord {
  return Object.freeze({ ...record, scopes: Object.freeze([...record.scopes]) })
}

/** Capture host-declared inputs using the same validation as broker requests. */
export function snapshotLogicalResourceRequirements(
  inputs: readonly LogicalResourceRequirement[],
  budget: ResourceBudget,
): readonly LogicalResourceRequirement[] {
  if (!Array.isArray(inputs) || inputs.length > budget.maxNodes)
    throw new TypeError('Logical inputs exceed the host resource budget.')
  const count = inputs.length
  const captured = Array.from({ length: count }, (_, index) => {
    const input = inputs[index]
    if (input === undefined) throw new TypeError('Logical inputs cannot contain empty entries.')
    return captureRequirement(input, budget.maxScalarBytes)
  })
  if (new Set(captured.map(input => input.id)).size !== captured.length)
    throw new TypeError('Logical input ids must be unique.')
  let textBytes = 0
  const encoder = new TextEncoder()
  for (const input of captured) {
    normalizeCompanionLogicalId(input.logicalId)
    textBytes += encoder.encode(input.id + input.logicalId + (input.parentResourceId ?? '')).length
    if (textBytes > budget.maxScalarBytes)
      throw new TypeError('Logical input descriptors exceed the host scalar budget.')
  }
  return Object.freeze(captured)
}

function captureCandidateScopes(
  scopes: readonly InputSearchScope[] | undefined,
): readonly InputSearchScope[] | undefined {
  if (scopes === undefined) return undefined
  if (!Array.isArray(scopes)) throw new TypeError('Invalid discovery candidate scopes.')
  const length = scopes.length
  if (!Number.isSafeInteger(length) || length < 1 || length > SCOPES.length)
    throw new TypeError('Discovery candidate scopes require one to five entries.')
  // Capture the extent once; neither a custom iterator nor an accessor can expand this read.
  const selected = Array.from({ length }, (_, index) => scopes[index])
  const captured: InputSearchScope[] = []
  const seen = new Set<InputSearchScope>()
  for (const scope of selected) {
    if (scope === undefined || !SCOPES.includes(scope) || seen.has(scope))
      throw new TypeError('Discovery candidate scopes must be known and unique.')
    seen.add(scope)
    captured.push(scope)
  }
  return Object.freeze(captured)
}

function unresolved(
  requirement: LogicalResourceRequirement,
  reason: ResourceUnresolvedReason,
  message: string,
): ResourceResolution {
  return Object.freeze({
    state: 'unresolved',
    reason,
    diagnostic: diagnostic('warning', resourceDiagnosticCode(reason), message),
    provenance: Object.freeze({
      requirementId: requirement.id,
      logicalId: requirement.logicalId,
      role: requirement.role,
      state: 'unresolved',
      reason,
      cached: false,
      scopes: Object.freeze([...requirement.scopes]),
    }),
  })
}

/** No resolver is duplicated: resolution and source leases belong to the existing host session. */
export function createSubjectLogicalResources(
  options: SubjectLogicalResourceOptions,
): LogicalResourcePort {
  const budget = Object.freeze({ ...options.budget })
  const batchState: LogicalResourceBatchState = { activeReads: 0, reservedBytes: 0n }
  const maxBytes =
    budget.maxInputBytes < BigInt(budget.maxScalarBytes)
      ? budget.maxInputBytes
      : BigInt(budget.maxScalarBytes)
  const policies = new Map<string, HostLogicalResourceDiscoveryPolicy>()
  for (const policy of snapshotLogicalResourceDiscoveryPolicies(options.policies ?? [])) {
    policies.set(`${policy.role}:${policy.extension}`, policy)
  }
  const unavailable = (): 'context-unavailable' | 'permission-missing' | undefined =>
    !options.state.live || options.state.resources?.state() !== 'live'
      ? 'context-unavailable'
      : !options.isAuthorized()
        ? 'permission-missing'
        : undefined
  const assertLive = (signal?: AbortSignal): void => {
    signal?.throwIfAborted()
    const reason = unavailable()
    if (reason !== undefined)
      throw new ModkitError({
        code: `x3.host/logical-resource-${reason}`,
        message: 'Logical resources require a live readable subject.',
      })
  }
  const captureDiscovery = (
    value: LogicalResourceDiscoveryResult,
  ): LogicalResourceDiscoveryResult => {
    if (value === null || typeof value !== 'object')
      throw new TypeError('Invalid discovery result.')
    const { state, candidates, receipt: raw } = value
    if (raw === null || typeof raw !== 'object') throw new TypeError('Invalid discovery receipt.')
    const { complete, pages, entries, candidates: count, bytes } = raw
    if (
      typeof complete !== 'boolean' ||
      ![pages, entries, count].every(n => Number.isSafeInteger(n) && n >= 0) ||
      typeof bytes !== 'bigint' ||
      bytes < 0n ||
      count > entries ||
      !Array.isArray(candidates)
    )
      throw new TypeError('Invalid discovery receipt counts.')
    if (
      pages > budget.maxNodes ||
      entries > budget.maxNodes ||
      count > budget.maxNodes ||
      candidates.length > budget.maxNodes ||
      bytes > maxBytes
    )
      return refuseDiscovery('budget-exceeded', 'Discovery exceeds the subject budget.')
    const receipt = Object.freeze({ complete, pages, entries, candidates: count, bytes })
    if (state === 'refused') {
      const { reason, message } = value
      if (
        complete ||
        candidates.length !== 0 ||
        !REASONS.includes(reason) ||
        typeof message !== 'string' ||
        message.length > budget.maxScalarBytes
      )
        throw new TypeError('Invalid discovery refusal.')
      return refuseDiscovery(reason, message, receipt)
    }
    if (state !== 'complete' || !complete || count !== candidates.length)
      throw new TypeError('Discovery did not publish a complete consistent receipt.')
    let context: LogicalResourceDiscoveryIdentity | undefined
    let contextBytes = 0
    const rawContext = value.context
    if (rawContext !== undefined) {
      if (
        rawContext === null ||
        typeof rawContext !== 'object' ||
        Object.keys(rawContext).some(key => key !== 'primaryLogicalId' && key !== 'rootId')
      )
        throw new TypeError('Invalid discovery naming context.')
      const { primaryLogicalId, rootId } = rawContext
      if (
        typeof primaryLogicalId !== 'string' ||
        primaryLogicalId.length === 0 ||
        primaryLogicalId.length > budget.maxScalarBytes ||
        (rootId !== undefined &&
          (typeof rootId !== 'string' ||
            rootId.length === 0 ||
            rootId.length > budget.maxScalarBytes))
      )
        throw new TypeError('Invalid bounded discovery identity.')
      normalizeCompanionLogicalId(primaryLogicalId)
      contextBytes = new TextEncoder().encode(primaryLogicalId + (rootId ?? '')).length
      context = Object.freeze({ primaryLogicalId, ...(rootId === undefined ? {} : { rootId }) })
    }
    const copied: LogicalResourceCandidate[] = []
    const seen = new Set<string>()
    let total = 0n
    let textBytes = contextBytes
    if (textBytes > budget.maxScalarBytes)
      return refuseDiscovery('budget-exceeded', 'Discovery context exceeds the subject budget.')
    // A candidate accessor cannot extend this bounded snapshot by appending to its source array.
    const selected = Array.from({ length: count }, (_, index) => candidates[index])
    for (const candidate of selected) {
      if (candidate === null || typeof candidate !== 'object')
        throw new TypeError('Invalid discovery candidate.')
      const { logicalId, expectedRevision, size, rootId, scopes: rawScopes } = candidate
      if (
        ![logicalId, expectedRevision, rootId].every(
          s => typeof s === 'string' && s.length > 0 && s.length <= budget.maxScalarBytes,
        ) ||
        !isRevisionId(expectedRevision) ||
        typeof size !== 'bigint' ||
        size < 0n ||
        seen.has(logicalId)
      )
        throw new TypeError('Invalid or duplicate discovery candidate.')
      const scopes = captureCandidateScopes(rawScopes)
      normalizeCompanionLogicalId(logicalId)
      seen.add(logicalId)
      total += size
      textBytes += new TextEncoder().encode(logicalId + expectedRevision + rootId).length
      if (scopes !== undefined) textBytes += new TextEncoder().encode(scopes.join('')).length
      if (total > maxBytes || textBytes > budget.maxScalarBytes)
        return refuseDiscovery('budget-exceeded', 'Discovery candidates exceed the subject budget.')
      copied.push(
        Object.freeze({
          logicalId,
          expectedRevision,
          size,
          rootId,
          ...(scopes === undefined ? {} : { scopes }),
        }),
      )
    }
    if (total !== bytes) throw new TypeError('Discovery candidate bytes disagree with the receipt.')
    return Object.freeze({
      state: 'complete',
      candidates: Object.freeze(copied),
      receipt,
      ...(context === undefined ? {} : { context }),
    })
  }
  const port: LogicalResourcePort = {
    readBatch(request, signal) {
      return readLogicalResourceBatch(
        request,
        {
          budget,
          state: batchState,
          resolve: port.resolve,
          captureRequirement: requirement => captureRequirement(requirement, budget.maxScalarBytes),
          unavailable,
        },
        signal,
      )
    },
    async discover(request, signal) {
      signal?.throwIfAborted()
      const reason = unavailable()
      if (reason !== undefined)
        return refuseDiscovery(reason, 'Logical discovery requires a live readable subject.')
      let captured: LogicalResourceDiscoveryRequest
      try {
        captured = captureRequest(request)
      } catch (error) {
        return refuseDiscovery(
          'request-invalid',
          error instanceof Error ? error.message : 'Invalid discovery request.',
        )
      }
      if (options.state.discoveryCalls >= budget.maxNodes)
        return refuseDiscovery(
          'budget-exceeded',
          'Logical discovery request count exceeds the subject budget.',
        )
      options.state.discoveryCalls += 1
      const policy = policies.get(`${captured.role}:${captured.extension}`)
      if (policy === undefined)
        return refuseDiscovery(
          'request-unsupported',
          'The host has no registered policy for this request.',
        )
      try {
        const timeoutMs = Math.min(
          captured.timeoutMs ?? 5000,
          policy.timeoutMs ?? 5000,
          budget.deadlineMs ?? Infinity,
        )
        const result = await logicalResourceDeadline(
          discoverySignal => policy.discover({ budget, signal: discoverySignal }),
          timeoutMs,
          signal,
        )
        signal?.throwIfAborted()
        const after = unavailable()
        if (after !== undefined)
          return refuseDiscovery(after, 'The discovery context is no longer readable.')
        if (result.state === 'deadline-exceeded')
          return refuseDiscovery(
            'deadline-exceeded',
            'Logical discovery exceeded its duration ceiling.',
          )
        return captureDiscovery(result.value)
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
        return refuseDiscovery(
          'namespace-invalid',
          'The host discovery policy returned an invalid or unavailable result.',
        )
      }
    },
    async resolve(request, signal) {
      signal?.throwIfAborted()
      let requirement: LogicalResourceRequirement
      try {
        requirement = captureRequirement(request, budget.maxScalarBytes)
      } catch {
        return unresolved(
          { id: 'invalid', logicalId: 'invalid', role: 'buffer', scopes: [] },
          'path-refused',
          'Invalid bounded logical requirement.',
        )
      }
      const reason = unavailable()
      if (reason !== undefined)
        return unresolved(
          requirement,
          reason === 'permission-missing' ? reason : 'session-disposed',
          'Logical resolution requires a live readable subject.',
        )
      const resources = options.state.resources
      if (resources === undefined)
        return unresolved(requirement, 'session-disposed', 'The subject has no resource origin.')
      if (options.state.resolveCalls >= budget.maxNodes)
        return unresolved(
          requirement,
          'budget-exceeded',
          'Logical resolution request count exceeds the subject budget.',
        )
      options.state.resolveCalls += 1
      const resolution = await resources.resolve(requirement, signal)
      if (resolution.state === 'unresolved') {
        assertLive(signal)
        return Object.freeze({ ...resolution, provenance: copyProvenance(resolution.provenance) })
      }
      let released = false
      const release = async (): Promise<void> => {
        if (released) return
        released = true
        await resolution.lease.release()
      }
      try {
        assertLive(signal)
        const source = resolution.lease.value
        if (source.kind !== 'bytes') {
          await release()
          return unresolved(
            requirement,
            'scope-unsupported',
            'Logical consumer resources expose byte sources only.',
          )
        }
        const { size, revision } = source
        if (
          typeof size !== 'bigint' ||
          size < 0n ||
          size > budget.maxInputBytes ||
          !isRevisionId(revision) ||
          revision !== resolution.revision
        ) {
          await release()
          return unresolved(
            requirement,
            'budget-exceeded',
            'The resource has no valid bounded pinned byte extent.',
          )
        }
        const live = (readSignal?: AbortSignal): void => {
          assertLive(readSignal)
          if (released)
            throw new ModkitError({
              code: 'x3.host/resource-session-disposed',
              message: 'The logical resource lease was released.',
            })
        }
        const read: ArtifactByteSource['read'] = async (offset, length, readSignal) => {
          live(readSignal)
          if (
            typeof offset !== 'bigint' ||
            offset < 0n ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            offset + BigInt(length) > size ||
            options.state.reservedBytes + length > budget.maxScalarBytes
          )
            throw new ModkitError({
              code: 'x3.host/resource-budget-exceeded',
              message: 'The logical byte read exceeds its bounded extent or byte budget.',
            })
          options.state.reservedBytes += length
          try {
            const bytes = await source.read(offset, length, readSignal)
            live(readSignal)
            if (!(bytes instanceof Uint8Array) || bytes.length > length)
              throw new ModkitError({
                code: 'x3.host/resource-budget-exceeded',
                message: 'The resource returned more bytes than requested.',
              })
            return Uint8Array.from(bytes)
          } finally {
            options.state.reservedBytes -= length
          }
        }
        const bounded = Object.freeze<ArtifactByteSource>({
          kind: 'bytes',
          ref: Object.freeze({ ...source.ref }),
          revision,
          size,
          read,
          async *stream(range, readSignal) {
            live(readSignal)
            const offset = range?.offset ?? 0n
            const length = range?.length ?? size - offset
            if (
              typeof offset !== 'bigint' ||
              typeof length !== 'bigint' ||
              offset < 0n ||
              length < 0n ||
              offset + length > size
            )
              throw new TypeError('Invalid logical resource stream range.')
            const chunkSize = Math.min(65536, budget.maxScalarBytes)
            if (length > 0n && chunkSize < 1)
              throw new TypeError('The subject has no byte-read budget.')
            let cursor = offset
            const end = offset + length
            while (cursor < end) {
              const remaining = end - cursor
              const bytes = await read(
                cursor,
                Number(remaining < BigInt(chunkSize) ? remaining : BigInt(chunkSize)),
                readSignal,
              )
              if (bytes.length === 0)
                throw new TypeError('The logical resource ended before its declared extent.')
              cursor += BigInt(bytes.length)
              yield bytes
            }
          },
        })
        return Object.freeze({
          state: 'resolved',
          revision,
          provenance: copyProvenance(resolution.provenance),
          lease: Object.freeze({ value: bounded, release }),
        })
      } catch (error) {
        await release()
        throw error
      }
    },
    async identity(signal) {
      signal?.throwIfAborted()
      if (unavailable() !== undefined) return undefined
      const primaryLogicalId = options.state.resources?.primaryLogicalId
      return primaryLogicalId === undefined || primaryLogicalId.length === 0
        ? undefined
        : Object.freeze({ primaryLogicalId })
    },
    async provenance(signal) {
      assertLive(signal)
      const records = options.state.resources?.provenance() ?? []
      if (records.length > budget.maxNodes)
        throw new ModkitError({
          code: 'x3.host/resource-budget-exceeded',
          message: 'Logical provenance exceeds the subject record budget.',
        })
      return Object.freeze(records.map(copyProvenance))
    },
  }
  return Object.freeze(port)
}
