/**
 * Host-owned companion input resolution (block 9, step 1).
 *
 * A codec declares *what* it needs (`AssetInputRequirement`: role, patterns, expected traits,
 * search scopes, cardinality) and never *where* it lives. This module is the host side of that
 * seam: it takes a host-private origin — the trusted place the primary subject actually came
 * from — enumerates it under an explicit budget, and hands the codec back an `AssetInput` whose
 * only reachable sources are the bindings the host itself chose.
 *
 * **What the codec does and does not get.** It receives host-issued *source identity* for the
 * bindings that were selected — `ResolvedAssetInputBinding.source` is a real `AssetSourceRef` with
 * a real URI, and under `read-source` seeing the identity metadata of a source it was granted is
 * exactly what that permission means. What it does not receive is an origin handle, or any right
 * to resolve, construct or open a URI of its own choosing: `openBinding` accepts only ids the host
 * minted for this input, the origin stays captured in a closure the codec never sees, and there is
 * no enumeration surface on `AssetInput` at all. An earlier version of this comment claimed no URI
 * ever reaches a codec, which was simply not true of the ABI and is worth stating accurately —
 * the boundary is authority over resolution, not concealment of names.
 *
 * Three rules hold the design together, and each of them is a test:
 *
 * 1. **The hot path pays nothing.** A plan with no requirements (`originKind: 'single'`, and a
 *    bare namespace) short-circuits into the same construction `subject-open` used before this
 *    module existed — zero enumerations, zero opens. Most files opened by most applications take
 *    exactly that path, and it must stay free.
 * 2. **No format branching.** The algorithm knows requirements, scopes, patterns and cardinality.
 *    It does not know VXL from W3D, and it does not know a directory from an archive: that is the
 *    origin backend's job. The filesystem backend below is the first of them; an archive backend
 *    plugs into the same interface without touching the algorithm.
 * 3. **Named outcomes, never silent ones.** A scope the origin cannot serve, a required companion
 *    that is missing, two candidates where one was asked for — each ends in a stable diagnostic
 *    code carrying the requirement id, its role and the scopes that were actually checked. The
 *    resolver never picks arbitrarily and never substitutes.
 */

import {
  canonicalJsonStringify,
  compareUtf8,
  diagnostic,
  ModkitError,
  throwIfAborted,
  type Diagnostic,
} from '@modkit/core'
import {
  CODEC_CONTRIBUTION_CONTRACT,
  type ArtifactByteSource,
  type ArtifactSource,
  type AssetInput,
  type AssetInputRequirement,
  type AssetInputRevisionVector,
  type AssetNamespace,
  type CodecContributionSpecV1Wire,
  type InputSearchScope,
  type Lease,
  type PhysicalAssetInputPlan,
  type ResolvedCandidateInputBinding,
  type ResolvedRequirementInputBinding,
  type RevisionId,
  type SignatureRule,
  type TraitQuery,
} from '@modkit/sdk'
import { matchesSignatures, signatureNeeds, type SignatureWindows } from './detection-index.js'
import type { Inventory } from './inventory.js'
import {
  defaultResolveInput,
  type SubjectInputResolutionContext,
  type SubjectInputResolver,
} from './subject-open.js'

// ---------------------------------------------------------------------------------------------
// diagnostic codes

/** A `required` requirement matched nothing in any scope the origin could serve. */
export const COMPANION_REQUIRED_MISSING = 'x3.host/companion-required-missing'
/** More candidates than the declared cardinality admits. The host never picks one at random. */
export const COMPANION_AMBIGUOUS = 'x3.host/companion-ambiguous'
/** A logical id that is not a plain confined name (traversal, absolute, UNC, drive, NUL). */
export const COMPANION_PATH_REFUSED = 'x3.host/companion-path-refused'
/** A pattern that is malformed, or so broad it would amount to an unbounded scan. */
export const COMPANION_PATTERN_INVALID = 'x3.host/companion-pattern-invalid'
/** Every scope the requirement asked for is one this origin does not serve. */
export const COMPANION_SCOPE_UNSUPPORTED = 'x3.host/companion-scope-unsupported'
/** Entry, probe, probe-byte, binding or deadline limit reached during resolution. */
export const COMPANION_BUDGET_EXCEEDED = 'x3.host/companion-budget-exceeded'
/** The requirement set itself is malformed (blank/duplicate id, cardinality/required mismatch). */
export const COMPANION_PLAN_INVALID = 'x3.host/companion-plan-invalid'
/** `expected` traits were declared but this composition wired no host-owned trait probe. */
export const COMPANION_TRAIT_PROBE_UNAVAILABLE = 'x3.host/companion-trait-probe-unavailable'
/** Informational: an optional companion is absent, with the reason it is absent. */
export const COMPANION_UNAVAILABLE = 'x3.host/companion-unavailable'

