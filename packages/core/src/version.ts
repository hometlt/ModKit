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

export function parseSemver(value: string): SemVer | undefined {
  const m = SEMVER.exec(value)
  if (!m) return undefined
  const prerelease = (m[4] ?? '')
    .split('.')
    .filter(part => part.length > 0)
    .map(part => (/^\d+$/.test(part) ? Number(part) : part))
  const build = (m[5] ?? '').split('.').filter(part => part.length > 0)
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease,
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

export interface VersionRange {
  readonly raw: string
  readonly normalized: string
  readonly comparators: readonly (readonly Comparator[])[] // outer: OR (unused v1), inner: AND
}

function caretUpperBound(v: SemVer): SemVer {
  if (v.major > 0) return { major: v.major + 1, minor: 0, patch: 0, prerelease: [], build: [] }
  if (v.minor > 0) return { major: 0, minor: v.minor + 1, patch: 0, prerelease: [], build: [] }
  return { major: 0, minor: 0, patch: v.patch + 1, prerelease: [], build: [] }
}

function parsePartial(value: string): { v: SemVer; precision: 1 | 2 | 3 } | undefined {
  const m = /^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(value)
  if (!m) return undefined
  const major = Number(m[1])
  const minorRaw = m[2]
  const patchRaw = m[3]
  const wild = (s: string | undefined) => s === 'x' || s === '*'
  if (minorRaw === undefined || wild(minorRaw)) {
    return { v: { major, minor: 0, patch: 0, prerelease: [], build: [] }, precision: 1 }
  }
  if (patchRaw === undefined || wild(patchRaw)) {
    return {
      v: { major, minor: Number(minorRaw), patch: 0, prerelease: [], build: [] },
      precision: 2,
    }
  }
  return {
    v: { major, minor: Number(minorRaw), patch: Number(patchRaw), prerelease: [], build: [] },
    precision: 3,
  }
}

function parseSingle(token: string): readonly Comparator[] | undefined {
  const opMatch = /^(>=|<=|>|<|=|\^)?(.+)$/.exec(token)
  if (!opMatch) return undefined
  const op = opMatch[1]
  const rest = (opMatch[2] ?? '').trim()
  if (op === '^') {
    const partial = parsePartial(rest)
    if (!partial) return undefined
    return [
      { op: '>=', version: partial.v },
      { op: '<', version: caretUpperBound(partial.v) },
    ]
  }
  const partial = parsePartial(rest)
  if (!partial) return undefined
  if (op === undefined || op === '=') {
    if (partial.precision === 3) return [{ op: '=', version: partial.v }]
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
  return { raw, normalized: tokens.join(' '), comparators: [comparators] }
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
