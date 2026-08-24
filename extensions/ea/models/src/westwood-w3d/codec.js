// Portable Westwood W3D reader. It walks bounded recursive chunks and decodes the documented mesh,
// hierarchy, HLOD and animation streams.
//
// Scope is set by the corpus, not by the specification: chunk types no readable file exercises are
// reported as unsupported with their bytes preserved rather than implemented blind. The Renegade /
// Apocalypse-Rising dialect that decodes to metadata only stays exactly that — a visible boundary.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'
import {
  meshRoles,
  parseAnimations,
  parseCollisionBoxes,
  parseHierarchy,
  parseHlod,
  scanTextureNames,
  unsupportedAnimationChunks,
} from './structure.js'

/** Bytes `planInput` reads from the front of the file to discover texture references. */
const PLAN_SCAN_BYTES = 256 * 1024
const TEXTURE_REQUIREMENT = 'textures'

const ID = 'org.modkitx/westwood-w3d'
const SIZE_MASK = 0x7fffffff
const HAS_CHILDREN = 0x80000000
const TOP_LEVEL = new Set([
  0x0, 0x100, 0x200, 0x280, 0x2c0, 0x300, 0x400, 0x420, 0x440, 0x460, 0x500, 0x600, 0x700, 0x740,
  0x750, 0x800, 0x900, 0xa00,
])
const NAMES = new Map([
  [0x0, 'MESH'],
  [0x1f, 'MESH_HEADER3'],
  [0x2, 'VERTICES'],
  [0x3, 'VERTEX_NORMALS'],
  [0x20, 'TRIANGLES'],
  [0x30, 'TEXTURES'],
  [0x31, 'TEXTURE'],
  [0x32, 'TEXTURE_NAME'],
  [0x38, 'MATERIAL_PASS'],
  [0x48, 'TEXTURE_STAGE'],
  [0x49, 'TEXTURE_IDS'],
  [0x4a, 'STAGE_TEXCOORDS'],
  [0x100, 'HIERARCHY'],
  [0x101, 'HIERARCHY_HEADER'],
  [0x102, 'PIVOTS'],
  [0x200, 'ANIMATION'],
  [0x280, 'COMPRESSED_ANIMATION'],
  [0x500, 'EMITTER'],
  [0x600, 'AGGREGATE'],
  [0x700, 'HLOD'],
  [0x740, 'BOX'],
  [0x900, 'DAZZLE'],
  [0xa00, 'SOUND_OBJECT'],
])
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function validRoot(prefix) {
  if (prefix.byteLength < 8 || prefix[0] === 0x3c) return false
  const data = view(prefix)
  const type = data.getUint32(0, true)
  const size = data.getUint32(4, true) & SIZE_MASK
  return TOP_LEVEL.has(type) && size > 0
}

function chunkName(type) {
  return NAMES.get(type) ?? `CHUNK_0x${type.toString(16).padStart(8, '0')}`
}

function readChunks(bytes, start, end, depth, state, budget) {
  if (depth > budget.maxDepth) throw new RangeError('W3D chunk tree exceeds maxDepth')
  const chunks = []
  let cursor = start
  while (cursor < end) {
    if (end - cursor < 8) throw new TypeError('W3D chunk header is truncated')
    if (state.nodes >= budget.maxNodes) throw new RangeError('W3D chunks exceed maxNodes')
    const data = view(bytes)
    const type = data.getUint32(cursor, true)
    const sizeField = data.getUint32(cursor + 4, true)
    const size = sizeField & SIZE_MASK
    const payloadStart = cursor + 8
    const payloadEnd = payloadStart + size
    if (!Number.isSafeInteger(payloadEnd) || payloadEnd > end) {
      if (depth === 0 && chunks.length > 0) {
        state.trailingBytes = end - cursor
        break
      }
      throw new RangeError(`W3D ${chunkName(type)} payload is outside its parent`)
    }
    state.nodes += 1
    const children =
      (sizeField & HAS_CHILDREN) !== 0
        ? readChunks(bytes, payloadStart, payloadEnd, depth + 1, state, budget)
        : Object.freeze([])
    chunks.push(
      Object.freeze({
        id: String(state.nodes - 1),
        type,
        name: chunkName(type),
        offset: cursor,
        size,
        payloadStart,
        payloadEnd,
        hasChildren: (sizeField & HAS_CHILDREN) !== 0,
        children,
      }),
    )
    cursor = payloadEnd
  }
  return Object.freeze(chunks)
}

