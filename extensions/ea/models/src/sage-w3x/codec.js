// Portable SAGE W3X reader. It validates the XML envelope, decodes the authored triangle-mesh
// subset, and reads the container's explicit relations: skeleton by id, bone by index, and each
// part's role stated by the document as <Mesh> or <CollisionBox>.
//
// References are ids, never paths. A reference becomes a companion pattern the host resolves inside
// granted scopes; a document that dresses a location up as an id is refused rather than followed.

import {
  createInspectionCodec,
  createModelCollisionSource,
  createModelResourceRefsSource,
  createModelSceneSource,
  createModelSkeletonSource,
  createProjectionReceipt,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'
import {
  parseAnimations,
  parseContainers,
  parseHierarchies,
  parseTextureReferences,
  unknownElements,
} from './structure.js'

/** Bytes `planInput` reads from the front of the document to discover its references. */
const PLAN_SCAN_BYTES = 128 * 1024
const HIERARCHY_REQUIREMENT = 'hierarchy'
const TEXTURE_REQUIREMENT = 'textures'
/** Extensions the engine appends to a texture asset id; the document states neither. */
const TEXTURE_EXTENSIONS = Object.freeze(['dds', 'tga'])

const ID = 'org.modkitx/sage-w3x'
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
/** Element names this reader understands; anything else is reported rather than dropped. */
const KNOWN_ELEMENTS = new Set([
  'AssetDeclaration',
  'W3DContainer',
  'W3DMesh',
  'W3DHierarchy',
  'W3DAnimation',
  'W3DCollisionBox',
  'SubObject',
  'RenderObject',
  'Mesh',
  'CollisionBox',
  'Pivot',
  'Translation',
  'Rotation',
  'FixupMatrix',
  'BoundingBox',
  'BoundingSphere',
  'Min',
  'Max',
  'Center',
  'Vertices',
  'Normals',
  'Triangles',
  'TexCoords',
  'Tangents',
  'Binormals',
  'VertexColors',
  'V',
  'T',
  'N',
  'C',
  'B',
  'Nrm',
  'Dist',
  'FXShader',
  'Constants',
  'Texture',
  'Value',
  'Float',
  'Bool',
  'Int',
  'Include',
  'Channel',
])
const ELEMENTS = Object.freeze([
  'W3DContainer',
  'W3DMesh',
  'W3DHierarchy',
  'W3DAnimation',
  'W3DCollisionBox',
  'Texture',
  'Include',
])

function decode(bytes) {
  return new TextDecoder().decode(bytes)
}

function signature(bytes) {
  const text = decode(bytes.subarray(0, Math.min(bytes.byteLength, 2048))).trimStart()
  return (
    text.includes('<AssetDeclaration') ||
    text.includes('<W3DMesh') ||
    text.includes('<W3DContainer')
  )
}

function elements(source, name) {
  const pattern = new RegExp(`<${name}(?:\\s[^<>]*?)?\\s*/?>`, 'gu')
  return [...source.matchAll(pattern)].map(match => match[0])
}

function blocks(source, name) {
  const pattern = new RegExp(`<${name}\\b([^<>]*?)(?:/\\s*>|>([\\s\\S]*?)</${name}\\s*>)`, 'gu')
  return [...source.matchAll(pattern)].map(match => ({
    element: match[0],
    body: match[2],
  }))
}

function attribute(element, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'u').exec(element)
  return match?.[1] ?? match?.[2]
}

function finiteAttribute(element, name, label) {
  const raw = attribute(element, name)
  const value = raw === undefined ? Number.NaN : Number(raw)
  if (!Number.isFinite(value)) throw new TypeError(`W3X ${label} has no finite ${name}`)
  return value
}

function firstSection(source, name) {
  return blocks(source, name)[0]?.body
}

function vectorElements(source, name, dimensions, label) {
  if (source === undefined) return []
  return blocks(source, name).map((block, index) => {
    const axes = ['X', 'Y', 'Z'].slice(0, dimensions)
    return axes.map(axis => finiteAttribute(block.element, axis, `${label} ${index}`))
  })
}

function toUvmVector([x, y, z]) {
  return [x, z, y === 0 ? 0 : -y]
}

