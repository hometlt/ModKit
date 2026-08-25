import {
  createInspectionCodec,
  createModelCollisionSource,
  createModelMaterialSource,
  createModelSceneSource,
  createProjectionReceipt,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

/**
 * UVM/core is a glTF 2.0 profile, so its space is glTF's: right-handed, Y up, −Z forward, metres.
 * Nothing is converted on the way in, which is why the geometry plane is `preserved`.
 */
const UVM_BASIS = Object.freeze({
  handedness: 'right',
  upAxis: 'y',
  forwardAxis: '-z',
  unit: 'meter',
  metersPerUnit: 1,
})

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const decoder = new TextDecoder('utf-8', { fatal: true })
const prefixDecoder = new TextDecoder('utf-8', { fatal: false })
const componentBytes = Object.freeze({ 5121: 1, 5123: 2, 5125: 4, 5126: 4 })
const componentCounts = Object.freeze({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 })

function array(value, key) {
  const candidate = value?.[key]
  return Array.isArray(candidate) ? candidate : []
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function finiteArray(value, length) {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(item => typeof item === 'number' && Number.isFinite(item))
  )
}

function boundedJson(value, budget) {
  const pending = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()
    nodes += 1
    if (nodes > budget.maxNodes) throw new RangeError('UVM JSON exceeds maxNodes budget')
    if (current.depth > budget.maxDepth) throw new RangeError('UVM JSON exceeds maxDepth budget')
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 })
    } else if (current.value !== null && typeof current.value === 'object') {
      for (const child of Object.values(current.value)) {
        pending.push({ value: child, depth: current.depth + 1 })
      }
    }
  }
  return nodes
}

