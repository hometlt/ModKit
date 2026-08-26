/**
 * Block 12 item 17 — the frozen runtime session v2 contract, checked against implementations.
 *
 * Two providers are exercised on purpose:
 *
 *  - a **full** one that declares every capability, so each rule has something to hold;
 *  - a **minimal** one that declares only `step`, because a provider that does less must still be
 *    conformant. Refusing honestly is conformance; the contract is about what a caller can rely on
 *    after reading `capabilities`, not about implementing everything.
 *
 * The third case is the one that keeps the other two meaningful: a deliberately broken provider,
 * whose snapshot restores to *almost* the right state. Nothing in a type system catches that, and a
 * harness that could not catch it either would be decoration. It is the exact failure snapshots
 * exist to prevent — a restore that looks like it worked.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { runRuntimeSessionV2Conformance } from '@modkitx-x3/testkit'
import {
  RUNTIME_SESSION_CONTRACT,
  type RuntimeEvent,
  type RuntimeRefusal,
  type RuntimeSessionCapability,
  type RuntimeSessionV2,
  type RuntimeSnapshot,
} from '@modkitx-x3/sdk/runtime'

const SCHEMA_ID = 'x3.test/counter-state'
const SCHEMA_VERSION = 1

const digestOf = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

const refuse = (reason: RuntimeRefusal['reason']): RuntimeRefusal => ({
  outcome: 'refused',
  reason,
  diagnostics: [],
})

interface ReferenceOptions {
  readonly capabilities: readonly RuntimeSessionCapability[]
  /** Deliberately lose information on restore, to prove the harness notices. */
  readonly loseOneTickOnRestore?: boolean
}

/**
 * A counter as a runtime.
 *
 * The state is one number, which is enough for every rule the contract states and small enough that
 * nothing about the rules is hidden behind the example.
 */
function referenceSession(options: ReferenceOptions): RuntimeSessionV2 {
  let ticks = 0
  let sequence = 0
  const log: RuntimeEvent[] = []
  const has = (capability: RuntimeSessionCapability): boolean =>
    options.capabilities.includes(capability)
  const stateBytes = (): Uint8Array => new TextEncoder().encode(JSON.stringify({ ticks }))

  return {
    contract: RUNTIME_SESSION_CONTRACT,
    sessionId: 'reference',
    providerId: 'x3.test/reference-runtime',
    budget: { maxWallTimeMs: 1000, maxTicks: 1000, maxMemoryBytes: 1024 * 1024 },
    capabilities: options.capabilities,

    async execute() {
      return {
        outcome: 'completed',
        value: null,
        usage: { wallTimeMs: 0, ticks, memoryBytes: 0 },
      } as never
    },
    async status() {
      return { state: 'ready' as const, executions: 0, ticks, memoryBytes: 0 }
    },
    async identity() {
      return {
        contentDigest: digestOf(stateBytes()),
        schemaId: SCHEMA_ID,
        schemaVersion: SCHEMA_VERSION,
      }
    },
    async step(count: number) {
      if (!has('step')) return refuse('capability-unavailable')
      for (let index = 0; index < count; index += 1) {
        ticks += 1
        sequence += 1
        log.push({ sequence, tick: ticks, kind: 'tick' })
      }
      return {
        outcome: 'stepped' as const,
        status: { state: 'ready' as const, executions: 0, ticks, memoryBytes: 0 },
        diagnostics: [],
      }
    },
    async *events(afterSequence = 0) {
      if (!has('events')) return
      for (const event of log) if (event.sequence > afterSequence) yield event
    },
    async snapshot() {
      if (!has('snapshot')) return refuse('capability-unavailable')
      const bytes = stateBytes()
      return {
        outcome: 'captured' as const,
        snapshot: {
          identity: {
            contentDigest: digestOf(bytes),
            schemaId: SCHEMA_ID,
            schemaVersion: SCHEMA_VERSION,
          },
          bytes,
        },
      }
    },
    async restore(snapshot: RuntimeSnapshot) {
      if (!has('restore')) return refuse('capability-unavailable')
      // schema before bytes: a foreign schema is refused without reading anything
      if (
        snapshot.identity.schemaId !== SCHEMA_ID ||
        snapshot.identity.schemaVersion !== SCHEMA_VERSION
      ) {
        return refuse('schema-mismatch')
      }
      if (digestOf(snapshot.bytes) !== snapshot.identity.contentDigest) {
        return refuse('digest-mismatch')
      }
      const parsed = JSON.parse(new TextDecoder().decode(snapshot.bytes)) as { ticks: number }
      ticks = options.loseOneTickOnRestore === true ? parsed.ticks - 1 : parsed.ticks
      return {
        outcome: 'restored' as const,
        status: { state: 'ready' as const, executions: 0, ticks, memoryBytes: 0 },
      }
    },
    async stateHash() {
      if (!has('state-hash')) return refuse('capability-unavailable')
      return { outcome: 'hashed' as const, stateHash: digestOf(stateBytes()) }
    },
  } as unknown as RuntimeSessionV2
}

const FOREIGN: RuntimeSnapshot = {
  identity: {
    contentDigest: digestOf(new TextEncoder().encode('{}')),
    schemaId: 'x3.test/some-other-runtime',
    schemaVersion: 1,
  },
  bytes: new TextEncoder().encode('{}'),
}

const ALL: readonly RuntimeSessionCapability[] = [
  'step',
  'events',
  'snapshot',
  'restore',
  'state-hash',
]

describe('12-4 runtime session v2 conformance', () => {
  it('a provider that declares everything satisfies every rule', async () => {
    const report = await runRuntimeSessionV2Conformance({
      openSession: async () => referenceSession({ capabilities: ALL }),
      foreignSnapshot: FOREIGN,
    })
    expect(report.failures, JSON.stringify(report.failures, null, 2)).toEqual([])
    // the suite must actually be running rules, not skipping into an empty pass
    expect(report.checks).toBeGreaterThanOrEqual(18)
    expect(report.capabilities).toEqual([...ALL])
  }, 60_000)

  it('a provider that declares only step is conformant by refusing the rest', async () => {
    const report = await runRuntimeSessionV2Conformance({
      openSession: async () => referenceSession({ capabilities: ['step'] }),
      foreignSnapshot: FOREIGN,
    })
    expect(report.failures, JSON.stringify(report.failures, null, 2)).toEqual([])
    expect(report.capabilities).toEqual(['step'])
  }, 60_000)

  it('catches a snapshot that restores to almost the right state', async () => {
    /*
     * One tick lost on restore. Every method is present, every capability is declared, every call
     * succeeds — and the session is silently wrong. This is what the round-trip rule is for, and
     * asserting the exact failing check is what stops the harness from passing this by accident
     * through some unrelated complaint.
     */
    const report = await runRuntimeSessionV2Conformance({
      openSession: async () => referenceSession({ capabilities: ALL, loseOneTickOnRestore: true }),
      foreignSnapshot: FOREIGN,
    })
    expect(report.failures.map(failure => failure.check)).toContain(
      'restore:returns-to-origin-hash',
    )
  }, 60_000)

  it('refuses an undeclared capability instead of throwing', async () => {
    const session = referenceSession({ capabilities: [] })
    const stepped = await session.step(1)
    expect(stepped).toMatchObject({ outcome: 'refused', reason: 'capability-unavailable' })
    const hashed = await session.stateHash()
    expect(hashed).toMatchObject({ outcome: 'refused', reason: 'capability-unavailable' })
  })
})
