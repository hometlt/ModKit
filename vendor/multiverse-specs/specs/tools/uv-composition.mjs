/**
 * Reference composition: UVP layer ordering and UVD definition resolution.
 *
 * This is the executable form of the composition contract SPEC_UVP.md §2 and SPEC_UVD.md §4
 * declare. Like every tool in this seed it is dependency-free and replaceable: the vectors in
 * `../conformance/uvp-composition/` and `../conformance/uvd-resolution/` are the contract, this
 * file is one implementation of it.
 *
 * Every failure is a typed refusal `{ rule, message }` naming the members involved; the first
 * refusal of a stage stops that stage (composition is refused, not partially applied).
 */

// --- minimal semver ------------------------------------------------------------------------------

const parseVersion = text => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const compareVersions = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** `1.2.3` exact, `^1.2.3` same-major, `~1.2.3` same-minor. */
export function satisfies(version, range) {
  const flavor = range.startsWith('^') ? 'caret' : range.startsWith('~') ? 'tilde' : 'exact'
  const base = parseVersion(flavor === 'exact' ? range : range.slice(1))
  const actual = parseVersion(version)
  if (base === undefined || actual === undefined) return false
  if (flavor === 'exact') return compareVersions(actual, base) === 0
  if (compareVersions(actual, base) < 0) return false
  if (flavor === 'caret') {
    // conventional caret: 0.x.y pins the minor, 0.0.z pins the patch
    if (base[0] > 0) return actual[0] === base[0]
    if (base[1] > 0) return actual[0] === 0 && actual[1] === base[1]
    return compareVersions(actual, base) === 0
  }
  return actual[0] === base[0] && actual[1] === base[1]
}

// --- UVP composition -----------------------------------------------------------------------------

const RANK_ORDER = ['base', 'official', 'map', 'mod']

/**
 * Compose the package closure of `rootId` from `manifests` (already schema-valid UVP manifests).
 * Returns `{ layers }` — the ordered composition — or `{ refusal }`.
 *
 * The root package itself is the last layer of its own rank class: a map root composes after its
 * dependencies; its dependencies join at their declared ranks.
 */
