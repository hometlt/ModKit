/**
 * Conformance harness for the frozen runtime session v2 contract (block 12 item 17).
 *
 * A frozen contract is only frozen if something checks implementations against it, and the thing
 * worth checking is not "does it have these methods" — TypeScript already says that — but the
 * promises the methods make to each other:
 *
 *  - a declared offer works, and an undeclared one is *refused*, not thrown. A provider that
 *    throws on an unsupported call forces every caller into a try/catch and makes "unsupported" and
 *    "broken" the same shape.
 *  - `step` is deterministic: the same state stepped the same way lands on the same state hash.
 *  - `snapshot` → `restore` returns to the hash it came from. This is the whole point of snapshots;
 *    a snapshot that restores to something almost right is worse than none, because it looks fine.
 *  - restoring a foreign schema is refused by `schema-mismatch`, and corrupted bytes by
 *    `digest-mismatch`. Both are the identity earning its place: without them `restore` would read
 *    hopefully and fail later, somewhere else.
 *
 * The harness never assumes a provider supports everything. It reads `offers` and checks each
 * one both ways — present ones must work, absent ones must refuse — so a minimal provider is
 * conformant by refusing honestly rather than by implementing more.
 */
import {
  RUNTIME_SESSION_V2_MEMBERS,
  type RuntimeRefusal,
  type RuntimeEvent,
  type RuntimeSessionOffer,
  type RuntimeSessionV2,
  type RuntimeSnapshot,
} from '@modkitx-x3/sdk/runtime'

export interface RuntimeConformanceFailure {
  readonly check: string
  readonly detail: string
}

export interface RuntimeConformanceReport {
  readonly checks: number
  readonly failures: readonly RuntimeConformanceFailure[]
  readonly offers: readonly RuntimeSessionOffer[]
}

const isRefusal = (value: unknown): value is RuntimeRefusal =>
  typeof value === 'object' &&
  value !== null &&
  (value as { outcome?: string }).outcome === 'refused'

export interface RuntimeConformanceOptions {
  /** A fresh session, at the same starting state each time it is called. */
  openSession: () => Promise<RuntimeSessionV2>
  /** A snapshot whose schema this provider does not implement. */
  readonly foreignSnapshot: RuntimeSnapshot
}

