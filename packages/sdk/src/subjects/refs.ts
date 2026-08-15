/**
 * Stable subject identity (owner: MK3/25 §3, normative-candidate). Identity is not a
 * path and not a revision: rename changes location, edit changes revision, neither
 * changes identity. Root subject = source URI with `identity.key === ''`; the format
 * NEVER enters root identity (MK3/25 §20).
 */

import { isQualifiedId } from '@modkitx-x3/core'

export interface SourceRef {
  readonly id: string
  readonly parent?: SourceRef
}

export interface SubjectIdentity {
  /** Namespaced subject kind (qualified grammar); '' for the root subject itself. */
  readonly kind: string
  /** '' means the asset/root subject itself. */
  readonly key: string
}

export interface SubjectRef {
  readonly workspace?: string
  readonly source: SourceRef
  readonly identity: SubjectIdentity
}

export const REVISION_KINDS = Object.freeze([
  'content-hash',
  'git-object',
  'etag',
  'database-version',
  'provider-token',
  'overlay-generation',
] as const)

export type RevisionKind = (typeof REVISION_KINDS)[number]

export interface RevisionRef {
  readonly kind: RevisionKind
  readonly value: string
  readonly algorithm?: string
}

const REVISION_KIND_PATTERN = REVISION_KINDS.join('|')
const REVISION_ALGORITHM_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*'
const REVISION_VALUE_PATTERN = "(?:[A-Za-z0-9_.!~*'()\\-]|%[0-9A-F]{2})+"
/** Collision-free string projection used by JSON wire descriptors and revision vectors. */
export const REVISION_ID_PATTERN = `^(?:${REVISION_KIND_PATTERN})(?:\\.${REVISION_ALGORITHM_PATTERN})?:${REVISION_VALUE_PATTERN}$`
const REVISION_ID = new RegExp(REVISION_ID_PATTERN)

export function serializeRevisionRef(ref: RevisionRef): string {
  if (!(REVISION_KINDS as readonly string[]).includes(ref.kind)) {
    throw new TypeError(`invalid revision kind: ${String(ref.kind)}`)
  }
  if (ref.value.length === 0) throw new TypeError('revision value must be non-empty')
  if (
    ref.algorithm !== undefined &&
    !new RegExp(`^${REVISION_ALGORITHM_PATTERN}$`).test(ref.algorithm)
  ) {
    throw new TypeError(`invalid revision algorithm: ${ref.algorithm}`)
  }
  return `${ref.kind}${ref.algorithm === undefined ? '' : `.${ref.algorithm}`}:${encodeURIComponent(ref.value)}`
}

export function parseRevisionRef(value: string): RevisionRef | undefined {
  if (!REVISION_ID.test(value)) return undefined
  const colon = value.indexOf(':')
  const coordinate = value.slice(0, colon)
  const dot = coordinate.indexOf('.')
  const kind = (dot === -1 ? coordinate : coordinate.slice(0, dot)) as RevisionKind
  const algorithm = dot === -1 ? undefined : coordinate.slice(dot + 1)
  const encoded = value.slice(colon + 1)
  try {
    const decoded = decodeURIComponent(encoded)
    if (decoded.length === 0 || encodeURIComponent(decoded) !== encoded) return undefined
    return Object.freeze({
      kind,
      value: decoded,
      ...(algorithm === undefined ? {} : { algorithm }),
    })
  } catch {
    return undefined
  }
}

function assertSourceChain(source: SourceRef): void {
  for (
    let current: SourceRef | undefined = source;
    current !== undefined;
    current = current.parent
  ) {
    if (typeof current.id !== 'string' || current.id.length === 0) {
      throw new TypeError('subject source id must be non-empty')
    }
  }
}

function assertSubjectIdentity(identity: SubjectIdentity): void {
  if (typeof identity.kind !== 'string' || typeof identity.key !== 'string') {
    throw new TypeError('subject identity kind and key must be strings')
  }
  if (identity.kind === '' && identity.key === '') return
  if (!isQualifiedId(identity.kind)) {
    throw new TypeError(`nested subject kind must be a qualified id: ${identity.kind}`)
  }
  if (identity.key.length === 0) {
    throw new TypeError('nested subject key must be non-empty')
  }
}

export function rootSubject(source: SourceRef, workspace?: string): SubjectRef {
  assertSourceChain(source)
  return {
    ...(workspace === undefined ? {} : { workspace }),
    source,
    identity: { kind: '', key: '' },
  }
}