export function composePackages(rootId, manifests, intrinsicRegistry, grantedCapabilities) {
  const byId = new Map()
  for (const manifest of manifests) {
    if (byId.has(manifest.id)) {
      return { refusal: { rule: 'duplicate-package', message: `package ${manifest.id} is provided twice` } }
    }
    byId.set(manifest.id, manifest)
  }
  const root = byId.get(rootId)
  if (root === undefined) {
    return { refusal: { rule: 'missing-package', message: `root package ${rootId} is not provided` } }
  }

  // walk the dependency closure, detect cycles, record each package's declared rank/order
  const entries = new Map() // id -> { rank, order }
  const state = new Map() // id -> 'visiting' | 'done'
  const stack = []
  const visit = id => {
    if (state.get(id) === 'done') return undefined
    if (state.get(id) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(id)), id]
      return { rule: 'no-dependency-cycles', message: `dependency cycle: ${cycle.join(' -> ')}` }
    }
    state.set(id, 'visiting')
    stack.push(id)
    const manifest = byId.get(id)
    if (manifest === undefined) {
      return { rule: 'missing-package', message: `dependency ${id} is not provided` }
    }
    for (const dependency of manifest.dependencies ?? []) {
      const target = byId.get(dependency.id)
      if (target === undefined) {
        return { rule: 'missing-package', message: `dependency ${dependency.id} of ${id} is not provided` }
      }
      if (!satisfies(target.version, dependency.range)) {
        return {
          rule: 'version-unsatisfied',
          message: `${id} needs ${dependency.id} ${dependency.range}, provided ${target.version}`,
        }
      }
      const existing = entries.get(dependency.id)
      const declared = { rank: dependency.rank, order: dependency.order }
      if (existing !== undefined && existing.rank !== declared.rank) {
        return {
          rule: 'conflicting-rank',
          message: `${dependency.id} is declared at rank ${existing.rank} and rank ${declared.rank}`,
        }
      }
      if (
        existing !== undefined &&
        existing.order !== undefined &&
        declared.order !== undefined &&
        existing.order !== declared.order
      ) {
        return {
          rule: 'conflicting-order',
          message: `${dependency.id} is declared at order ${existing.order} and order ${declared.order}`,
        }
      }
      entries.set(dependency.id, existing ?? declared)
      const failure = visit(dependency.id)
      if (failure !== undefined) return failure
    }
    stack.pop()
    state.set(id, 'done')
    return undefined
  }
  const failure = visit(rootId)
  if (failure !== undefined) return { refusal: failure }

  // explicit order inside one rank: more than one entry sharing a rank needs distinct orders
  const byRank = new Map()
  for (const [id, entry] of entries) {
    const list = byRank.get(entry.rank) ?? []
    list.push({ id, order: entry.order })
    byRank.set(entry.rank, list)
  }
  for (const [rank, list] of byRank) {
    if (list.length < 2) continue
    const seen = new Set()
    for (const entry of list) {
      if (entry.order === undefined) {
        return {
          refusal: {
            rule: 'explicit-order-within-rank',
            message: `rank ${rank} holds ${list.map(e => e.id).join(', ')} and ${entry.id} declares no order`,
          },
        }
      }
      if (seen.has(entry.order)) {
        return {
          refusal: { rule: 'explicit-order-within-rank', message: `rank ${rank} repeats order ${entry.order}` },
        }
      }
      seen.add(entry.order)
    }
  }

  // requirements before content: every intrinsic id@version must exist in the registry
  if (intrinsicRegistry !== undefined) {
    const known = new Set(intrinsicRegistry.intrinsics.map(row => `${row.id}@${row.version}`))
    const missing = new Set()
    for (const id of [rootId, ...entries.keys()]) {
      for (const requirement of byId.get(id).requires?.intrinsics ?? []) {
        if (!known.has(requirement)) missing.add(`${requirement} (needed by ${id})`)
      }
    }
    if (missing.size > 0) {
      return {
        refusal: {
          rule: 'requirements-before-content',
          message: `unsatisfied intrinsic requirements: ${[...missing].sort().join('; ')}`,
        },
      }
    }
  }

  // capabilities before content: every requested class must be granted by the host/trust chain
  if (grantedCapabilities !== undefined) {
    const granted = new Set(grantedCapabilities)
    const denied = new Set()
    for (const id of [rootId, ...entries.keys()]) {
      for (const capability of byId.get(id).requires?.capabilities ?? []) {
        if (!granted.has(capability)) denied.add(`${capability} (requested by ${id})`)
      }
    }
    if (denied.size > 0) {
      return {
        refusal: {
          rule: 'capabilities-granted',
          message: `capabilities not granted: ${[...denied].sort().join('; ')}`,
        },
      }
    }
  }

  // the root joins the sort at its own kind's rank, after that rank's dependencies: a map root
  // composes over its map-rank dependencies but UNDER its mods — mods always win over the map.
  // A campaign root composes at the official rank (its shared rules sit under maps and mods);
  // libraries and game bases are base-rank roots.
  const rootRank =
    root.kind === 'mod' ? 'mod' : root.kind === 'map' ? 'map' : root.kind === 'campaign' ? 'official' : 'base'
  const layers = [
    ...[...entries.entries()].map(([id, entry]) => ({ id, rank: entry.rank, order: entry.order ?? 0 })),
    { id: rootId, rank: rootRank, order: Number.MAX_SAFE_INTEGER },
  ].sort(
    (a, b) =>
      RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank) ||
      a.order - b.order ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return { layers: layers.map(({ id, rank }) => ({ id, rank })) }
}

// --- UVD resolution ------------------------------------------------------------------------------

/**
 * Resolve definitions across ordered layers.
 *
 * `layers`: ordered `{ id, documents }` where documents are schema-valid UVD documents
 * (kind-schema, definitions, overlay). Returns `{ definitions }` — a map
 * `fullId -> { kind, fields: { name: { value, provenance } } }` — or `{ refusal }`.
 * Provenance names the layer and document namespace that set the value, with
 * `via: 'parent <id>'` when inheritance supplied it.
 */