// ---------------------------------------------------------------------------------------------
// the host-private origin backend

export interface CompanionOriginEntry {
  /** Confined logical name inside the origin; `/`-separated, never absolute. */
  readonly logicalId: string
  readonly size?: bigint
}

/**
 * Case policy is a property of the *backend*, not of the algorithm: a Windows directory and a
 * case-folded archive index both collapse two spellings onto one logical entry, and a POSIX
 * directory does not. The backend declares which it is; the resolver folds accordingly, so
 * `sample.hva` and `SAMPLE.HVA` are one companion on an insensitive backend and two on a
 * sensitive one.
 */
export type CompanionCaseSensitivity = 'sensitive' | 'insensitive'

export interface CompanionEnumerationOptions {
  /**
   * Logical-id prefix the resolver derived from the requirement's own patterns; `''` means none.
   *
   * A hint, never a filter the backend may rely on being applied — the resolver matches patterns
   * again over whatever comes back. It exists because "enumerate everything and then filter" stops
   * being a bounded search once a namespace is large: a production namespace may list hundreds of thousands of
   * entries, which is not a scan any budget should permit. A backend that can narrow its listing
   * cheaply should; one whose logical ids carry no path structure (a directory, whose ids are bare
   * names) ignores this and loses nothing.
   *
   * Format-neutral by construction: a prefix is a property of a logical-id space, which every
   * backend has, and the resolver derives it from the codec's declared patterns without knowing
   * what any of them mean.
   */
  readonly prefix: string
}

/**
 * The trusted place a subject came from. Host-private by construction: it is created by product
 * wiring, closed over by the resolver, and never reaches a codec or a public host export.
 */
export interface CompanionOrigin {
  /** Logical id of the primary subject itself; never offered as its own companion. */
  readonly primaryLogicalId: string
  readonly caseSensitivity: CompanionCaseSensitivity
  /** Scopes this backend can actually serve. Anything else is a named unsupported outcome. */
  readonly scopes: readonly InputSearchScope[]
  /** Bounded enumeration. The resolver counts entries and stops at its own limit. */
  enumerate(
    scope: InputSearchScope,
    options: CompanionEnumerationOptions,
    signal?: AbortSignal,
  ): AsyncIterable<CompanionOriginEntry>
  open(logicalId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>>
}

// ---------------------------------------------------------------------------------------------
// bounded, host-owned trait validation

export interface CompanionTraitProbeRequest {
  readonly requirementId: string
  readonly logicalId: string
  readonly source: ArtifactSource
  readonly expected: TraitQuery
  /** Bytes this probe may still read before the resolution budget is spent. */
  readonly maxBytes: number
}

/** Host-owned and bounded. It answers a yes/no about one candidate; it never opens a session. */
export type CompanionTraitProbe = (
  request: CompanionTraitProbeRequest,
  signal?: AbortSignal,
) => boolean | Promise<boolean>

function traitIdsOf(query: TraitQuery, key: 'all' | 'any' | 'none'): readonly string[] {
  return (query[key] ?? []).map(item => item.id)
}

/**
 * The default probe: the host's own signature index, over inert inventory data.
 *
 * It reads one bounded head/tail window of the candidate, finds the codec contributions whose
 * declared byte signatures match it, and evaluates the trait query against what *those*
 * contributions declare they expose. No codec is activated and no session is opened, which is the
 * whole point — validating a companion must not cost an activation per candidate.
 *
 * The honest limit: this proves a *declared* trait of an identified format, not an *observed*
 * trait state of the opened file. A query that constrains `states` therefore cannot be satisfied
 * here and is refused rather than quietly accepted.
 */
export function createSignatureTraitProbe(inventory: Inventory): CompanionTraitProbe {
  interface Entry {
    readonly signatures: readonly SignatureRule[]
    readonly traits: readonly string[]
  }
  const entries: Entry[] = []
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      if (manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1) {
        continue
      }
      const spec = manifest.spec as unknown as CodecContributionSpecV1Wire
      const signatures = spec.match.signatures
      if (signatures === undefined || signatures.length === 0) continue
      entries.push({
        signatures,
        traits: (spec.traitDeclarations ?? []).map(item => item.id),
      })
    }
  }
  const needs = signatureNeeds(entries.map(entry => entry.signatures))
  return async (request, signal): Promise<boolean> => {
    for (const key of ['all', 'any', 'none'] as const) {
      if ((request.expected[key] ?? []).some(item => item.states !== undefined)) {
        throw new ModkitError({
          code: COMPANION_TRAIT_PROBE_UNAVAILABLE,
          message:
            'the signature trait probe proves declared traits, not observed trait states; ' +
            'a state-constrained companion query needs a probe this composition does not have',
          context: { requirementId: request.requirementId, logicalId: request.logicalId },
        })
      }
    }
    if (request.source.kind !== 'bytes') return false
    const source: ArtifactByteSource = request.source
    const size = source.size
    if (size === undefined) return false
    const budget = BigInt(request.maxBytes)
    const headLength = Number(
      [size, BigInt(needs.prefix), budget].reduce((left, right) => (left < right ? left : right)),
    )
    const head = headLength <= 0 ? new Uint8Array(0) : await source.read(0n, headLength, signal)
    const tailLength = Number(
      [size, BigInt(needs.suffix), budget - BigInt(headLength)].reduce((left, right) =>
        left < right ? left : right,
      ),
    )
    const tail =
      tailLength <= 0
        ? new Uint8Array(0)
        : await source.read(size - BigInt(tailLength), tailLength, signal)
    const windows: SignatureWindows = { head, tail, size }
    const declared = new Set<string>()
    for (const entry of entries) {
      if (!matchesSignatures(entry.signatures, windows)) continue
      for (const trait of entry.traits) declared.add(trait)
    }
    const all = traitIdsOf(request.expected, 'all')
    const any = traitIdsOf(request.expected, 'any')
    const none = traitIdsOf(request.expected, 'none')
    if (!all.every(id => declared.has(id))) return false
    if (any.length > 0 && !any.some(id => declared.has(id))) return false
    if (none.some(id => declared.has(id))) return false
    return true
  }
}