function normalized(vector) {
  const length = Math.hypot(...vector)
  return length === 0 ? [0, 0, 0] : vector.map(value => value / length)
}

function boundsFor(positions) {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis]
      if (value === undefined) throw new TypeError('W3X position tuple is truncated')
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

function triangleIndices(source, vertexCount, meshName) {
  if (source === undefined) return new Uint32Array()
  const result = []
  for (const [triangleIndex, triangle] of blocks(source, 'T').entries()) {
    const values = [...(triangle.body ?? '').matchAll(/<V(?:\s[^<>]*?)?>([^<]+)<\/V\s*>/gu)].map(
      match => Number.parseInt(match[1] ?? '', 10),
    )
    if (
      values.length !== 3 ||
      values.some(value => !Number.isSafeInteger(value) || value < 0 || value >= vertexCount)
    ) {
      throw new TypeError(`W3X mesh ${meshName} triangle ${triangleIndex} has invalid indices`)
    }
    result.push(...values)
  }
  return Uint32Array.from(result)
}

function textureReferences(source) {
  return Object.freeze([
    ...new Set(
      blocks(source, 'Texture')
        .map(block => {
          const direct =
            attribute(block.element, 'File') ??
            attribute(block.element, 'file') ??
            attribute(block.element, 'id')
          if (direct !== undefined) return direct
          return /<Value(?:\s[^<>]*?)?>([^<]+)<\/Value\s*>/u.exec(block.body ?? '')?.[1]?.trim()
        })
        .filter(Boolean),
    ),
  ])
}

function decodedMeshes(source) {
  return blocks(source, 'W3DMesh').flatMap((block, index) => {
    if (block.body === undefined) return []
    const name = attribute(block.element, 'id') ?? `W3DMesh_${index}`
    const rawPositions = vectorElements(
      firstSection(block.body, 'Vertices'),
      'V',
      3,
      `${name} vertex`,
    )
    if (rawPositions.length === 0) return []
    const positions = Float32Array.from(rawPositions.flatMap(toUvmVector))
    const indices = triangleIndices(
      firstSection(block.body, 'Triangles'),
      rawPositions.length,
      name,
    )
    if (indices.length === 0) return []
    const rawNormals = vectorElements(firstSection(block.body, 'Normals'), 'N', 3, `${name} normal`)
    const normals =
      rawNormals.length === rawPositions.length
        ? Float32Array.from(rawNormals.flatMap(value => normalized(toUvmVector(value))))
        : undefined
    const rawUvs = vectorElements(
      firstSection(block.body, 'TexCoords'),
      'T',
      2,
      `${name} texture coordinate`,
    )
    const textureCoordinates =
      rawUvs.length === rawPositions.length
        ? Float32Array.from(rawUvs.flatMap(([u, v]) => [u, 1 - v]))
        : undefined
    const meshId = `w3x-mesh-${index}`
    const primitiveId = `w3x-primitive-${index}`
    const materialId = `w3x-material-${index}`
    const bounds = boundsFor(positions)
    return [
      Object.freeze({
        id: meshId,
        name,
        primitive: Object.freeze({
          id: primitiveId,
          topology: 'triangles',
          positions,
          indices,
          ...(normals === undefined ? {} : { normals }),
          ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
          materialId,
          bounds,
        }),
      }),
    ]
  })
}

