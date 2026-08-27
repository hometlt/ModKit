import {
  createInspectionCodec,
  createModelAnimationSource,
  createModelResourceRefsSource,
  createModelSceneSource,
  createProjectionReceipt,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/warzone-pie'
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1])
const TEXTURED = 0x200
const TEXTURE_ANIMATED = 0x4000
const TEXTURE_DIRECTIVES = new Set([
  'TEXTURE',
  'BASE',
  'TCMASK',
  'TEAM',
  'NORMALMAP',
  'NORMAL',
  'NORM',
  'SPECULARMAP',
  'SPECULAR',
  'SPEC',
])

function modelTree(label, nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const childIds = new Set(nodes.flatMap(node => node.childIds))
  const treeNode = id => {
    const node = byId.get(id)
    if (node === undefined) throw new TypeError(`PIE tree names an unknown node ${id}`)
    return {
      kind: 'model-node',
      label: node.name ?? node.id,
      preview: `${node.meshIds.length} mesh(es)`,
      children: node.childIds.map(treeNode),
    }
  }
  return createTreeDataSource({
    kind: 'model',
    label,
    preview: `${nodes.length} node(s)`,
    children: nodes.filter(node => !childIds.has(node.id)).map(node => treeNode(node.id)),
  })
}

function finite(token, label, line) {
  if (token === undefined) throw new TypeError(`PIE ${label} is missing at line ${line}`)
  const value = Number(token)
  if (!Number.isFinite(value)) throw new TypeError(`PIE ${label} is not finite at line ${line}`)
  return value
}

function count(token, label, line) {
  const value = finite(token, label, line)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`PIE ${label} must be a non-negative safe integer at line ${line}`)
  }
  return value
}

function hex(token, label, line) {
  const normalized = token?.replace(/^0x/iu, '') ?? ''
  if (!/^[0-9a-f]+$/iu.test(normalized)) {
    throw new TypeError(`PIE ${label} is not hexadecimal at line ${line}`)
  }
  return Number.parseInt(normalized, 16)
}

