/** Game-neutral, bounded semantic overview annotations. Geometry is horizontal in the declared
 * frame; scalar elevation is a presentation field, not authoritative terrain or runtime physics.
 * Missing masks mean unknown. Rows cover the full grid; a zero sample is known clear.
 */
export type LatticePoint = readonly [number, number]
export type LatticeRgb = readonly [number, number, number]
/** Ordered nonoverlapping runs, [positive sample count, finite scalar]; each row totals columns. */
export type LatticeRunRows = readonly (readonly (readonly [number, number])[])[]

export interface MapLatticeOverview {
  /** Identity and fidelity of the publisher's analysis; no game rule is inferred by consumers. */
  readonly provenance: Readonly<{
    method: string
    quality: 'authored' | 'derived'
    complete: boolean
  }>
  readonly raster: Readonly<{
    columns: number
    rows: number
    /** Corner of sample (0,0); row and column vectors include the full sample width. */
    origin: LatticePoint
    columnStep: LatticePoint
    rowStep: LatticePoint
    /** Presentation elevation/level field, encoded independently of colour and masks. */
    elevation: LatticeRunRows
    /** Ordered scalar→sRGB byte anchors; a common renderer interpolates between anchors. */
    palette: readonly Readonly<{ value: number; color: LatticeRgb }>[]
    /** Publisher-qualified movement category; absence never means all unit types are covered. */
    movementProfile?: string
    blocked?: LatticeRunRows
    noBuild?: LatticeRunRows
    vision?: LatticeRunRows
  }>
  /** Mid-surface boundaries already resolved by the native owner; never area perimeters. */
  readonly lines: readonly Readonly<{
    role: 'cliff' | 'ramp'
    points: readonly LatticePoint[]
    closed: boolean
  }>[]
  readonly markers: readonly Readonly<{
    id: string
    role: 'resource' | 'destructible' | 'unit' | 'start'
    point: LatticePoint
    outline: readonly LatticePoint[]
    color: LatticeRgb
    opacity: number
    /** Native resource label, carried for inspection rather than interpreted by the renderer. */
    resourceKind?: string
    resourceVariant?: 'ordinary' | 'rich'
    resourceState?: 'full' | 'reduced' | 'depleted'
    player?: number
  }>[]
  /** Missing means no known playable boundary. An empty polygon is invalid. */
  readonly playableArea?: readonly LatticePoint[]
}

export interface LatticeOverviewLimits {
  readonly maxSamples?: number
  readonly maxRuns?: number
  readonly maxVertices?: number
  readonly signal?: AbortSignal
}