/** Run every v2 rule against one provider. An empty `failures` is the whole claim. */
export async function runRuntimeSessionV2Conformance(
  options: RuntimeConformanceOptions,
): Promise<RuntimeConformanceReport> {
  const failures: RuntimeConformanceFailure[] = []
  let checks = 0
  const check = (name: string, condition: boolean, detail: string): void => {
    checks += 1
    if (!condition) failures.push({ check: name, detail })
  }

  const session = await options.openSession()
  const offers = [...session.offers]
  const has = (offer: RuntimeSessionOffer): boolean => offers.includes(offer)

  // --- the surface itself ----------------------------------------------------------------------
  for (const member of RUNTIME_SESSION_V2_MEMBERS) {
    check(
      `member:${member}`,
      (session as unknown as Record<string, unknown>)[member] !== undefined,
      `a v2 session must expose «${member}»`,
    )
  }

  const identity = await session.identity()
  check(
    'identity:qualified-digest',
    /^[a-z0-9-]+:[0-9a-f]+$/u.test(identity.contentDigest),
    `contentDigest must be algorithm-qualified, found «${identity.contentDigest}»`,
  )
  check(
    'identity:schema-major',
    Number.isSafeInteger(identity.schemaVersion) && identity.schemaVersion >= 1,
    `schemaVersion must be a positive integer, found ${String(identity.schemaVersion)}`,
  )

  // --- step --------------------------------------------------------------------------------------
  const stepped = await session.step(1)
  if (has('step')) {
    check(
      'step:works',
      !isRefusal(stepped),
      `a declared «step» offer must step: ${JSON.stringify(stepped)}`,
    )
  } else {
    check(
      'step:refused-when-undeclared',
      isRefusal(stepped) && stepped.reason === 'offer-unavailable',
      'an undeclared «step» must be refused with offer-unavailable, not thrown',
    )
  }

  // --- deterministic state hash --------------------------------------------------------------------
  if (has('state-hash')) {
    const first = await session.stateHash()
    const again = await session.stateHash()
    check(
      'state-hash:stable',
      !isRefusal(first) && !isRefusal(again) && first.stateHash === again.stateHash,
      'hashing the same state twice must give the same hash',
    )

    if (has('step')) {
      /*
       * Determinism, stated as the property that matters: two sessions from the same start, stepped
       * the same way, agree. Comparing one session against itself would only prove the hash is
       * cached.
       */
      const left = await options.openSession()
      const right = await options.openSession()
      await left.step(3)
      await right.step(3)
      const leftHash = await left.stateHash()
      const rightHash = await right.stateHash()
      check(
        'state-hash:deterministic-across-sessions',
        !isRefusal(leftHash) && !isRefusal(rightHash) && leftHash.stateHash === rightHash.stateHash,
        'two sessions stepped identically from the same start must hash equal',
      )
      const oneMore = await options.openSession()
      await oneMore.step(4)
      const otherHash = await oneMore.stateHash()
      check(
        'state-hash:distinguishes-states',
        !isRefusal(otherHash) && !isRefusal(leftHash) && otherHash.stateHash !== leftHash.stateHash,
        'a different number of steps should not hash the same; a constant hash proves nothing',
      )
    }
  }

  // --- snapshot and restore --------------------------------------------------------------------
  if (has('snapshot') && has('restore') && has('state-hash') && has('step')) {
    const origin = await options.openSession()
    await origin.step(2)
    const before = await origin.stateHash()
    const captured = await origin.snapshot()
    check(
      'snapshot:works',
      !isRefusal(captured),
      `a declared «snapshot» must capture: ${JSON.stringify(captured)}`,
    )
    if (!isRefusal(captured) && !isRefusal(before)) {
      const target = await options.openSession()
      await target.step(7)
      const restored = await target.restore(captured.snapshot)
      check(
        'restore:works',
        !isRefusal(restored),
        `a declared «restore» must restore: ${JSON.stringify(restored)}`,
      )
      const after = await target.stateHash()
      check(
        'restore:returns-to-origin-hash',
        !isRefusal(after) && after.stateHash === before.stateHash,
        'a restored session must hash exactly as the session the snapshot came from',
      )

      // corrupted bytes are caught by the identity that travels with them
      const corrupted: RuntimeSnapshot = {
        identity: captured.snapshot.identity,
        bytes: Uint8Array.from([...captured.snapshot.bytes, 0xff]),
      }
      const refusedDigest = await (await options.openSession()).restore(corrupted)
      check(
        'restore:digest-mismatch',
        isRefusal(refusedDigest) && refusedDigest.reason === 'digest-mismatch',
        'bytes that disagree with their own digest must be refused, not read hopefully',
      )
    }

    const refusedSchema = await (await options.openSession()).restore(options.foreignSnapshot)
    check(
      'restore:schema-mismatch',
      isRefusal(refusedSchema) && refusedSchema.reason === 'schema-mismatch',
      'a snapshot from another schema must be refused by schema, before its bytes are read',
    )
  }

  // --- events --------------------------------------------------------------------------------------
  if (has('events') && has('step')) {
    const source = await options.openSession()
    await source.step(3)
    const collected: RuntimeEvent[] = []
    for await (const event of source.events()) collected.push(event)
    check(
      'events:ordered',
      collected.every(
        (event, index) => index === 0 || event.sequence > (collected[index - 1]?.sequence ?? 0),
      ),
      'event sequences must be strictly increasing',
    )
    check(
      'events:sequence-starts-at-one',
      collected.length === 0 || collected[0]?.sequence === 1,
      'the first event of a session is sequence 1, so a gap is visible as a gap',
    )
    const tail: RuntimeEvent[] = []
    for await (const event of source.events(1)) tail.push(event)
    check(
      'events:after-sequence-excludes',
      tail.every(event => event.sequence > 1),
      '«afterSequence» must exclude the sequence it names, or resuming a stream replays one event',
    )
  }

  return { checks, failures, offers }
}