function logicalPath(value, label, line) {
  const normalized = value.replace(/\\/gu, '/').replace(/^\.\//u, '')
  if (
    normalized.length === 0 ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split('/').some(segment => segment === '..' || segment.length === 0)
  ) {
    throw new TypeError(`PIE ${label} is not a confined logical path at line ${line}`)
  }
  return normalized
}

function position(values) {
  return [values[0], values[1], values[2]]
}

function normal(values) {
  const mapped = position(values)
  const length = Math.hypot(...mapped)
  return length === 0 ? [0, 0, 0] : mapped.map(value => value / length)
}

function boundsOf(values) {
  if (values.length === 0) return undefined
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (let offset = 0; offset < values.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], values[offset + axis])
      max[axis] = Math.max(max[axis], values[offset + axis])
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function parsePie(bytes, budget, signal) {
  if (bytes.byteLength > budget.maxScalarBytes) {
    throw new RangeError('PIE text exceeds maxScalarBytes')
  }
  let source
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new TypeError('PIE source is not valid UTF-8 text')
  }
  if (source.includes('\0')) throw new TypeError('PIE source contains a NUL byte')
  const lines = source
    .split(/\r?\n/gu)
    .map((raw, index) => {
      const text = raw.replace(/#.*$/u, '').trim()
      return text.length === 0 ? undefined : { line: index + 1, tokens: text.split(/\s+/u) }
    })
    .filter(Boolean)
  let cursor = 0
  let observedNodes = 0
  const consume = amount => {
    observedNodes += amount
    if (observedNodes > budget.maxNodes) throw new RangeError('PIE records exceed maxNodes')
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  }
  const next = label => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    const line = lines[cursor]
    cursor += 1
    if (line === undefined) throw new TypeError(`PIE is truncated in ${label}`)
    return line
  }
  const header = next('header')
  if (header.tokens[0]?.toUpperCase() !== 'PIE') throw new TypeError('PIE header is missing')
  const version = count(header.tokens[1], 'version', header.line)
  if (version === 0) throw new RangeError('PIE version zero is unsupported')

  const globalTextures = []
  const levels = []
  const warnings = []
  let expectedLevels
  let current
  let connectors = 0
  let events = 0
  let shadowPoints = 0
  let shadowPolygons = 0
  let textureAnimations = 0

  const numberRows = (amount, label, minimum) => {
    consume(amount)
    const rows = []
    for (let index = 0; index < amount; index += 1) {
      const row = next(label)
      if (row.tokens.length < minimum) {
        throw new TypeError(`PIE ${label} row is too short at line ${row.line}`)
      }
      rows.push(row.tokens.map(token => finite(token, `${label} value`, row.line)))
    }
    return rows
  }

  while (cursor < lines.length) {
    const row = next('directive')
    const directive = row.tokens[0]?.toUpperCase()
    if (TEXTURE_DIRECTIVES.has(directive)) {
      if (row.tokens.length < 3)
        throw new TypeError(`PIE ${directive} is truncated at line ${row.line}`)
      count(row.tokens[1], `${directive} tileset`, row.line)
      const ref = logicalPath(row.tokens[2], `${directive} path`, row.line)
      ;(current?.textures ?? globalTextures).push(ref)
      continue
    }
    switch (directive) {
      case 'TYPE':
        hex(row.tokens[1], 'TYPE flags', row.line)
        break
      case 'INTERPOLATE':
        count(row.tokens[1], 'INTERPOLATE value', row.line)
        break
      case 'EVENT':
        count(row.tokens[1], 'EVENT kind', row.line)
        if (row.tokens[2] !== undefined) logicalPath(row.tokens[2], 'EVENT path', row.line)
        events += 1
        break
      case 'LEVELS':
        expectedLevels = count(row.tokens[1], 'LEVELS count', row.line)
        break
      case 'LEVEL': {
        const index = count(row.tokens[1], 'LEVEL index', row.line)
        if (levels.some(level => level.index === index)) {
          throw new TypeError(`PIE LEVEL ${index} is duplicated`)
        }
        consume(1)
        current = {
          index,
          points: [],
          normalRows: [],
          polygons: [],
          animations: [],
          textures: [],
        }
        levels.push(current)
        break
      }
      case 'POINTS':
        if (current === undefined) throw new TypeError('PIE POINTS appears before LEVEL')
        current.points = numberRows(
          count(row.tokens[1], 'POINTS count', row.line),
          'POINTS',
          3,
        ).map(values => position(values))
        break
      case 'NORMALS':
        if (current === undefined) throw new TypeError('PIE NORMALS appears before LEVEL')
        current.normalRows = numberRows(
          count(row.tokens[1], 'NORMALS count', row.line),
          'NORMALS',
          3,
        )
        break
      case 'POLYGONS': {
        if (current === undefined) throw new TypeError('PIE POLYGONS appears before LEVEL')
        const amount = count(row.tokens[1], 'POLYGONS count', row.line)
        consume(amount)
        for (let polygonIndex = 0; polygonIndex < amount; polygonIndex += 1) {
          const polygon = next('POLYGONS')
          const flags = hex(polygon.tokens[0], 'polygon flags', polygon.line)
          const pointCount = count(polygon.tokens[1], 'polygon point count', polygon.line)
          if (pointCount < 3)
            throw new RangeError(`PIE polygon has fewer than three points at line ${polygon.line}`)
          let offset = 2
          const pointIndices = polygon.tokens
            .slice(offset, offset + pointCount)
            .map(token => count(token, 'polygon point index', polygon.line))
          if (pointIndices.length !== pointCount)
            throw new TypeError(`PIE polygon is truncated at line ${polygon.line}`)
          offset += pointCount
          if ((flags & TEXTURE_ANIMATED) !== 0) {
            if (polygon.tokens.length < offset + 4) {
              throw new TypeError(
                `PIE polygon texture animation is truncated at line ${polygon.line}`,
              )
            }
            for (const token of polygon.tokens.slice(offset, offset + 4)) {
              finite(token, 'polygon texture animation value', polygon.line)
            }
            offset += 4
            textureAnimations += 1
          }
          const divisor = version <= 2 ? 256 : 1
          const uvs = []
          if ((flags & TEXTURED) !== 0) {
            if (polygon.tokens.length < offset + pointCount * 2) {
              throw new TypeError(`PIE polygon UV block is truncated at line ${polygon.line}`)
            }
            for (let uvIndex = 0; uvIndex < pointCount; uvIndex += 1) {
              uvs.push([
                finite(polygon.tokens[offset + uvIndex * 2], 'polygon U', polygon.line) / divisor,
                finite(polygon.tokens[offset + uvIndex * 2 + 1], 'polygon V', polygon.line) /
                  divisor,
              ])
            }
          } else {
            for (let uvIndex = 0; uvIndex < pointCount; uvIndex += 1) uvs.push([0, 0])
          }
          current.polygons.push({ pointIndices, uvs })
        }
        break
      }
      case 'CONNECTORS': {
        const amount = count(row.tokens[1], 'CONNECTORS count', row.line)
        numberRows(amount, 'CONNECTORS', 3)
        connectors += amount
        break
      }
      case 'ANIMOBJECT': {
        if (current === undefined) throw new TypeError('PIE ANIMOBJECT appears before LEVEL')
        const time = finite(row.tokens[1], 'ANIMOBJECT time', row.line)
        const cycles = count(row.tokens[2], 'ANIMOBJECT cycles', row.line)
        const amount = count(row.tokens[3], 'ANIMOBJECT frames', row.line)
        consume(amount)
        const frames = []
        for (let index = 0; index < amount; index += 1) {
          const frame = next('ANIMOBJECT')
          if (frame.tokens.length < 10) {
            throw new TypeError(`PIE ANIMOBJECT frame is truncated at line ${frame.line}`)
          }
          const values = frame.tokens
            .slice(0, 10)
            .map(token => finite(token, 'ANIMOBJECT value', frame.line))
          if (!Number.isSafeInteger(values[0]) || values[0] < 0) {
            throw new RangeError(`PIE ANIMOBJECT frame index is invalid at line ${frame.line}`)
          }
          frames.push(values)
        }
        for (let index = 1; index < frames.length; index += 1) {
          if (frames[index][0] <= frames[index - 1][0]) {
            throw new TypeError('PIE ANIMOBJECT frame indices must be strictly increasing')
          }
        }
        if (frames.length > 0) current.animations.push({ time, cycles, frames })
        break
      }
      case 'SHADOWPOINTS': {
        const amount = count(row.tokens[1], 'SHADOWPOINTS count', row.line)
        numberRows(amount, 'SHADOWPOINTS', 3)
        shadowPoints += amount
        break
      }
      case 'SHADOWPOLYGONS': {
        const amount = count(row.tokens[1], 'SHADOWPOLYGONS count', row.line)
        consume(amount)
        for (let index = 0; index < amount; index += 1) {
          const polygon = next('SHADOWPOLYGONS')
          hex(polygon.tokens[0], 'shadow polygon flags', polygon.line)
          const pointCount = count(polygon.tokens[1], 'shadow polygon point count', polygon.line)
          if (pointCount < 3 || polygon.tokens.length < 2 + pointCount) {
            throw new TypeError(`PIE shadow polygon is malformed at line ${polygon.line}`)
          }
        }
        shadowPolygons += amount
        break
      }
      default:
        warnings.push(`${directive ?? 'EMPTY'} at line ${row.line}`)
        break
    }
  }

  if (levels.length === 0) throw new TypeError('PIE has no LEVEL blocks')
  if (expectedLevels !== undefined && expectedLevels !== levels.length) {
    throw new TypeError(`PIE declares ${expectedLevels} levels but contains ${levels.length}`)
  }

  const resources = [...new Set([...globalTextures, ...levels.flatMap(level => level.textures)])]
  const primitives = []
  const meshes = []
  const nodes = []
  const globalPositions = []
  const clips = []
  for (const level of levels) {
    const positions = []
    const normals = []
    const textureCoordinates = []
    const indices = []
    for (let polygonIndex = 0; polygonIndex < level.polygons.length; polygonIndex += 1) {
      const polygon = level.polygons[polygonIndex]
      const normalRow = level.normalRows[polygonIndex]
      const base = positions.length / 3
      for (let corner = 0; corner < polygon.pointIndices.length; corner += 1) {
        const pointIndex = polygon.pointIndices[corner]
        const point = level.points[pointIndex]
        if (point === undefined)
          throw new RangeError(`PIE LEVEL ${level.index} polygon references point ${pointIndex}`)
        positions.push(...point)
        textureCoordinates.push(...polygon.uvs[corner])
        if (normalRow !== undefined && normalRow.length >= polygon.pointIndices.length * 3) {
          normals.push(...normal(normalRow.slice(corner * 3, corner * 3 + 3)))
        }
      }
      for (let triangle = 1; triangle + 1 < polygon.pointIndices.length; triangle += 1) {
        indices.push(base, base + triangle + 1, base + triangle)
      }
    }
    const primitiveId = `pie-level-${level.index}-primitive`
    const meshId = `pie-level-${level.index}`
    const typedPositions = new Float32Array(positions)
    const primitive = {
      id: primitiveId,
      topology: 'triangles',
      positions: typedPositions,
      indices: new Uint32Array(indices),
      textureCoordinates: new Float32Array(textureCoordinates),
      ...(normals.length === positions.length ? { normals: new Float32Array(normals) } : {}),
      ...(positions.length === 0 ? {} : { bounds: boundsOf(typedPositions) }),
    }
    primitives.push(primitive)
    meshes.push({ id: meshId, name: `Level ${level.index}`, primitiveIds: [primitiveId] })
    nodes.push({
      id: `pie-level-${level.index}`,
      name: `Level ${level.index}`,
      childIds: [],
      meshIds: [meshId],
      transform: IDENTITY,
    })
    // Bounds describe the published contract, whose coordinates are Float32. Computing them from
    // the source doubles would make live and reopened UVM disagree by rounding-only differences.
    globalPositions.push(...typedPositions)
    for (let animationIndex = 0; animationIndex < level.animations.length; animationIndex += 1) {
      const animation = level.animations[animationIndex]
      const firstFrame = Math.min(...animation.frames.map(frame => frame[0]))
      const lastFrame = Math.max(...animation.frames.map(frame => frame[0]))
      clips.push({
        id: `pie-level-${level.index}-animobject-${animationIndex}`,
        name: `Level ${level.index} ANIMOBJECT ${animationIndex + 1}`,
        kind: animation.frames.length > 1 ? 'animation' : 'rest-pose',
        provenance: 'direct',
        // Count only records actually decoded. A sparse index range is not evidence of the missing
        // frames between its endpoints, and must not become an overclaim in the facet.
        frames: animation.frames.length,
        channels: [
          { target: `pie-level-${level.index}`, kind: 'translation', firstFrame, lastFrame },
          { target: `pie-level-${level.index}`, kind: 'rotation', firstFrame, lastFrame },
          { target: `pie-level-${level.index}`, kind: 'scale', firstFrame, lastFrame },
        ],
        unsupportedChannels: 0,
      })
    }
  }

  return {
    version,
    levels,
    resources,
    primitives,
    meshes,
    nodes,
    clips,
    bounds: boundsOf(globalPositions),
    events,
    connectors,
    shadowPoints,
    shadowPolygons,
    textureAnimations,
    warnings,
  }
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'warzone-pie', label: 'Warzone 2100 PIE model' }),
  async detect(prefix) {
    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(prefix.subarray(0, 2048))
    } catch {
      return { confidence: 0, kind: 'structure', note: 'invalid-utf8' }
    }
    const first = text
      .split(/\r?\n/gu)
      .map(line => line.replace(/#.*$/u, '').trim())
      .find(Boolean)
    return /^PIE\s+[1-9]\d*\b/iu.test(first ?? '')
      ? { confidence: 0.995, kind: 'structure', note: 'PIE header' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const parsed = parsePie(bytes, context.budget, context.signal)
    const info = {
      scenes: 1,
      nodes: parsed.nodes.length,
      meshes: parsed.meshes.length,
      primitives: parsed.primitives.length,
      materials: 0,
      textures: parsed.resources.length,
      animations: parsed.clips.filter(clip => clip.kind === 'animation').length,
      ...(parsed.bounds === undefined ? {} : { bounds: parsed.bounds }),
      geometryAccess: 'decoded',
    }
    const dataSources = {
      'common.view/model-scene-source': createModelSceneSource({
        info,
        nodes: parsed.nodes,
        meshes: parsed.meshes,
        primitives: parsed.primitives,
      }),
      'common.view/tree-data-source': modelTree('Warzone 2100 PIE', parsed.nodes),
      ...(parsed.resources.length === 0
        ? {}
        : {
            'common.view/model-resource-refs-source': createModelResourceRefsSource({
              references: parsed.resources.map(id => ({
                id,
                role: 'texture',
                provenance: 'reference-only',
              })),
            }),
          }),
      ...(parsed.clips.length === 0
        ? {}
        : {
            'common.view/model-animation-source': createModelAnimationSource({
              clips: parsed.clips,
            }),
          }),
    }
    return {
      summary: {
        format: 'warzone-pie',
        version: parsed.version,
        levels: parsed.levels.length,
        points: parsed.levels.reduce((total, level) => total + level.points.length, 0),
        polygons: parsed.levels.reduce((total, level) => total + level.polygons.length, 0),
        textures: parsed.resources.length,
        animObjects: parsed.clips.length,
        namedRemainder: ['warzone-3do', 'pie-writing'],
      },
      traits: [
        { id: 'model.geometry' },
        { id: 'structure.hierarchy' },
        { id: 'content.text' },
        ...(parsed.resources.length === 0 ? [] : [{ id: 'model.textures' }]),
        ...(parsed.clips.length === 0 ? [] : [{ id: 'model.animations' }]),
      ],
      maxDecodedBytes: parsed.primitives.reduce(
        (total, primitive) =>
          total +
          primitive.positions.byteLength +
          primitive.indices.byteLength +
          primitive.textureCoordinates.byteLength +
          (primitive.normals?.byteLength ?? 0),
        0,
      ),
      projectionReceipt: createProjectionReceipt({
        adapter: { id: ID, version: '1.0.0' },
        subjectRevision: context.input.revisions.revision,
        companions: [],
        basis: { handedness: 'right', upAxis: 'y', forwardAxis: '+z', unit: 'source-unit' },
        planes: [
          {
            planeId: 'geometry',
            state: 'preserved',
            note: 'PIE POINTS and NORMALS already use the renderer x,y,z frame and polygons are fan-triangulated without changing that frame',
          },
          {
            planeId: 'structure',
            state: 'preserved',
            note: 'LEVEL order and identity are preserved',
          },
          {
            planeId: 'resources',
            state: 'preserved',
            note: `${parsed.resources.length} confined logical texture reference(s), unresolved by the codec`,
          },
          {
            planeId: 'animation',
            state: 'preserved',
            note:
              parsed.clips.length === 0
                ? 'the source contains no valid ANIMOBJECT frame records; no animation facet is published'
                : `${parsed.clips.length} clip/channel envelope(s) come only from decoded ANIMOBJECT frame records`,
          },
          ...(parsed.clips.length === 0
            ? []
            : [
                {
                  planeId: 'animation-samples',
                  state: 'lost',
                  note: 'numeric ANIMOBJECT translation/rotation/scale samples are validated but the admitted animation facet carries only clip and channel envelopes',
                },
              ]),
          {
            planeId: 'polygon-texture-animation',
            state: parsed.textureAnimations === 0 ? 'preserved' : 'lost',
            note:
              parsed.textureAnimations === 0
                ? 'no animated polygon UV blocks were present'
                : `${parsed.textureAnimations} polygon texture animation block(s) are not skeletal animation and are not projected`,
          },
          {
            planeId: 'materials',
            state: 'lost',
            note: 'PIE blend and material flags have no admitted live facet here',
          },
          ...(parsed.shadowPoints + parsed.shadowPolygons === 0
            ? []
            : [
                {
                  planeId: 'shadow-geometry',
                  state: 'lost',
                  note: `${parsed.shadowPoints} shadow point(s) and ${parsed.shadowPolygons} shadow polygon(s) are validated but not projected`,
                },
              ]),
          ...(parsed.connectors === 0
            ? []
            : [
                {
                  planeId: 'connectors',
                  state: 'lost',
                  note: `${parsed.connectors} connector(s); model-socket-source remains reserved`,
                },
              ]),
        ],
        evidence: [
          {
            kind: 'observed',
            statement: `${parsed.levels.length} level(s), ${parsed.primitives.length} decoded primitive(s), ${parsed.clips.length} ANIMOBJECT clip(s)`,
            bytesRead: BigInt(bytes.byteLength),
          },
          {
            kind: 'declared',
            statement:
              'PIE parsing and coordinate behavior follow the readable Warzone 2100 model implementation; no 3DO behavior is inferred',
            source: 'warzone-2100-pie-reader',
          },
        ],
        confidence: parsed.primitives.length > 0 ? 'high' : 'partial',
      }),
      dataSources,
      unsupportedFeatures: [
        'warzone-3do',
        'pie-writing',
        ...(parsed.textureAnimations === 0 ? [] : ['polygon-texture-animation']),
        ...(parsed.shadowPoints + parsed.shadowPolygons === 0 ? [] : ['shadow-geometry']),
        ...(parsed.events === 0 ? [] : ['event-resolution']),
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
