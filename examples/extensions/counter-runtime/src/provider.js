import { RUNTIME_PROVIDER_CONTRACT, RUNTIME_SESSION_CONTRACT } from '@modkit/sdk/runtime'

const PROVIDER_ID = 'modkit.reference/counter-runtime'
const RUNTIME_ID = 'reference.counter'
const RESOURCE_KEYS = new Set(['wallTimeMs', 'ticks', 'memoryBytes'])
const BUDGET_KEYS = new Set(['maxWallTimeMs', 'maxTicks', 'maxMemoryBytes'])
const ZERO_USAGE = Object.freeze({ wallTimeMs: 0, ticks: 0, memoryBytes: 0 })
const NO_DIAGNOSTICS = Object.freeze([])

const recordOf = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined

const nonNegativeSafeInteger = value =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function hasExactKeys(record, keys) {
  const own = Object.keys(record)
  return own.length === keys.size && own.every(key => keys.has(key))
}

function runtimeBudget(value) {
  const record = recordOf(value)
  if (
    record === undefined ||
    !hasExactKeys(record, BUDGET_KEYS) ||
    !nonNegativeSafeInteger(record.maxWallTimeMs) ||
    !nonNegativeSafeInteger(record.maxTicks) ||
    !nonNegativeSafeInteger(record.maxMemoryBytes)
  ) {
    throw new TypeError('runtime budget must contain non-negative safe integers')
  }
  return Object.freeze({
    maxWallTimeMs: record.maxWallTimeMs,
    maxTicks: record.maxTicks,
    maxMemoryBytes: record.maxMemoryBytes,
  })
}

function executionResources(value) {
  const record = recordOf(value)
  if (
    record === undefined ||
    !hasExactKeys(record, RESOURCE_KEYS) ||
    !nonNegativeSafeInteger(record.wallTimeMs) ||
    !nonNegativeSafeInteger(record.ticks) ||
    !nonNegativeSafeInteger(record.memoryBytes)
  ) {
    throw new TypeError('runtime execution resources must contain non-negative safe integers')
  }
  return Object.freeze({
    wallTimeMs: record.wallTimeMs,
    ticks: record.ticks,
    memoryBytes: record.memoryBytes,
  })
}

function refusal(reason, label, limit, requested) {
  const message = `${label} budget exceeded: requested ${requested}, limit ${limit}`
  return Object.freeze({
    state: 'refused',
    reason,
    message,
    limit,
    requested,
    usage: ZERO_USAGE,
    diagnostics: Object.freeze([
      Object.freeze({
        severity: 'warning',
        code: `reference.counter/${reason}`,
        message,
      }),
    ]),
  })
}

function createCounterSession(request) {
  request.signal?.throwIfAborted()
  if (typeof request.sessionId !== 'string' || request.sessionId.trim().length === 0) {
    throw new TypeError('counter runtime requires a non-empty session id')
  }
  const budget = runtimeBudget(request.budget)
  let state = 'ready'
  let counter = 0
  let executions = 0
  let ticks = 0
  let memoryBytes = 0

  const status = () => Promise.resolve(Object.freeze({ state, executions, ticks, memoryBytes }))

  const execute = async execution => {
    execution.signal?.throwIfAborted()
    if (state === 'disposed')
      throw new TypeError(`runtime session ${request.sessionId} is disposed`)
    if (state === 'executing') {
      throw new TypeError(`runtime session ${request.sessionId} already has an active execution`)
    }
    if (execution.entrypoint !== 'counter.advance') {
      throw new TypeError(`unsupported counter runtime entrypoint ${execution.entrypoint}`)
    }
    const by = execution.arguments?.[0] ?? 1
    if (!Number.isSafeInteger(by)) throw new TypeError('counter.advance expects one safe integer')
    const resources = executionResources(execution.resources)
    if (resources.wallTimeMs > budget.maxWallTimeMs) {
      return refusal('max-wall-time-ms', 'wall time', budget.maxWallTimeMs, resources.wallTimeMs)
    }
    const requestedTicks = ticks + resources.ticks
    if (requestedTicks > budget.maxTicks) {
      return refusal('max-ticks', 'tick', budget.maxTicks, requestedTicks)
    }
    const requestedMemory = memoryBytes + resources.memoryBytes
    if (requestedMemory > budget.maxMemoryBytes) {
      return refusal('max-memory-bytes', 'memory', budget.maxMemoryBytes, requestedMemory)
    }

    state = 'executing'
    try {
      execution.signal?.throwIfAborted()
      counter += by
      executions += 1
      ticks = requestedTicks
      memoryBytes = requestedMemory
      return Object.freeze({
        state: 'completed',
        value: Object.freeze({ counter }),
        usage: resources,
        diagnostics: NO_DIAGNOSTICS,
      })
    } finally {
      if (state !== 'disposed') state = 'ready'
    }
  }

  const session = Object.freeze({
    contract: RUNTIME_SESSION_CONTRACT,
    sessionId: request.sessionId,
    providerId: PROVIDER_ID,
    budget,
    execute,
    status,
  })
  let released = false
  return Object.freeze({
    value: session,
    async release() {
      if (released) return
      released = true
      state = 'disposed'
      memoryBytes = 0
    },
  })
}

export const abiVersion = 1
export const provides = Object.freeze([RUNTIME_PROVIDER_CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== RUNTIME_PROVIDER_CONTRACT || selection.major !== 1) {
    throw new TypeError(`unsupported runtime selection ${selection.contract}@${selection.major}`)
  }
  return Object.freeze({
    value: Object.freeze({
      contract: RUNTIME_PROVIDER_CONTRACT,
      providerId: PROVIDER_ID,
      runtimeIds: Object.freeze([RUNTIME_ID]),
      createSession: request => Promise.resolve(createCounterSession(request)),
    }),
    release: async () => undefined,
  })
}