function parseW3x(bytes, budget) {
  if (bytes.byteLength > budget.maxScalarBytes)
    throw new RangeError('W3X text exceeds maxScalarBytes')
  const source = decode(bytes)
  if (!signature(bytes)) throw new TypeError('W3X AssetDeclaration root is missing')
  const open = /<AssetDeclaration(?:\s[^<>]*?)?>/u.exec(source)
  const close = /<\/AssetDeclaration\s*>/u.exec(source)
  if (open === null || close === null || close.index <= open.index) {
    throw new TypeError('W3X AssetDeclaration is not closed')
  }
  const records = Object.fromEntries(ELEMENTS.map(name => [name, elements(source, name)]))
  const total = ELEMENTS.reduce((sum, name) => sum + (records[name]?.length ?? 0), 1)
  if (total > budget.maxNodes) throw new RangeError('W3X elements exceed maxNodes')
  const ids = Object.freeze(
    ELEMENTS.flatMap(name =>
      (records[name] ?? []).map(element => attribute(element, 'id')).filter(Boolean),
    ),
  )
  const textures = textureReferences(source)
  const includes = Object.freeze(
    (records.Include ?? [])
      .map(element => attribute(element, 'source') ?? attribute(element, 'Source'))
      .filter(Boolean),
  )
  const counts = Object.freeze(
    Object.fromEntries(ELEMENTS.map(name => [name, records[name]?.length ?? 0])),
  )
  const meshes = decodedMeshes(source)
  const geometryNodes = meshes.reduce(
    (sum, mesh) => sum + mesh.primitive.positions.length / 3 + mesh.primitive.indices.length / 3,
    0,
  )
  if (total + geometryNodes > budget.maxNodes) throw new RangeError('W3X elements exceed maxNodes')
  const decodedBytes = meshes.reduce(
    (sum, mesh) =>
      sum +
      mesh.primitive.positions.byteLength +
      mesh.primitive.indices.byteLength +
      (mesh.primitive.normals?.byteLength ?? 0) +
      (mesh.primitive.textureCoordinates?.byteLength ?? 0),
    0,
  )
  if (decodedBytes > budget.maxScalarBytes)
    throw new RangeError('W3X geometry exceeds maxScalarBytes')
  return Object.freeze({
    ids,
    textures,
    includes,
    counts,
    total,
    meshes,
    bounds: unionBounds(meshes),
    decodedBytes,
  })
}

function modelSource(parsed) {
  const animationCount = parsed.counts.W3DAnimation ?? 0
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: parsed.meshes.length,
      primitives: parsed.meshes.length,
      materials: parsed.meshes.length,
      textures: parsed.textures.length,
      animations: animationCount,
      ...(parsed.bounds === undefined ? {} : { bounds: parsed.bounds }),
      geometryAccess: parsed.meshes.length > 0 ? 'decoded' : 'metadata-only',
    },
    nodes: [
      {
        id: 'w3x-root',
        name: 'SAGE W3X structural root',
        childIds: [],
        meshIds: parsed.meshes.map(mesh => mesh.id),
        transform: IDENTITY,
      },
    ],
    meshes: parsed.meshes.map(mesh => ({
      id: mesh.id,
      name: mesh.name,
      primitiveIds: [mesh.primitive.id],
    })),
    primitives: parsed.meshes.map(mesh => mesh.primitive),
  })
}

/**
 * The axes the projection publishes, after `toUvmVector` turns the document's Z-up space into the
 * UV one. Converted, therefore `normalized`; W3X names no physical unit, so none is asserted.
 */
const W3X_BASIS = Object.freeze({
  handedness: 'right',
  upAxis: 'y',
  forwardAxis: '-z',
  unit: 'source-unit',
})

/**
 * The three facet contracts a W3X document can honestly fill (block 12, slice 12-1).
 *
 * Animation is the interesting absence. `W3DAnimation` blocks are counted and their `Channel`
 * children are counted, but nothing decodes a frame count, a rate or a channel target — and
 * `ModelAnimationClip` requires `frames`. Publishing the facet would mean inventing that number, so
 * the facet stays unpublished and the receipt records the plane as `lost` with the count as
 * evidence. Materials are absent for the same kind of reason: the primitives carry material slots
 * whose definitions live in `FXShader` blocks this reader does not represent.
 */