// ---------------------------------------------------------------------------------------------
// budgets

export interface CompanionResolutionLimits {
  /** Entries the resolver will take from one scope before refusing to continue. */
  readonly maxEntries: number
  /** Candidates that may be trait-probed across the whole resolution. */
  readonly maxProbes: number
  /** Bytes every trait probe may read, summed across the whole resolution. */
  readonly maxProbeBytes: number
  /** Requirement bindings one input may carry. */
  readonly maxBindings: number
}

export const DEFAULT_COMPANION_LIMITS: CompanionResolutionLimits = Object.freeze({
  maxEntries: 4096,
  maxProbes: 64,
  maxProbeBytes: 256 * 1024,
  maxBindings: 64,
})

export interface CompanionInputResolverOptions {
  readonly limits?: Partial<CompanionResolutionLimits>
  /** Wall-clock ceiling for one resolution, checked between every bounded step. */
  readonly deadlineMs?: number
  /** Host-owned bounded validation for requirements that declare `expected` traits. */
  readonly traitProbe?: CompanionTraitProbe
  /**
   * Product-supplied bindings for `explicit-user-selection`. The host core never opens a picker;
   * a scope with no selections here is an unsupported outcome, not a prompt.
   */
  readonly explicitSelections?: Readonly<Record<string, readonly string[]>>
  /** Where named non-fatal outcomes go (an absent optional companion, an unserved scope). */
  readonly onDiagnostic?: (item: Diagnostic) => void
  /** Injectable clock; the deadline is measured against it. */
  readonly now?: () => number
}

interface BudgetState {
  entries: number
  probes: number
  probeBytes: number
  bindings: number
}

// ---------------------------------------------------------------------------------------------
// normalization and patterns

const DRIVE_PREFIX = /^[A-Za-z]:/u

function refusePath(value: string, why: string, context: Record<string, unknown>): never {
  throw new ModkitError({
    code: COMPANION_PATH_REFUSED,
    message: `companion logical id «${value}» is refused: ${why}`,
    context: { ...context, logicalId: value },
  })
}

/**
 * One logical name inside a confined origin. Separators are normalized to `/`; everything that
 * could name something outside the origin — a `..` segment, a leading `/`, a drive letter, a UNC
 * prefix, a NUL — is refused rather than sanitized, because sanitizing a hostile name silently
 * produces a *different* name that then resolves to a real file.
 */
export function normalizeCompanionLogicalId(
  value: string,
  context: Record<string, unknown> = {},
): string {
  if (value.includes('\0')) refusePath(value, 'it contains a NUL byte', context)
  const slashed = value.replaceAll('\\', '/')
  if (slashed.startsWith('//')) refusePath(slashed, 'it is a UNC path', context)
  if (slashed.startsWith('/')) refusePath(slashed, 'it is an absolute path', context)
  if (DRIVE_PREFIX.test(slashed)) refusePath(slashed, 'it carries a drive prefix', context)
  const parts: string[] = []
  for (const part of slashed.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') refusePath(slashed, 'it escapes the confined origin root', context)
    parts.push(part)
  }
  const normalized = parts.join('/')
  if (normalized === '') refusePath(value, 'it names nothing', context)
  return normalized
}

const WILDCARDS = new Set(['*', '?'])

/**
 * Compiles a requirement's patterns once. A pattern must carry at least one literal character:
 * `*` alone, or `**`, is not a narrow declaration but a request to look at everything, and §1.4
 * of the block plan forbids turning that into a hidden full scan.
 */
