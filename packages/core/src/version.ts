/**
 * Deterministic SemVer 2.0.0 subset (owner of the request forms: MK3/23 §4).
 * Supported ranges: `*` / omitted, `1.x` / `1.2.x`, exact `1.2.3` / `=1.2.3`,
 * caret `^1.2` / `^1.2.3`, and space-joined comparator conjunctions `>=1.2 <2`.
 */

export interface SemVer {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly (string | number)[]
  readonly build: readonly string[]
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

function parseSafeInteger(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function parseSemver(value: string): SemVer | undefined {
  const m = SEMVER.exec(value)
  if (!m) return undefined
  const major = parseSafeInteger(m[1] ?? '')
  const minor = parseSafeInteger(m[2] ?? '')
  const patch = parseSafeInteger(m[3] ?? '')
  if (major === undefined || minor === undefined || patch === undefined) return undefined
  const prerelease = (m[4] ?? '')
    .split('.')
    .filter(part => part.length > 0)
    .map(part => (/^\d+$/.test(part) ? parseSafeInteger(part) : part))
  if (prerelease.some(part => part === undefined)) return undefined
  const build = (m[5] ?? '').split('.').filter(part => part.length > 0)
  return {
    major,
    minor,
    patch,
    prerelease: prerelease as readonly (string | number)[],
    build,
  }
}

function comparePrerelease(a: SemVer, b: SemVer): number {
  const ap = a.prerelease
  const bp = b.prerelease
  if (ap.length === 0 && bp.length === 0) return 0
  if (ap.length === 0) return 1 // release > prerelease
  if (bp.length === 0) return -1
  const length = Math.min(ap.length, bp.length)
  for (let i = 0; i < length; i += 1) {
    const x = ap[i] as string | number
    const y = bp[i] as string | number
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    if (typeof x === 'number') return -1 // numeric < alphanumeric
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return ap.length === bp.length ? 0 : ap.length < bp.length ? -1 : 1
}

export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePrerelease(a, b)
}

interface Comparator {
  readonly op: '=' | '>' | '>=' | '<' | '<='
  readonly version: SemVer
}

function formatSemver(version: SemVer): string {
  const prerelease =
    version.prerelease.length === 0 ? '' : `-${version.prerelease.map(String).join('.')}`
  const build = version.build.length === 0 ? '' : `+${version.build.join('.')}`
  return `${version.major}.${version.minor}.${version.patch}${prerelease}${build}`
}

function canonicalComparatorConjunction(comparators: readonly Comparator[]): string {
  const unique = new Map<string, Comparator>()
  for (const comparator of comparators) {
    const rendered = `${comparator.op}${formatSemver(comparator.version)}`
    unique.set(rendered, comparator)
  }
  const operatorOrder: Record<Comparator['op'], number> = {
    '>': 0,
    '>=': 1,
    '=': 2,
    '<=': 3,
    '<': 4,
  }
  return [...unique.entries()]
    .sort(([, a], [, b]) => {
      const byVersion = compareSemver(a.version, b.version)
      return byVersion === 0 ? operatorOrder[a.op] - operatorOrder[b.op] : byVersion
    })
    .map(([rendered]) => rendered)
    .join(' ')
}

export interface VersionRange {
  readonly raw: string
  readonly normalized: string
  readonly comparators: readonly (readonly Comparator[])[] // outer: OR (unused v1), inner: AND
}

function caretUpperBound(v: SemVer): SemVer | undefined {
  if (v.major > 0) {
    return Number.isSafeInteger(v.major + 1)
      ? { major: v.major + 1, minor: 0, patch: 0, prerelease: [], build: [] }
      : undefined
  }
  if (v.minor > 0) {
    return Number.isSafeInteger(v.minor + 1)
      ? { major: 0, minor: v.minor + 1, patch: 0, prerelease: [], build: [] }
      : undefined
  }
  return Number.isSafeInteger(v.patch + 1)
    ? { major: 0, minor: 0, patch: v.patch + 1, prerelease: [], build: [] }
    : undefined
}

function parsePartial(value: string): { v: SemVer; precision: 1 | 2 | 3 } | undefined {
  const m = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*|x|\*))?(?:\.(0|[1-9]\d*|x|\*))?$/.exec(value)
  if (!m) return undefined
  const major = parseSafeInteger(m[1] ?? '')
  if (major === undefined) return undefined
  const minorRaw = m[2]
  const patchRaw = m[3]
  const wild = (s: string | undefined) => s === 'x' || s === '*'
  if (minorRaw === undefined || wild(minorRaw)) {
    if (wild(minorRaw) && patchRaw !== undefined) return undefined
    return { v: { major, minor: 0, patch: 0, prerelease: [], build: [] }, precision: 1 }
  }
  if (patchRaw === undefined || wild(patchRaw)) {
    const minor = parseSafeInteger(minorRaw)
    if (minor === undefined) return undefined
    return {
      v: { major, minor, patch: 0, prerelease: [], build: [] },
      precision: 2,
    }
  }
  const minor = parseSafeInteger(minorRaw)
  const patch = parseSafeInteger(patchRaw)
  if (minor === undefined || patch === undefined) return undefined
  return {
    v: { major, minor, patch, prerelease: [], build: [] },
    precision: 3,
  }
}

