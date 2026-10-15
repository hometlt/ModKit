/** Host-composed execution mechanisms; artifact security admission stays in security/gate.ts.
 * Optional trusted Node worker capacity belongs to one composition-root registry shared across
 * subjects/activations/generations, not a per-document/client allowance. Pending and warm live
 * realms remain charged; only an actual resolved Node exit or known pre-spawner rollback frees
 * capacity. Root close is terminal, with uncertain exit retained. This does not bound memory/RSS,
 * supervise browser exit or expose a voxel operation; no new public package/barrel export.
 * Existing unconfigured generic backends retain their behavior. A bounded client must require
 * explicit root policy. Global-symbol captured owners preserve separately bundled Host identity.
 */

import { ModkitError, throwIfAborted } from '@modkit/core'
import type {
  ExecutionProfile,
  PermissionGrant,
  RuntimeTarget,
  RuntimeVariantDeclaration,
} from '@modkit/sdk'
import type { ActivationTicket } from '../security/gate.js'

export interface ExecutionBackendActivation {
  /** Trusted registry-owned allowance, never chosen by an activation/job. Node only for now. */
  readonly workerAdmission?: WorkerRealmAdmission | undefined
  /** A gate-issued ticket that has already passed identity/digest/target checks. */
  readonly ticket: ActivationTicket
  readonly entrypoint: URL
  readonly artifactRoot: URL
  /**
   * Per-file digests of the artifact as inventoried (posix path relative to `artifactRoot` →
   * `sha256:…`), still valid because the gate re-verified the artifact digest just now. A backend
   * that evaluates files elsewhere verifies each one against this map right before evaluation.
   */
  readonly fileDigests?: Readonly<Record<string, string>>
  readonly variant: RuntimeVariantDeclaration
  readonly target: RuntimeTarget
  readonly grant: PermissionGrant
  readonly signal?: AbortSignal
}

export interface ExecutionModuleLease {
  readonly module: Record<string, unknown>
  /** Idempotent release of the backend realm/process/worker resources. */
  release(): Promise<void>
}

export interface ExecutionBackend {
  readonly profile: ExecutionProfile
  /** Pure feature/realm availability check. Throwing means unavailable. */
  readonly supports: (target: RuntimeTarget, variant: RuntimeVariantDeclaration) => boolean
  readonly activate: (
    context: ExecutionBackendActivation,
  ) => ExecutionModuleLease | Promise<ExecutionModuleLease>
}

export interface ExecutionBackendRegistry {
  readonly profiles: readonly ExecutionProfile[]
  /**
   * Where `trusted-in-process` code runs when this registry activates codecs for another realm:
   * the process that owns the registry. A Node host resolves for its worker realm, yet a linked
   * built-in (`@modkit/uv`'s materializer) can only run in the host process; without this its
   * `node` offer never matched the `node-worker` target. Absent: in-process code runs in the target.
   */
  readonly inProcessTarget?: RuntimeTarget
  supports(
    profile: ExecutionProfile,
    target: RuntimeTarget,
    variant: RuntimeVariantDeclaration,
  ): boolean
}

interface BackendBinding {
  readonly profile: ExecutionProfile
  readonly supports: ExecutionBackend['supports']
  readonly activate: ExecutionBackend['activate']
}

/** One pending/spawned generation; only the existing Node realm owner reports its actual exit. */
export interface WorkerRealmReservation {
  /** Refuse a root closed while asynchronous pre-spawn work was pending. */
  beginSpawn(): void
  /** Attach the actual Node exit promise, not a reply, release or terminate acknowledgement. */
  observeExit(exit: Promise<unknown>, terminate: () => Promise<unknown>): void
  /** Refund only before entering the spawner; a thrown spawn call is not proof no Worker exists. */
  rollbackBeforeSpawn(): void
}

/** Shared by every subject/activation/generation under one trusted composition root. */
export interface WorkerRealmAdmission {
  reserve(): WorkerRealmReservation
}

interface RegistryLifetime {
  readonly admission: WorkerRealmAdmission | undefined
  readonly closed: boolean
  close(): Promise<void>
}

