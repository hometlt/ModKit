/**
 * UVW lattice annotation admission, shared by spatial and glTF worlds.
 * Wire shape and versions belong to world/schema/uvw.profile.v1.schema.json;
 * this module checks exact keys, finite publisher polygons, scoped resource kinds,
 * complete row-major cliff classification and a combined annotation budget.
 * It derives no footprint, cliff, collision or navigation from geometry. It does
 * not read game files or allocate simulation State; omitted facts remain unknown.
 */
const MAX_ANNOTATION_ITEMS = 1_048_576
const channels = ['blocked', 'noBuild', 'vision', 'nearResources', 'outline'] as const

/** Return the named admission failure without repairing or dropping publisher facts. */
function refuse(rule: string, message: string): never {
  throw Object.assign(new TypeError(`${rule}: ${message}`), { rule })
}

/** JSON objects alone carry annotations; primitives and arrays are not records. */
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Each version owns an exact vocabulary; unknown fields must never be discarded. */
function record(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key))
      || Object.keys(value).some(key => !allowed.includes(key)))
    refuse('uvw-lattice-shape', 'Invalid or unknown lattice annotation fields')
  return value
}

/** Scope and kind are opaque labels, never implicit paths or resource-fetch authority. */
function label(value: unknown, maximum: number): boolean {
  if (typeof value !== 'string' || !value || value.length > maximum * 2
      || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) return false
  let count = 0
  for (const _character of value) if (++count > maximum) return false
  return true
}

/** Reuse SDK polygon coordinates: x is parent-space X, y is its horizontal Z. */
function assertCoverage(value: unknown, consume: (count: number) => void): void {
  const coverage = record(value, ['roles', 'resourceKind', 'resourceKindScope', ...channels], [])
  if (Object.hasOwn(coverage, 'roles')) {
    const roles = coverage['roles']
    if (!Array.isArray(roles) || roles.length > 3 || new Set(roles).size !== roles.length)
      refuse('uvw-lattice-roles', 'Roles must be unique declared neutral labels')
    for (const role of roles) if (!['resource', 'destructible', 'start'].includes(role))
      refuse('uvw-lattice-roles', 'Roles must be unique declared neutral labels')
  }
  if (Object.hasOwn(coverage, 'resourceKind') || Object.hasOwn(coverage, 'resourceKindScope')) {
    if (!label(coverage['resourceKind'], 4096) || !label(coverage['resourceKindScope'], 1024))
      refuse('uvw-lattice-resource-scope', 'Resource kind needs its exact declared scope and label')
  }
  for (const channel of channels) {
    if (!Object.hasOwn(coverage, channel)) continue
    const polygons = coverage[channel]
    if (!Array.isArray(polygons) || polygons.length > MAX_ANNOTATION_ITEMS)
      refuse('uvw-lattice-polygons', 'A known channel must contain a bounded polygon array')
    consume(polygons.length)
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > MAX_ANNOTATION_ITEMS)
        refuse('uvw-lattice-polygons', 'Each publisher polygon needs at least three vertices')
      consume(polygon.length)
      for (const value of polygon) {
        const point = record(value, ['x', 'y'], ['x', 'y'])
        if (typeof point['x'] !== 'number' || !Number.isFinite(point['x'])
            || typeof point['y'] !== 'number' || !Number.isFinite(point['y']))
          refuse('uvw-lattice-polygons', 'Polygon vertices must be finite parent-space coordinates')
      }
    }
  }
}

/** A present cliff set classifies every quad; sample-grid boundary vertices are not cells. */
function assertCliffFaces(layer: Record<string, unknown>, consume: (count: number) => void): void {
  const columns = layer['columns'], rows = layer['rows'], cells = layer['cliffFaces']
  if (typeof columns !== 'number' || !Number.isSafeInteger(columns) || columns < 2
      || typeof rows !== 'number' || !Number.isSafeInteger(rows) || rows < 2
      || !Array.isArray(cells) || cells.length > MAX_ANNOTATION_ITEMS)
    refuse('uvw-lattice-cliff-cells', 'Cliff coverage requires an exact bounded heightfield cell set')
  consume(cells.length)
  let lastX = -1, lastY = -1
  for (const value of cells) {
    const cell = record(value, ['x', 'y'], ['x', 'y'])
    const x = cell['x'], y = cell['y']
    if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0 || x >= columns - 1
        || typeof y !== 'number' || !Number.isSafeInteger(y) || y < 0 || y >= rows - 1)
      refuse('uvw-lattice-cliff-cells', 'Cliff coverage names a cell outside its parent heightfield')
    if (y < lastY || y === lastY && x <= lastX)
      refuse('uvw-lattice-cell-order', 'Cliff cells must be unique and ordered by y, then x')
    lastX = x; lastY = y
  }
}

/** Check one whole world with a shared budget, preserving unknown versus known-empty channels. */
export function assertUvwLattice(spaces: readonly Record<string, unknown>[], profileVersion: unknown): void {
  let used = 0
  const consume = (count: number): void => {
    if (profileVersion !== '1.0')
      refuse('uvw-lattice-profile-version', 'Lattice annotation admission requires UVW profile 1.0')
    used += count
    if (used > MAX_ANNOTATION_ITEMS)
      refuse('uvw-lattice-budget', 'World lattice annotations exceed 1048576 records/vertices/cells')
  }
  for (const space of spaces) {
    if (!Array.isArray(space['layers'])) continue // The existing spatial owner checks the layer envelope.
    for (const layer of space['layers']) {
      if (!object(layer)) continue
      if (layer['kind'] === 'heightfield' && Object.hasOwn(layer, 'cliffFaces')) {
        consume(1); assertCliffFaces(layer, consume)
      }
      if (layer['kind'] !== 'objects' || !Array.isArray(layer['instances'])) continue
      for (const instance of layer['instances']) if (object(instance) && Object.hasOwn(instance, 'latticeCoverage')) {
        consume(1); assertCoverage(instance['latticeCoverage'], consume)
      }
    }
  }
}