function compilePatterns(
  requirementId: string,
  patterns: readonly string[] | undefined,
  caseSensitivity: CompanionCaseSensitivity,
): {
  readonly test: (logicalId: string) => boolean
  /** Listing hint for backends whose namespace is too large to enumerate whole. */
  readonly prefix: string
} {
  if (patterns === undefined || patterns.length === 0) {
    throw new ModkitError({
      code: COMPANION_PATTERN_INVALID,
      message: `requirement «${requirementId}» declares no patterns; an unbounded companion scan is refused`,
      context: { requirementId },
    })
  }
  /** `{ expression, whole }` — see the comment at the bottom of this function. */
  const expressions: { readonly expression: RegExp; readonly whole: boolean }[] = []
  for (const pattern of patterns) {
    const invalid = (why: string): never => {
      throw new ModkitError({
        code: COMPANION_PATTERN_INVALID,
        message: `companion pattern «${pattern}» of requirement «${requirementId}» is refused: ${why}`,
        context: { requirementId, pattern },
      })
    }
    if (pattern.length === 0) invalid('it is empty')
    if (pattern.includes('\0')) invalid('it contains a NUL byte')
    if (pattern.includes('**')) invalid('recursive patterns are not a bounded companion search')
    if (pattern.startsWith('/') || pattern.startsWith('\\')) invalid('it is an absolute path')
    if (DRIVE_PREFIX.test(pattern)) invalid('it carries a drive prefix')
    if (pattern.replaceAll('\\', '/').split('/').includes('..')) {
      invalid('it escapes the confined origin root')
    }
    if (![...pattern].some(character => !WILDCARDS.has(character))) {
      invalid('it has no literal part and would match every entry')
    }
    let expression = '^'
    for (const character of pattern.replaceAll('\\', '/')) {
      if (character === '*') expression += '[^/]*'
      else if (character === '?') expression += '[^/]'
      else expression += character.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')
    }
    // a pattern is matched under the *backend's* case rule: on a folding backend `*.hva` and
    // `SAMPLE.HVA` name the same file, and a case-sensitive regex would quietly claim otherwise
    expressions.push({
      expression: new RegExp(`${expression}$`, caseSensitivity === 'insensitive' ? 'iu' : 'u'),
      whole: pattern.replaceAll('\\', '/').includes('/'),
    })
  }
  /*
   * What a pattern is matched against depends on whether the codec wrote a path in it.
   *
   * A directory backend hands out bare names, so the two readings coincide there and this rule is
   * invisible. An archive backend hands out `data/editor/molds/bowl.w3d`, and a codec that declared
   * `*.tga` meant "an entry named like that" — it does not know, and must not need to know, which
   * folder the container filed it under. A pattern that *does* carry a `/` is a deliberate
   * statement about location, and is matched against the whole logical id.
   */
  return {
    test: (logicalId: string) => {
      const name = logicalId.split('/').at(-1) ?? logicalId
      return expressions.some(item => item.expression.test(item.whole ? logicalId : name))
    },
    prefix: enumerationPrefix(patterns),
  }
}

/**
 * The longest logical-id prefix every pattern of a requirement agrees on.
 *
 * Each pattern contributes the most it can safely promise about where a match may live:
 *
 *  * a pattern with no wildcard promises its whole self — anything matching it *is* it, so the
 *    complete literal is a sound prefix. On a large installed corpus this is the difference
 *    between listing 1 entry and listing 4,100;
 *  * a pattern with a wildcard promises only up to the last `/` before it. `assets/tex*` narrows
 *    to `assets/`, never to `assets/tex`, which would silently exclude `assets/textures/hero.dds`;
 *  * a bare name like `bowl.tga` promises nothing, because it says nothing about location and the
 *    resolver must not invent one.
 *
 * When patterns disagree, their common part is cut back to a `/` for the same reason: a character
 * boundary in the middle of a segment is not a location either.
 */
function enumerationPrefix(patterns: readonly string[]): string {
  const safe = patterns.map(pattern => {
    const normalized = pattern.replaceAll('\\', '/')
    // a pattern with no separator is matched against the entry's *name*, so `bowl.tga` may live at
    // `art/textures/bowl.tga` and licenses no prefix whatsoever — see `compilePatterns`
    if (!normalized.includes('/')) return ''
    const wildcard = normalized.search(/[*?]/u)
    if (wildcard === -1) return normalized
    const literal = normalized.slice(0, wildcard)
    const cut = literal.lastIndexOf('/')
    return cut === -1 ? '' : literal.slice(0, cut + 1)
  })
  const first = safe[0]
  if (first === undefined) return ''
  if (safe.every(value => value === first)) return first
  let common = first
  for (const value of safe.slice(1)) {
    let length = 0
    while (length < common.length && length < value.length && common[length] === value[length]) {
      length += 1
    }
    common = common.slice(0, length)
  }
  const cut = common.lastIndexOf('/')
  return cut === -1 ? '' : common.slice(0, cut + 1)
}