const PROFILE_VALUES: readonly ExecutionProfile[] = Object.freeze([
  'browser-sandbox',
  'worker-brokered',
  'process-brokered',
  'wasm-brokered',
  'trusted-in-process',
  'remote-provider',
])
/**
 * The private bindings travel on the registry object under a global symbol (not a module-local
 * WeakMap): the published entries of this package (`.`, `./node`) are bundled separately, so a
 * registry created by `@modkit/host/node` must be honoured by the gate inside
 * `@modkit/host`. Non-enumerable and symbol-keyed: a spread copy or a hand-built look-alike
 * still carries no bindings and is refused.
 */
const REGISTRY_BINDINGS = Symbol.for('x3.host/execution-backend-registry-bindings')
// Like the bindings, carry the actual owner object across separately published Host bundles.
const REGISTRY_LIFETIME = Symbol.for('x3.host/execution-backend-registry-lifetime')

/** Read the captured owner, never reconstruct an allowance from a client or a copied registry. */
function lifetimeOf(registry: ExecutionBackendRegistry): RegistryLifetime {
  const lifetime = (registry as unknown as Record<symbol, unknown>)[REGISTRY_LIFETIME]
  if (bindingsOf(registry) === undefined || lifetime === undefined)
    throw invalid('execution backend registry was not created by this host')
  return lifetime as RegistryLifetime
}

/** Root policy is opt-in; pending generations and warm live workers both occupy slots. */
function registryLifetime(maxWorkerRealms: number | undefined): RegistryLifetime {
  if (maxWorkerRealms !== undefined &&
      (!Number.isSafeInteger(maxWorkerRealms) || maxWorkerRealms < 1))
    throw invalid('maxWorkerRealms must be a positive safe integer')
  let closed = false
  let closing: Promise<void> | undefined
  const held = new Set<{ done: Promise<void>; stop?: () => Promise<unknown> }>()
  const admission: WorkerRealmAdmission | undefined = maxWorkerRealms === undefined ? undefined : Object.freeze({
    /** Reserve synchronously, before a generation can start digest/graph I/O or spawn. */
    reserve(): WorkerRealmReservation {
      if (closed) throw invalid('execution backend root is closed')
      if (held.size >= maxWorkerRealms) throw new ModkitError({
        code: 'x3.host/worker-capacity-exceeded', message: 'host root worker capacity is occupied',
        retryability: 'never',
      })
      let finish!: () => void
      const record: { done: Promise<void>; stop?: () => Promise<unknown> } = {
        done: new Promise<void>(resolve => { finish = resolve }),
      }
      held.add(record)
      let phase: 'pending' | 'spawning' | 'running' | 'finished' = 'pending'
      /** A completed reservation cannot release a later generation's slot. */
      const release = (): void => { held.delete(record); phase = 'finished'; finish() }
      return Object.freeze({
        /** Root closure wins even when it occurred during the digest await. */
        beginSpawn(): void {
          if (phase !== 'pending' || closed) throw invalid('worker reservation cannot spawn')
          phase = 'spawning'
        },
        /** Only resolution of the real exit promise refunds; rejection stays charged. */
        observeExit(exit: Promise<unknown>, terminate: () => Promise<unknown>): void {
          if (phase !== 'spawning') throw invalid('worker reservation cannot observe exit')
          phase = 'running'
          record.stop = terminate
          void exit.then(release, () => undefined)
          if (closed) void Promise.resolve().then(terminate).catch(() => undefined)
        },
        /** Only the trusted pre-spawn path can prove no Worker construction was attempted. */
        rollbackBeforeSpawn(): void {
          if (phase === 'running' || phase === 'spawning')
            throw invalid('a spawned or uncertain worker needs observed exit')
          if (phase !== 'finished') release()
        },
      })
    },
  })
  return Object.freeze({
    admission,
    get closed() { return closed },
    /** Close admission immediately; stop through existing owners, wait on exit/never-spawned rollback. */
    close(): Promise<void> {
      if (closing !== undefined) return closing
      closed = true
      const pending = [...held]
      for (const record of pending)
        if (record.stop !== undefined) void Promise.resolve().then(record.stop).catch(() => undefined)
      closing = Promise.all(pending.map(record => record.done)).then(() => undefined)
      return closing
    },
  })
}