function parseSingle(token: string): readonly Comparator[] | undefined {
  const opMatch = /^(>=|<=|>|<|=|\^)?(.+)$/.exec(token)
  if (!opMatch) return undefined
  const op = opMatch[1]
  const rest = (opMatch[2] ?? '').trim()
  const hasWildcard = /(?:^|\.)(?:x|\*)(?:\.|$)/.test(rest)
  if (op === '^') {
    if (hasWildcard) return undefined
    const partial = parsePartial(rest)
    if (!partial || partial.precision === 1) return undefined
    const upper = caretUpperBound(partial.v)
    if (upper === undefined) return undefined
    return [
      { op: '>=', version: partial.v },
      { op: '<', version: upper },
    ]
  }
  const partial = parsePartial(rest)
  if (!partial) return undefined
  if (hasWildcard && op !== undefined) return undefined
  if (op === undefined || op === '=') {
    // Wildcards are explicit (`1.x`, `1.2.x`) and never carry an operator. Bare
    // partials (`1`, `1.2`) are not request forms; comparator bounds remain valid.
    if (!hasWildcard && partial.precision !== 3) return undefined
    if (partial.precision === 3) return [{ op: '=', version: partial.v }]
    const next = partial.precision === 1 ? partial.v.major + 1 : partial.v.minor + 1
    if (!Number.isSafeInteger(next)) return undefined
    // 1.x / 1.2.x — bounded wildcard
    const upper: SemVer =
      partial.precision === 1
        ? { major: partial.v.major + 1, minor: 0, patch: 0, prerelease: [], build: [] }
        : {
            major: partial.v.major,
            minor: partial.v.minor + 1,
            patch: 0,
            prerelease: [],
            build: [],
          }
    return [
      { op: '>=', version: partial.v },
      { op: '<', version: upper },
    ]
  }
  return [{ op: op as Comparator['op'], version: partial.v }]
}

/** Returns undefined for an unparseable range. `''`, `'*'` and `'x'` mean any version. */
export function parseVersionRange(raw: string): VersionRange | undefined {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '*' || trimmed === 'x') {
    return { raw, normalized: '*', comparators: [[]] }
  }
  const tokens = trimmed.split(/\s+/)
  const comparators: Comparator[] = []
  for (const token of tokens) {
    const parsed = parseSingle(token)
    if (!parsed) return undefined
    comparators.push(...parsed)
  }
  return {
    raw,
    normalized: canonicalComparatorConjunction(comparators),
    comparators: [comparators],
  }
}

/**
 * Contract requirements carry a separate major. This rejects ranges that name another major,
 * except for the conventional exclusive upper boundary `<nextMajor.0.0`; `*` remains valid
 * because the resolver has already partitioned candidates by the explicit major field.
 */
export function versionRangeTargetsMajor(range: VersionRange, major: number): boolean {
  if (!Number.isSafeInteger(major) || major < 0) return false
  const start: SemVer = { major, minor: 0, patch: 0, prerelease: [], build: [] }
  return range.comparators.every(conjunction => {
    // The empty conjunction is the explicit `*` form and is scoped by the separate major field.
    if (conjunction.length === 0) return true
    const exact = conjunction.find(comparator => comparator.op === '=')
    if (exact !== undefined) {
      return (
        exact.version.major === major &&
        conjunction.every(comparator => matches(exact.version, comparator))
      )
    }
    const nextMajor = major + 1
    if (!Number.isSafeInteger(nextMajor)) return false
    const end: SemVer = { major: nextMajor, minor: 0, patch: 0, prerelease: [], build: [] }
    // Do not let a stricter sibling comparator hide an authored inclusive/cross-major
    // upper bound. The explicit major supplies the implicit interval, but a requirement
    // that itself admits a version from the next major is contradictory rather than a
    // harmless redundant bound.
    const crossesUpperBoundary = conjunction.some(comparator => {
      if (comparator.op !== '<' && comparator.op !== '<=') return false
      const boundary = compareSemver(comparator.version, end)
      return boundary > 0 || (boundary === 0 && comparator.op === '<=')
    })
    if (crossesUpperBoundary) return false
    // The explicit major is an implicit interval. Open authored bounds are valid when
    // their intersection with that interval is non-empty (MK3/02 consumer examples).
    const lowers: Comparator[] = [
      { op: '>=', version: start },
      ...conjunction.filter(comparator => comparator.op === '>' || comparator.op === '>='),
    ]
    const uppers: Comparator[] = [
      { op: '<', version: end },
      ...conjunction.filter(comparator => comparator.op === '<' || comparator.op === '<='),
    ]
    const lower = lowers.reduce((best, candidate) => {
      const comparison = compareSemver(candidate.version, best.version)
      if (comparison > 0 || (comparison === 0 && candidate.op === '>')) return candidate
      return best
    })
    const upper = uppers.reduce((best, candidate) => {
      const comparison = compareSemver(candidate.version, best.version)
      if (comparison < 0 || (comparison === 0 && candidate.op === '<')) return candidate
      return best
    })
    const lowerInside = compareSemver(lower.version, start) >= 0
    const upperVsEnd = compareSemver(upper.version, end)
    const upperInside = upperVsEnd < 0 || (upperVsEnd === 0 && upper.op === '<')
    const boundsOrder = compareSemver(lower.version, upper.version)
    const nonEmpty =
      boundsOrder < 0 || (boundsOrder === 0 && lower.op === '>=' && upper.op === '<=')
    return lowerInside && upperInside && nonEmpty
  })
}

function matches(version: SemVer, comparator: Comparator): boolean {
  const cmp = compareSemver(version, comparator.version)
  switch (comparator.op) {
    case '=':
      return cmp === 0
    case '>':
      return cmp > 0
    case '>=':
      return cmp >= 0
    case '<':
      return cmp < 0
    case '<=':
      return cmp <= 0
  }
}

export function satisfiesRange(version: SemVer, range: VersionRange): boolean {
  return range.comparators.some(conjunction => conjunction.every(c => matches(version, c)))
}