// ---------------------------------------------------------------------------------------------
// the resolver

interface SelectedCandidate {
  readonly requirement: AssetInputRequirement
  readonly logicalId: string
  readonly bindingId: string
  readonly ref: ArtifactSource['ref']
  readonly revision: RevisionId
}

function validateRequirements(requirements: readonly AssetInputRequirement[]): void {
  const seen = new Set<string>()
  for (const requirement of requirements) {
    const invalid = (why: string): never => {
      throw new ModkitError({
        code: COMPANION_PLAN_INVALID,
        message: `companion requirement «${requirement.id}» is invalid: ${why}`,
        context: { requirementId: requirement.id, role: requirement.role },
      })
    }
    if (typeof requirement.id !== 'string' || requirement.id.trim().length === 0) {
      invalid('its id is blank')
    }
    if (seen.has(requirement.id)) invalid('its id is not unique within the plan')
    seen.add(requirement.id)
    if (typeof requirement.role !== 'string' || requirement.role.trim().length === 0) {
      invalid('its role is blank')
    }
    if (!['owned', 'companion', 'external'].includes(requirement.ownership)) {
      invalid(`ownership «${String(requirement.ownership)}» is not a declared ownership`)
    }
    const required = requirement.cardinality === 'one' || requirement.cardinality === 'one-or-more'
    if (requirement.required !== required) {
      invalid(
        `cardinality «${requirement.cardinality}» does not agree with required=${String(requirement.required)}`,
      )
    }
    if (!Array.isArray(requirement.scopes) || requirement.scopes.length === 0) {
      invalid('it declares no search scope')
    }
  }
}

/**
 * Binds a host-private origin into the `SubjectInputResolver` hook of `openSubject`.
 *
 * The returned resolver is the *only* thing the open pipeline sees; the origin stays captured in
 * this closure, which is what keeps the public SDK contract unchanged — a codec still receives an
 * `AssetInput` and nothing else.
 */
