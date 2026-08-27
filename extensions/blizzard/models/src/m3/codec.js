import {
  createInspectionCodec,
  createModelAnimationSource,
  createModelCollisionSource,
  createModelMaterialSource,
  createModelResourceRefsSource,
  createModelSceneSource,
  createModelSkeletonSource,
  createModelSocketSource,
  createProjectionReceipt,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/m3'
const TEXTURE_REQUIREMENT = 'textures'
/** Bytes `planInput` reads from the front of the file to find its string table. */
const PLAN_SCAN_BYTES = 512 * 1024
const MAX_TEXTURE_REFERENCES = 64
/** A reference must be a relative asset path; anything naming a location is refused. */
const LOCATION_LIKE = /^[A-Za-z]:|^[\\/]|(?:^|[\\/])\.\.(?:[\\/]|$)|^[a-z][a-z0-9+.-]*:/u
const TEXTURE_FILE = /\.(?:dds|tga)$/iu

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function reversedTag(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new TypeError('M3 tag is truncated')
  return String.fromCharCode(
    bytes[offset + 3],
    bytes[offset + 2],
    bytes[offset + 1],
    bytes[offset],
  ).replaceAll('\0', '')
}

function parseM3(bytes, maxNodes) {
  const tag = reversedTag(bytes, 0)
  if (tag !== 'MD33' && tag !== 'MD34') throw new TypeError(`unsupported M3 header ${tag}`)
  const headerBytes = tag === 'MD33' ? 20 : 24
  if (bytes.byteLength < headerBytes) throw new TypeError('M3 header is truncated')
  const view = viewOf(bytes)
  const indexOffset = view.getUint32(4, true)
  const indexCount = view.getUint32(8, true)
  if (indexCount > maxNodes) throw new RangeError('M3 section index exceeds maxNodes budget')
  const indexBytes = indexCount * 16
  if (
    !Number.isSafeInteger(indexBytes) ||
    indexOffset < headerBytes ||
    indexOffset + indexBytes > bytes.byteLength
  ) {
    throw new TypeError('M3 section index is outside the file')
  }
  const sections = []
  for (let index = 0; index < indexCount; index += 1) {
    const offset = indexOffset + index * 16
    const sectionOffset = view.getUint32(offset + 4, true)
    if (sectionOffset > bytes.byteLength)
      throw new TypeError(`M3 section ${index} is outside the file`)
    sections.push({
      index,
      tag: reversedTag(bytes, offset),
      offset: sectionOffset,
      repetitions: view.getUint32(offset + 8, true),
      version: view.getUint32(offset + 12, true),
      byteLength: 0,
    })
  }
  const orderedOffsets = [...new Set([...sections.map(section => section.offset), indexOffset])]
    .filter(offset => offset >= 0 && offset <= bytes.byteLength)
    .sort((left, right) => left - right)
  for (const section of sections) {
    const next = orderedOffsets.find(offset => offset > section.offset) ?? bytes.byteLength
    section.byteLength = Math.max(0, next - section.offset)
  }
  return Object.freeze({ tag, indexOffset, sections: Object.freeze(sections) })
}

function metadataSceneOf(model, animations, materials, textures) {
  const sectionNodes = model.sections.map(section => ({
    id: `section/${section.index}`,
    name: `${section.tag} v${section.version}`,
    childIds: [],
    meshIds: [],
    transform: IDENTITY,
  }))
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: sectionNodes.length + 1,
      meshes: 0,
      primitives: 0,
      materials,
      textures,
      animations,
      geometryAccess: 'metadata-only',
    },
    nodes: [
      {
        id: 'model',
        name: `${model.tag} section graph`,
        childIds: sectionNodes.map(node => node.id),
        meshIds: [],
        transform: IDENTITY,
      },
      ...sectionNodes,
    ],
    meshes: [],
  })
}

function decodedSceneOf(geometry, animations, materials, textures) {
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: geometry.nodes.length,
      meshes: geometry.meshes.length,
      primitives: geometry.primitives.length,
      materials,
      textures,
      animations,
      ...(geometry.bounds === undefined ? {} : { bounds: geometry.bounds }),
      geometryAccess: 'decoded',
    },
    nodes: geometry.nodes,
    meshes: geometry.meshes,
    primitives: geometry.primitives,
  })
}