export function nestedSubject(owner: SubjectRef, kind: string, key: string): SubjectRef {
  assertSourceChain(owner.source)
  assertSubjectIdentity({ kind, key })
  return { ...owner, identity: { kind, key } }
}

function sourceChainEquals(a: SourceRef | undefined, b: SourceRef | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  return a.id === b.id && sourceChainEquals(a.parent, b.parent)
}

/** MK3/25 §3: equality = workspace + recursive source.id chain + identity; never revision. */
export function subjectRefEquals(a: SubjectRef, b: SubjectRef): boolean {
  return (
    a.workspace === b.workspace &&
    sourceChainEquals(a.source, b.source) &&
    a.identity.kind === b.identity.kind &&
    a.identity.key === b.identity.key
  )
}

const EXTENDED_SUBJECT_PREFIX = 'x3-subject:'

function sourceIdChain(source: SourceRef): string[] {
  const chain: string[] = []
  for (
    let current: SourceRef | undefined = source;
    current !== undefined;
    current = current.parent
  ) {
    chain.push(current.id)
  }
  return chain.reverse()
}

function sourceFromIdChain(chain: readonly string[]): SourceRef {
  if (chain.length === 0) throw new TypeError('subject source chain must be non-empty')
  let source: SourceRef | undefined
  for (const id of chain) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('subject source id must be non-empty')
    }
    source = { id, ...(source === undefined ? {} : { parent: source }) }
  }
  return source as SourceRef
}

/**
 * Canonical URI. The compact legacy spelling is retained only when workspace and parent chain
 * are absent; the extended spelling losslessly binds both otherwise.
 */
export function serializeSubjectRef(ref: SubjectRef): string {
  assertSourceChain(ref.source)
  assertSubjectIdentity(ref.identity)
  if (
    ref.workspace !== undefined ||
    ref.source.parent !== undefined ||
    ref.source.id.includes('#') ||
    ref.source.id.startsWith(EXTENDED_SUBJECT_PREFIX)
  ) {
    const payload = [
      1,
      ref.workspace ?? null,
      sourceIdChain(ref.source),
      ref.identity.kind,
      ref.identity.key,
    ] as const
    return `${EXTENDED_SUBJECT_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`
  }
  if (ref.identity.key === '' && ref.identity.kind === '') return ref.source.id
  return `${ref.source.id}#${encodeURIComponent(ref.identity.kind)}/${encodeURIComponent(ref.identity.key)}`
}

export function parseSubjectRef(uri: string, workspace?: string): SubjectRef {
  if (uri.startsWith(EXTENDED_SUBJECT_PREFIX)) {
    try {
      const payload = JSON.parse(
        decodeURIComponent(uri.slice(EXTENDED_SUBJECT_PREFIX.length)),
      ) as unknown
      if (!Array.isArray(payload) || payload.length !== 5 || payload[0] !== 1) {
        throw new TypeError('invalid extended subject reference')
      }
      const encodedWorkspace = payload[1]
      const chain = payload[2]
      const kind = payload[3]
      const key = payload[4]
      if (
        (encodedWorkspace !== null && typeof encodedWorkspace !== 'string') ||
        !Array.isArray(chain) ||
        typeof kind !== 'string' ||
        typeof key !== 'string'
      ) {
        throw new TypeError('invalid extended subject reference')
      }
      const identity = { kind, key }
      assertSubjectIdentity(identity)
      return {
        ...(encodedWorkspace === null ? {} : { workspace: encodedWorkspace }),
        source: sourceFromIdChain(chain),
        identity,
      }
    } catch (error) {
      throw new TypeError(
        `invalid extended subject reference: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const hash = uri.indexOf('#')
  if (hash === -1) return rootSubject({ id: uri }, workspace)
  const fragment = uri.slice(hash + 1)
  const slash = fragment.indexOf('/')
  if (slash === -1) throw new TypeError('nested subject reference must include a non-empty key')
  try {
    const kind = decodeURIComponent(fragment.slice(0, slash))
    const key = decodeURIComponent(fragment.slice(slash + 1))
    return nestedSubject(rootSubject({ id: uri.slice(0, hash) }, workspace), kind, key)
  } catch (error) {
    throw new TypeError(
      `invalid nested subject reference: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