function modelFacets(containers, hierarchies, companionPivots, textureRefs, boundHierarchy) {
  const facets = {}
  const skeletonCompanion = boundHierarchy[0]
  const hierarchyRefs = [
    ...new Set(
      containers.flatMap(container =>
        container.hierarchyRef === undefined ? [] : [container.hierarchyRef],
      ),
    ),
  ]
  const references = [
    ...textureRefs.map(item => ({
      id: item.value,
      role: 'texture',
      provenance: 'reference-only',
    })),
    /*
     * The skeleton sidecar is the one reference this codec can attribute, and the reason is the
     * requirement's own shape: `zero-or-one` with a single pattern means a bound file can only be
     * that reference. The `many` texture requirement has no such guarantee, so those stay
     * reference-only rather than being matched by sniffing a resolved URI.
     */
    ...hierarchyRefs.map(ref => ({
      id: ref,
      role: 'sidecar',
      provenance: skeletonCompanion === undefined ? 'reference-only' : 'companion',
      ...(skeletonCompanion === undefined
        ? {}
        : { bindingId: skeletonCompanion.bindingId, bytes: skeletonCompanion.bytes }),
    })),
  ]
  if (references.length > 0) {
    facets['common.view/model-resource-refs-source'] = createModelResourceRefsSource({ references })
  }
  const bindings = containers.flatMap(container =>
    container.subObjects.map(sub => ({
      partId: sub.id,
      boneIndex: sub.boneIndex,
      ...boneFact(hierarchies, companionPivots, container.hierarchyRef, sub.boneIndex),
      ...(container.hierarchyRef === undefined ? {} : { hierarchyId: container.hierarchyRef }),
    })),
  )
  // an empty facet is not a facet: a document that declares a hierarchy but binds no part to a bone
  // publishes no skeleton source rather than an empty page
  if (bindings.length > 0) {
    facets['common.view/model-skeleton-source'] = createModelSkeletonSource({
      bindings: bindings.map(({ boneProvenance, ...rest }) => ({
        ...rest,
        provenance: boneProvenance,
      })),
      hierarchies: hierarchies.length + companionPivots.length,
    })
  }
  const collisionParts = containers.flatMap(container =>
    container.subObjects.filter(sub => sub.role === 'collision'),
  )
  if (collisionParts.length > 0) {
    facets['common.view/model-collision-source'] = createModelCollisionSource({
      volumes: collisionParts.map(sub => ({
        id: sub.id,
        kind: 'mesh',
        origin: 'mesh-role',
        ...(sub.renderObject === undefined ? {} : { meshId: sub.renderObject }),
      })),
    })
  }
  return facets
}

function w3xDiagnostic(id, code, message) {
  return Object.freeze({
    id,
    severity: 'warning',
    code: `x3.w3x/${code}`,
    message,
    category: 'dependency',
  })
}

/**
 * Where a bone's name came from, or why it has none.
 *
 * `direct` when this very document declares the hierarchy, `companion` when the bound skeleton
 * does, `absent` when neither — the container names a bone index and the reader will not invent a
 * name for it from the sub-object's own id, however tempting the resemblance.
 */
function boneFact(local, companion, hierarchyRef, boneIndex) {
  if (boneIndex < 0) return { boneName: null, boneProvenance: 'absent' }
  const direct = local.find(item => item.id === hierarchyRef)?.pivots[boneIndex]
  if (direct !== undefined) return { boneName: direct.name, boneProvenance: 'direct' }
  const bound = companion.find(item => item.id === hierarchyRef)?.pivots[boneIndex]
  if (bound !== undefined) return { boneName: bound.name, boneProvenance: 'companion' }
  return { boneName: null, boneProvenance: 'absent' }
}