async function geometryOf(bytes, budget) {
  if (globalThis.process?.versions?.node === undefined) return undefined
  const { decodeM3Geometry } = await import('./geometry.node.js')
  return decodeM3Geometry(bytes, budget)
}

async function skeletonOf(bytes, budget, signal) {
  if (globalThis.process?.versions?.node === undefined) return undefined
  const { decodeM3Skeleton } = await import('./skeleton.node.js')
  return decodeM3Skeleton(bytes, budget, signal)
}

async function animationOf(bytes, budget, signal) {
  if (globalThis.process?.versions?.node === undefined) return undefined
  const { decodeM3Animations } = await import('./animation.node.js')
  return decodeM3Animations(bytes, budget, signal)
}

async function materialOf(bytes, budget, signal, resourceIds) {
  if (globalThis.process?.versions?.node === undefined) return undefined
  const { decodeM3Materials } = await import('./material.node.js')
  return decodeM3Materials(bytes, budget, signal, resourceIds)
}

async function attachmentOf(bytes, budget, signal) {
  if (globalThis.process?.versions?.node === undefined) return undefined
  const { decodeM3Attachments } = await import('./attachments.node.js')
  return decodeM3Attachments(bytes, budget, signal)
}

function geometryWithMaterials(geometry, bindings) {
  if (geometry === undefined || bindings.length === 0) return geometry
  const materialByPrimitive = new Map(
    bindings.map(binding => [binding.primitiveId, binding.materialId]),
  )
  return Object.freeze({
    ...geometry,
    primitives: Object.freeze(
      geometry.primitives.map(primitive => {
        const materialId = materialByPrimitive.get(primitive.id)
        return materialId === undefined ? primitive : Object.freeze({ ...primitive, materialId })
      }),
    ),
  })
}

/**
 * Texture paths an M3 names, read from its own `CHAR` string table.
 *
 * M3 keeps every string in `CHAR` sections and points at them from `LAYR` entries. Following that
 * indirection means decoding the layer records; reading the string table does not, and the paths
 * are unambiguous on their own — `Assets/Textures/SM_HML_Artifact_diff512.dds` is a texture
 * reference whichever layer points at it. So this walks the section index (fixed-size headers, no
 * record decoding) and collects the strings that name a texture file.
 *
 * These are *paths*, not bare names, and that matters on the host side too: the resolver matches a
 * pattern containing `/` against the whole logical id and derives a listing prefix from it, so a
 * container with hundreds of thousands of entries is searched by directory instead of scanned.
 */
function scanTextureReferences(bytes) {
  const empty = Object.freeze({ names: Object.freeze([]), truncated: true })
  const tag = bytes.byteLength >= 4 ? reversedTag(bytes, 0) : ''
  if (tag !== 'MD33' && tag !== 'MD34') return empty
  const headerBytes = tag === 'MD33' ? 20 : 24
  if (bytes.byteLength < headerBytes) return empty
  const view = viewOf(bytes)
  const indexOffset = view.getUint32(4, true)
  const indexCount = view.getUint32(8, true)
  const indexBytes = indexCount * 16
  if (
    !Number.isSafeInteger(indexBytes) ||
    indexOffset < headerBytes ||
    indexOffset + indexBytes > bytes.byteLength
  ) {
    // the scan window cut the index, or the file is malformed: declare nothing rather than guess
    return empty
  }
  const sections = []
  for (let index = 0; index < indexCount; index += 1) {
    const offset = indexOffset + index * 16
    sections.push({ tag: reversedTag(bytes, offset), offset: view.getUint32(offset + 4, true) })
  }
  const bounds = [...new Set([...sections.map(section => section.offset), indexOffset])]
    .filter(offset => offset >= 0 && offset <= bytes.byteLength)
    .sort((left, right) => left - right)
  const decoder = new TextDecoder('latin1')
  const names = []
  const seen = new Set()
  let truncated = false
  for (const section of sections) {
    if (section.tag !== 'CHAR' || section.offset > bytes.byteLength) continue
    const end = bounds.find(offset => offset > section.offset) ?? bytes.byteLength
    for (const part of decoder.decode(bytes.subarray(section.offset, end)).split('\u0000')) {
      const value = part.trim()
      if (!TEXTURE_FILE.test(value) || LOCATION_LIKE.test(value)) continue
      const normalized = value.split(String.fromCharCode(92)).join('/')
      const key = normalized.toLowerCase()
      if (seen.has(key)) continue
      if (names.length >= MAX_TEXTURE_REFERENCES) {
        truncated = true
        break
      }
      seen.add(key)
      names.push(normalized)
    }
  }
  return Object.freeze({ names: Object.freeze(names), truncated })
}

