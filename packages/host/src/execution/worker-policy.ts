/**
 * Worker backend policy (THREAT_MODEL_WORKER_BOUNDARY §8 decision 2): every limit a worker
 * backend applies — V8 resource limits, deadlines, grace and stdio caps — is chosen by the host's
 * composition root and bounded by hard host ceilings. It is never supplied by an extension
 * manifest, a runtime variant or an activation request; a variant may ask for a realm, not for
 * its own budgets.
 */

import { ModkitError } from '@modkit/core'

export interface WorkerResourceLimits {
  readonly maxOldGenerationSizeMb: number
  readonly maxYoungGenerationSizeMb: number
  readonly codeRangeSizeMb: number
  readonly stackSizeMb: number
}

export interface WorkerBackendPolicy {
  readonly resourceLimits: WorkerResourceLimits
  /** Budget for `load` (spawn + verify + evaluate + `ready`). */
  readonly loadDeadlineMs: number
  /** Default per-call deadline for the host endpoint. */
  readonly defaultCallDeadlineMs: number
  /** How long a peer may take to honour `cancel`/`terminate` before `worker.terminate()`. */
  readonly graceMs: number
  /** Cap on captured stdout and stderr, each. */
  readonly outputCapBytes: number
  /**
   * How many times one module lease may respawn its worker (generation + 1, same session) after
   * the worker died or was terminated, before further use of the lease is refused
   * (`x3.host/worker-restart-limit`). 0 disables restarts.
   */
  readonly maxRestartsPerLease: number
}

/** Hard ceilings no composition root can exceed. */
export const WORKER_BACKEND_POLICY_CEILINGS: WorkerBackendPolicy = Object.freeze({
  resourceLimits: Object.freeze({
    maxOldGenerationSizeMb: 4096,
    maxYoungGenerationSizeMb: 512,
    codeRangeSizeMb: 512,
    stackSizeMb: 64,
  }),
  loadDeadlineMs: 120_000,
  defaultCallDeadlineMs: 600_000,
  graceMs: 30_000,
  outputCapBytes: 4 * 1024 * 1024,
  maxRestartsPerLease: 1_000,
})

/**
 * Defaults sized for real game extensions, not just small codecs: the StarCraft II set needs a
 * few seconds to load its larger modules on a busy machine (15 s timed out under parallel test
 * load) and its data codec does not fit a 32 MB heap even on a one-unit fixture, so a small
 * default made such subjects open unresolved. A composition root may still choose tighter values.
 */
export const DEFAULT_WORKER_BACKEND_POLICY: WorkerBackendPolicy = Object.freeze({
  resourceLimits: Object.freeze({
    maxOldGenerationSizeMb: 2_048,
    maxYoungGenerationSizeMb: 256,
    codeRangeSizeMb: 64,
    stackSizeMb: 4,
  }),
  loadDeadlineMs: 120_000,
  defaultCallDeadlineMs: 120_000,
  graceMs: 5_000,
  outputCapBytes: 1024 * 1024,
  maxRestartsPerLease: 3,
})

export interface WorkerBackendPolicyInput {
  readonly resourceLimits?: Partial<WorkerResourceLimits>
  readonly loadDeadlineMs?: number
  readonly defaultCallDeadlineMs?: number
  readonly graceMs?: number
  readonly outputCapBytes?: number
  readonly maxRestartsPerLease?: number
}

function invalid(message: string): never {
  throw new ModkitError({ code: 'x3.host/invalid-worker-policy', message })
}

function bounded(name: string, value: number, ceiling: number, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    invalid(`${name} must be an integer ≥ ${minimum}, received ${String(value)}`)
  }
  if (value > ceiling) invalid(`${name} ${value} exceeds the host ceiling ${ceiling}`)
  return value
}

/**
 * Validates a policy against the ceilings; unspecified fields take the defaults. Values above a
 * ceiling are refused, not clamped — a misconfigured root must notice.
 */
export function workerBackendPolicy(input: WorkerBackendPolicyInput = {}): WorkerBackendPolicy {
  const c = WORKER_BACKEND_POLICY_CEILINGS
  const d = DEFAULT_WORKER_BACKEND_POLICY
  const limits = { ...d.resourceLimits, ...(input.resourceLimits ?? {}) }
  return Object.freeze({
    resourceLimits: Object.freeze({
      maxOldGenerationSizeMb: bounded(
        'resourceLimits.maxOldGenerationSizeMb',
        limits.maxOldGenerationSizeMb,
        c.resourceLimits.maxOldGenerationSizeMb,
      ),
      maxYoungGenerationSizeMb: bounded(
        'resourceLimits.maxYoungGenerationSizeMb',
        limits.maxYoungGenerationSizeMb,
        c.resourceLimits.maxYoungGenerationSizeMb,
      ),
      codeRangeSizeMb: bounded(
        'resourceLimits.codeRangeSizeMb',
        limits.codeRangeSizeMb,
        c.resourceLimits.codeRangeSizeMb,
      ),
      stackSizeMb: bounded(
        'resourceLimits.stackSizeMb',
        limits.stackSizeMb,
        c.resourceLimits.stackSizeMb,
      ),
    }),
    loadDeadlineMs: bounded(
      'loadDeadlineMs',
      input.loadDeadlineMs ?? d.loadDeadlineMs,
      c.loadDeadlineMs,
    ),
    defaultCallDeadlineMs: bounded(
      'defaultCallDeadlineMs',
      input.defaultCallDeadlineMs ?? d.defaultCallDeadlineMs,
      c.defaultCallDeadlineMs,
    ),
    graceMs: bounded('graceMs', input.graceMs ?? d.graceMs, c.graceMs),
    outputCapBytes: bounded(
      'outputCapBytes',
      input.outputCapBytes ?? d.outputCapBytes,
      c.outputCapBytes,
      0,
    ),
    maxRestartsPerLease: bounded(
      'maxRestartsPerLease',
      input.maxRestartsPerLease ?? d.maxRestartsPerLease,
      c.maxRestartsPerLease,
      0,
    ),
  })
}
