/** Small, dependency-neutral helpers used only by Core's built-in text codecs. */
export function lease(value) {
  let released = false
  return Object.freeze({
    value,
    async release() {
      released = true
    },
    isReleased: () => released,
  })
}

function pageStart(cursor) {
  if (cursor === undefined) return 0
  if (!/^(?:0|[1-9][0-9]*)$/u.test(cursor)) throw new TypeError('invalid page cursor')
  const value = Number(cursor)
  if (!Number.isSafeInteger(value)) throw new TypeError('page cursor exceeds safe integer range')
  return value
}

/** Build a bounded lazy tree from inert nodes shaped as `{kind,label,preview?,children?}`. */
export function createTreeDataSource(rootNode) {
  const nodes = new Map()
  const register = (node, id) => {
    const children = Array.isArray(node.children) ? node.children : []
    nodes.set(id, { node, childIds: children.map((_, index) => `${id}/${index}`) })
    children.forEach((child, index) => register(child, `${id}/${index}`))
  }
  register(rootNode, 'root')
  const ref = id => {
    const item = nodes.get(id)
    return Object.freeze({ id, hasChildren: (item?.childIds.length ?? 0) > 0 })
  }
  return Object.freeze({
    async root() {
      return ref('root')
    },
    async children(node, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('tree page limit must be a positive safe integer')
      }
      const start = pageStart(page.cursor)
      const childIds = nodes.get(node.id)?.childIds ?? []
      const items = childIds.slice(start, start + page.limit).map(ref)
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < childIds.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
    async facts(node) {
      const value = nodes.get(node.id)?.node
      if (value === undefined) throw new TypeError(`unknown tree node ${node.id}`)
      return Object.freeze({
        kind: value.kind,
        label: value.label,
        ...(value.preview === undefined ? {} : { preview: value.preview }),
      })
    },
    async *search(query) {
      for (const [id, item] of nodes) {
        const label = item.node.label ?? ''
        const preview = item.node.preview ?? ''
        if (label.includes(query.pattern) || preview.includes(query.pattern)) yield ref(id)
      }
    },
  })
}

export function newlineOf(text) {
  const crlf = (text.match(/\r\n/gu) ?? []).length
  const withoutCrLf = text.replace(/\r\n/gu, '')
  const lf = (withoutCrLf.match(/\n/gu) ?? []).length
  const cr = (withoutCrLf.match(/\r/gu) ?? []).length
  if ([crlf, lf, cr].filter(count => count > 0).length > 1) return 'mixed'
  if (crlf > 0) return 'crlf'
  if (lf > 0) return 'lf'
  if (cr > 0) return 'cr'
  return 'none'
}

/** Minimal implementation of `common.edit/writer@1` for native text writers. */
export function defineWriter({
  providerId,
  providerVersion = '1.0.0',
  artifactDigest,
  offerId,
  formatId,
  representationId,
  mutationMode = 'mutate',
  minimumRoundTrip,
  fidelityEvidenceId,
  fidelity,
  validate,
  planEdits,
}) {
  const identity = Object.freeze({
    providerId,
    providerVersion,
    artifactDigest,
    formatId,
    representationId,
  })
  const offer = Object.freeze({
    providerId,
    fidelityEvidenceId,
    formatId,
    representationId,
    mutationMode,
    minimumRoundTrip,
  })
  const writer = Object.freeze({
    identity,
    offer,
    async validate(change, signal) {
      return validate(change, signal)
    },
    async plan(change, signal) {
      const edits = await planEdits(change, signal)
      return Object.freeze({
        planId: `${providerId}:${change.targets.map(target => target.targetId).join('+')}`,
        targets: change.targets,
        edits,
        semantics: Object.freeze({ mutationMode, minimumGuarantee: 'atomic' }),
        fidelity,
        diagnostics: Object.freeze([]),
      })
    },
  })
  return Object.freeze({
    abiVersion: 1,
    provides: Object.freeze(['common.edit/writer']),
    async createProvider(selection) {
      if (selection.offerId !== offerId)
        throw new TypeError(`unknown writer offer ${selection.offerId}`)
      return lease(writer)
    },
  })
}