function flatten(chunks, out = []) {
  for (const chunk of chunks) {
    out.push(chunk)
    flatten(chunk.children, out)
  }
  return out
}

function treeChunk(chunk) {
  return {
    kind: chunk.hasChildren ? 'section' : 'record',
    label: chunk.name,
    preview: `${chunk.size} payload bytes at ${chunk.offset}`,
    children: chunk.children.map(treeChunk),
  }
}

function descendants(chunks, type, out = []) {
  for (const chunk of chunks) {
    if (chunk.type === type) out.push(chunk)
    descendants(chunk.children, type, out)
  }
  return out
}

function fixedString(bytes, offset, length) {
  const end = Math.min(bytes.byteLength, offset + length)
  let cursor = offset
  while (cursor < end && bytes[cursor] !== 0) cursor += 1
  return new TextDecoder().decode(bytes.subarray(offset, cursor)).trim()
}

function toUvm([x, y, z]) {
  return [x, z, y === 0 ? 0 : -y]
}

function normalized(vector) {
  const length = Math.hypot(...vector)
  return length === 0 ? [0, 0, 0] : vector.map(value => value / length)
}

function vec3Stream(bytes, chunk, count, label) {
  const available = Math.floor(chunk.size / 12)
  if (count > available) throw new TypeError(`W3D ${label} stream is truncated`)
  const data = view(bytes)
  const result = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const offset = chunk.payloadStart + index * 12
    result.set(
      toUvm([
        data.getFloat32(offset, true),
        data.getFloat32(offset + 4, true),
        data.getFloat32(offset + 8, true),
      ]),
      index * 3,
    )
  }
  return result
}

function normalStream(bytes, chunk, count, label) {
  const values = vec3Stream(bytes, chunk, count, label)
  for (let offset = 0; offset < values.length; offset += 3) {
    values.set(normalized([values[offset], values[offset + 1], values[offset + 2]]), offset)
  }
  return values
}