const isIntegerQuanta = value => Number.isInteger(value) || (typeof value === 'string' && /^-?\d+$/.test(value))

/** Value-against-field-spec check. Returns an error string or undefined. */
function typeError(spec, value) {
  switch (spec.type) {
    case 'bool':
      return typeof value === 'boolean' ? undefined : 'expects bool'
    case 'i64':
    case 'fixed64':
      return isIntegerQuanta(value) ? undefined : `expects ${spec.type} integer quanta`
    case 'f64':
      return typeof value === 'number' ? undefined : 'expects f64'
    case 'string':
    case 'strref':
      return typeof value === 'string' ? undefined : 'expects string'
    case 'enum':
      return spec.values.includes(value) ? undefined : `expects one of ${spec.values.join('|')}`
    case 'flags': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'expects a flag set object'
      for (const [name, on] of Object.entries(value)) {
        if (!spec.values.includes(name)) return `undeclared flag ${name}`
        if (typeof on !== 'boolean') return `flag ${name} expects bool`
      }
      return undefined
    }
    case 'ref':
      return typeof value === 'string' ? undefined : 'expects a reference id'
    case 'list': {
      if (!Array.isArray(value)) return 'expects list'
      for (const item of value) {
        const error = typeError({ ...spec, type: spec.itemType }, item)
        if (error !== undefined) return `list item ${error}`
      }
      return undefined
    }
    case 'record': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'expects record'
      for (const key of Object.keys(value)) {
        const field = spec.recordFields.find(f => f.name === key)
        if (field === undefined) return `undeclared record field ${key}`
        const error = typeError(field, value[key])
        if (error !== undefined) return `record field ${key} ${error}`
      }
      for (const field of spec.recordFields) {
        if (field.required === true && value[field.name] === undefined) return `missing required record field ${field.name}`
      }
      return undefined
    }
    default:
      return `unknown field type ${spec.type}`
  }
}

/**
 * Options:
 *   danglingReferences: 'refuse' (default) | 'diagnose' — a typed reference to a definition nobody
 *     ships refuses, or is kept with a `dangling-reference` diagnostic (what Modkit does on real
 *     catalogs, which do contain dead links);
 *   externalParents: 'refuse' (default) | 'truncate' — a parent outside the package closure refuses,
 *     or truncates the chain with a `parent-outside-closure` diagnostic (loose mods inherit from
 *     the base game).
 * Returns `{ definitions, diagnostics }` or `{ refusal }`.
 */