/** Validate before consumers allocate raster buffers; preserve unknown versus known-empty masks. */
export function validateLatticeOverview(
  value: unknown,
  limits: LatticeOverviewLimits = {},
): MapLatticeOverview {
  const maxSamples = limits.maxSamples ?? 4_194_304
  const maxRuns = limits.maxRuns ?? 1_000_000
  const maxVertices = limits.maxVertices ?? 500_000
  for (const n of [maxSamples, maxRuns, maxVertices])
    if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError('Invalid lattice overview limit')
  let runs = 0,
    vertices = 0
  const check = () => {
    limits.signal?.throwIfAborted()
    if (runs > maxRuns || vertices > maxVertices)
      throw new RangeError('Lattice overview budget exceeded')
  }
  const record = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (v === null || typeof v !== 'object' || Array.isArray(v))
      throw new TypeError('Invalid lattice overview record')
    const r = v as Record<string, unknown>
    if (Object.keys(r).some(k => !keys.includes(k)))
      throw new TypeError('Unknown lattice overview field')
    return r
  }
  const finite = (v: unknown): number => {
    if (typeof v !== 'number' || !Number.isFinite(v))
      throw new TypeError('Invalid lattice overview number')
    return v
  }
  const text = (v: unknown): string => {
    if (typeof v !== 'string' || !v.trim() || v.length > 1024 || v.includes('\0'))
      throw new TypeError('Invalid lattice overview string')
    return v
  }
  const list = (v: unknown): readonly unknown[] => {
    if (!Array.isArray(v)) throw new TypeError('Invalid lattice overview array')
    return v
  }
  const point = (v: unknown): LatticePoint => {
    const a = list(v)
    if (a.length !== 2) throw new TypeError('Invalid lattice overview point')
    vertices++
    check()
    return Object.freeze([finite(a[0]), finite(a[1])])
  }
  const color = (v: unknown): readonly [number, number, number] => {
    const a = list(v)
    if (
      a.length !== 3 ||
      a.some(n => !Number.isInteger(n) || (n as number) < 0 || (n as number) > 255)
    )
      throw new TypeError('Invalid lattice overview colour')
    return Object.freeze([a[0] as number, a[1] as number, a[2] as number])
  }
  const points = (v: unknown, minimum: number) => {
    const a = list(v)
    if (a.length < minimum || a.length > maxVertices)
      throw new RangeError('Invalid lattice overview polygon')
    return Object.freeze(a.map(point))
  }
  check()
  const root = record(value, ['provenance', 'raster', 'lines', 'markers', 'playableArea'])
  const p = record(root['provenance'], ['method', 'quality', 'complete'])
  if (
    (p['quality'] !== 'authored' && p['quality'] !== 'derived') ||
    typeof p['complete'] !== 'boolean'
  )
    throw new TypeError('Invalid lattice overview provenance')
  const r = record(root['raster'], [
    'columns',
    'rows',
    'origin',
    'columnStep',
    'rowStep',
    'elevation',
    'palette',
    'movementProfile',
    'blocked',
    'noBuild',
    'vision',
  ])
  const columns = finite(r['columns']),
    rows = finite(r['rows'])
  if (
    !Number.isSafeInteger(columns) ||
    !Number.isSafeInteger(rows) ||
    columns <= 0 ||
    rows <= 0 ||
    columns * rows > maxSamples
  )
    throw new RangeError('Lattice overview sample budget exceeded')
  const origin = point(r['origin']),
    columnStep = point(r['columnStep']),
    rowStep = point(r['rowStep'])
  const determinant = columnStep[0] * rowStep[1] - columnStep[1] * rowStep[0]
  if (!Number.isFinite(determinant) || determinant === 0)
    throw new TypeError('Degenerate lattice overview frame')
  const runRows = (v: unknown, mask: boolean): LatticeRunRows => {
    const a = list(v)
    if (a.length !== rows) throw new TypeError('Lattice overview row count mismatch')
    return Object.freeze(
      a.map(row => {
        check()
        const entries = list(row)
        runs += entries.length
        check()
        let total = 0
        const result = entries.map(run => {
          const pair = list(run)
          const length = finite(pair[0]),
            sample = finite(pair[1])
          if (
            pair.length !== 2 ||
            !Number.isSafeInteger(length) ||
            length <= 0 ||
            (mask && sample !== 0 && sample !== 1)
          )
            throw new TypeError('Invalid lattice overview run')
          total += length
          if (total > columns) throw new TypeError('Lattice overview row overflow')
          return Object.freeze([length, sample] as const)
        })
        if (total !== columns) throw new TypeError('Lattice overview row coverage mismatch')
        return Object.freeze(result)
      }),
    )
  }
  const anchors = list(r['palette'])
  if (anchors.length < 2 || anchors.length > 256)
    throw new RangeError('Invalid lattice overview palette')
  const palette = Object.freeze(
    anchors.map(anchor => {
      const item = record(anchor, ['value', 'color'])
      return Object.freeze({ value: finite(item['value']), color: color(item['color']) })
    }),
  )
  if (palette.some((anchor, i) => i > 0 && anchor.value <= palette[i - 1]!.value))
    throw new TypeError('Unordered lattice overview palette')
  const movementProfile =
    r['movementProfile'] === undefined ? undefined : text(r['movementProfile'])
  if (r['blocked'] !== undefined && movementProfile === undefined)
    throw new TypeError('Lattice blocked mask requires a movement profile')
  const lineValues = list(root['lines']),
    markerValues = list(root['markers'])
  if (lineValues.length + markerValues.length > maxVertices)
    throw new RangeError('Lattice overview primitive budget exceeded')
  const lines = Object.freeze(
    lineValues.map(v => {
      const line = record(v, ['role', 'points', 'closed'])
      if (
        (line['role'] !== 'cliff' && line['role'] !== 'ramp') ||
        typeof line['closed'] !== 'boolean'
      )
        throw new TypeError('Invalid lattice overview line')
      return Object.freeze({
        role: line['role'],
        points: points(line['points'], 2),
        closed: line['closed'],
      })
    }),
  )
  const ids = new Set<string>()
  const markers = Object.freeze(
    markerValues.map(v => {
      const m = record(v, [
        'id',
        'role',
        'point',
        'outline',
        'color',
        'opacity',
        'resourceKind',
        'resourceVariant',
        'resourceState',
        'player',
      ])
      const id = text(m['id'])
      if (ids.has(id)) throw new TypeError('Duplicate lattice overview marker')
      ids.add(id)
      const role = m['role']
      if (role !== 'resource' && role !== 'destructible' && role !== 'unit' && role !== 'start')
        throw new TypeError('Invalid lattice marker role')
      const opacity = finite(m['opacity'])
      if (opacity < 0 || opacity > 1) throw new TypeError('Invalid lattice marker opacity')
      if (
        m['resourceVariant'] !== undefined &&
        m['resourceVariant'] !== 'ordinary' &&
        m['resourceVariant'] !== 'rich'
      )
        throw new TypeError('Invalid resource variant')
      if (
        m['resourceState'] !== undefined &&
        !['full', 'reduced', 'depleted'].includes(String(m['resourceState']))
      )
        throw new TypeError('Invalid resource state')
      if (m['player'] !== undefined && !Number.isSafeInteger(m['player']))
        throw new TypeError('Invalid lattice player')
      return Object.freeze({
        id,
        role,
        point: point(m['point']),
        outline: points(m['outline'], 3),
        color: color(m['color']),
        opacity,
        ...(m['resourceKind'] === undefined ? {} : { resourceKind: text(m['resourceKind']) }),
        ...(m['resourceVariant'] === undefined
          ? {}
          : { resourceVariant: m['resourceVariant'] as 'ordinary' | 'rich' }),
        ...(m['resourceState'] === undefined
          ? {}
          : { resourceState: m['resourceState'] as 'full' | 'reduced' | 'depleted' }),
        ...(m['player'] === undefined ? {} : { player: m['player'] as number }),
      })
    }),
  )
  return Object.freeze({
    provenance: Object.freeze({
      method: text(p['method']),
      quality: p['quality'],
      complete: p['complete'],
    }),
    raster: Object.freeze({
      columns,
      rows,
      origin,
      columnStep,
      rowStep,
      elevation: runRows(r['elevation'], false),
      palette,
      ...(movementProfile === undefined ? {} : { movementProfile }),
      ...Object.fromEntries(
        ['blocked', 'noBuild', 'vision'].flatMap(k =>
          r[k] === undefined ? [] : [[k, runRows(r[k], true)]],
        ),
      ),
    }),
    lines,
    markers,
    ...(root['playableArea'] === undefined
      ? {}
      : { playableArea: points(root['playableArea'], 3) }),
  })
}

/** Project horizontal geometry once; presentation scalars, profile and masks are unchanged. */
export function projectLatticeOverview(
  value: MapLatticeOverview,
  project: (point: LatticePoint) => LatticePoint,
): MapLatticeOverview {
  const overview = validateLatticeOverview(value)
  const r = overview.raster,
    origin = project(r.origin)
  const step = (p: LatticePoint): LatticePoint => {
    const q = project([r.origin[0] + p[0], r.origin[1] + p[1]])
    return [q[0] - origin[0], q[1] - origin[1]]
  }
  return validateLatticeOverview({
    ...overview,
    raster: { ...r, origin, columnStep: step(r.columnStep), rowStep: step(r.rowStep) },
    lines: overview.lines.map(line => ({ ...line, points: line.points.map(project) })),
    markers: overview.markers.map(marker => ({
      ...marker,
      point: project(marker.point),
      outline: marker.outline.map(project),
    })),
    ...(overview.playableArea === undefined
      ? {}
      : { playableArea: overview.playableArea.map(project) }),
  })
}