function boundsFor(positions) {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis]
      min[axis] = Math.min(min[axis], value)
      max[axis] = Math.max(max[axis], value)
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function unionBounds(meshes) {
  if (meshes.length === 0) return undefined
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const mesh of meshes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.primitive.bounds.min[axis])
      max[axis] = Math.max(max[axis], mesh.primitive.bounds.max[axis])
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function decodeMesh(bytes, chunk, index) {
  const header = chunk.children.find(child => child.type === 0x1f)
  const vertices = chunk.children.find(child => child.type === 0x2)
  const triangles = chunk.children.find(child => child.type === 0x20)
  if (header === undefined || vertices === undefined || triangles === undefined) return undefined
  if (header.size < 116) throw new TypeError('W3D MESH_HEADER3 is shorter than 116 bytes')
  const data = view(bytes)
  const vertexCount = data.getUint32(header.payloadStart + 44, true)
  const triangleCount = data.getUint32(header.payloadStart + 40, true)
  if (vertexCount === 0 || triangleCount === 0) return undefined
  const positions = vec3Stream(bytes, vertices, vertexCount, 'vertex')
  if (triangles.size < triangleCount * 32) throw new TypeError('W3D triangle stream is truncated')
  const indices = new Uint32Array(triangleCount * 3)
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangles.payloadStart + triangle * 32
    for (let corner = 0; corner < 3; corner += 1) {
      const value = data.getUint32(offset + corner * 4, true)
      if (value >= vertexCount)
        throw new TypeError('W3D triangle index is outside the vertex stream')
      indices[triangle * 3 + corner] = value
    }
  }
  const normalChunk = chunk.children.find(child => child.type === 0x3)
  const normals =
    normalChunk !== undefined && normalChunk.size >= vertexCount * 12
      ? normalStream(bytes, normalChunk, vertexCount, 'normal')
      : undefined
  const texcoordChunk = descendants(chunk.children, 0x4a)[0]
  let textureCoordinates
  if (texcoordChunk !== undefined && texcoordChunk.size >= vertexCount * 8) {
    textureCoordinates = new Float32Array(vertexCount * 2)
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const offset = texcoordChunk.payloadStart + vertex * 8
      textureCoordinates[vertex * 2] = data.getFloat32(offset, true)
      textureCoordinates[vertex * 2 + 1] = 1 - data.getFloat32(offset + 4, true)
    }
  }
  const textures = Object.freeze(
    descendants(chunk.children, 0x32)
      .map(texture => fixedString(bytes, texture.payloadStart, texture.size))
      .filter(Boolean),
  )
  const name = fixedString(bytes, header.payloadStart + 8, 16) || `W3DMesh_${index}`
  const container = fixedString(bytes, header.payloadStart + 24, 16)
  const roles = meshRoles(data.getUint32(header.payloadStart + 4, true))
  const primitive = Object.freeze({
    id: `w3d-primitive-${index}`,
    topology: 'triangles',
    positions,
    indices,
    ...(normals === undefined ? {} : { normals }),
    ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
    materialId: `w3d-material-${index}`,
    bounds: boundsFor(positions),
  })
  return Object.freeze({
    id: `w3d-mesh-${index}`,
    name,
    container,
    roles,
    primitive,
    textures,
    decodedBytes:
      positions.byteLength +
      indices.byteLength +
      (normals?.byteLength ?? 0) +
      (textureCoordinates?.byteLength ?? 0),
  })
}

function decodedMeshes(bytes, roots, budget) {
  const meshes = roots
    .filter(chunk => chunk.type === 0x0)
    .map((chunk, index) => decodeMesh(bytes, chunk, index))
    .filter(Boolean)
  const geometryNodes = meshes.reduce(
    (sum, mesh) => sum + mesh.primitive.positions.length / 3 + mesh.primitive.indices.length / 3,
    0,
  )
  if (geometryNodes > budget.maxNodes) throw new RangeError('W3D geometry exceeds maxNodes')
  const decodedBytes = meshes.reduce((sum, mesh) => sum + mesh.decodedBytes, 0)
  if (decodedBytes > budget.maxScalarBytes)
    throw new RangeError('W3D geometry exceeds maxScalarBytes')
  return Object.freeze({ meshes: Object.freeze(meshes), decodedBytes })
}

function modelSource(total, decoded, structure) {
  const bounds = unionBounds(decoded.meshes)
  const textures = [...new Set(decoded.meshes.flatMap(mesh => mesh.textures))]
  const scene = sceneNodes(structure.hierarchy, structure.hlod, decoded.meshes, total)
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: scene.nodes.length,
      meshes: decoded.meshes.length,
      primitives: decoded.meshes.length,
      materials: decoded.meshes.length,
      textures: textures.length,
      // an animation counts once it has at least one decoded channel; a header with nothing this
      // reader understands is reported as unsupported, never as a track that was read
      animations: structure.animations.filter(item => item.channels.length > 0).length,
      ...(bounds === undefined ? {} : { bounds }),
      geometryAccess: decoded.meshes.length > 0 ? 'decoded' : 'metadata-only',
    },
    nodes: scene.nodes,
    meshes: decoded.meshes.map(mesh => ({
      id: mesh.id,
      name: mesh.name,
      primitiveIds: [mesh.primitive.id],
    })),
    primitives: decoded.meshes.map(mesh => mesh.primitive),
  })
}

function w3dDiagnostic(id, severity, code, message, data) {
  return Object.freeze({
    id,
    severity,
    code: `x3.w3d/${code}`,
    message,
    category: 'dependency',
    ...(data === undefined ? {} : { data }),
  })
}

