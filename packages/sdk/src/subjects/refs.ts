/**
 * Stable subject identity (owner: MK3/25 §3, normative-candidate). Identity is not a
 * path and not a revision: rename changes location, edit changes revision, neither
 * changes identity. Root subject = source URI with `identity.key === ''`; the format
 * NEVER enters root identity (MK3/25 §20).
 */

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

export interface RevisionRef {
  readonly kind:
    | 'content-hash'
    | 'git-object'
    | 'etag'
    | 'database-version'
    | 'provider-token'
    | 'overlay-generation'
  readonly value: string
  readonly algorithm?: string
}

export function rootSubject(source: SourceRef, workspace?: string): SubjectRef {
  return {
    ...(workspace === undefined ? {} : { workspace }),
    source,
    identity: { kind: '', key: '' },
  }
}

export function nestedSubject(owner: SubjectRef, kind: string, key: string): SubjectRef {
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

/** Canonical URI: `<source-uri>` for roots, `<source-uri>#<pct(kind)>/<pct(key)>` nested. */
export function serializeSubjectRef(ref: SubjectRef): string {
  if (ref.identity.key === '' && ref.identity.kind === '') return ref.source.id
  return `${ref.source.id}#${encodeURIComponent(ref.identity.kind)}/${encodeURIComponent(ref.identity.key)}`
}

export function parseSubjectRef(uri: string, workspace?: string): SubjectRef {
  const hash = uri.indexOf('#')
  if (hash === -1) return rootSubject({ id: uri }, workspace)
  const fragment = uri.slice(hash + 1)
  const slash = fragment.indexOf('/')
  const kind = decodeURIComponent(slash === -1 ? fragment : fragment.slice(0, slash))
  const key = slash === -1 ? '' : decodeURIComponent(fragment.slice(slash + 1))
  return {
    ...(workspace === undefined ? {} : { workspace }),
    source: { id: uri.slice(0, hash) },
    identity: { kind, key },
  }
}