/** Future bounded kernel clients must require this existing root, never create their own budget. */
export function requireWorkerRealmAdmission(registry: ExecutionBackendRegistry): WorkerRealmAdmission {
  const lifetime = lifetimeOf(registry)
  if (lifetime.closed || lifetime.admission === undefined)
    throw invalid('an open host root with explicit worker policy is required')
  return lifetime.admission
}

/** Terminal root teardown; does not reset the allowance or infer exit from a release/acknowledgement. */
export function closeExecutionBackendRegistry(registry: ExecutionBackendRegistry): Promise<void> {
  return lifetimeOf(registry).close()
}

function bindingsOf(
  registry: ExecutionBackendRegistry,
): ReadonlyMap<ExecutionProfile, BackendBinding> | undefined {
  const value = (registry as unknown as Record<symbol, unknown>)[REGISTRY_BINDINGS]
  return value instanceof Map ? (value as ReadonlyMap<ExecutionProfile, BackendBinding>) : undefined
}

function invalid(message: string): ModkitError {
  return new ModkitError({ code: 'x3.host/invalid-execution-backend', message })
}

export function createExecutionBackendRegistry(
  backends: readonly ExecutionBackend[],
  options: { readonly inProcessTarget?: RuntimeTarget; readonly maxWorkerRealms?: number } = {},
): ExecutionBackendRegistry {
  const lifetime = registryLifetime(options.maxWorkerRealms)
  const bindings = new Map<ExecutionProfile, BackendBinding>()
  for (const [index, backend] of backends.entries()) {
    if (typeof backend !== 'object' || backend === null) {
      throw invalid(`execution backend[${index}] must be an object`)
    }
    const profile = backend.profile
    const supports = backend.supports
    const activate = backend.activate
    if (!PROFILE_VALUES.includes(profile)) {
      throw invalid(`execution backend[${index}] has an invalid profile`)
    }
    if (typeof supports !== 'function' || typeof activate !== 'function') {
      throw invalid(`execution backend ${profile} must provide supports and activate callbacks`)
    }
    if (bindings.has(profile)) {
      throw invalid(`execution backend profile ${profile} is registered more than once`)
    }
    bindings.set(profile, Object.freeze({ profile, supports, activate }))
  }
  const profiles = Object.freeze([...bindings.keys()].sort())
  const registry: ExecutionBackendRegistry = {
    profiles,
    ...(options.inProcessTarget === undefined ? {} : { inProcessTarget: options.inProcessTarget }),
    supports(
      profile: ExecutionProfile,
      target: RuntimeTarget,
      variant: RuntimeVariantDeclaration,
    ): boolean {
      try {
        const binding = bindings.get(profile)
        if (lifetime.closed || binding === undefined || variant.executionProfile !== profile) return false
        return binding.supports(target, variant) === true
      } catch {
        return false
      }
    },
  }
  Object.defineProperty(registry, REGISTRY_BINDINGS, {
    value: bindings,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  Object.defineProperty(registry, REGISTRY_LIFETIME, { value: lifetime })
  return Object.freeze(registry)
}

/** Internal gate-to-backend dispatch. Not exported from the package root. */
export async function activateExecutionBackend(
  registry: ExecutionBackendRegistry,
  context: ExecutionBackendActivation,
): Promise<ExecutionModuleLease> {
  throwIfAborted(context.signal)
  const bindings = bindingsOf(registry)
  if (bindings === undefined) {
    throw invalid('execution backend registry was not created by this host')
  }
  const lifetime = lifetimeOf(registry)
  if (lifetime.closed) throw invalid('execution backend root is closed')
  const profile = context.variant.executionProfile
  const binding = bindings.get(profile)
  if (binding === undefined || !registry.supports(profile, context.target, context.variant)) {
    throw new ModkitError({
      code: 'x3.host/execution-backend-unavailable',
      message: `no execution backend can honour ${profile} for ${context.target.environment}`,
      context: { profile, environment: context.target.environment },
    })
  }
  const raw = await binding.activate({
    ...context,
    // Overwrite a caller-supplied admission value even for an unconfigured root.
    workerAdmission: lifetime.admission,
    entrypoint: new URL(context.entrypoint.href),
    artifactRoot: new URL(context.artifactRoot.href),
  })
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof raw.module !== 'object' ||
    raw.module === null ||
    Array.isArray(raw.module) ||
    typeof raw.release !== 'function'
  ) {
    if (typeof raw === 'object' && raw !== null && typeof raw.release === 'function') {
      try {
        await raw.release()
      } catch {
        // The malformed backend result is already rejected; cleanup failure cannot make it valid.
      }
    }
    throw invalid(`execution backend ${profile} returned an invalid module lease`)
  }
  let released = false
  return Object.freeze({
    module: raw.module,
    async release(): Promise<void> {
      if (released) return
      released = true
      await raw.release()
    },
  })
}

/**
 * The in-process backend: `import()` of the entrypoint in the host realm. It is offered to
 * variants declaring `trusted-in-process`; the gate additionally requires the inventory's explicit
 * `allowTrustedInProcess` decision for the artifact (24 §5.1: full process authority is never
 * inferred). Composition roots register it next to their brokered backends.
 */
export const TRUSTED_IN_PROCESS_EXECUTION_BACKEND: ExecutionBackend = /* @__PURE__ */ Object.freeze(
  {
    profile: 'trusted-in-process',
    supports: (_target: RuntimeTarget, variant: RuntimeVariantDeclaration) =>
      variant.executionProfile === 'trusted-in-process',
    async activate(context: ExecutionBackendActivation): Promise<ExecutionModuleLease> {
      throwIfAborted(context.signal)
      const module = (await import(context.entrypoint.href)) as Record<string, unknown>
      return Object.freeze({ module, release: async () => undefined })
    },
  } satisfies ExecutionBackend,
)

/**
 * The in-process backend of a host with statically linked extensions.
 *
 * Same profile and same gate as `TRUSTED_IN_PROCESS_EXECUTION_BACKEND`; the difference is where
 * the module comes from. A linked entrypoint (`modkit-linked://…`, minted by
 * `defineLinkedExtension`) is served from the registry of modules the application imported at
 * build time — that code is already in the process, and `import()` of a synthetic URL would be
 * both impossible and beside the point. Anything not in the registry falls back to the plain
 * dynamic `import()`, so one backend serves a host that mixes linked and directory extensions.
 */
export function linkedInProcessBackend(
  linked: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): ExecutionBackend {
  return Object.freeze({
    profile: 'trusted-in-process',
    supports: (_target: RuntimeTarget, variant: RuntimeVariantDeclaration) =>
      variant.executionProfile === 'trusted-in-process',
    async activate(context: ExecutionBackendActivation): Promise<ExecutionModuleLease> {
      throwIfAborted(context.signal)
      const preLinked = linked.get(context.entrypoint.href)
      if (preLinked !== undefined) {
        return Object.freeze({ module: preLinked, release: async () => undefined })
      }
      if (context.entrypoint.protocol === 'modkit-linked:') {
        throw new ModkitError({
          code: 'x3.host/linked-module-missing',
          message: `no linked module was registered for ${context.entrypoint.href}`,
          context: { entrypoint: context.entrypoint.href },
        })
      }
      const module = (await import(context.entrypoint.href)) as Record<string, unknown>
      return Object.freeze({ module, release: async () => undefined })
    },
  } satisfies ExecutionBackend)
}

/** Compatibility composition used until an application supplies explicit worker/process realms. */
export const DEFAULT_EXECUTION_BACKENDS: ExecutionBackendRegistry =
  /* @__PURE__ */ createExecutionBackendRegistry([TRUSTED_IN_PROCESS_EXECUTION_BACKEND])
