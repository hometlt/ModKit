/**
 * Evidence declarations: a test says what it proves, beside the assertion that proves it.
 *
 * Block 12 slice 12-5, closing exit-gate line 2a. Decision 67 of the canon asks that conformance
 * badges be *generated* from testkit evidence rather than self-declared, and slice 12-3 built the
 * machine fields (`projection.operations`) but could only populate five rows: attributing the rest
 * by hand would have been the rule-of-thumb the field exists to replace. This is the missing half.
 *
 * The shape of the rule matters more than the mechanism. A declaration is written **at the proof**:
 *
 *     const descriptor = await session.descriptor()
 *     expect(descriptor.dataSources).toContain(…)
 *     proves({ contributionId: 'modkit/png', operation: 'inspect' })
 *
 * not in a table somewhere else. A list kept beside the tests is a second thing to maintain and it
 * rots in the direction that flatters: assertions get deleted, list entries do not. A declaration
 * that sits in the test body disappears exactly when the proof does.
 *
 * Each declaration is appended to `reports/evidence/raw/` the moment it is made, not buffered until
 * exit: vitest runs suites in worker *threads*, where an exit hook is not a reliable place to write
 * anything and where several workers share one pid. A file per worker plus an immediate append is
 * the arrangement that survives both. `scripts/migration/emit-evidence.mjs` merges and de-duplicates
 * them into one sorted document, so the artifact can be committed and diffed like every other
 * generated file here — the merge is deterministic even though the run that produced it is not.
 *
 * What this deliberately does not do: it does not check that the assertion beside it is any good.
 * A declaration is a claim about *which* capability and operation a test covers, and the registry
 * gate then requires that the named test exists and that the capability declares that operation.
 * Whether the test is a strong one stays a matter for review — this makes it visible, not true.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/** The operations a projection row can carry evidence for; mirrors `PROJECTION_OPERATION_KEYS`. */
export type EvidenceOperation = 'inspect' | 'validate' | 'read' | 'materialize'

export interface EvidenceDeclaration {
  /** A row in `migration/capabilities.yaml`, when the test knows one. */
  readonly capabilityId?: string
  /**
   * The MK3 contribution the assertion exercised, resolved to capability rows at merge time.
   *
   * A test usually knows the *contribution* it opened rather than the capability row that owns it,
   * so this is the other way in. Keeping the mapping in the generator means 74 tests do not each
   * carry a copy of it, and the copy cannot drift.
   */
  readonly contributionId?: string
  readonly operation: EvidenceOperation
  /**
   * Repository-relative path of the test file making the claim.
   *
   * Defaulted from the call site so the common case cannot get it wrong: a copied declaration that
   * kept someone else's path would name a test that does not contain the assertion.
   */
  readonly test?: string
  /** Optional one-line note about what the assertion actually shows. */
  readonly note?: string
}

type EvidenceRecord = EvidenceDeclaration & { readonly test: string }

const OPERATIONS: readonly EvidenceOperation[] = ['inspect', 'validate', 'read', 'materialize']

const collected = new Map<string, EvidenceRecord>()
/** One file per worker: threads share a pid, so the pid alone would let appends interleave. */
let runFile: string | undefined

/** Repository root, found from this module's location rather than from a worker's cwd. */
const repoRoot = join(import.meta.dirname, '..', '..', '..')

const subjectOf = (item: EvidenceDeclaration): string =>
  item.capabilityId ?? item.contributionId ?? ''

const keyOf = (item: EvidenceRecord): string => `${subjectOf(item)} ${item.operation} ${item.test}`

function callerTest(): string | undefined {
  const stack = new Error('evidence').stack ?? ''
  for (const line of stack.split('\n').slice(1)) {
    const match = /(?:\(|\s)((?:[A-Za-z]:)?[^():]+\.(?:test|spec)\.[cm]?[jt]sx?)/u.exec(line)
    if (match?.[1] === undefined) continue
    const found = match[1].replace(/^file:\/\/\/?/u, '').replaceAll('\\', '/')
    const rooted = repoRoot.replaceAll('\\', '/')
    return found.startsWith(rooted) ? found.slice(rooted.length + 1) : found
  }
  return undefined
}

function record(entry: EvidenceRecord): void {
  if (runFile === undefined) {
    const directory = join(repoRoot, 'reports', 'evidence', 'raw')
    mkdirSync(directory, { recursive: true })
    runFile = join(directory, `${process.pid}-${randomUUID()}.jsonl`)
  }
  appendFileSync(runFile, `${JSON.stringify(entry)}\n`, 'utf8')
}

/**
 * Declare that the surrounding assertion proves `operation` for one capability or contribution.
 *
 * Idempotent: a parameterised case that declares the same thing a hundred times is one record, so a
 * data-driven suite declares once per row without inflating anything.
 */
export function proves(declaration: EvidenceDeclaration): void {
  const subject = subjectOf(declaration)
  if (subject.trim() === '') {
    throw new TypeError('an evidence declaration must name a capabilityId or a contributionId')
  }
  if (declaration.capabilityId !== undefined && declaration.contributionId !== undefined) {
    throw new TypeError(
      `evidence for «${subject}» names both a capabilityId and a contributionId; one subject, one name`,
    )
  }
  if (!OPERATIONS.includes(declaration.operation)) {
    throw new TypeError(
      `evidence operation must be one of ${OPERATIONS.join(' | ')}, got «${String(declaration.operation)}»`,
    )
  }
  const test = declaration.test ?? callerTest()
  if (test === undefined) {
    throw new TypeError(
      `evidence for ${subject} cannot find its test file; pass an explicit test path`,
    )
  }
  const entry: EvidenceRecord = {
    ...(declaration.capabilityId === undefined ? {} : { capabilityId: declaration.capabilityId }),
    ...(declaration.contributionId === undefined
      ? {}
      : { contributionId: declaration.contributionId }),
    operation: declaration.operation,
    test,
    ...(declaration.note === undefined ? {} : { note: declaration.note }),
  }
  const key = keyOf(entry)
  if (collected.has(key)) return
  collected.set(key, entry)
  record(entry)
}

/** Everything declared in this process so far. Exposed for the harness's own tests. */
export function declaredEvidence(): readonly EvidenceRecord[] {
  return [...collected.values()].sort((left, right) => (keyOf(left) < keyOf(right) ? -1 : 1))
}

/** Drop everything collected. For tests of the harness; never call it from a real suite. */
export function resetDeclaredEvidence(): void {
  collected.clear()
}