function decodeUvmGlb(bytes, budget) {
  if (bytes.byteLength < 20)
    throw new TypeError('UVM GLB is shorter than its header and JSON chunk')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new TypeError('UVM requires the GLB magic')
  if (view.getUint32(4, true) !== 2) throw new TypeError('UVM requires GLB version 2')
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new TypeError('UVM GLB declared length does not match the source')
  }
  let cursor = 12
  let jsonBytes
  let binary = new Uint8Array()
  while (cursor < bytes.byteLength) {
    if (cursor + 8 > bytes.byteLength) throw new TypeError('UVM GLB chunk header is truncated')
    const length = view.getUint32(cursor, true)
    const type = view.getUint32(cursor + 4, true)
    const start = cursor + 8
    const end = start + length
    if (end > bytes.byteLength) throw new TypeError('UVM GLB chunk exceeds the source length')
    if (type === JSON_CHUNK) {
      if (jsonBytes !== undefined) throw new TypeError('UVM GLB contains more than one JSON chunk')
      jsonBytes = bytes.subarray(start, end)
    } else if (type === BIN_CHUNK) {
      if (binary.byteLength > 0) throw new TypeError('UVM GLB contains more than one BIN chunk')
      binary = bytes.slice(start, end)
    }
    cursor = end
  }
  if (jsonBytes === undefined) throw new TypeError('UVM GLB has no JSON chunk')
  let document
  try {
    document = JSON.parse(decoder.decode(jsonBytes).replace(/[\u0000\u0020]+$/u, ''))
  } catch (error) {
    throw new TypeError(
      `invalid UVM JSON chunk: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  object(document, 'UVM document')
  const jsonNodes = boundedJson(document, budget)
  validateUvmDocument(document, binary.byteLength)
  return Object.freeze({ document, binary, jsonNodes })
}

function looksLikeUvmPrefix(bytes) {
  if (bytes.byteLength < 20) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) return false
  const declaredLength = view.getUint32(8, true)
  const jsonLength = view.getUint32(12, true)
  if (declaredLength < 20 || view.getUint32(16, true) !== JSON_CHUNK) return false
  const availableEnd = Math.min(bytes.byteLength, 20 + jsonLength)
  if (availableEnd <= 20) return false
  const jsonBytes = bytes.subarray(20, availableEnd)
  if (jsonBytes.byteLength === jsonLength) {
    try {
      const document = JSON.parse(decoder.decode(jsonBytes).replace(/[\u0000\u0020]+$/u, ''))
      object(document, 'UVM document')
      validateUvmDocument(document)
      return true
    } catch {
      return false
    }
  }
  const prefix = prefixDecoder.decode(jsonBytes)
  return (
    /"format"\s*:\s*"UVM"/u.test(prefix) &&
    /"version"\s*:\s*"1\.0"/u.test(prefix) &&
    /"profile"\s*:\s*"core"/u.test(prefix) &&
    /"UV_asset"\s*:/u.test(prefix) &&
    /"UV_provenance"\s*:/u.test(prefix)
  )
}

function validateUvmDocument(document, binaryByteLength) {
  const asset = object(document.asset, 'UVM asset')
  if (asset.version !== '2.0') throw new TypeError('UVM asset.version must be 2.0')
  const uv = object(object(asset.extras, 'UVM asset.extras').uv, 'UVM profile marker')
  if (uv.format !== 'UVM' || uv.version !== '1.0' || uv.profile !== 'core') {
    throw new TypeError('asset.extras.uv must identify the UVM/core 1.0 profile')
  }
  const used = array(document, 'extensionsUsed')
  for (const required of ['UV_asset', 'UV_provenance']) {
    if (!used.includes(required))
      throw new TypeError(`${required} is not declared in extensionsUsed`)
  }
  if (array(document, 'extensionsRequired').some(id => String(id).startsWith('UV_'))) {
    throw new TypeError('UVM/core must not require a UV extension for base rendering')
  }
  const extensions = object(document.extensions, 'UVM extensions')
  const identity = object(extensions.UV_asset, 'UV_asset')
  if (!nonBlank(identity.id) || !nonBlank(identity.class)) {
    throw new TypeError('UV_asset requires non-empty id and class')
  }
  const provenance = object(extensions.UV_provenance, 'UV_provenance')
  const source = object(provenance.source, 'UV_provenance.source')
  const importer = object(provenance.importer, 'UV_provenance.importer')
  if (!nonBlank(source.format) || !nonBlank(importer.id) || !nonBlank(importer.version)) {
    throw new TypeError('UV_provenance requires source format and importer coordinate')
  }
  const sourceBlob = extensions.UV_source_blob
  if (sourceBlob !== undefined) {
    if (!used.includes('UV_source_blob')) {
      throw new TypeError('UV_source_blob is not declared in extensionsUsed')
    }
    const blobs = array(object(sourceBlob, 'UV_source_blob'), 'blobs')
    if (blobs.length === 0) throw new TypeError('UV_source_blob.blobs must not be empty')
    const bufferViews = array(document, 'bufferViews')
    for (const [index, candidate] of blobs.entries()) {
      const blob = object(candidate, `UV_source_blob blob ${index}`)
      if (
        !nonBlank(blob.format) ||
        !nonBlank(blob.chunk) ||
        !/^[0-9a-f]{64}$/u.test(blob.sha256) ||
        !['raw', 'zstd', 'deflate'].includes(blob.encoding ?? 'raw')
      ) {
        throw new TypeError(`UV_source_blob blob ${index} metadata is invalid`)
      }
      const bufferView = object(
        bufferViews[safeIndex(blob.bufferView, bufferViews.length, 'source blob bufferView')],
        `UV_source_blob blob ${index} bufferView`,
      )
      const offset = bufferView.byteOffset ?? 0
      const length = bufferView.byteLength
      if (
        bufferView.buffer !== 0 ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        offset + length > binaryByteLength
      ) {
        throw new RangeError(`UV_source_blob blob ${index} exceeds the BIN chunk`)
      }
    }
  } else if (used.includes('UV_source_blob')) {
    throw new TypeError('UV_source_blob is declared but absent')
  }
  validateCollisionMetadata(document, used)
  validateTeamColorMetadata(document, used)
  validateGameMaterialMetadata(document, used)
  validateEffectsMetadata(document, used)
  validateAnimationPointers(document, used)
}

function validateEffectsMetadata(document, used) {
  const extension = document.extensions?.UV_game_effects
  if (extension === undefined) {
    if (used.includes('UV_game_effects'))
      throw new TypeError('UV_game_effects is declared but absent')
    return
  }
  if (!used.includes('UV_game_effects')) {
    throw new TypeError('UV_game_effects is not declared in extensionsUsed')
  }
  const effects = object(extension, 'UV_game_effects')
  if (effects.profile !== undefined && !['common', 'm3', 'mdx', 'w3d'].includes(effects.profile)) {
    throw new TypeError('UV_game_effects has an invalid profile')
  }
  if (
    effects.trackTimeUnit !== undefined &&
    !['seconds', 'milliseconds'].includes(effects.trackTimeUnit)
  ) {
    throw new TypeError('UV_game_effects has an invalid trackTimeUnit')
  }
  const nodes = array(document, 'nodes')
  const materials = array(document, 'materials')
  for (const kind of ['particles', 'ribbons', 'forces', 'warps', 'projectors']) {
    const entries = effects[kind]
    if (entries === undefined) continue
    if (!Array.isArray(entries)) throw new TypeError(`UV_game_effects.${kind} must be an array`)
    for (const [index, candidate] of entries.entries()) {
      const entry = object(candidate, `UV_game_effects ${kind} ${index}`)
      if (!nonBlank(entry.name))
        throw new TypeError(`UV_game_effects ${kind} ${index} needs a name`)
      safeIndex(entry.node, nodes.length, `UV_game_effects ${kind} ${index} node`)
      if (['particles', 'ribbons', 'projectors'].includes(kind)) {
        safeIndex(entry.material, materials.length, `UV_game_effects ${kind} ${index} material`)
      }
      if (
        entry.maxParticles !== undefined &&
        (!Number.isSafeInteger(entry.maxParticles) || entry.maxParticles < 0)
      ) {
        throw new RangeError(`UV_game_effects ${kind} ${index} maxParticles is invalid`)
      }
      if (entry.lifecycleSize !== undefined) {
        const lifecycle = object(
          entry.lifecycleSize,
          `UV_game_effects ${kind} ${index} lifecycleSize`,
        )
        if (
          !finiteArray(lifecycle.start, 3) ||
          !finiteArray(lifecycle.middle, 3) ||
          !finiteArray(lifecycle.end, 3) ||
          !Number.isFinite(lifecycle.timeMiddle)
        ) {
          throw new TypeError(`UV_game_effects ${kind} ${index} lifecycleSize is invalid`)
        }
      }
    }
  }
}

function validateAnimationPointers(document, used) {
  let count = 0
  const accessors = array(document, 'accessors')
  for (const [animationIndex, candidate] of array(document, 'animations').entries()) {
    const animation = object(candidate, `animation ${animationIndex}`)
    const samplers = array(animation, 'samplers')
    const animationUv =
      animation.extras?.uv === undefined
        ? undefined
        : object(animation.extras.uv, `animation ${animationIndex} extras.uv`)
    const scope = animationUv?.effectTrackScope
    const hasGlobalSeqId = Object.prototype.hasOwnProperty.call(animationUv ?? {}, 'globalSeqId')
    if (scope !== undefined && scope !== 'global' && scope !== 'absolute') {
      throw new TypeError(`animation ${animationIndex} effect track scope is invalid`)
    }
    if (
      scope === 'global' &&
      (!Number.isSafeInteger(animationUv.globalSeqId) || animationUv.globalSeqId < 0)
    ) {
      throw new TypeError(`animation ${animationIndex} globalSeqId is invalid or missing`)
    }
    if (scope !== 'global' && hasGlobalSeqId) {
      throw new TypeError(`animation ${animationIndex} globalSeqId needs global scope`)
    }
    if (
      animationUv?.sourceSequenceIndex !== undefined &&
      (!Number.isSafeInteger(animationUv.sourceSequenceIndex) ||
        animationUv.sourceSequenceIndex < 0)
    ) {
      throw new TypeError(`animation ${animationIndex} sourceSequenceIndex is invalid`)
    }
    const targets = new Set()
    for (const [channelIndex, channelCandidate] of array(animation, 'channels').entries()) {
      const channel = object(
        channelCandidate,
        `animation ${animationIndex} channel ${channelIndex}`,
      )
      const target = object(channel.target, `animation ${animationIndex} channel target`)
      const extension = target.extensions?.KHR_animation_pointer
      if (target.path !== 'pointer' && extension === undefined) continue
      count += 1
      const samplerIndex = safeIndex(
        channel.sampler,
        samplers.length,
        `animation ${animationIndex} pointer sampler`,
      )
      const sampler = object(samplers[samplerIndex], `animation ${animationIndex} pointer sampler`)
      const pointer = object(extension, `animation ${animationIndex} KHR_animation_pointer`)
      const targetValue = safeAnimationPointer(pointer.pointer)
        ? resolvePointer(document, pointer.pointer)
        : undefined
      if (target.path !== 'pointer' || targetValue === undefined) {
        throw new TypeError(`animation ${animationIndex} pointer target is unsafe or unresolved`)
      }
      if (targets.has(pointer.pointer)) {
        throw new TypeError(`animation ${animationIndex} pointer target is duplicated`)
      }
      targets.add(pointer.pointer)
      const interpolation = sampler.interpolation ?? 'LINEAR'
      if (!['STEP', 'LINEAR', 'CUBICSPLINE'].includes(interpolation)) {
        throw new TypeError(`animation ${animationIndex} pointer interpolation is invalid`)
      }
      const channelUv =
        channel.extras?.uv === undefined
          ? undefined
          : object(channel.extras.uv, `animation ${animationIndex} channel extras.uv`)
      const sourceLineType = channelUv?.sourceLineType
      if (
        sourceLineType !== undefined &&
        (!Number.isSafeInteger(sourceLineType) || sourceLineType < 0 || sourceLineType > 3)
      ) {
        throw new TypeError(`animation ${animationIndex} pointer sourceLineType is invalid`)
      }
      if (
        (interpolation === 'STEP' && sourceLineType !== undefined && sourceLineType !== 0) ||
        (interpolation === 'LINEAR' && sourceLineType !== undefined && sourceLineType !== 1) ||
        (interpolation === 'CUBICSPLINE' &&
          sourceLineType !== undefined &&
          sourceLineType !== 2 &&
          sourceLineType !== 3)
      ) {
        throw new TypeError(
          `animation ${animationIndex} pointer sourceLineType does not match interpolation`,
        )
      }
      const inputIndex = safeIndex(
        sampler.input,
        accessors.length,
        `animation ${animationIndex} pointer input`,
      )
      const outputIndex = safeIndex(
        sampler.output,
        accessors.length,
        `animation ${animationIndex} pointer output`,
      )
      const input = object(accessors[inputIndex], `animation ${animationIndex} pointer input`)
      const output = object(accessors[outputIndex], `animation ${animationIndex} pointer output`)
      const targetWidth =
        typeof targetValue === 'number'
          ? 1
          : Array.isArray(targetValue) &&
              targetValue.length > 0 &&
              targetValue.length <= 4 &&
              targetValue.every(Number.isFinite)
            ? targetValue.length
            : undefined
      const multiplier = interpolation === 'CUBICSPLINE' ? 3 : 1
      if (
        input.componentType !== 5126 ||
        input.type !== 'SCALAR' ||
        !Number.isSafeInteger(input.count) ||
        input.count <= 0 ||
        output.componentType !== 5126 ||
        componentCounts[output.type] !== targetWidth ||
        output.count !== input.count * multiplier
      ) {
        throw new TypeError(`animation ${animationIndex} pointer accessor shape is invalid`)
      }
    }
  }
  if (count > 0 && !used.includes('KHR_animation_pointer')) {
    throw new TypeError('KHR_animation_pointer is not declared in extensionsUsed')
  }
  if (count === 0 && used.includes('KHR_animation_pointer')) {
    throw new TypeError('KHR_animation_pointer is declared but absent')
  }
}

function safeAnimationPointer(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || pointer.includes('\u0000'))
    return false
  return !['/buffers', '/bufferViews', '/accessors', '/extensions/UV_source_blob'].some(
    prefix => pointer === prefix || pointer.startsWith(`${prefix}/`),
  )
}

function resolvePointer(root, pointer) {
  let current = root
  for (const encoded of pointer.slice(1).split('/')) {
    const token = encoded.replace(/~1/gu, '/').replace(/~0/gu, '~')
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(token)) return undefined
      const index = Number(token)
      if (!Number.isSafeInteger(index) || index >= current.length) return undefined
      current = current[index]
    } else if (
      current !== null &&
      typeof current === 'object' &&
      Object.prototype.hasOwnProperty.call(current, token)
    ) {
      current = current[token]
    } else {
      return undefined
    }
  }
  return current
}

function validateGameMaterialMetadata(document, used) {
  let extensionCount = 0
  for (const [materialIndex, candidate] of array(document, 'materials').entries()) {
    const material = object(candidate, `material ${materialIndex}`)
    const extension = material.extensions?.UV_game_material
    if (extension === undefined) continue
    extensionCount += 1
    const label = `material ${materialIndex} UV_game_material`
    if (!used.includes('UV_game_material')) {
      throw new TypeError(`${label} is not declared in extensionsUsed`)
    }
    const gameMaterial = object(extension, label)
    if (!nonBlank(gameMaterial.shader)) throw new TypeError(`${label} requires a shader identity`)
    const snapshot = gameMaterial.params?.renderModel
    if (snapshot === undefined) continue
    const renderModel = object(snapshot, `${label} neutral snapshot`)
    if (renderModel.version !== 1) {
      throw new TypeError(`${label} neutral snapshot has an unsupported version`)
    }
    if (renderModel.standard === undefined && renderModel.composite === undefined) {
      throw new TypeError(`${label} neutral snapshot has no material payload`)
    }
    if (renderModel.standard !== undefined) {
      object(renderModel.standard, `${label} standard material`)
    }
    if (renderModel.composite !== undefined) {
      object(renderModel.composite, `${label} composite material`)
    }
  }
  if (used.includes('UV_game_material') && extensionCount === 0) {
    throw new TypeError('UV_game_material is declared but absent')
  }
}

function validateTeamColorMetadata(document, used) {
  let extensionCount = 0
  for (const [materialIndex, candidate] of array(document, 'materials').entries()) {
    const material = object(candidate, `material ${materialIndex}`)
    const extension = material.extensions?.UV_game_material_team_color
    if (extension === undefined) continue
    extensionCount += 1
    const label = `material ${materialIndex} UV_game_material_team_color`
    if (!used.includes('UV_game_material_team_color')) {
      throw new TypeError(`${label} is not declared in extensionsUsed`)
    }
    const teamColor = object(extension, label)
    if (!['texture', 'vertexColor', 'paletteRange', 'whole'].includes(teamColor.maskSource)) {
      throw new TypeError(`${label} has an invalid maskSource`)
    }
    if (
      teamColor.blend !== undefined &&
      !['multiply', 'add', 'replace', 'overlay', 'lerp'].includes(teamColor.blend)
    ) {
      throw new TypeError(`${label} has an invalid blend`)
    }
    if (
      teamColor.targets !== undefined &&
      (!Array.isArray(teamColor.targets) ||
        teamColor.targets.length === 0 ||
        teamColor.targets.some(target => !['baseColor', 'emissive', 'specular'].includes(target)) ||
        new Set(teamColor.targets).size !== teamColor.targets.length)
    ) {
      throw new TypeError(`${label} has invalid targets`)
    }
    if (
      teamColor.strength !== undefined &&
      (!Number.isFinite(teamColor.strength) || teamColor.strength < 0)
    ) {
      throw new TypeError(`${label} has an invalid strength`)
    }
    const renderModel = teamColor.extras?.renderModel
    if (renderModel !== undefined) {
      const remap = object(renderModel, `${label} neutral remap`)
      if (
        remap.target !== 'team-color' ||
        !['replace', 'multiply', 'hsv-shade'].includes(remap.operation)
      ) {
        throw new TypeError(`${label} has invalid neutral remap metadata`)
      }
    }
  }
  if (used.includes('UV_game_material_team_color') && extensionCount === 0) {
    throw new TypeError('UV_game_material_team_color is declared but absent')
  }
}

function validateCollisionMetadata(document, used) {
  const nodes = array(document, 'nodes')
  const allowedKinds = new Set([
    'box',
    'sphere',
    'capsule',
    'cylinder',
    'convex-hull',
    'mesh',
    'plane',
  ])
  let extensionCount = 0
  for (const [nodeIndex, candidate] of nodes.entries()) {
    const node = object(candidate, `node ${nodeIndex}`)
    const extension = node.extensions?.UV_game_collision
    if (extension === undefined) continue
    extensionCount += 1
    if (!used.includes('UV_game_collision')) {
      throw new TypeError(`node ${nodeIndex} uses undeclared UV_game_collision`)
    }
    const collision = object(extension, `node ${nodeIndex} UV_game_collision`)
    const shapes = array(collision, 'shapes')
    if (shapes.length === 0) throw new TypeError('UV_game_collision.shapes must not be empty')
    if (
      collision.role !== undefined &&
      !['physics', 'hit', 'selection', 'footprint', 'effect', 'vision'].includes(collision.role)
    ) {
      throw new TypeError(`node ${nodeIndex} has an invalid collision role`)
    }
    for (const [shapeIndex, shapeCandidate] of shapes.entries()) {
      const label = `node ${nodeIndex} collision shape ${shapeIndex}`
      const shape = object(shapeCandidate, label)
      if (!allowedKinds.has(shape.kind)) throw new TypeError(`${label} has an invalid kind`)
      if (shape.matrix !== undefined && !finiteArray(shape.matrix, 16)) {
        throw new TypeError(`${label} has an invalid matrix`)
      }
      if (
        shape.collisionMask !== undefined &&
        (!Number.isSafeInteger(shape.collisionMask) || shape.collisionMask < 0)
      ) {
        throw new TypeError(`${label} has an invalid collisionMask`)
      }
      if (
        shape.kind === 'box' &&
        (!finiteArray(shape.size, 3) || shape.size.some(value => value <= 0))
      ) {
        throw new TypeError(`${label} has invalid box extents`)
      }
      if (shape.kind === 'sphere' && !(Number.isFinite(shape.radius) && shape.radius > 0)) {
        throw new TypeError(`${label} has an invalid radius`)
      }
      if (
        (shape.kind === 'capsule' || shape.kind === 'cylinder') &&
        (!(Number.isFinite(shape.radius) && shape.radius > 0) ||
          !(Number.isFinite(shape.height) && shape.height > 0) ||
          (shape.axis !== undefined && !['x', 'y', 'z'].includes(shape.axis)))
      ) {
        throw new TypeError(`${label} has invalid dimensions or axis`)
      }
      if (
        shape.kind === 'plane' &&
        (!finiteArray(shape.normal, 3) || Math.hypot(...shape.normal) <= 1e-12)
      ) {
        throw new TypeError(`${label} has an invalid normal`)
      }
      if (
        (shape.kind === 'convex-hull' || shape.kind === 'mesh') &&
        !Number.isSafeInteger(shape.positions)
      ) {
        throw new TypeError(`${label} has an invalid positions accessor`)
      }
      if (shape.kind === 'mesh' && !Number.isSafeInteger(shape.indices)) {
        throw new TypeError(`${label} has an invalid indices accessor`)
      }
    }
  }
  if (used.includes('UV_game_collision') && extensionCount === 0) {
    throw new TypeError('UV_game_collision is declared but absent from all nodes')
  }
}

function safeIndex(value, length, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= length) {
    throw new RangeError(`${label} index is outside the UVM document`)
  }
  return value
}

function readComponent(view, offset, type) {
  if (type === 5121) return view.getUint8(offset)
  if (type === 5123) return view.getUint16(offset, true)
  if (type === 5125) return view.getUint32(offset, true)
  if (type === 5126) return view.getFloat32(offset, true)
  throw new TypeError(`unsupported UVM accessor component type ${String(type)}`)
}

function accessorValues(document, binary, accessorIndex, budget, purpose) {
  const accessors = array(document, 'accessors')
  const bufferViews = array(document, 'bufferViews')
  const accessor = object(accessors[safeIndex(accessorIndex, accessors.length, purpose)], purpose)
  if (accessor.sparse !== undefined)
    throw new TypeError(`${purpose} sparse accessors are not supported`)
  const count = accessor.count
  const width = componentCounts[accessor.type]
  const bytesPerComponent = componentBytes[accessor.componentType]
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    width === undefined ||
    bytesPerComponent === undefined
  ) {
    throw new TypeError(`${purpose} accessor shape is invalid`)
  }
  const bufferView = object(
    bufferViews[safeIndex(accessor.bufferView, bufferViews.length, `${purpose} bufferView`)],
    `${purpose} bufferView`,
  )
  if ((bufferView.buffer ?? 0) !== 0)
    throw new TypeError(`${purpose} references an external buffer`)
  const viewOffset = bufferView.byteOffset ?? 0
  const accessorOffset = accessor.byteOffset ?? 0
  const elementBytes = width * bytesPerComponent
  const stride = bufferView.byteStride ?? elementBytes
  const viewLength = bufferView.byteLength
  if (
    !Number.isSafeInteger(viewOffset) ||
    !Number.isSafeInteger(accessorOffset) ||
    !Number.isSafeInteger(viewLength) ||
    !Number.isSafeInteger(stride) ||
    viewOffset < 0 ||
    accessorOffset < 0 ||
    viewLength < 0 ||
    stride < elementBytes
  ) {
    throw new TypeError(`${purpose} buffer view range is invalid`)
  }
  const scalarCount = count * width
  if (!Number.isSafeInteger(scalarCount) || scalarCount * 4 > budget.maxScalarBytes) {
    throw new RangeError(`${purpose} exceeds maxScalarBytes budget`)
  }
  const start = viewOffset + accessorOffset
  const end = count === 0 ? start : start + (count - 1) * stride + elementBytes
  if (start < viewOffset || end > viewOffset + viewLength || end > binary.byteLength) {
    throw new RangeError(`${purpose} accessor exceeds the UVM BIN chunk`)
  }
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  const result =
    purpose === 'indices' ? new Uint32Array(scalarCount) : new Float32Array(scalarCount)
  for (let item = 0; item < count; item += 1) {
    const itemOffset = start + item * stride
    for (let component = 0; component < width; component += 1) {
      result[item * width + component] = readComponent(
        view,
        itemOffset + component * bytesPerComponent,
        accessor.componentType,
      )
    }
  }
  return Object.freeze({ values: result, count, width, componentType: accessor.componentType })
}

function decodeCollisions(document, binary, budget) {
  const byKind = Object.create(null)
  const volumes = []
  let total = 0
  for (const [nodeIndex, nodeCandidate] of array(document, 'nodes').entries()) {
    const node = object(nodeCandidate, `node ${nodeIndex}`)
    const extension = node.extensions?.UV_game_collision
    if (extension === undefined) continue
    for (const [shapeIndex, shapeCandidate] of array(
      object(extension, 'UV_game_collision'),
      'shapes',
    ).entries()) {
      const shape = object(shapeCandidate, `node ${nodeIndex} collision shape ${shapeIndex}`)
      if (shape.kind === 'convex-hull' || shape.kind === 'mesh') {
        const positions = accessorValues(
          document,
          binary,
          shape.positions,
          budget,
          'collision positions',
        )
        if (positions.width !== 3 || positions.componentType !== 5126) {
          throw new TypeError('UV_game_collision positions must be float VEC3')
        }
        if (shape.kind === 'mesh') {
          const indices = accessorValues(document, binary, shape.indices, budget, 'indices')
          if (
            indices.width !== 1 ||
            ![5121, 5123, 5125].includes(indices.componentType) ||
            indices.count % 3 !== 0
          ) {
            throw new TypeError('UV_game_collision mesh indices must form integer triangles')
          }
          for (const index of indices.values) {
            if (!Number.isSafeInteger(index) || index < 0 || index >= positions.count) {
              throw new RangeError('UV_game_collision mesh index exceeds its positions')
            }
          }
        }
      }
      total += 1
      byKind[shape.kind] = (byKind[shape.kind] ?? 0) + 1
      /*
       * The per-volume records `common.view/model-collision-source@1` publishes. UVM is the
       * `declared-volume` publisher of that contract: a `UV_game_collision` shape is a volume the
       * document declares, not a render mesh wearing a collision bit. The role travels as a
       * publisher-qualified type, and stays absent when the document does not state one.
       */
      volumes.push(
        Object.freeze({
          id: `node-${nodeIndex}-collision-${shapeIndex}`,
          kind: shape.kind,
          origin: 'declared-volume',
          ...(collisionNodeMesh(node) === undefined ? {} : { meshId: collisionNodeMesh(node) }),
          ...(typeof extensionRole(extension) === 'string'
            ? { types: Object.freeze([extensionRole(extension)]) }
            : {}),
        }),
      )
    }
  }
  return Object.freeze({ total, byKind: Object.freeze(byKind), volumes: Object.freeze(volumes) })
}

/** The mesh a collision node also draws, when it draws one; a volume-only node has none. */
function collisionNodeMesh(node) {
  return typeof node.mesh === 'number' ? `mesh-${node.mesh}` : undefined
}

function extensionRole(extension) {
  const role = object(extension, 'UV_game_collision').role
  return typeof role === 'string' ? role : undefined
}

/**
 * Per-material contract coverage — `common.view/model-material-source@1`.
 *
 * The contracts are the extension names the document itself declares, not a vocabulary invented
 * here: UV preserves shader *parameters* and does not define pixel output, so a material's identity
 * plus the contracts it carries is exactly what this facet can honestly say about it.
 */
function decodeMaterialRefs(document) {
  return array(document, 'materials').map((candidate, index) => {
    const material = object(candidate, `material ${index}`)
    const contracts = []
    const snapshot = material.extensions?.UV_game_material?.params?.renderModel
    if (snapshot?.version === 1) {
      if (snapshot.standard !== undefined) contracts.push('UV_game_material/standard')
      if (snapshot.composite !== undefined) contracts.push('UV_game_material/composite')
    }
    if (material.extensions?.UV_game_material_team_color !== undefined) {
      contracts.push('UV_game_material_team_color')
    }
    return Object.freeze({
      // the identity the artifact binding fixes, so a primitive and its material can be joined
      id: `material-${index}`,
      ...(typeof material.name === 'string' && material.name !== '' ? { name: material.name } : {}),
      ...(contracts.length === 0 ? {} : { contracts: Object.freeze(contracts) }),
    })
  })
}

function decodeTeamColors(document) {
  const byOperation = Object.create(null)
  let total = 0
  for (const candidate of array(document, 'materials')) {
    const material = object(candidate, 'UVM material')
    const extension = material.extensions?.UV_game_material_team_color
    if (extension === undefined) continue
    const teamColor = object(extension, 'UV_game_material_team_color')
    const remap = teamColor.extras?.renderModel
    const operation = remap?.operation ?? (teamColor.blend === 'replace' ? 'replace' : 'multiply')
    total += 1
    byOperation[operation] = (byOperation[operation] ?? 0) + 1
  }
  return Object.freeze({ total, byOperation: Object.freeze(byOperation) })
}

function decodeAdvancedMaterials(document) {
  const byContract = { standard: 0, composite: 0 }
  let total = 0
  for (const candidate of array(document, 'materials')) {
    const material = object(candidate, 'UVM material')
    const snapshot = material.extensions?.UV_game_material?.params?.renderModel
    if (snapshot?.version !== 1) continue
    let represented = false
    if (snapshot.standard !== undefined) {
      byContract.standard += 1
      represented = true
    }
    if (snapshot.composite !== undefined) {
      byContract.composite += 1
      represented = true
    }
    if (represented) total += 1
  }
  return Object.freeze({ total, byContract: Object.freeze(byContract) })
}

function decodeEffects(document) {
  const extension = document.extensions?.UV_game_effects
  if (extension === undefined) {
    return Object.freeze({ total: 0, profile: undefined, byKind: Object.freeze({}), animated: 0 })
  }
  const effects = object(extension, 'UV_game_effects')
  const byKind = Object.create(null)
  let total = 0
  for (const kind of ['particles', 'ribbons', 'forces', 'warps', 'projectors']) {
    const count = array(effects, kind).length
    byKind[kind] = count
    total += count
  }
  let animated = 0
  for (const candidate of array(document, 'animations')) {
    const animation = object(candidate, 'UVM animation')
    animated += array(animation, 'channels').filter(channel => {
      const target = channel?.target
      return target?.path === 'pointer' && target?.extensions?.KHR_animation_pointer !== undefined
    }).length
  }
  return Object.freeze({
    total,
    profile: effects.profile ?? 'common',
    byKind: Object.freeze(byKind),
    animated,
  })
}

function identityTransform() {
  return Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

function nodeTransform(node) {
  if (
    Array.isArray(node.matrix) &&
    node.matrix.length === 16 &&
    node.matrix.every(Number.isFinite)
  ) {
    return Object.freeze([...node.matrix])
  }
  return identityTransform()
}

function decodeScene(document, binary, budget) {
  const nodes = array(document, 'nodes')
  const meshes = array(document, 'meshes')
  const materials = array(document, 'materials')
  const textures = array(document, 'textures')
  const animations = array(document, 'animations')
  const primitives = []
  const modelMeshes = meshes.map((candidate, meshIndex) => {
    const mesh = object(candidate, `mesh ${meshIndex}`)
    const primitiveIds = array(mesh, 'primitives').map((candidatePrimitive, primitiveIndex) => {
      const primitive = object(candidatePrimitive, `mesh ${meshIndex} primitive ${primitiveIndex}`)
      if ((primitive.mode ?? 4) !== 4) throw new TypeError('UVM/core currently requires triangles')
      const attributes = object(primitive.attributes, 'UVM primitive attributes')
      const position = accessorValues(document, binary, attributes.POSITION, budget, 'positions')
      if (position.width !== 3 || position.componentType !== 5126) {
        throw new TypeError('UVM POSITION must be a float VEC3 accessor')
      }
      const indices =
        primitive.indices === undefined
          ? Uint32Array.from({ length: position.count }, (_unused, index) => index)
          : accessorValues(document, binary, primitive.indices, budget, 'indices').values
      const normals =
        attributes.NORMAL === undefined
          ? undefined
          : accessorValues(document, binary, attributes.NORMAL, budget, 'normals').values
      const textureCoordinates =
        attributes.TEXCOORD_0 === undefined
          ? undefined
          : accessorValues(document, binary, attributes.TEXCOORD_0, budget, 'texture coordinates')
              .values
      const id = `mesh-${meshIndex}-primitive-${primitiveIndex}`
      primitives.push({
        id,
        topology: 'triangles',
        positions: position.values,
        indices,
        ...(normals === undefined ? {} : { normals }),
        ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
        ...(Number.isSafeInteger(primitive.material)
          ? { materialId: `material-${primitive.material}` }
          : {}),
      })
      return id
    })
    return {
      id: `mesh-${meshIndex}`,
      ...(typeof mesh.name === 'string' ? { name: mesh.name } : {}),
      primitiveIds,
    }
  })
  const modelNodes = nodes.map((candidate, nodeIndex) => {
    const node = object(candidate, `node ${nodeIndex}`)
    const childIds = (Array.isArray(node.children) ? node.children : []).map(
      child => `node-${safeIndex(child, nodes.length, `node ${nodeIndex} child`)}`,
    )
    const meshIds =
      node.mesh === undefined ? [] : [`mesh-${safeIndex(node.mesh, meshes.length, 'node mesh')}`]
    return {
      id: `node-${nodeIndex}`,
      ...(typeof node.name === 'string' ? { name: node.name } : {}),
      childIds,
      meshIds,
      transform: nodeTransform(node),
    }
  })
  return Object.freeze({
    nodes: modelNodes,
    meshes: modelMeshes,
    primitives,
    materials: materials.length,
    textures: textures.length,
    animations: animations.length,
  })
}

function treeFor(document, scene, collisions, teamColors, advancedMaterials, effects) {
  const preservedSourceBlobs = array(document.extensions.UV_source_blob, 'blobs').length
  return createTreeDataSource({
    kind: 'model',
    label: 'Universal Verse Model',
    preview: `${scene.nodes.length} nodes, ${scene.meshes.length} meshes`,
    children: [
      {
        kind: 'collection',
        label: 'Nodes',
        preview: String(scene.nodes.length),
        children: scene.nodes.map(node => ({ kind: 'node', label: node.name ?? node.id })),
      },
      {
        kind: 'collection',
        label: 'Meshes',
        preview: String(scene.meshes.length),
        children: scene.meshes.map(mesh => ({ kind: 'mesh', label: mesh.name ?? mesh.id })),
      },
      {
        kind: 'object',
        label: 'UV_asset',
        preview: String(document.extensions.UV_asset.id),
      },
      ...(preservedSourceBlobs > 0
        ? [
            {
              kind: 'collection',
              label: 'Preserved source blobs',
              preview: String(preservedSourceBlobs),
            },
          ]
        : []),
      ...(collisions.total > 0
        ? [
            {
              kind: 'collection',
              label: 'Collision shapes',
              preview: String(collisions.total),
              children: Object.entries(collisions.byKind).map(([kind, count]) => ({
                kind: 'collision-shape',
                label: kind,
                preview: String(count),
              })),
            },
          ]
        : []),
      ...(teamColors.total > 0
        ? [
            {
              kind: 'collection',
              label: 'Team-colour materials',
              preview: String(teamColors.total),
              children: Object.entries(teamColors.byOperation).map(([operation, count]) => ({
                kind: 'material-remap',
                label: operation,
                preview: String(count),
              })),
            },
          ]
        : []),
      ...(advancedMaterials.total > 0
        ? [
            {
              kind: 'collection',
              label: 'Advanced material contracts',
              preview: String(advancedMaterials.total),
              children: Object.entries(advancedMaterials.byContract)
                .filter(([, count]) => count > 0)
                .map(([contract, count]) => ({
                  kind: 'material-contract',
                  label: contract,
                  preview: String(count),
                })),
            },
          ]
        : []),
      ...(effects.total > 0
        ? [
            {
              kind: 'collection',
              label: 'Game effects',
              preview: `${effects.total} (${effects.profile})`,
              children: Object.entries(effects.byKind)
                .filter(([, count]) => count > 0)
                .map(([kind, count]) => ({
                  kind: 'effect-kind',
                  label: kind,
                  preview: String(count),
                })),
            },
          ]
        : []),
    ],
  })
}

function inspectUvm(bytes, context) {
  const decoded = decodeUvmGlb(bytes, context.budget)
  const document = decoded.document
  const scene = decodeScene(document, decoded.binary, context.budget)
  const collisions = decodeCollisions(document, decoded.binary, context.budget)
  const teamColors = decodeTeamColors(document)
  const advancedMaterials = decodeAdvancedMaterials(document)
  const effects = decodeEffects(document)
  const materialRefs = decodeMaterialRefs(document)
  const identity = document.extensions.UV_asset
  const provenance = document.extensions.UV_provenance
  const preservedSourceBlobs = array(document.extensions.UV_source_blob, 'blobs').length
  const bounds = (() => {
    if (scene.primitives.length === 0) return undefined
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (const primitive of scene.primitives) {
      for (let offset = 0; offset < primitive.positions.length; offset += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = primitive.positions[offset + axis]
          min[axis] = Math.min(min[axis], value)
          max[axis] = Math.max(max[axis], value)
        }
      }
    }
    return { min, max }
  })()
  const model = createModelSceneSource({
    info: {
      scenes: array(document, 'scenes').length,
      nodes: scene.nodes.length,
      meshes: scene.meshes.length,
      primitives: scene.primitives.length,
      materials: scene.materials,
      textures: scene.textures,
      animations: scene.animations,
      ...(bounds === undefined ? {} : { bounds }),
      geometryAccess: 'decoded',
    },
    nodes: scene.nodes,
    meshes: scene.meshes,
    primitives: scene.primitives,
  })
  return {
    summary: {
      format: 'uvm',
      version: document.asset.extras.uv.version,
      profile: document.asset.extras.uv.profile,
      assetId: identity.id,
      assetClass: identity.class,
      sourceFormat: provenance.source.format,
      importer: provenance.importer,
      nodes: scene.nodes.length,
      meshes: scene.meshes.length,
      primitives: scene.primitives.length,
      collisionShapes: collisions.total,
      collisionKinds: collisions.byKind,
      teamColorMaterials: teamColors.total,
      teamColorOperations: teamColors.byOperation,
      advancedMaterialContracts: advancedMaterials.total,
      advancedMaterialKinds: advancedMaterials.byContract,
      effects: effects.total,
      effectProfile: effects.profile,
      effectKinds: effects.byKind,
      animatedEffectProperties: effects.animated,
      preservedSourceBlobs,
      losses: Array.isArray(provenance.lost) ? provenance.lost : [],
    },
    metadata: [
      {
        id: 'uvm-document',
        label: 'Universal Verse Model',
        entries: [
          { key: 'version', value: document.asset.extras.uv.version },
          { key: 'profile', value: document.asset.extras.uv.profile },
          { key: 'assetId', value: identity.id },
          { key: 'assetClass', value: identity.class },
          { key: 'sourceFormat', value: provenance.source.format },
          { key: 'meshes', value: scene.meshes.length },
          { key: 'primitives', value: scene.primitives.length },
          { key: 'collisionShapes', value: collisions.total },
          { key: 'teamColorMaterials', value: teamColors.total },
          { key: 'advancedMaterialContracts', value: advancedMaterials.total },
          { key: 'effects', value: effects.total },
          { key: 'animatedEffectProperties', value: effects.animated },
          { key: 'preservedSourceBlobs', value: preservedSourceBlobs },
        ],
      },
    ],
    traits: [
      ...(scene.primitives.length > 0
        ? [{ id: 'model.geometry', parameters: { primitives: scene.primitives.length } }]
        : []),
      ...(scene.materials > 0
        ? [{ id: 'model.materials', parameters: { count: scene.materials } }]
        : []),
      ...(scene.textures > 0
        ? [{ id: 'model.textures', parameters: { count: scene.textures } }]
        : []),
      ...(scene.animations > 0
        ? [{ id: 'model.animations', parameters: { count: scene.animations } }]
        : []),
      { id: 'scene.objects', parameters: { nodes: scene.nodes.length } },
      { id: 'structure.hierarchy', parameters: { nodeCount: decoded.jsonNodes, lazy: true } },
    ],
    projectionReceipt: createProjectionReceipt({
      adapter: { id: 'org.modkitx/model-uvm', version: '1.0.0' },
      subjectRevision: context.input.revisions.revision,
      companions: [],
      basis: UVM_BASIS,
      planes: [
        {
          planeId: 'geometry',
          state: 'preserved',
          // the document already is the UV space; there is nothing to convert
          note: 'positions are read in the profile’s own right-handed Y-up metre space',
        },
        {
          planeId: 'structure',
          state: 'preserved',
          note: 'the node graph, positionally identified',
        },
        {
          planeId: 'materials',
          state: scene.materials > 0 ? 'preserved' : 'lost',
          note: `${scene.materials} material(s), ${advancedMaterials.total} carrying a render-model contract`,
        },
        {
          planeId: 'collision',
          state: collisions.total > 0 ? 'preserved' : 'lost',
          note: `${collisions.total} declared UV_game_collision shape(s)`,
        },
        {
          planeId: 'resources',
          state: 'lost',
          note: `${scene.textures} texture(s) are counted from the document; this reader does not surface their references, so no resource facet is published`,
        },
        {
          planeId: 'effects',
          state: effects.total > 0 ? 'lost' : 'preserved',
          note:
            effects.total > 0
              ? `${effects.total} UV_game_effects entry(ies) are counted by kind; per-emitter records have no contract to be published through`
              : 'the document declares no effects',
        },
        ...(preservedSourceBlobs > 0
          ? [
              {
                planeId: 'native-source-blob',
                state: 'preserved',
                note: `${preservedSourceBlobs} opaque UV_source_blob entry(ies) travel with the document untouched`,
              },
            ]
          : []),
      ],
      evidence: [
        {
          kind: 'observed',
          statement: `UVM ${document.asset.extras.uv.version}/${document.asset.extras.uv.profile}: ${scene.nodes.length} node(s), ${scene.primitives.length} primitive(s)`,
          bytesRead: BigInt(bytes.byteLength),
        },
        {
          kind: 'declared',
          statement: `the document declares its source format as «${provenance.source.format}» and its importer as ${provenance.importer?.id ?? 'unnamed'}`,
          source: 'UV_provenance',
        },
        ...(Array.isArray(provenance.lost) && provenance.lost.length > 0
          ? [
              {
                kind: 'declared',
                statement: `the producing importer recorded ${provenance.lost.length} loss(es) in UV_provenance.lost`,
                source: 'UV_provenance',
              },
            ]
          : []),
      ],
      confidence: 'exact',
    }),
    dataSources: {
      'common.view/model-scene-source': model,
      ...(collisions.volumes.length === 0
        ? {}
        : {
            'common.view/model-collision-source': createModelCollisionSource({
              volumes: collisions.volumes,
            }),
          }),
      ...(materialRefs.length === 0
        ? {}
        : {
            'common.view/model-material-source': createModelMaterialSource({
              // UVM has no material-library concept, so `libraries` is absent rather than zero
              materials: materialRefs,
            }),
          }),
      'common.view/tree-data-source': treeFor(
        document,
        scene,
        collisions,
        teamColors,
        advancedMaterials,
        effects,
      ),
    },
  }
}

const definition = Object.freeze({
  id: 'org.modkitx/model-uvm',
  format: Object.freeze({
    id: 'uvm',
    label: 'Universal Verse Model 1.0',
    mediaType: 'model/gltf-binary; profile=uvm-1.0',
  }),
  async detect(bytes) {
    const match = looksLikeUvmPrefix(bytes)
    return match
      ? { confidence: 0.995, kind: 'structure', note: 'uvm-core-1.0' }
      : { confidence: 0.01, kind: 'structure', note: 'uvm-profile-marker-missing' }
  },
  async inspect(bytes, context) {
    return inspectUvm(bytes, context)
  },
})

export const abiVersion = 1
export const createCodec = () => createInspectionCodec(definition)