export function resolveDefinitions(layers, options = {}) {
  const danglingPolicy = options.danglingReferences ?? 'refuse'
  const parentPolicy = options.externalParents ?? 'refuse'
  const diagnostics = []
  const kinds = new Map() // kind -> field spec map
  const kindVersions = new Map() // kind -> declared version
  const defs = new Map() // fullId -> { kind, parent, own: Map(field -> {value, provenance}) }

  for (const layer of layers) {
    for (const document of layer.documents) {
      if (document.role === 'kind-schema') {
        for (const kind of document.kinds) {
          // a later layer redefining a kind is a named refusal, not a silent override: "a mod
          // extends a kind schema" is a real feature that needs its own amendment, not an accident
          if (kinds.has(kind.kind)) {
            return { refusal: { rule: 'duplicate-kind', message: `kind ${kind.kind} is declared twice (layer ${layer.id})` } }
          }
          const fields = new Map()
          for (const field of kind.fields) fields.set(field.name, field)
          kinds.set(kind.kind, fields)
          kindVersions.set(kind.kind, kind.version)
        }
      }
    }
  }

  const fieldSpec = (kind, name) => kinds.get(kind)?.get(name)

  for (const layer of layers) {
    for (const document of layer.documents) {
      if (document.role !== 'definitions') continue
      for (const definition of document.definitions) {
        const fullId = `${document.namespace}/${definition.kind}/${definition.name}`
        if (defs.has(fullId)) {
          if (document.upsert !== true) {
            return { refusal: { rule: 'duplicate-definition', message: `${fullId} is defined twice` } }
          }
          // upsert: the later document re-publishes the record whole; own fields are replaced.
          // (kind is part of the full id, so a kind change is a different definition, not a conflict)
        }
        if (!kinds.has(definition.kind)) {
          return { refusal: { rule: 'unknown-kind', message: `${fullId} uses undeclared kind ${definition.kind}` } }
        }
        if (definition.kindVersion !== kindVersions.get(definition.kind)) {
          return {
            refusal: {
              rule: 'kind-version-mismatch',
              message: `${fullId} targets kind ${definition.kind} version ${definition.kindVersion}, schema declares ${kindVersions.get(definition.kind)}`,
            },
          }
        }
        const own = new Map()
        for (const [name, value] of Object.entries(definition.fields)) {
          const spec = fieldSpec(definition.kind, name)
          if (spec === undefined) {
            return {
              refusal: { rule: 'fields-match-kind-schema', message: `${fullId} sets undeclared field ${name}` },
            }
          }
          const error = typeError(spec, value)
          if (error !== undefined) {
            return { refusal: { rule: 'type-mismatch', message: `${fullId}.${name} ${error}` } }
          }
          own.set(name, { value, provenance: { layer: layer.id, document: document.namespace } })
        }
        defs.set(fullId, { kind: definition.kind, parent: definition.parent, own })
      }
    }
  }

  // parent chains exist and do not cycle
  for (const [fullId, definition] of defs) {
    const seen = new Set([fullId])
    let cursor = definition.parent
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        return { refusal: { rule: 'no-parent-cycles', message: `parent cycle at ${cursor} (from ${fullId})` } }
      }
      seen.add(cursor)
      const parent = defs.get(cursor)
      if (parent === undefined) {
        if (parentPolicy === 'truncate') {
          diagnostics.push({ rule: 'parent-outside-closure', message: `${fullId} names parent ${cursor} outside the package closure; chain truncated` })
          // find the last definition in the chain that exists and cut its parent link
          let last = definition
          while (last.parent !== undefined && defs.has(last.parent)) last = defs.get(last.parent)
          last.parent = undefined
          break
        }
        return { refusal: { rule: 'missing-reference', message: `${fullId} names missing parent ${cursor}` } }
      }
      if (parent.kind !== definition.kind) {
        return { refusal: { rule: 'parent-kind-mismatch', message: `${fullId} inherits across kinds from ${cursor}` } }
      }
      cursor = parent.parent
    }
  }

  const inherited = (fullId, name) => {
    const spec = fieldSpec(defs.get(fullId).kind, name)
    if (spec?.type === 'flags') {
      // a flag set merges by name root-to-leaf; a tombstone restarts the set
      const chain = []
      for (let cursor = fullId; cursor !== undefined; cursor = defs.get(cursor).parent) chain.unshift(cursor)
      let flags = {}
      let provenance
      let seen = false
      for (const id of chain) {
        const entry = defs.get(id).own.get(name)
        if (entry === undefined) continue
        seen = true
        const via = id === fullId ? entry.provenance : { ...entry.provenance, via: `flags-chain through ${id}` }
        if (entry.removed === true) {
          flags = {}
          provenance = via
          continue
        }
        flags = { ...flags, ...entry.value }
        provenance = via
      }
      return seen ? { value: flags, provenance } : undefined
    }
    if (spec?.type === 'list' && spec.inherit === 'merge') {
      // keyed merge root-to-leaf: same key replaces, new keys append; a tombstone restarts
      const chain = []
      for (let cursor = fullId; cursor !== undefined; cursor = defs.get(cursor).parent) chain.unshift(cursor)
      let merged = []
      let provenance
      let seen = false
      for (const id of chain) {
        const entry = defs.get(id).own.get(name)
        if (entry === undefined) continue
        seen = true
        const via = id === fullId ? entry.provenance : { ...entry.provenance, via: `merge-chain through ${id}` }
        if (entry.removed === true) {
          merged = []
          provenance = via
          continue
        }
        for (const record of entry.value) {
          const index = merged.findIndex(existing => existing[spec.keyField] === record[spec.keyField])
          if (index >= 0) merged[index] = record
          else merged.push(record)
        }
        provenance = via
      }
      return seen ? { value: merged, provenance } : undefined
    }
    if (spec?.type === 'list' && spec.inherit === 'append') {
      // root-to-leaf concatenation; a tombstone in the chain restarts the list
      const chain = []
      for (let cursor = fullId; cursor !== undefined; cursor = defs.get(cursor).parent) chain.unshift(cursor)
      let list = []
      let provenance
      let seen = false
      for (const id of chain) {
        const entry = defs.get(id).own.get(name)
        if (entry === undefined) continue
        seen = true
        if (entry.removed === true) {
          list = []
          provenance = id === fullId ? entry.provenance : { ...entry.provenance, via: `parent ${id}` }
          continue
        }
        list = [...list, ...entry.value]
        provenance = id === fullId ? entry.provenance : { ...entry.provenance, via: `append-chain through ${id}` }
      }
      return seen ? { value: list, provenance } : undefined
    }
    let cursor = fullId
    while (cursor !== undefined) {
      const definition = defs.get(cursor)
      const entry = definition.own.get(name)
      if (entry !== undefined) {
        if (cursor === fullId) return entry
        // an ancestor's tombstone is inherited as absence, exactly like an ancestor's value
        return entry.removed === true
          ? { value: undefined, removed: true, provenance: { ...entry.provenance, via: `parent ${cursor}` } }
          : { value: entry.value, provenance: { ...entry.provenance, via: `parent ${cursor}` } }
      }
      cursor = definition.parent
    }
    return undefined
  }

  for (const layer of layers) {
    for (const document of layer.documents) {
      if (document.role !== 'overlay') continue
      for (const overlay of document.overlays) {
        const target = defs.get(overlay.target)
        if (target === undefined) {
          return { refusal: { rule: 'missing-reference', message: `overlay targets missing ${overlay.target}` } }
        }
        const spec = fieldSpec(target.kind, overlay.field)
        if (spec === undefined) {
          return {
            refusal: {
              rule: 'fields-match-kind-schema',
              message: `overlay sets undeclared field ${overlay.field} on ${overlay.target}`,
            },
          }
        }
        const provenance = { layer: layer.id, document: document.namespace }
        if (overlay.op === 'set') {
          const error = typeError(spec, overlay.value)
          if (error !== undefined) {
            return { refusal: { rule: 'type-mismatch', message: `overlay ${overlay.target}.${overlay.field} ${error}` } }
          }
          if (spec.type === 'flags') {
            // a partial flag object patches named flags; the own tail keeps the rest
            const own = target.own.get(overlay.field)
            const base = own === undefined || own.removed === true ? {} : own.value
            target.own.set(overlay.field, { value: { ...base, ...overlay.value }, provenance })
          } else {
            target.own.set(overlay.field, { value: overlay.value, provenance })
          }
        } else if (overlay.op === 'remove') {
          if (spec.required === true) {
            return {
              refusal: {
                rule: 'required-fields-survive-overlays',
                message: `overlay removes required field ${overlay.field} from ${overlay.target}`,
              },
            }
          }
          target.own.set(overlay.field, { value: undefined, removed: true, provenance })
        } else if (overlay.op === 'append') {
          if (spec.type !== 'list') {
            return {
              refusal: { rule: 'append-to-non-list', message: `overlay appends to non-list field ${overlay.field} on ${overlay.target}` },
            }
          }
          const itemError = typeError({ ...spec, type: spec.itemType }, overlay.value)
          if (itemError !== undefined) {
            return { refusal: { rule: 'type-mismatch', message: `overlay append ${overlay.target}.${overlay.field} list item ${itemError}` } }
          }
          // append-inherited lists own only their own tail: appending to the effective chain
          // would count the ancestors twice on the next resolution
          const base = spec.inherit === 'append' || spec.inherit === 'merge' ? target.own.get(overlay.field) : inherited(overlay.target, overlay.field)
          const list = base === undefined || base.removed === true ? [] : [...base.value]
          if (spec.inherit === 'merge') {
            // upsert by key inside the own tail; the chain merge applies the same rule upward
            const index = list.findIndex(existing => existing[spec.keyField] === overlay.value[spec.keyField])
            if (index >= 0) list[index] = overlay.value
            else list.push(overlay.value)
          } else {
            list.push(overlay.value)
          }
          target.own.set(overlay.field, { value: list, provenance })
        }
      }
    }
  }

  // materialize effective views: late-bind ${self}, then check typed references (scalar, list, record)
  const bindSelf = (value, localName) =>
    typeof value === 'string' ? value.replaceAll('${self}', localName) : Array.isArray(value) ? value.map(v => bindSelf(v, localName)) : value
  const definitions = new Map()
  for (const [fullId, definition] of defs) {
    const localName = fullId.slice(fullId.lastIndexOf('/') + 1)
    const fields = {}
    for (const name of kinds.get(definition.kind).keys()) {
      const entry = inherited(fullId, name)
      if (entry === undefined || entry.removed === true) continue
      const spec = fieldSpec(definition.kind, name)
      // ${self} binds in every textual position an identity can appear: strings, references,
      // lists of either, and reference/string fields inside records — the admission rerun showed
      // the motivating case (a template weapon's `effect = ${self}-damage`) must be a typed ref
      const textual = t => t === 'string' || t === 'strref' || t === 'ref'
      const bindRecord = record =>
        Object.fromEntries(
          Object.entries(record).map(([k, v]) => {
            const f = spec.recordFields.find(x => x.name === k)
            return [k, f !== undefined && textual(f.type) ? bindSelf(v, localName) : v]
          }),
        )
      let value = entry.value
      if (textual(spec.type) || (spec.type === 'list' && textual(spec.itemType))) value = bindSelf(value, localName)
      else if (spec.type === 'record') value = bindRecord(value)
      else if (spec.type === 'list' && spec.itemType === 'record') value = value.map(bindRecord)
      fields[name] = { value, provenance: entry.provenance }
    }
    definitions.set(fullId, { kind: definition.kind, fields })
  }
  const checkRef = (fullId, name, target, refKind) => {
    if (defs.has(target)) {
      // a polymorphic reference names a closed set of kinds; the target must be one of them
      const kinds = Array.isArray(refKind) ? refKind : [refKind]
      if (refKind !== undefined && !kinds.includes(defs.get(target).kind)) {
        return { refusal: { rule: 'reference-kind-mismatch', message: fullId + '.' + name + ' names ' + target + ' of kind ' + defs.get(target).kind + ', expects ' + kinds.join('|') } }
      }
      return undefined
    }
    if (danglingPolicy === 'diagnose') {
      diagnostics.push({ rule: 'dangling-reference', message: `${fullId}.${name} names missing ${target}` })
      return undefined
    }
    return { refusal: { rule: 'missing-reference', message: `${fullId}.${name} names missing ${target}` } }
  }
  for (const [fullId, definition] of definitions) {
    for (const [name, entry] of Object.entries(definition.fields)) {
      const spec = fieldSpec(definition.kind, name)
      if (spec.type === 'ref') {
        const failure = checkRef(fullId, name, entry.value, spec.refKind)
        if (failure !== undefined) return failure
      } else if (spec.type === 'list' && spec.itemType === 'ref') {
        for (const item of entry.value) {
          const failure = checkRef(fullId, name, item, spec.refKind)
          if (failure !== undefined) return failure
        }
      } else if (spec.type === 'record' || (spec.type === 'list' && spec.itemType === 'record')) {
        const records = spec.type === 'record' ? [entry.value] : entry.value
        for (const record of records) {
          for (const field of spec.recordFields) {
            if (field.type === 'ref' && record[field.name] !== undefined) {
              const failure = checkRef(fullId, `${name}.${field.name}`, record[field.name], field.refKind)
              if (failure !== undefined) return failure
            }
          }
        }
      }
    }
  }
  return { definitions, diagnostics }
}