export function createCompanionInputResolver(
  origin: CompanionOrigin,
  options: CompanionInputResolverOptions = {},
): SubjectInputResolver {
  const limits: CompanionResolutionLimits = Object.freeze({
    ...DEFAULT_COMPANION_LIMITS,
    ...options.limits,
  })
  const now = options.now ?? (() => Date.now())
  const report = options.onDiagnostic
  const explicit = options.explicitSelections

  return async (context: SubjectInputResolutionContext): Promise<AssetInput> => {
    const plan = context.plan
    /*
     * The hot path. `single` never carries requirements and a bare namespace has none either, so
     * neither needs an origin, an enumeration or a single extra open — they go straight through
     * the construction the host used before this module existed. This early return is the whole
     * of §3.3 ("`single` gets no new I/O"), and the counters in the test suite guard it.
     */
    if (plan.originKind === 'derived' || plan.requirements.length === 0) {
      return defaultResolveInput(context)
    }
    if (plan.originKind === 'bundle' && context.source.kind !== 'bytes') {
      throw new ModkitError({
        code: 'x3.host/input-topology-mismatch',
        message: 'a bundle input plan requires a byte subject source',
      })
    }
    if (plan.originKind === 'namespace' && context.source.kind !== 'namespace') {
      throw new ModkitError({
        code: 'x3.host/input-topology-mismatch',
        message: 'a namespace input plan requires a namespace subject source',
      })
    }
    const signal = context.signal
    const deadlineAt = options.deadlineMs === undefined ? undefined : now() + options.deadlineMs
    const budget: BudgetState = { entries: 0, probes: 0, probeBytes: 0, bindings: 0 }
    const checkpoint = (stage: string): void => {
      throwIfAborted(signal)
      if (deadlineAt !== undefined && now() > deadlineAt) {
        throw new ModkitError({
          code: COMPANION_BUDGET_EXCEEDED,
          message: `companion resolution exceeded its ${String(options.deadlineMs)}ms deadline`,
          context: { limit: 'deadline', stage, deadlineMs: options.deadlineMs },
        })
      }
    }
    const exceeded = (limit: string, value: number): never => {
      throw new ModkitError({
        code: COMPANION_BUDGET_EXCEEDED,
        message: `companion resolution exceeded its ${limit} limit of ${value}`,
        context: { limit, value },
      })
    }
    /*
     * A refusal is reported *and* thrown. `openSubject` turns a thrown resolver error into a
     * diagnostic carrying only its code and message, which is enough to know that an open failed
     * and not enough to know which requirement failed it — so the structured detail (requirement,
     * role, the scopes actually checked) goes out through the host's own sink first.
     */
    const refuse = (
      code: string,
      message: string,
      detail: Readonly<Record<string, unknown>>,
    ): never => {
      report?.(diagnostic('error', code, message, [String(detail['requirementId'])], detail))
      throw new ModkitError({ code, message, context: detail })
    }

    validateRequirements(plan.requirements)

    // keyed by scope *and* prefix: two requirements that narrow to different places must not
    // read each other's listing, and two that narrow to the same place should share one
    const enumerated = new Map<string, readonly string[]>()
    const served = new Set<InputSearchScope>(origin.scopes)
    if (explicit !== undefined) served.add('explicit-user-selection')

    const enumerateScope = async (
      scope: InputSearchScope,
      prefix: string,
    ): Promise<readonly string[]> => {
      const key = canonicalJsonStringify([scope, prefix])
      const cached = enumerated.get(key)
      if (cached !== undefined) return cached
      const ids: string[] = []
      if (scope === 'explicit-user-selection') {
        for (const value of Object.values(explicit ?? {}).flat()) {
          ids.push(normalizeCompanionLogicalId(value, { scope }))
        }
      } else {
        for await (const entry of origin.enumerate(scope, { prefix }, signal)) {
          checkpoint(`enumerate:${scope}`)
          budget.entries += 1
          if (budget.entries > limits.maxEntries) exceeded('entries', limits.maxEntries)
          ids.push(normalizeCompanionLogicalId(entry.logicalId, { scope }))
        }
      }
      const frozen = Object.freeze(ids)
      enumerated.set(key, frozen)
      return frozen
    }

    const fold = (value: string): string =>
      origin.caseSensitivity === 'insensitive' ? value.toLowerCase() : value

    const primaryKey = fold(normalizeCompanionLogicalId(origin.primaryLogicalId))
    const selected: SelectedCandidate[] = []
    const usedBindingIds = new Set<string>()
    /** Identity observed while probing, reused so an accepted candidate is opened once, not twice. */
    const pinned = new Map<
      string,
      { readonly ref: ArtifactSource['ref']; readonly revision: RevisionId }
    >()

    for (const requirement of plan.requirements) {
      checkpoint(`requirement:${requirement.id}`)
      const patterns = compilePatterns(requirement.id, requirement.patterns, origin.caseSensitivity)
      const requested = [...requirement.scopes].sort(compareUtf8)
      const usable = requested.filter(scope => served.has(scope))
      if (usable.length === 0) {
        const detail = {
          requirementId: requirement.id,
          role: requirement.role,
          requestedScopes: requested,
          servedScopes: [...served].sort(compareUtf8),
          reason: requested.includes('explicit-user-selection')
            ? 'no-product-selection'
            : requested.includes('workspace-dependency-layer')
              ? 'no-provider'
              : 'origin-cannot-serve-scope',
        }
        if (requirement.required) {
          refuse(
            COMPANION_SCOPE_UNSUPPORTED,
            `required companion «${requirement.role}» (requirement «${requirement.id}») asks only for scopes this origin cannot serve: ${requested.join(', ')}`,
            detail,
          )
        }
        report?.(
          diagnostic(
            'warning',
            COMPANION_SCOPE_UNSUPPORTED,
            `optional companion «${requirement.role}» is unavailable: none of its scopes can be served here`,
            [requirement.id],
            detail,
          ),
        )
        continue
      }

      // stable candidate set: sort by the logical id itself, then fold for identity, so the
      // outcome never depends on the order the backend happened to enumerate in
      const matched: string[] = []
      for (const scope of usable) {
        for (const logicalId of await enumerateScope(scope, patterns.prefix)) {
          if (
            scope === 'explicit-user-selection' &&
            !(explicit?.[requirement.id] ?? []).some(
              value => fold(normalizeCompanionLogicalId(value)) === fold(logicalId),
            )
          ) {
            continue
          }
          if (fold(logicalId) === primaryKey) continue
          if (!patterns.test(logicalId)) continue
          matched.push(logicalId)
        }
      }
      matched.sort(compareUtf8)
      const unique: string[] = []
      const seenKeys = new Set<string>()
      for (const logicalId of matched) {
        const key = fold(logicalId)
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        unique.push(logicalId)
      }

      const accepted: string[] = []
      const rejected: string[] = []
      for (const logicalId of unique) {
        checkpoint(`validate:${requirement.id}`)
        if (requirement.expected === undefined) {
          accepted.push(logicalId)
          continue
        }
        if (options.traitProbe === undefined) {
          throw new ModkitError({
            code: COMPANION_TRAIT_PROBE_UNAVAILABLE,
            message: `requirement «${requirement.id}» declares expected traits but this host wired no companion trait probe`,
            context: { requirementId: requirement.id, role: requirement.role },
          })
        }
        budget.probes += 1
        if (budget.probes > limits.maxProbes) exceeded('probes', limits.maxProbes)
        const remaining = limits.maxProbeBytes - budget.probeBytes
        if (remaining <= 0) exceeded('probeBytes', limits.maxProbeBytes)
        const lease = await origin.open(logicalId, signal)
        let ok = false
        try {
          pinned.set(logicalId, { ref: lease.value.ref, revision: lease.value.revision })
          ok = await options.traitProbe(
            {
              requirementId: requirement.id,
              logicalId,
              // every byte the probe pulls is counted by the host, not reported by the probe
              source: countingSource(lease.value, read => {
                budget.probeBytes += read
                if (budget.probeBytes > limits.maxProbeBytes) {
                  exceeded('probeBytes', limits.maxProbeBytes)
                }
              }),
              expected: requirement.expected,
              maxBytes: remaining,
            },
            signal,
          )
        } finally {
          await lease.release()
        }
        ;(ok ? accepted : rejected).push(logicalId)
      }

      const detail = {
        requirementId: requirement.id,
        role: requirement.role,
        cardinality: requirement.cardinality,
        checkedScopes: usable,
        requestedScopes: requested,
        matched: unique.length,
        rejectedByExpectedTraits: rejected,
      }
      const singular =
        requirement.cardinality === 'one' || requirement.cardinality === 'zero-or-one'
      if (singular && accepted.length > 1) {
        refuse(
          COMPANION_AMBIGUOUS,
          `companion «${requirement.role}» (requirement «${requirement.id}») admits at most one candidate but ${accepted.length} matched in ${usable.join(', ')}`,
          { ...detail, candidates: accepted },
        )
      }
      if (requirement.required && accepted.length === 0) {
        refuse(
          COMPANION_REQUIRED_MISSING,
          `required companion «${requirement.role}» (requirement «${requirement.id}») was not found in any checked scope: ${usable.join(', ')}`,
          detail,
        )
      }
      if (accepted.length === 0) {
        report?.(
          diagnostic(
            'information',
            COMPANION_UNAVAILABLE,
            `optional companion «${requirement.role}» is absent; the dependent capability stays unavailable`,
            [requirement.id],
            {
              ...detail,
              reason: rejected.length > 0 ? 'expected-traits-rejected' : 'no-candidate-matched',
            },
          ),
        )
        continue
      }

      for (const logicalId of accepted) {
        checkpoint(`bind:${requirement.id}`)
        budget.bindings += 1
        if (budget.bindings > limits.maxBindings) exceeded('bindings', limits.maxBindings)
        const bindingId = `${requirement.id}#${logicalId}`
        if (usedBindingIds.has(bindingId)) {
          throw new ModkitError({
            code: COMPANION_PLAN_INVALID,
            message: `companion binding id «${bindingId}» is not unique within the resolved input`,
            context: { requirementId: requirement.id, bindingId },
          })
        }
        usedBindingIds.add(bindingId)
        /*
         * Bindings carry provenance, and provenance the host did not observe is provenance the
         * host invented — so identity comes from an actual open, released immediately. A candidate
         * that was already opened for its trait probe is not opened a second time.
         */
        let identity = pinned.get(logicalId)
        if (identity === undefined) {
          const lease = await origin.open(logicalId, signal)
          try {
            identity = { ref: lease.value.ref, revision: lease.value.revision }
            pinned.set(logicalId, identity)
          } finally {
            await lease.release()
          }
        }
        selected.push({
          requirement,
          logicalId,
          bindingId,
          ref: identity.ref,
          revision: identity.revision,
        })
      }
    }

    return buildAssetInput(context, plan, origin, selected, signal)
  }
}