/** Reads the texture bindings the host resolved, keyed by the exact name the model referenced. */
async function readTextures(input, signal) {
  const bindings = input.bindingsFor?.(TEXTURE_REQUIREMENT) ?? []
  const resolved = []
  for (const binding of bindings) {
    const lease = await input.openBinding(binding.bindingId, signal)
    try {
      if (lease.value.kind !== 'bytes') continue
      resolved.push(
        Object.freeze({
          bindingId: binding.bindingId,
          uri: binding.source.uri,
          bytes: Number(lease.value.size ?? 0n),
        }),
      )
    } finally {
      await lease.release()
    }
  }
  return Object.freeze(resolved)
}

/**
 * Builds the scene nodes from the pivot table and attaches meshes through the HLOD table.
 *
 * When there is no hierarchy the model keeps the single structural root it always had — a flat file
 * genuinely has one node, and inventing a skeleton for it would be worse than reporting none.
 */
function sceneNodes(hierarchy, hlod, meshes, total) {
  if (hierarchy === undefined || hierarchy.pivots.length === 0) {
    return {
      nodes: [
        {
          id: 'w3d-root',
          name: `Westwood W3D structural root (${total} chunks)`,
          childIds: [],
          meshIds: meshes.map(mesh => mesh.id),
          transform: IDENTITY,
        },
      ],
      boundMeshes: 0,
    }
  }
  /*
   * The mesh↔bone table, built only from what an HLOD sub-object states: its `boneIndex` and the
   * `CONTAINER.MESH` name it carries. A mesh whose composite name no sub-object mentions stays on
   * the root — unbound and visibly so, rather than attached to a bone by resemblance.
   */
  const byComposite = new Map()
  for (const sub of hlod?.subObjects ?? []) {
    if (sub.name !== '') byComposite.set(sub.name.toLowerCase(), sub.boneIndex)
  }
  const meshesFor = new Map()
  let boundMeshes = 0
  const unbound = []
  for (const mesh of meshes) {
    const composite = `${mesh.container}.${mesh.name}`.toLowerCase()
    const bone = byComposite.get(composite)
    if (bone === undefined || bone >= hierarchy.pivots.length) {
      unbound.push(mesh.id)
      continue
    }
    const list = meshesFor.get(bone) ?? []
    list.push(mesh.id)
    meshesFor.set(bone, list)
    boundMeshes += 1
  }
  const childIds = new Map()
  for (const pivot of hierarchy.pivots) {
    if (pivot.parentIndex < 0) continue
    const siblings = childIds.get(pivot.parentIndex) ?? []
    siblings.push(`w3d-pivot-${pivot.index}`)
    childIds.set(pivot.parentIndex, siblings)
  }
  const nodes = hierarchy.pivots.map(pivot => ({
    id: `w3d-pivot-${pivot.index}`,
    name: pivot.name,
    childIds: childIds.get(pivot.index) ?? [],
    meshIds: [
      ...(meshesFor.get(pivot.index) ?? []),
      // meshes nothing claimed hang off the first pivot only when it is the hierarchy root
      ...(pivot.parentIndex < 0 && pivot.index === 0 ? unbound : []),
    ],
    transform: IDENTITY,
  }))
  return { nodes, boundMeshes }
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'westwood-w3d', label: 'Westwood W3D binary model' }),
  async planInput(source, _detection, signal) {
    /*
     * One bounded read of the file's front, walking chunk headers only, to learn which textures
     * this model names. Those names become *exact* optional requirements — the host looks for
     * `d_prismtwr_linear.dds`, not for every `.dds` it can see. A model that names none declares
     * no requirement at all and therefore costs the resolver nothing.
     */
    const size = Number(source.size ?? 0n)
    const window = Math.min(size, PLAN_SCAN_BYTES)
    const bytes = window === 0 ? new Uint8Array(0) : await source.read(0n, window, signal)
    const scan = scanTextureNames(bytes, {})
    if (scan.names.length === 0) {
      return Object.freeze({
        originKind: 'single',
        candidate: Object.freeze({ bindingId: 'content', role: 'content', ownership: 'owned' }),
        requirements: Object.freeze([]),
      })
    }
    return Object.freeze({
      originKind: 'bundle',
      candidate: Object.freeze({ bindingId: 'content', role: 'content', ownership: 'owned' }),
      requirements: Object.freeze([
        Object.freeze({
          id: TEXTURE_REQUIREMENT,
          role: 'texture',
          ownership: 'companion',
          patterns: Object.freeze([...scan.names]),
          scopes: Object.freeze(['sibling-directory', 'current-mount', 'enclosing-container']),
          // a model whose textures ship in another archive is a complete model; C&C 3 files them
          // in Terrain.big while the meshes live in Misc.big, and that must not fail the open
          cardinality: 'many',
          required: false,
        }),
      ]),
    })
  },
  async detect(prefix) {
    return validRoot(prefix)
      ? { confidence: 0.99, kind: 'structure', note: 'bounded W3D root chunk' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    if (!validRoot(bytes)) throw new TypeError('W3D root chunk is invalid')
    const state = { nodes: 0, trailingBytes: 0 }
    const roots = readChunks(bytes, 0, bytes.byteLength, 0, state, context.budget)
    const all = flatten(roots)
    const decoded = decodedMeshes(bytes, roots, context.budget)
    const textures = [...new Set(decoded.meshes.flatMap(mesh => mesh.textures))]
    const issues = []
    const hierarchy = parseHierarchy(bytes, roots, issues)
    const animations = parseAnimations(bytes, roots, issues)
    const hlod = parseHlod(bytes, roots)
    const collisionBoxes = parseCollisionBoxes(bytes, all)
    const preserved = unsupportedAnimationChunks(all)
    const bound = await readTextures(context.input, context.signal)
    const structure = { hierarchy, animations, hlod }
    const scene = sceneNodes(hierarchy, hlod, decoded.meshes, all.length)
    const decodedAnimations = animations.filter(item => item.channels.length > 0)
    // collision is reported from declarations only: mesh attribute bits and BOX chunks
    const collisionMeshes = decoded.meshes.filter(mesh => mesh.roles.collision)
    const types = Object.freeze(
      Object.entries(
        all.reduce((counts, chunk) => {
          counts[chunk.name] = (counts[chunk.name] ?? 0) + 1
          return counts
        }, {}),
      ).map(([name, count]) => ({ name, count })),
    )
    return {
      summary: {
        format: 'westwood-w3d',
        rootChunks: roots.length,
        chunks: all.length,
        opaqueTailBytes: state.trailingBytes,
        chunkTypes: types,
        decodedMeshes: decoded.meshes.length,
        decodedVertices: decoded.meshes.reduce(
          (sum, mesh) => sum + mesh.primitive.positions.length / 3,
          0,
        ),
        decodedTriangles: decoded.meshes.reduce(
          (sum, mesh) => sum + mesh.primitive.indices.length / 3,
          0,
        ),
        textures,
        textureBindings: bound.map(item => ({
          bindingId: item.bindingId,
          bytes: item.bytes,
          provenance: 'companion',
        })),
        hierarchy:
          hierarchy === undefined
            ? null
            : {
                name: hierarchy.name,
                pivots: hierarchy.pivots.map(pivot => ({
                  index: pivot.index,
                  name: pivot.name,
                  parentIndex: pivot.parentIndex,
                })),
              },
        meshBindings: decoded.meshes.map(mesh => ({
          mesh: mesh.id,
          name: mesh.name,
          container: mesh.container,
          // 'hlod' when a sub-object named this mesh, 'none' when nothing did
          binding: scene.boundMeshes > 0 && mesh.container !== '' ? 'hlod' : 'none',
          roles: {
            render: mesh.roles.render,
            collision: mesh.roles.collision,
            collisionTypes: mesh.roles.collisionTypes,
            hidden: mesh.roles.hidden,
          },
        })),
        animations: animations.map(item => ({
          name: item.name,
          hierarchyName: item.hierarchyName,
          frames: item.frames,
          frameRate: item.frameRate,
          channels: item.channels.map(channel => ({
            pivot: channel.pivot,
            kind: channel.kind,
            ...(channel.axis === undefined ? {} : { axis: channel.axis }),
            firstFrame: channel.firstFrame,
            lastFrame: channel.lastFrame,
          })),
          unsupportedChannels: item.unsupportedChannels,
        })),
        collision: {
          meshes: collisionMeshes.map(mesh => mesh.id),
          boxes: collisionBoxes.length,
        },
        preservedUnsupportedChunks: preserved,
        geometryAccess: decoded.meshes.length > 0 ? 'decoded' : 'metadata-only',
      },
      metadata: [
        {
          id: 'westwood-w3d-model',
          label: 'Westwood W3D model',
          entries: [
            { key: 'rootChunks', value: roots.length },
            { key: 'chunks', value: all.length },
            { key: 'opaqueTailBytes', value: state.trailingBytes },
            {
              key: 'chunkTypes',
              value: types.map(type => `${type.name}:${type.count}`).join(', '),
            },
            { key: 'decodedMeshes', value: decoded.meshes.length },
            { key: 'textures', value: textures.length },
            {
              key: 'geometryAccess',
              value: decoded.meshes.length > 0 ? 'decoded' : 'metadata-only',
            },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: { meshes: decoded.meshes.length, decoded: decoded.meshes.length > 0 },
        },
        ...(textures.length > 0
          ? [{ id: 'model.textures', parameters: { count: textures.length } }]
          : []),
        ...(hierarchy === undefined || hierarchy.pivots.length === 0
          ? []
          : [
              {
                id: 'model.skeleton',
                parameters: { pivots: hierarchy.pivots.length, name: hierarchy.name },
              },
            ]),
        ...(decodedAnimations.length > 0
          ? [
              {
                id: 'model.animations',
                parameters: {
                  animations: decodedAnimations.length,
                  channels: decodedAnimations.reduce((sum, item) => sum + item.channels.length, 0),
                  frames: decodedAnimations[0]?.frames ?? 0,
                },
              },
            ]
          : []),
        {
          id: 'structure.hierarchy',
          parameters: {
            chunks: all.length,
            ...(hierarchy === undefined ? {} : { pivots: hierarchy.pivots.length }),
          },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/model-scene-source': modelSource(all.length, decoded, structure),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'Westwood W3D',
          preview: `${all.length} chunks`,
          children: roots.map(treeChunk),
        }),
      },
      diagnostics: [
        ...issues.map(issue =>
          w3dDiagnostic(
            issue.code,
            'warning',
            issue.code.replace('westwood-w3d-', ''),
            issue.message,
          ),
        ),
        ...preserved.map(item =>
          w3dDiagnostic(
            `preserved-${item.chunkId}`,
            'information',
            'compressed-animation-unsupported',
            `a COMPRESSED_ANIMATION chunk of ${item.preservedBytes} bytes is not decoded by this reader; its bytes are preserved and remain readable through the byte-range source`,
            { offset: item.offset, preservedBytes: item.preservedBytes },
          ),
        ),
      ],
      companions: [
        {
          id: TEXTURE_REQUIREMENT,
          role: 'texture',
          cardinality: 'many',
          required: false,
          ...(bound.length > 0
            ? { state: 'resolved', bindingIds: bound.map(item => item.bindingId) }
            : { state: 'missing' }),
        },
      ],
      maxDecodedBytes: Math.max(bytes.byteLength, decoded.decodedBytes),
      unsupportedFeatures: [
        ...(decoded.meshes.length === 0 ? ['remaining-w3d-geometry-variants'] : []),
        ...(preserved.length > 0 ? ['w3d-compressed-animation-decoding'] : []),
        'w3d-bit-channel-decoding',
        'protected-asset-recovery',
        'shader-particle-and-dazzle-execution',
        'model-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