/** Reads the bindings the host resolved for one requirement, keyed by binding id. */
async function readBindings(input, requirementId, signal, options) {
  const bindings = input.bindingsFor?.(requirementId) ?? []
  const resolved = []
  for (const binding of bindings) {
    const lease = await input.openBinding(binding.bindingId, signal)
    try {
      if (lease.value.kind !== 'bytes') continue
      const size = Number(lease.value.size ?? 0n)
      resolved.push(
        Object.freeze({
          bindingId: binding.bindingId,
          uri: binding.source.uri,
          bytes: size,
          // only the skeleton companion is read; a texture is bound, not decoded, by this codec
          text:
            options?.decode === true && size <= (options.maxBytes ?? 0)
              ? decode(await lease.value.read(0n, size, signal))
              : undefined,
        }),
      )
    } finally {
      await lease.release()
    }
  }
  return Object.freeze(resolved)
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'sage-w3x', label: 'SAGE W3X XML model' }),
  async planInput(source, _detection, signal) {
    /*
     * One bounded read of the document's front, from which two kinds of reference are turned into
     * exact companion patterns: the skeleton a container names by id, and the textures a shader
     * names by id. Both become file names here — `<id>.w3x` and `<id>.dds`/`.tga` — because the
     * extension is the engine's convention and the document states only the asset id. A file that
     * references neither declares no requirement at all.
     */
    const size = Number(source.size ?? 0n)
    const window = Math.min(size, PLAN_SCAN_BYTES)
    const bytes = window === 0 ? new Uint8Array(0) : await source.read(0n, window, signal)
    const text = decode(bytes)
    const issues = []
    const hierarchyRefs = [
      ...new Set(
        parseContainers(text, issues).flatMap(container =>
          container.hierarchyRef === undefined ? [] : [container.hierarchyRef],
        ),
      ),
    ]
    const textureRefs = parseTextureReferences(text, issues).map(item => item.value)
    const requirements = []
    if (hierarchyRefs.length > 0) {
      requirements.push(
        Object.freeze({
          id: HIERARCHY_REQUIREMENT,
          role: 'skeleton',
          ownership: 'companion',
          patterns: Object.freeze(hierarchyRefs.map(ref => `${ref}.w3x`)),
          scopes: Object.freeze(['sibling-directory', 'current-mount', 'enclosing-container']),
          // a mesh opened on its own is a complete, readable mesh; the skeleton adds a plane
          cardinality: 'zero-or-one',
          required: false,
        }),
      )
    }
    if (textureRefs.length > 0) {
      requirements.push(
        Object.freeze({
          id: TEXTURE_REQUIREMENT,
          role: 'texture',
          ownership: 'companion',
          patterns: Object.freeze(
            textureRefs.flatMap(ref => TEXTURE_EXTENSIONS.map(extension => `${ref}.${extension}`)),
          ),
          scopes: Object.freeze(['sibling-directory', 'current-mount', 'enclosing-container']),
          cardinality: 'many',
          required: false,
        }),
      )
    }
    if (requirements.length === 0) {
      return Object.freeze({
        originKind: 'single',
        candidate: Object.freeze({ bindingId: 'content', role: 'content', ownership: 'owned' }),
        requirements: Object.freeze([]),
      })
    }
    return Object.freeze({
      originKind: 'bundle',
      candidate: Object.freeze({ bindingId: 'content', role: 'content', ownership: 'owned' }),
      requirements: Object.freeze(requirements),
    })
  },
  async detect(prefix) {
    return signature(prefix)
      ? { confidence: 0.98, kind: 'structure', note: 'W3X XML elements' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const parsed = parseW3x(bytes, context.budget)
    const text = decode(bytes)
    const issues = []
    const containers = parseContainers(text, issues)
    const hierarchies = parseHierarchies(text)
    const animations = parseAnimations(text)
    const textureRefs = parseTextureReferences(text, issues)
    const unknown = unknownElements(text, KNOWN_ELEMENTS)
    const boundHierarchy = await readBindings(
      context.input,
      HIERARCHY_REQUIREMENT,
      context.signal,
      {
        decode: true,
        maxBytes: Math.min(PLAN_SCAN_BYTES, context.budget.maxScalarBytes),
      },
    )
    /*
     * Pivots from the bound skeleton, when one was bound. This is the payoff of the include
     * companion: a mesh container states `BoneIndex="4"` and nothing else, so the bone's *name*
     * exists only in the other file — and is therefore published with `companion` provenance,
     * never merged into the direct facts of this document.
     */
    const companionPivots = boundHierarchy.flatMap(item =>
      item.text === undefined ? [] : parseHierarchies(item.text),
    )
    const boundTextures = await readBindings(context.input, TEXTURE_REQUIREMENT, context.signal)
    const parts = containers.flatMap(container =>
      container.subObjects.map(sub => ({
        container: container.id,
        id: sub.id,
        boneIndex: sub.boneIndex,
        role: sub.role,
        ...(sub.renderObject === undefined ? {} : { renderObject: sub.renderObject }),
        // the pivot this part rides, named only when the referenced hierarchy is actually bound
        ...boneFact(hierarchies, companionPivots, container.hierarchyRef, sub.boneIndex),
      })),
    )
    const meshCount = parsed.counts.W3DMesh ?? 0
    const hierarchyCount = parsed.counts.W3DHierarchy ?? 0
    const animationCount = parsed.counts.W3DAnimation ?? 0
    return {
      summary: {
        format: 'sage-w3x',
        elements: parsed.total,
        containers: parsed.counts.W3DContainer ?? 0,
        declaredMeshes: meshCount,
        declaredHierarchies: hierarchyCount,
        declaredAnimations: animationCount,
        decodedMeshes: parsed.meshes.length,
        decodedVertices: parsed.meshes.reduce(
          (sum, mesh) => sum + mesh.primitive.positions.length / 3,
          0,
        ),
        decodedTriangles: parsed.meshes.reduce(
          (sum, mesh) => sum + mesh.primitive.indices.length / 3,
          0,
        ),
        /*
         * Superseded by the three facet contracts published beside the base scene source. Kept for
         * one slice so the existing readouts keep working while the authority moves; removal is
         * scheduled with the block-12 slice 12-2 consumers.
         */
        textures: parsed.textures,
        includes: parsed.includes,
        containerRelations: containers.map(container => ({
          id: container.id,
          hierarchyRef: container.hierarchyRef ?? null,
          hierarchyProvenance:
            container.hierarchyRef === undefined
              ? 'absent'
              : boundHierarchy.length > 0
                ? 'companion'
                : 'reference-only',
          ...(boundHierarchy[0] === undefined
            ? {}
            : { hierarchyBindingId: boundHierarchy[0].bindingId }),
          subObjects: container.subObjects.length,
        })),
        modelParts: parts,
        declaredPivots: hierarchies.map(item => ({
          id: item.id,
          pivots: item.pivots.length,
          // provenance: read from this document, or from the bound companion, or neither
          provenance: 'direct',
        })),
        animationBlocks: animations,
        textureReferences: textureRefs.map(item => ({
          slot: item.slot,
          value: item.value,
          shaderName: item.shaderName,
          // 'companion' once the host bound a file for it, 'reference-only' while it is just a name
          provenance: boundTextures.length > 0 ? 'companion' : 'reference-only',
        })),
        textureBindings: boundTextures.map(item => ({
          bindingId: item.bindingId,
          bytes: item.bytes,
          provenance: 'companion',
        })),
        collisionParts: parts.filter(part => part.role === 'collision').map(part => part.id),
        renderParts: parts.filter(part => part.role === 'render').map(part => part.id),
        unknownElements: unknown,
        geometryAccess: parsed.meshes.length > 0 ? 'decoded' : 'metadata-only',
      },
      metadata: [
        {
          id: 'sage-w3x-model',
          label: 'SAGE W3X model',
          entries: [
            { key: 'elements', value: parsed.total },
            { key: 'containers', value: parsed.counts.W3DContainer ?? 0 },
            { key: 'declaredMeshes', value: meshCount },
            { key: 'declaredHierarchies', value: hierarchyCount },
            { key: 'declaredAnimations', value: animationCount },
            { key: 'decodedMeshes', value: parsed.meshes.length },
            { key: 'textures', value: parsed.textures.length },
            { key: 'includes', value: parsed.includes.length },
            {
              key: 'geometryAccess',
              value: parsed.meshes.length > 0 ? 'decoded' : 'metadata-only',
            },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: { meshes: parsed.meshes.length, decoded: parsed.meshes.length > 0 },
        },
        ...(parsed.textures.length > 0
          ? [{ id: 'model.textures', parameters: { count: parsed.textures.length } }]
          : []),
        ...(animationCount > 0
          ? [{ id: 'model.animations', parameters: { count: animationCount, decoded: false } }]
          : []),
        ...(hierarchies.length > 0
          ? [
              {
                id: 'model.skeleton',
                parameters: {
                  hierarchies: hierarchies.length,
                  pivots: hierarchies.reduce((sum, item) => sum + item.pivots.length, 0),
                  provenance: 'direct',
                },
              },
            ]
          : []),
        { id: 'structure.hierarchy', parameters: { nodes: parsed.total, parts: parts.length } },
        { id: 'content.text', parameters: { encoding: 'utf-8' } },
      ],
      projectionReceipt: createProjectionReceipt({
        adapter: { id: ID, version: '1.0.0' },
        subjectRevision: context.input.revisions.revision,
        companions: [
          {
            requirementId: HIERARCHY_REQUIREMENT,
            role: 'skeleton',
            state: boundHierarchy[0] === undefined ? 'absent' : 'bound',
            ...(boundHierarchy[0] === undefined ? {} : { bindingId: boundHierarchy[0].bindingId }),
          },
          {
            requirementId: TEXTURE_REQUIREMENT,
            role: 'texture',
            state: boundTextures.length > 0 ? 'bound' : 'absent',
            ...(boundTextures[0] === undefined ? {} : { bindingId: boundTextures[0].bindingId }),
          },
        ],
        basis: W3X_BASIS,
        planes: [
          {
            planeId: 'geometry',
            state: parsed.meshes.length > 0 ? 'normalized' : 'lost',
            note: `${parsed.meshes.length} of ${meshCount} declared mesh(es) decoded and rotated into the UV space`,
          },
          { planeId: 'structure', state: 'preserved', note: 'the declared element graph' },
          {
            planeId: 'skeleton',
            // a bone name that arrived from the bound sidecar is a companion fact, not this
            // document's; the facet carries the provenance per binding
            state: hierarchies.length + companionPivots.length > 0 ? 'preserved' : 'lost',
            note: `${hierarchies.length} direct hierarchy(ies), ${companionPivots.length} from the bound skeleton`,
          },
          {
            planeId: 'animation',
            state: 'lost',
            note: `${animationCount} W3DAnimation block(s) counted; no frame count, rate or channel target is decoded, so no clip can be published without inventing one`,
          },
          {
            planeId: 'collision',
            state: containers.some(container =>
              container.subObjects.some(sub => sub.role === 'collision'),
            )
              ? 'preserved'
              : 'lost',
            note: 'a part is collision because the document says <CollisionBox>, never because of its name',
          },
          { planeId: 'resources', state: 'preserved', note: 'texture and skeleton ids, verbatim' },
          {
            planeId: 'materials',
            state: 'lost',
            note: 'FXShader definitions are not represented; primitives carry material slots only',
          },
        ],
        evidence: [
          {
            kind: 'observed',
            statement: `${parsed.total} element(s), ${containers.length} container(s), ${unknown.length} undecoded element name(s)`,
            bytesRead: BigInt(bytes.byteLength),
          },
          {
            kind: 'declared',
            statement:
              'W3X authors in a right-handed Z-up space; the projection rotates it into the UV Y-up space',
            source: 'sage-w3x-format-convention',
          },
          ...issues.map(issue => ({
            kind: 'diagnostic',
            code: `x3.w3x/${issue.code.replace('sage-w3x-', '')}`,
            message: issue.message,
          })),
        ],
        confidence: parsed.meshes.length > 0 ? 'high' : 'partial',
      }),
      dataSources: {
        'common.view/model-scene-source': modelSource(parsed),
        ...modelFacets(containers, hierarchies, companionPivots, textureRefs, boundHierarchy),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'SAGE W3X',
          preview: `${parsed.total} structural elements`,
          children: ELEMENTS.filter(name => (parsed.counts[name] ?? 0) > 0).map(name => ({
            kind: 'section',
            label: name,
            preview: `${parsed.counts[name]} element(s)`,
          })),
        }),
      },
      diagnostics: issues.map(issue =>
        w3xDiagnostic(issue.code, issue.code.replace('sage-w3x-', ''), issue.message),
      ),
      companions: [
        {
          id: HIERARCHY_REQUIREMENT,
          role: 'skeleton',
          cardinality: 'zero-or-one',
          required: false,
          ...(boundHierarchy[0] === undefined
            ? { state: 'missing' }
            : { state: 'resolved', bindingIds: [boundHierarchy[0].bindingId] }),
        },
        {
          id: TEXTURE_REQUIREMENT,
          role: 'texture',
          cardinality: 'many',
          required: false,
          ...(boundTextures.length === 0
            ? { state: 'missing' }
            : { state: 'resolved', bindingIds: boundTextures.map(item => item.bindingId) }),
        },
      ],
      maxDecodedBytes: Math.max(bytes.byteLength, parsed.decodedBytes),
      unsupportedFeatures: [
        ...(parsed.meshes.length < meshCount ? ['remaining-w3x-geometry-variants'] : []),
        'w3x-animation-channel-decoding',
        'fx-shader-execution',
        'model-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