/** Reads the texture bindings the host resolved; the codec binds them, it does not decode them. */
async function readTextureBindings(input, signal) {
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
 * The axes M3 vertex positions arrive in — the file's own, because nothing converts them.
 *
 * `preserved`, not `normalized`: the decoder copies each position verbatim, so the projected space
 * is the M3 space. Z-up right-handed with +X forward is the format's documented convention rather
 * than something read out of these bytes, which is why the receipt states it as `declared`.
 */
const M3_BASIS = Object.freeze({
  handedness: 'right',
  upAxis: 'z',
  forwardAxis: '+x',
  unit: 'source-unit',
  sourceUnit: 'm3-model-unit',
})

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'm3', label: 'StarCraft II M3/M3A' }),
  async planInput(source, _detection, signal) {
    const size = Number(source.size ?? 0n)
    const window = Math.min(size, PLAN_SCAN_BYTES)
    const bytes = window === 0 ? new Uint8Array(0) : await source.read(0n, window, signal)
    const scan = scanTextureReferences(bytes)
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
          // an M3 whose textures ship in another mod layer is a complete, readable model
          cardinality: 'many',
          required: false,
        }),
      ]),
    })
  },
  async detect(prefix) {
    const tag = prefix.byteLength >= 4 ? reversedTag(prefix, 0) : ''
    return tag === 'MD33' || tag === 'MD34'
      ? { confidence: 0.99, kind: 'magic', note: tag }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const model = parseM3(bytes, context.budget.maxNodes)
    const references = scanTextureReferences(bytes)
    const skeleton = await skeletonOf(bytes, context.budget, context.signal)
    const animation = await animationOf(bytes, context.budget, context.signal)
    const material = await materialOf(bytes, context.budget, context.signal, references.names)
    const attachments = await attachmentOf(bytes, context.budget, context.signal)
    const skeletonBudgetRefusal = skeleton?.issues.find(
      item => item.code === 'x3.m3/skeleton-budget-exceeded',
    )
    if (skeletonBudgetRefusal !== undefined) {
      // A resource budget is a hard host boundary, not a feature that may silently disappear.
      // Structural BONE damage remains inspectable below, but exhaustion must fail closed just as
      // the geometry decoder does.
      throw new RangeError(`M3 ${skeletonBudgetRefusal.message}`)
    }
    const animationBudgetRefusal = animation?.issues.find(
      item => item.code === 'x3.m3/animation-budget-exceeded',
    )
    if (animationBudgetRefusal !== undefined) {
      throw new RangeError(`M3 ${animationBudgetRefusal.message}`)
    }
    const materialBudgetRefusal = material?.issues.find(
      item => item.code === 'x3.m3/material-budget-exceeded',
    )
    if (materialBudgetRefusal !== undefined) {
      throw new RangeError(`M3 ${materialBudgetRefusal.message}`)
    }
    const attachmentBudgetRefusal = attachments?.issues.find(
      item => item.code === 'x3.m3/attachment-budget-exceeded',
    )
    if (attachmentBudgetRefusal !== undefined) {
      throw new RangeError(`M3 ${attachmentBudgetRefusal.message}`)
    }
    // A truncated BONE table makes the schema parser unsafe for geometry too: both paths load the
    // same section list. Keep the subject inspectable as a section graph and report the refusal.
    const decodedGeometry =
      skeleton?.fatal === true ||
      animation?.fatal === true ||
      material?.fatal === true ||
      attachments?.fatal === true
        ? undefined
        : await geometryOf(bytes, context.budget)
    const geometry = geometryWithMaterials(decodedGeometry, material?.primitiveBindings ?? [])
    const boundTextures = await readTextureBindings(context.input, context.signal)
    const tree = createTreeDataSource({
      kind: 'model',
      label: model.tag,
      preview: `${model.sections.length} indexed sections`,
      children: model.sections.map(section => ({
        kind: 'section',
        label: `${section.index}: ${section.tag}`,
        preview: `v${section.version}, ${section.repetitions} record(s), ${section.byteLength} bytes`,
      })),
    })
    /*
     * The base scene counts executable motion. SEQS-only metadata remains visible in the optional
     * animation facet, whose `channelled` count names the distinction. Counting an unsupported
     * timestamp list here made a UVM artifact claim motion it could not truthfully write.
     */
    const animationCount = animation?.clips.filter(clip => clip.channels.length > 0).length ?? 0
    const declaredMaterialCount = model.sections
      .filter(section => section.tag === 'MATM')
      .reduce((total, section) => total + section.repetitions, 0)
    const materialCount =
      material?.fatal === false ? material.materials.length : declaredMaterialCount
    const scene =
      geometry === undefined || geometry.primitives.length === 0
        ? metadataSceneOf(model, animationCount, materialCount, references.names.length)
        : decodedSceneOf(geometry, animationCount, materialCount, references.names.length)
    const info = await scene.info()
    const geometryAccess = info.geometryAccess
    /*
     * The six facet contracts, published as contracts rather than as a shape inside `summary`.
     *
     * M3 fills four of them. Texture *paths* come out of `CHAR`, skeleton bindings follow
     * `MODL.bones → BONE.name → CHAR`. Parent links and flags are validated but stay out of the
     * skeleton facet because its v1 ABI carries neither. SEQS supplies clip names and bounds used
     * to validate distinct SD timestamp samples; their count is the clip's `frames`, while no frame
     * rate is inferred. STG/STC/STS can attribute only those channels whose animation ids match
     * explicit BONE reference headers. MATM supplies stable identity, MAT_ supplies standard names
     * and semantics, LAYR texture strings join to resource ids, and BAT_ binds regions to material
     * ids. Layer records remain evidence because model-material-source@1 has no layer field.
     *
     * Every reference stays `reference-only`. The texture requirement is `many`, so a bound
     * companion cannot be attributed to one name without inspecting the resolved URI, which is the
     * line block 9 drew: the bound companions are recorded in the receipt instead, by binding id.
     */
    const resourceFacet =
      references.names.length === 0
        ? {}
        : {
            // an empty facet is not a facet: a model that names no texture publishes no resource
            // source rather than an empty page a consumer would read as "the references are gone"
            'common.view/model-resource-refs-source': createModelResourceRefsSource({
              references: references.names.map(value => ({
                id: value,
                role: 'texture',
                provenance: 'reference-only',
              })),
              truncated: references.truncated,
            }),
          }
    const skeletonFacet =
      skeleton === undefined || skeleton.bindings.length === 0
        ? {}
        : {
            'common.view/model-skeleton-source': createModelSkeletonSource({
              bindings: skeleton.bindings,
              ...(skeleton.hierarchyComplete ? { hierarchies: 1 } : {}),
            }),
          }
    const animationFacet =
      animation === undefined || animation.clips.length === 0
        ? {}
        : {
            'common.view/model-animation-source': createModelAnimationSource({
              clips: animation.clips,
            }),
          }
    const materialFacet =
      material === undefined || material.fatal || material.materials.length === 0
        ? {}
        : {
            'common.view/model-material-source': createModelMaterialSource({
              materials: material.materials.map(item => ({
                id: item.id,
                ...(item.name === undefined ? {} : { name: item.name }),
              })),
            }),
          }
    const socketFacet =
      attachments === undefined || attachments.fatal || attachments.sockets.length === 0
        ? {}
        : {
            'common.view/model-socket-source': createModelSocketSource({
              sockets: attachments.sockets,
            }),
          }
    const collisionFacet =
      attachments === undefined || attachments.fatal || attachments.volumes.length === 0
        ? {}
        : {
            'common.view/model-collision-source': createModelCollisionSource({
              volumes: attachments.volumes,
            }),
          }
    const materialComplete =
      material !== undefined &&
      !material.fatal &&
      material.materials.length > 0 &&
      material.exoticMaterials === 0 &&
      material.rejectedNames === 0 &&
      material.rejectedLayerReferences === 0 &&
      material.unresolvedLayerResources === 0 &&
      material.rejectedMaterialReferences === 0 &&
      material.ambiguousPrimitiveBindings === 0 &&
      material.unsupportedBlendModes === 0 &&
      material.unknownFlagRecords === 0
    const projectionReceipt = createProjectionReceipt({
      adapter: { id: ID, version: '1.0.0' },
      subjectRevision: context.input.revisions.revision,
      companions: [
        {
          requirementId: TEXTURE_REQUIREMENT,
          role: 'texture',
          state: boundTextures.length > 0 ? 'bound' : 'absent',
          ...(boundTextures[0] === undefined ? {} : { bindingId: boundTextures[0].bindingId }),
        },
      ],
      basis: M3_BASIS,
      planes: [
        {
          planeId: 'geometry',
          state: geometryAccess === 'decoded' ? 'preserved' : 'lost',
          note:
            geometryAccess === 'decoded'
              ? 'vertex positions are copied in the file’s own axes'
              : 'the geometry decoder is Node-only; this open produced the section graph alone',
        },
        { planeId: 'structure', state: 'preserved', note: 'the M3 section index, verbatim' },
        { planeId: 'resources', state: 'preserved', note: 'texture paths from the CHAR table' },
        {
          planeId: 'materials',
          state: materialComplete ? 'normalized' : 'lost',
          note:
            material === undefined || material.materials.length === 0
              ? 'this open published no decoded MATM material identity'
              : `${material.materials.length} MATM material(s), ${material.decodedLayers} LAYR slot(s), ` +
                `${material.linkedLayers} resource foreign key(s), and ${material.primitiveBindings.length} BAT_ primitive binding(s) decoded`,
        },
        {
          planeId: 'material-layer-facet-fields',
          state: 'lost',
          note: 'model-material-source@1 carries material identity but no layer slots; decoded layers retain resource ids only as validation evidence',
        },
        {
          planeId: 'material-shader-parameters',
          state: 'lost',
          note: `${material?.exoticMaterials ?? 0} exotic material(s) and renderer-specific shader parameters are not projected`,
        },
        ...(skeleton === undefined || skeleton.bindings.length === 0
          ? [
              {
                planeId: 'skeleton-bindings',
                state: 'lost',
                note: 'this open published no BONE bindings',
              },
            ]
          : [
              {
                planeId: 'skeleton-bindings',
                state: skeleton.rejectedNames === 0 ? 'preserved' : 'lost',
                note: `${skeleton.bindings.length} BONE index/name binding(s) decoded through their CHAR references`,
              },
            ]),
        {
          planeId: 'skeleton-hierarchy',
          state: 'lost',
          note:
            skeleton === undefined
              ? 'the Node-only BONE decoder did not run, and model-skeleton-source@1 carries no parent links'
              : `${skeleton.roots} root(s) validated, but model-skeleton-source@1 carries no parent links`,
        },
        {
          planeId: 'skeleton-flags',
          state: 'lost',
          note: 'named BONE flag bits are not carried by the live facet contract',
        },
        {
          planeId: 'skeleton-rest-pose',
          state: 'lost',
          note: 'IREF matrices and animation-reference defaults are not projected',
        },
        {
          planeId: 'animation',
          state: animation !== undefined && animation.clips.length > 0 ? 'normalized' : 'lost',
          note:
            animation !== undefined && animation.clips.length > 0
              ? `${animation.clips.length} SEQS name(s) and distinct SD timestamp count(s) normalized as clips`
              : 'this open published no SEQS clip with a measured SD timestamp count',
        },
        {
          planeId: 'animation-native-time-bounds',
          state: 'lost',
          note: 'SEQS millisecond start/end bounds validate SD timestamps but are not frame counts',
        },
        {
          planeId: 'animation-bone-targets',
          state: (animation?.supportedChannels ?? 0) > 0 ? 'normalized' : 'lost',
          note:
            (animation?.supportedChannels ?? 0) > 0
              ? `${animation.supportedChannels} STC channel(s) matched explicit BONE animation-reference ids`
              : 'no STC channel matched an explicit BONE animation-reference id',
        },
        {
          planeId: 'animation-sd-keyframes',
          state: 'lost',
          note: `${animation?.unsupportedChannels ?? 0} STC channel(s) remain unsupported; SD keyframes are not decoded`,
        },
        {
          planeId: 'attachments',
          state:
            attachments !== undefined &&
            !attachments.fatal &&
            attachments.rejectedNames === 0 &&
            attachments.rejectedBones === 0
              ? 'normalized'
              : 'lost',
          note: `${attachments?.sockets.length ?? 0} ATT_ attachment point(s) projected with stable ids and exact bone targets`,
        },
        {
          planeId: 'attachment-orientation',
          state: 'lost',
          note: 'ATT_ declares a bone and source name but no portable forward/up axes',
        },
        {
          planeId: 'attachment-volume-fields',
          state: 'lost',
          note: `${attachments?.volumes.length ?? 0} ATVL volume(s) retain kind/identity; native matrices, sizes, and vertices are outside model-collision-source@1`,
        },
        {
          planeId: 'external-m3a-sidecars',
          state: 'lost',
          note:
            (attachments?.animationHashes.length ?? 0) === 0
              ? 'MODL declares no non-zero M3A binding hash'
              : `${attachments.animationHashes.length} M3A binding hash(es) retained for ResourceSessionPort sidecar projection`,
        },
      ],
      evidence: [
        {
          kind: 'declared',
          statement: 'M3 authors in a right-handed Z-up space with +X forward',
          source: 'm3-format-convention',
        },
        {
          kind: 'observed',
          statement:
            `${model.sections.length} sections indexed, ${references.names.length} texture path(s) read from CHAR, ` +
            `${skeleton?.bindings.length ?? 0} BONE binding(s), ${animation?.clips.length ?? 0} SEQS clip(s), ` +
            `${animation?.supportedChannels ?? 0} BONE channel target(s), ${material?.materials.length ?? 0} MATM material(s), ` +
            `${material?.decodedLayers ?? 0} LAYR slot(s), ${material?.linkedLayers ?? 0} resource link(s), ` +
            `${material?.primitiveBindings.length ?? 0} BAT_ primitive binding(s), ${attachments?.sockets.length ?? 0} ATT_ socket(s), and ` +
            `${attachments?.volumes.length ?? 0} ATVL volume(s) decoded`,
          bytesRead: BigInt(bytes.byteLength),
        },
        ...(references.truncated
          ? [
              {
                kind: 'diagnostic',
                code: 'x3.m3/texture-scan-truncated',
                message: `the texture scan stopped at its budget of ${MAX_TEXTURE_REFERENCES} references`,
              },
            ]
          : []),
      ],
      confidence:
        geometryAccess === 'decoded' &&
        (skeleton?.issues.length ?? 0) === 0 &&
        (material?.issues.length ?? 0) === 0 &&
        (attachments?.issues.length ?? 0) === 0
          ? 'high'
          : 'partial',
    })
    return {
      summary: {
        format: 'm3',
        container: model.tag,
        sections: model.sections.length,
        sectionTags: [...new Set(model.sections.map(section => section.tag))],
        /*
         * The texture references and their bindings are gone from here on purpose (slice 12-2).
         * `common.view/model-resource-refs-source@1` publishes the names the document spells, and
         * the projection receipt records which companions the host actually bound. Keeping a third
         * copy in the summary meant three places to update and two of them silently wrong.
         */
        geometryAccess,
        nodes: info.nodes,
        meshes: info.meshes,
        primitives: info.primitives,
        scenes: info.scenes,
        materials: info.materials,
        textures: info.textures,
        animations: info.animations,
      },
      metadata: [
        {
          id: 'm3-container',
          label: 'M3 container',
          entries: [
            { key: 'container', value: model.tag },
            { key: 'indexOffset', value: model.indexOffset },
            { key: 'sections', value: model.sections.length },
            { key: 'geometryAccess', value: geometryAccess },
            { key: 'nodes', value: info.nodes },
            { key: 'meshes', value: info.meshes },
            { key: 'primitives', value: info.primitives },
            { key: 'scenes', value: info.scenes },
            { key: 'materials', value: info.materials },
            { key: 'textures', value: info.textures },
            { key: 'animations', value: info.animations },
          ],
        },
        ...(animation === undefined || animation.clips.length === 0
          ? []
          : [
              {
                id: 'm3-animation',
                label: 'M3 animation',
                entries: [
                  { key: 'sequences', value: animation.clips.length },
                  { key: 'timelineContainers', value: animation.timelineContainers.length },
                  { key: 'supportedBoneChannels', value: animation.supportedChannels },
                  { key: 'unsupportedChannels', value: animation.unsupportedChannels },
                  {
                    key: 'sampleFrames',
                    value: animation.clips.reduce((total, clip) => total + clip.frames, 0),
                  },
                  {
                    key: 'timelineNames',
                    value: animation.timelineContainers.map(item => item.name).join(', '),
                  },
                ],
              },
            ]),
        ...(material === undefined || material.materials.length === 0
          ? []
          : [
              {
                id: 'm3-materials',
                label: 'M3 materials',
                entries: [
                  { key: 'materialReferences', value: material.materials.length },
                  { key: 'standardMaterials', value: material.standardMaterials },
                  { key: 'exoticMaterials', value: material.exoticMaterials },
                  { key: 'layerSlots', value: material.decodedLayers },
                  { key: 'resourceLinkedLayers', value: material.linkedLayers },
                  { key: 'primitiveBindings', value: material.primitiveBindings.length },
                  { key: 'rejectedReferences', value: material.rejectedMaterialReferences },
                  { key: 'unresolvedLayerResources', value: material.unresolvedLayerResources },
                  { key: 'layerFacetState', value: 'lost/model-material-source@1-has-no-layers' },
                ],
              },
            ]),
      ],
      traits: [
        ...(geometryAccess === 'decoded'
          ? [
              {
                id: 'model.geometry',
                parameters: { meshes: info.meshes, primitives: info.primitives },
              },
            ]
          : []),
        ...(skeleton === undefined || skeleton.bindings.length === 0
          ? []
          : [
              {
                id: 'model.skeleton',
                parameters: {
                  bindings: skeleton.bindings.length,
                  named: skeleton.bindings.filter(item => item.boneName !== null).length,
                  roots: skeleton.roots,
                  rejectedParentLinks: skeleton.rejectedParentLinks,
                },
              },
            ]),
        ...(animation === undefined || animation.clips.length === 0
          ? []
          : [
              {
                id: 'model.animations',
                parameters: {
                  clips: animation.clips.length,
                  channels: animation.supportedChannels,
                  unsupportedChannels: animation.unsupportedChannels,
                },
              },
            ]),
        ...(material === undefined || material.materials.length === 0
          ? []
          : [
              {
                id: 'model.materials',
                parameters: {
                  materials: material.materials.length,
                  standard: material.standardMaterials,
                  exotic: material.exoticMaterials,
                  layers: material.decodedLayers,
                  resourceLinks: material.linkedLayers,
                  primitiveBindings: material.primitiveBindings.length,
                },
              },
            ]),
        { id: 'structure.hierarchy', parameters: { sections: model.sections.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/model-scene-source': scene,
        ...resourceFacet,
        ...skeletonFacet,
        ...animationFacet,
        ...materialFacet,
        ...socketFacet,
        ...collisionFacet,
      },
      projectionReceipt,
      diagnostics: [
        ...(skeleton?.issues ?? []),
        ...(animation?.issues ?? []),
        ...(material?.issues ?? []),
        ...(attachments?.issues ?? []),
      ],
      maxDecodedBytes: BigInt(
        Math.max(
          bytes.byteLength,
          geometry?.decodedBytes ?? 0,
          skeleton?.decodedBytes ?? 0,
          animation?.decodedBytes ?? 0,
          material?.decodedBytes ?? 0,
          attachments?.decodedBytes ?? 0,
        ),
      ),
      companions: [
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
      unsupportedFeatures: [
        ...(geometryAccess === 'decoded' ? [] : ['decoded-geometry-buffers']),
        ...(material === undefined || material.materials.length === 0 ? ['materials'] : []),
        'material-layer-facet-fields',
        'material-shader-parameters',
        ...((material?.exoticMaterials ?? 0) === 0 ? [] : ['exotic-material-parameters']),
        'texture-decoding',
        'skeleton-parent-links',
        'skeleton-flags',
        'skeleton-rest-pose',
        ...(animation === undefined || animation.clips.length === 0 ? ['animations'] : []),
        'animation-sd-keyframes',
        ...((attachments?.animationHashes.length ?? 0) === 0
          ? []
          : ['external-m3a-sidecars-require-resource-session']),
        'm3-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = () => createInspectionCodec(definition)