/**
 * The candidate source a trait probe sees, with every byte it pulls reported back to the host's
 * own budget. The probe cannot under-report what it read, because it is not the one counting.
 */
function countingSource(source: ArtifactSource, onBytes: (read: number) => void): ArtifactSource {
  if (source.kind !== 'bytes') return source
  const inner = source
  return Object.freeze({
    ...inner,
    async read(offset: bigint, length: number, signal?: AbortSignal): Promise<Uint8Array> {
      const bytes = await inner.read(offset, length, signal)
      onBytes(bytes.byteLength)
      return bytes
    },
    async *stream(
      range?: { readonly offset: bigint; readonly length?: bigint },
      signal?: AbortSignal,
    ): AsyncIterable<Uint8Array> {
      for await (const chunk of inner.stream(range, signal)) {
        onBytes(chunk.byteLength)
        yield chunk
      }
    },
  })
}

function buildAssetInput(
  context: SubjectInputResolutionContext,
  plan: PhysicalAssetInputPlan,
  origin: CompanionOrigin,
  selected: readonly SelectedCandidate[],
  signal: AbortSignal | undefined,
): AssetInput {
  const requirementBindings = selected.map((item): ResolvedRequirementInputBinding =>
    Object.freeze({
      sourceKind: 'requirement' as const,
      bindingId: item.bindingId,
      requirementId: item.requirement.id,
      role: item.requirement.role,
      ownership: item.requirement.ownership,
      source: item.ref,
      revision: item.revision,
    }),
  )
  const openRequirement = async (
    bindingId: string,
    openSignal?: AbortSignal,
  ): Promise<Lease<ArtifactSource>> => {
    throwIfAborted(openSignal ?? signal)
    const item = selected.find(candidate => candidate.bindingId === bindingId)
    if (item === undefined) {
      throw new ModkitError({
        code: 'x3.host/unknown-asset-input-binding',
        message: `asset input has no binding ${bindingId}`,
      })
    }
    const lease = await origin.open(item.logicalId, openSignal ?? signal)
    if (lease.value.revision !== item.revision) {
      await lease.release()
      throw new ModkitError({
        code: 'x3.host/source-revision-changed',
        message: `companion «${item.logicalId}» changed after it was bound (revision ${item.revision})`,
        context: { bindingId, revision: item.revision, observed: lease.value.revision },
      })
    }
    return lease
  }
  const bindingsFor = (requirementId: string): readonly ResolvedRequirementInputBinding[] =>
    Object.freeze(requirementBindings.filter(item => item.requirementId === requirementId))

  if (plan.originKind === 'namespace') {
    const source = context.source as Extract<ArtifactSource, { kind: 'namespace' }>
    const revisions = Object.freeze({
      topology: 'namespace' as const,
      revision: source.revision,
      namespaceRevision: source.revision,
      bindings: Object.freeze(
        requirementBindings.map(item =>
          Object.freeze({ bindingId: item.bindingId, revision: item.revision }),
        ),
      ),
      compositionFingerprint: canonicalJsonStringify({
        topology: 'namespace',
        root: source.ref,
        revision: source.revision,
        bindings: requirementBindings.map(item => ({
          bindingId: item.bindingId,
          source: item.source,
          revision: item.revision,
        })),
      }),
    }) as Extract<AssetInputRevisionVector, { readonly topology: 'namespace' }>
    return Object.freeze({
      originKind: 'namespace' as const,
      root: source.ref,
      bindings: Object.freeze(requirementBindings),
      revisions,
      bindingsFor,
      openBinding: openRequirement,
      async openNamespace(openSignal?: AbortSignal): Promise<Lease<AssetNamespace>> {
        throwIfAborted(openSignal ?? signal)
        return source.openNamespace(openSignal ?? signal)
      },
    })
  }

  const source = context.source as ArtifactByteSource
  const candidatePlan = plan.candidate
  if (
    candidatePlan === undefined ||
    candidatePlan.bindingId.trim().length === 0 ||
    candidatePlan.role.trim().length === 0 ||
    (candidatePlan.ownership !== 'owned' && candidatePlan.ownership !== 'external')
  ) {
    throw new ModkitError({
      code: 'x3.host/invalid-asset-input-plan',
      message: 'codec returned an invalid bundle candidate binding',
    })
  }
  const candidate: ResolvedCandidateInputBinding = Object.freeze({
    sourceKind: 'candidate' as const,
    bindingId: candidatePlan.bindingId,
    role: candidatePlan.role,
    ownership: candidatePlan.ownership,
    source: source.ref,
    revision: source.revision,
  })
  if (requirementBindings.some(item => item.bindingId === candidate.bindingId)) {
    throw new ModkitError({
      code: COMPANION_PLAN_INVALID,
      message: `companion binding id «${candidate.bindingId}» collides with the candidate binding`,
      context: { bindingId: candidate.bindingId },
    })
  }
  const bindings = Object.freeze([candidate, ...requirementBindings]) as unknown as readonly [
    ResolvedCandidateInputBinding,
    ...ResolvedRequirementInputBinding[],
  ]
  const revisions = Object.freeze({
    topology: 'bundle' as const,
    revision: source.revision,
    bindings: Object.freeze(
      bindings.map(item => Object.freeze({ bindingId: item.bindingId, revision: item.revision })),
    ),
    compositionFingerprint: canonicalJsonStringify({
      topology: 'bundle',
      bindings: bindings.map(item => ({
        bindingId: item.bindingId,
        source: item.source,
        revision: item.revision,
      })),
    }),
  }) as unknown as Extract<AssetInputRevisionVector, { readonly topology: 'bundle' }>
  return Object.freeze({
    originKind: 'bundle' as const,
    bindings,
    primaryBindingId: candidate.bindingId,
    revisions,
    bindingsFor,
    async openBinding(bindingId: string, openSignal?: AbortSignal): Promise<Lease<ArtifactSource>> {
      throwIfAborted(openSignal ?? signal)
      if (bindingId === candidate.bindingId) {
        return Object.freeze({ value: source, release: async () => undefined })
      }
      return openRequirement(bindingId, openSignal)
    },
  })
}
