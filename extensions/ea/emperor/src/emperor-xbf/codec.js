// Portable Emperor XBF v1 reader. The parser follows the retail container order rather than
// scavenging for plausible floats: node headers declare the recursive tree, geometry follows each
// child list, and optional payloads are selected only by the node flags.

import {
  createInspectionCodec,
  createModelAnimationSource,
  createModelMaterialSource,
  createModelResourceRefsSource,
  createModelSceneSource,
  createProjectionReceipt,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/emperor-xbf'
const VERSION = 1
const HEADER_BYTES = 8
const NODE_HEADER_BYTES = 148
const VERTEX_BYTES = 24
const FACE_BYTES = 44
const COMPRESSED_VERTEX_BYTES = 8
const MAX_PROBE_SECTION_BYTES = 100 * 1024 * 1024
const END_MARKER = -1
const FRAME_RATE = 20
const FLAG_PRELIGHT = 1
const FLAG_SMOOTHING_GROUPS = 2
const FLAG_VERTEX_ANIMATION = 4
const FLAG_KEY_ANIMATION = 8
const KNOWN_FLAGS =
  FLAG_PRELIGHT | FLAG_SMOOTHING_GROUPS | FLAG_VERTEX_ANIMATION | FLAG_KEY_ANIMATION

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function cancelled(signal) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

function checkedRange(total, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > total ||
    length > total - offset
  )
    throw new RangeError(`XBF ${label} is outside the source`)
}

function checkedProduct(count, stride, label) {
  const value = count * stride
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`XBF ${label} is too large`)
  return value
}

function nonNegativeInt(view, offset, label) {
  const value = view.getInt32(offset, true)
  if (value < 0) throw new RangeError(`XBF ${label} is negative`)
  return value
}

function finiteFloat(view, offset, label) {
  const value = view.getFloat32(offset, true)
  if (!Number.isFinite(value)) throw new TypeError(`XBF ${label} is not finite`)
  return value
}

function decodeAscii(bytes) {
  return new TextDecoder('windows-1252').decode(bytes).replace(/\0+$/gu, '')
}

function decodeFixedString(bytes) {
  const terminator = bytes.indexOf(0)
  return decodeAscii(terminator < 0 ? bytes : bytes.subarray(0, terminator))
}

function addDiagnostic(state, code, message, severity = 'information') {
  if (state.diagnostics.length >= state.budget.maxDiagnostics) return
  state.diagnostics.push({ code: `x3.emperor-xbf/${code}`, message, severity })
}

function spendNodes(state, amount, label) {
  state.nodeBudget += amount
  if (!Number.isSafeInteger(state.nodeBudget) || state.nodeBudget > state.budget.maxNodes) {
    throw new RangeError(`XBF ${label} exceeds maxNodes`)
  }
}

function spendScalar(state, amount, label) {
  state.scalarBytes += amount
  if (!Number.isSafeInteger(state.scalarBytes) || state.scalarBytes > state.budget.maxScalarBytes) {
    throw new RangeError(`XBF ${label} exceeds maxScalarBytes`)
  }
}

function parseTextureNames(bytes) {
  const textures = []
  let start = 0
  for (let offset = 0; offset <= bytes.byteLength; offset += 1) {
    if (offset < bytes.byteLength && bytes[offset] !== 0) continue
    let raw = bytes.subarray(start, offset)
    while (raw.length > 0 && (raw[0] ?? 0) <= 2) raw = raw.subarray(1)
    const value = decodeAscii(raw).trim()
    if (value.length > 0) textures.push(value)
    start = offset + 1
  }
  return textures
}

function readTransform(view, offset, state, nodeOffset) {
  const transform = []
  let normalizedPadding = 0
  for (let index = 0; index < 16; index += 1) {
    const source = view.getFloat64(offset + index * 8, true)
    if (!Number.isFinite(source))
      throw new TypeError(`XBF node transform at ${nodeOffset} is not finite`)
    let value = source
    if (index === 3 || index === 7 || index === 11) value = 0
    else if (index === 15) value = 1
    if (!Object.is(source, value)) normalizedPadding += 1
    transform.push(value)
  }
  if (normalizedPadding > 0) {
    addDiagnostic(
      state,
      'affine-padding-normalized',
      `node at byte ${nodeOffset} contains ${normalizedPadding} non-affine padding value(s)`,
    )
  }
  return transform
}

function multiplyColumnMajor(left, right) {
  const out = new Array(16).fill(0)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0
      for (let inner = 0; inner < 4; inner += 1) {
        value += left[inner * 4 + row] * right[column * 4 + inner]
      }
      out[column * 4 + row] = value
    }
  }
  return out
}

function readVertices(bytes, cursor, count, state) {
  const byteLength = checkedProduct(count, VERTEX_BYTES, 'vertex buffer')
  checkedRange(bytes.byteLength, cursor.offset, byteLength, 'vertex buffer')
  spendNodes(state, count, 'vertices')
  spendScalar(state, byteLength, 'vertices')
  const view = dataView(bytes)
  const vertices = []
  for (let index = 0; index < count; index += 1) {
    if ((index & 0x3fff) === 0) cancelled(state.signal)
    const offset = cursor.offset + index * VERTEX_BYTES
    vertices.push({
      position: [
        finiteFloat(view, offset, 'vertex position'),
        finiteFloat(view, offset + 4, 'vertex position'),
        finiteFloat(view, offset + 8, 'vertex position'),
      ],
      normal: [
        finiteFloat(view, offset + 12, 'vertex normal'),
        finiteFloat(view, offset + 16, 'vertex normal'),
        finiteFloat(view, offset + 20, 'vertex normal'),
      ],
    })
  }
  cursor.offset += byteLength
  return vertices
}

function readFaces(bytes, cursor, count, state) {
  const byteLength = checkedProduct(count, FACE_BYTES, 'face buffer')
  checkedRange(bytes.byteLength, cursor.offset, byteLength, 'face buffer')
  spendNodes(state, count, 'faces')
  spendScalar(state, byteLength, 'faces')
  const view = dataView(bytes)
  const faces = []
  for (let index = 0; index < count; index += 1) {
    if ((index & 0x3fff) === 0) cancelled(state.signal)
    const offset = cursor.offset + index * FACE_BYTES
    faces.push({
      indices: [
        view.getInt32(offset, true),
        view.getInt32(offset + 4, true),
        view.getInt32(offset + 8, true),
      ],
      textureIndex: view.getInt32(offset + 12, true),
      flags: view.getInt32(offset + 16, true),
      uvs: [
        [finiteFloat(view, offset + 20, 'face uv'), finiteFloat(view, offset + 24, 'face uv')],
        [finiteFloat(view, offset + 28, 'face uv'), finiteFloat(view, offset + 32, 'face uv')],
        [finiteFloat(view, offset + 36, 'face uv'), finiteFloat(view, offset + 40, 'face uv')],
      ],
    })
  }
  cursor.offset += byteLength
  return faces
}

function skipVertexAnimation(bytes, cursor, state) {
  const start = cursor.offset
  checkedRange(bytes.byteLength, cursor.offset, 12, 'vertex animation header')
  const view = dataView(bytes)
  const frameCount = nonNegativeInt(view, cursor.offset, 'vertex animation frame count')
  const count = view.getInt32(cursor.offset + 4, true)
  const keyCount = nonNegativeInt(view, cursor.offset + 8, 'vertex animation key count')
  spendNodes(state, keyCount, 'vertex animation keys')
  cursor.offset += 12
  const keyBytes = checkedProduct(keyCount, 4, 'vertex animation keys')
  checkedRange(bytes.byteLength, cursor.offset, keyBytes, 'vertex animation keys')
  cursor.offset += keyBytes
  let targetCount = 0
  if (count < 0) {
    checkedRange(bytes.byteLength, cursor.offset, 8, 'compressed vertex animation header')
    const scale = view.getUint32(cursor.offset, true)
    const baseCount = view.getUint32(cursor.offset + 4, true)
    if (keyCount === 0 || count !== -baseCount || baseCount % keyCount !== 0) {
      throw new TypeError('XBF compressed vertex animation count is inconsistent')
    }
    targetCount = keyCount
    cursor.offset += 8
    const frameBytes = checkedProduct(baseCount, COMPRESSED_VERTEX_BYTES, 'vertex animation frames')
    checkedRange(bytes.byteLength, cursor.offset, frameBytes, 'vertex animation frames')
    cursor.offset += frameBytes
    if ((scale & 0x80000000) !== 0) {
      const interpolationBytes = checkedProduct(frameCount, 4, 'vertex animation interpolation')
      checkedRange(
        bytes.byteLength,
        cursor.offset,
        interpolationBytes,
        'vertex animation interpolation',
      )
      cursor.offset += interpolationBytes
    }
  } else if (count > 0) {
    throw new TypeError('XBF uncompressed vertex animation payload is unsupported')
  }
  spendScalar(state, cursor.offset - start, 'vertex animation')
  return { frameCount, keyCount, targetCount }
}

function readMatrixAnimation(bytes, cursor, state, nodeName) {
  const start = cursor.offset
  checkedRange(bytes.byteLength, cursor.offset, 8, 'key animation header')
  const view = dataView(bytes)
  const frameCount = nonNegativeInt(view, cursor.offset, 'key animation frame count')
  const flags = view.getInt32(cursor.offset + 4, true)
  cursor.offset += 8
  let keyCount = 0
  if (flags === -1 || flags === -2) {
    const stride = flags === -1 ? 64 : 48
    keyCount = frameCount + 1
    const byteLength = checkedProduct(keyCount, stride, 'key animation matrices')
    checkedRange(bytes.byteLength, cursor.offset, byteLength, 'key animation matrices')
    cursor.offset += byteLength
  } else if (flags === -3) {
    const mapBytes = checkedProduct(frameCount + 1, 2, 'key animation frame map')
    checkedRange(bytes.byteLength, cursor.offset, 4 + mapBytes, 'key animation frame map')
    const realCount = view.getInt32(cursor.offset, true)
    if (realCount < 0) throw new RangeError('XBF key animation matrix count is negative')
    cursor.offset += 4 + mapBytes
    const matrixBytes = checkedProduct(realCount, 48, 'key animation matrices')
    checkedRange(bytes.byteLength, cursor.offset, matrixBytes, 'key animation matrices')
    cursor.offset += matrixBytes
    keyCount = realCount
  } else if (flags >= 0) {
    keyCount = flags
    for (let index = 0; index < flags; index += 1) {
      cancelled(state.signal)
      checkedRange(bytes.byteLength, cursor.offset, 4, 'key animation record')
      const frameFlags = view.getUint16(cursor.offset + 2, true)
      cursor.offset += 4
      if ((frameFlags & 0x8fff) !== 0) {
        addDiagnostic(
          state,
          'key-animation-flags',
          `node «${nodeName}» key ${index} has unknown flags 0x${frameFlags.toString(16)}`,
          'warning',
        )
      }
      const valueBytes =
        ((frameFlags & 0x1000) !== 0 ? 16 : 0) +
        ((frameFlags & 0x2000) !== 0 ? 12 : 0) +
        ((frameFlags & 0x4000) !== 0 ? 12 : 0)
      checkedRange(bytes.byteLength, cursor.offset, valueBytes, 'key animation values')
      cursor.offset += valueBytes
    }
  } else throw new TypeError(`XBF key animation flags ${flags} are unsupported`)
  spendNodes(state, keyCount, 'key animation records')
  spendScalar(state, cursor.offset - start, 'key animation')
  return { frameCount, keyCount, flags }
}

function readNode(bytes, cursor, parentTransform, parentIndex, depth, state) {
  cancelled(state.signal)
  if (depth > state.budget.maxDepth) throw new RangeError('XBF hierarchy exceeds maxDepth')
  spendNodes(state, 1, 'hierarchy')
  checkedRange(bytes.byteLength, cursor.offset, NODE_HEADER_BYTES, 'node header')
  const view = dataView(bytes)
  const start = cursor.offset
  const index = state.nextNodeIndex++
  const vertexCount = nonNegativeInt(view, start, 'vertex count')
  const flags = view.getInt32(start + 4, true)
  const faceCount = nonNegativeInt(view, start + 8, 'face count')
  const childCount = nonNegativeInt(view, start + 12, 'child count')
  const transform = readTransform(view, start + 16, state, start)
  const nameLength = view.getUint32(start + 144, true)
  if (nameLength > state.budget.maxScalarBytes)
    throw new RangeError('XBF node name exceeds maxScalarBytes')
  cursor.offset += NODE_HEADER_BYTES
  checkedRange(bytes.byteLength, cursor.offset, nameLength, 'node name')
  const sourceName = decodeAscii(bytes.subarray(cursor.offset, cursor.offset + nameLength))
  const name = sourceName || `Node_${start}`
  cursor.offset += nameLength
  const worldTransform = parentTransform
    ? multiplyColumnMajor(parentTransform, transform)
    : [...transform]
  const children = []
  for (let child = 0; child < childCount; child += 1) {
    children.push(readNode(bytes, cursor, worldTransform, index, depth + 1, state))
  }
  const vertices = readVertices(bytes, cursor, vertexCount, state)
  const faces = readFaces(bytes, cursor, faceCount, state)
  if ((flags & FLAG_PRELIGHT) !== 0) {
    const size = checkedProduct(vertexCount, 3, 'prelight colors')
    checkedRange(bytes.byteLength, cursor.offset, size, 'prelight colors')
    cursor.offset += size
    spendScalar(state, size, 'prelight colors')
  }
  if ((flags & FLAG_SMOOTHING_GROUPS) !== 0) {
    const size = checkedProduct(faceCount, 4, 'smoothing groups')
    checkedRange(bytes.byteLength, cursor.offset, size, 'smoothing groups')
    cursor.offset += size
    spendScalar(state, size, 'smoothing groups')
  }
  const vertexAnimation =
    (flags & FLAG_VERTEX_ANIMATION) === 0 ? undefined : skipVertexAnimation(bytes, cursor, state)
  const keyAnimation =
    (flags & FLAG_KEY_ANIMATION) === 0 ? undefined : readMatrixAnimation(bytes, cursor, state, name)
  const unknownFlags = flags & ~KNOWN_FLAGS
  if (unknownFlags !== 0)
    addDiagnostic(
      state,
      'unknown-node-flags',
      `node «${name}» has unknown flags 0x${unknownFlags.toString(16)}`,
      'warning',
    )
  const node = {
    index,
    parentIndex,
    name,
    flags,
    transform,
    worldTransform,
    children,
    vertices,
    faces,
    ...(vertexAnimation === undefined ? {} : { vertexAnimation }),
    ...(keyAnimation === undefined ? {} : { keyAnimation }),
  }
  state.nodes.push(node)
  return node
}

function readCString(bytes, cursor) {
  const terminator = bytes.indexOf(0, cursor.offset)
  if (terminator < 0) throw new TypeError('XBF FX string is unterminated')
  const value = decodeAscii(bytes.subarray(cursor.offset, terminator))
  cursor.offset = terminator + 1
  return value
}

function skipFxEvent(bytes, cursor, referencedEmitters) {
  checkedRange(bytes.byteLength, cursor.offset, 12, 'FX event header')
  const view = dataView(bytes)
  const type = view.getUint32(cursor.offset, true)
  cursor.offset += 12
  switch (type) {
    case 1:
    case 2:
    case 8:
      readCString(bytes, cursor)
      break
    case 3:
    case 4: {
      referencedEmitters.add(readCString(bytes, cursor).toLocaleLowerCase())
      readCString(bytes, cursor)
      break
    }
    case 6:
      readCString(bytes, cursor)
      readCString(bytes, cursor)
      break
    case 7:
      readCString(bytes, cursor)
      checkedRange(bytes.byteLength, cursor.offset, 8, 'FX UV event')
      cursor.offset += 8
      break
    case 9:
      readCString(bytes, cursor)
      break
    case 10:
      checkedRange(bytes.byteLength, cursor.offset, 4, 'FX trigger event')
      cursor.offset += 4
      break
    case 11:
      checkedRange(bytes.byteLength, cursor.offset, 8, 'FX speed event')
      cursor.offset += 8
      break
    case 12:
    case 13:
      readCString(bytes, cursor)
      checkedRange(bytes.byteLength, cursor.offset, 108, 'FX light event')
      cursor.offset += 108
      break
    default:
      throw new TypeError(`XBF FX event type ${type} is unsupported`)
  }
}

function readParticleEmitter(bytes, cursor) {
  const view = dataView(bytes)
  checkedRange(bytes.byteLength, cursor.offset, 4, 'FX particle name length')
  const nameLength = view.getUint32(cursor.offset, true)
  cursor.offset += 4
  checkedRange(bytes.byteLength, cursor.offset, nameLength + 68, 'FX particle definition')
  const name = decodeAscii(bytes.subarray(cursor.offset, cursor.offset + nameLength))
  cursor.offset += nameLength
  const fixed = cursor.offset
  const frameCount = view.getUint32(fixed + 60, true)
  const textureNameLength = view.getUint32(fixed + 64, true)
  cursor.offset += 68
  checkedRange(bytes.byteLength, cursor.offset, textureNameLength + 32, 'FX particle tail')
  const textureName = decodeAscii(bytes.subarray(cursor.offset, cursor.offset + textureNameLength))
  cursor.offset += textureNameLength + 32
  return { name, frameCount, textureName }
}

function readClip(bytes, cursor) {
  const offset = cursor.offset
  checkedRange(bytes.byteLength, offset, 36, 'FX animation header')
  const view = dataView(bytes)
  const name = decodeFixedString(bytes.subarray(offset, offset + 32)).trim()
  if (name.length === 0) throw new TypeError('XBF FX animation name is empty')
  cursor.offset += 36
  const ranges = []
  for (let index = 0; index < 64; index += 1) {
    checkedRange(bytes.byteLength, cursor.offset, 24, 'FX animation range')
    const at = cursor.offset
    const startFrame = view.getInt32(at + 16, true)
    const endFrame = view.getInt32(at + 20, true)
    if (startFrame < 0 || endFrame < startFrame || endFrame > 1_000_000)
      throw new RangeError('XBF FX animation range is invalid')
    ranges.push({
      repeat: view.getInt32(at + 4, true),
      bodyPart: view.getInt32(at + 8, true),
      startFrame,
      endFrame,
    })
    const last = bytes[at + 12] !== 0
    cursor.offset += 24
    if (last) return { name, ranges, offset }
  }
  throw new RangeError('XBF FX animation has too many ranges')
}

function parseFxData(bytes, state) {
  if (bytes.byteLength === 0) return { emitters: [], clips: [], referencedEmitters: new Set() }
  checkedRange(bytes.byteLength, 0, 29, 'FX header')
  const view = dataView(bytes)
  const animationCount = view.getUint32(24, true)
  const marker = bytes[28]
  if (marker !== 0 && marker !== 1) throw new TypeError(`XBF FX marker ${marker} is unsupported`)
  spendNodes(state, animationCount, 'FX animations')
  const cursor = { offset: 29 }
  const emitters = []
  const referencedEmitters = new Set()
  if (marker === 1) {
    checkedRange(bytes.byteLength, cursor.offset, 4, 'FX particle count')
    const particleCount = view.getUint32(cursor.offset, true)
    cursor.offset += 4
    spendNodes(state, particleCount, 'FX particles')
    for (let index = 0; index < particleCount; index += 1) {
      cancelled(state.signal)
      emitters.push(readParticleEmitter(bytes, cursor))
    }
    checkedRange(bytes.byteLength, cursor.offset, 16, 'FX script header')
    const frameCount = view.getUint32(cursor.offset + 8, true)
    const scriptNameLength = view.getUint32(cursor.offset + 12, true)
    cursor.offset += 16
    spendNodes(state, frameCount, 'FX frames')
    const tableBytes = checkedProduct(frameCount, 4, 'FX event table')
    checkedRange(bytes.byteLength, cursor.offset, tableBytes, 'FX event table')
    const eventsPerFrame = []
    let eventCount = 0
    for (let frame = 0; frame < frameCount; frame += 1) {
      const count = view.getUint32(cursor.offset + frame * 4, true)
      eventCount += count
      eventsPerFrame.push(count)
    }
    spendNodes(state, eventCount, 'FX events')
    cursor.offset += tableBytes
    checkedRange(bytes.byteLength, cursor.offset, scriptNameLength, 'FX script name')
    cursor.offset += scriptNameLength
    for (const count of eventsPerFrame)
      for (let index = 0; index < count; index += 1) {
        cancelled(state.signal)
        skipFxEvent(bytes, cursor, referencedEmitters)
      }
  }
  const clips = []
  for (let index = 0; index < animationCount; index += 1) clips.push(readClip(bytes, cursor))
  let trailingUnknown
  if (cursor.offset + 4 === bytes.byteLength) {
    trailingUnknown = view.getInt32(cursor.offset, true)
    cursor.offset += 4
  }
  if (cursor.offset !== bytes.byteLength)
    throw new TypeError(`XBF FX data has ${bytes.byteLength - cursor.offset} trailing byte(s)`)
  return {
    emitters,
    clips,
    referencedEmitters,
    ...(trailingUnknown === undefined ? {} : { trailingUnknown }),
  }
}

function parseXbf(bytes, budget, signal) {
  if (bytes.byteLength < HEADER_BYTES + 4) throw new TypeError('XBF header is truncated')
  const state = {
    budget,
    signal,
    nodeBudget: 0,
    scalarBytes: 0,
    nextNodeIndex: 0,
    nodes: [],
    diagnostics: [],
  }
  const view = dataView(bytes)
  const version = view.getInt32(0, true)
  if (version !== VERSION) throw new TypeError(`unsupported XBF version ${version}`)
  const fxDataSize = view.getInt32(4, true)
  if (fxDataSize < 0 || fxDataSize > budget.maxScalarBytes)
    throw new RangeError('XBF FX data exceeds maxScalarBytes')
  checkedRange(bytes.byteLength, HEADER_BYTES, fxDataSize, 'FX data')
  const fxBytes = bytes.subarray(HEADER_BYTES, HEADER_BYTES + fxDataSize)
  let offset = HEADER_BYTES + fxDataSize
  checkedRange(bytes.byteLength, offset, 4, 'texture table size')
  const textureDataSize = view.getUint32(offset, true)
  if (textureDataSize > budget.maxScalarBytes)
    throw new RangeError('XBF texture table exceeds maxScalarBytes')
  offset += 4
  checkedRange(bytes.byteLength, offset, textureDataSize, 'texture table')
  const textures = parseTextureNames(bytes.subarray(offset, offset + textureDataSize))
  spendNodes(state, textures.length, 'textures')
  spendScalar(state, fxDataSize + textureDataSize, 'header sections')
  offset += textureDataSize
  const fx = parseFxData(fxBytes, state)
  const roots = []
  const cursor = { offset }
  let hasEndMarker = false
  while (cursor.offset < bytes.byteLength) {
    cancelled(signal)
    if (
      cursor.offset + 4 <= bytes.byteLength &&
      view.getInt32(cursor.offset, true) === END_MARKER
    ) {
      cursor.offset += 4
      hasEndMarker = true
      break
    }
    roots.push(readNode(bytes, cursor, null, -1, 0, state))
  }
  if (cursor.offset !== bytes.byteLength)
    throw new TypeError(`XBF has ${bytes.byteLength - cursor.offset} byte(s) after its end marker`)
  if (!hasEndMarker) addDiagnostic(state, 'end-marker-missing', 'retail -1 end marker is absent')
  return Object.freeze({
    version,
    fxDataSize,
    textureDataSize,
    textures: Object.freeze(textures),
    fx,
    roots: Object.freeze(roots),
    nodes: Object.freeze([...state.nodes].sort((a, b) => a.index - b.index)),
    hasEndMarker,
    diagnostics: Object.freeze(state.diagnostics),
  })
}

function textureReference(texture) {
  let cleanName = texture
    .replace(/^[\x00-\x02]+/u, '')
    .replaceAll('/', '\\')
    .trim()
  const prefixes = []
  while (/^[=!%@]/u.test(cleanName)) {
    prefixes.push(cleanName[0])
    cleanName = cleanName.slice(1)
  }
  cleanName = cleanName.trim()
  return {
    cleanName,
    path: /\.[a-z0-9]+$/iu.test(cleanName) ? cleanName : `${cleanName}.tga`,
    prefixes,
  }
}

function materialRecords(parsed) {
  const materials = parsed.textures.map((texture, index) => {
    const reference = textureReference(texture)
    return {
      id: `xbf-material-${index}`,
      name: reference.cleanName || `Texture ${index}`,
      resources: [texture],
    }
  })
  const used = parsed.fx.emitters.filter(emitter =>
    parsed.fx.referencedEmitters.has(emitter.name.toLocaleLowerCase()),
  )
  for (const emitter of used) {
    materials.push({
      id: `xbf-material-${materials.length}`,
      name: `${emitter.name} Particle`,
      // The native document spells only the sequence stem. Generated frame paths belong to a
      // resolver/material contract that does not exist yet, not to a verbatim resource-ref source.
      resources: [emitter.textureName],
    })
  }
  return materials
}

function geometry(parsed, budget) {
  const meshes = [],
    primitives = [],
    meshIdsByNode = new Map()
  let decodedBytes = 0
  for (const node of parsed.nodes) {
    const batches = new Map()
    for (const face of node.faces) {
      if (face.textureIndex < 0) continue
      const bucket = batches.get(face.textureIndex)
      if (bucket === undefined) batches.set(face.textureIndex, [face])
      else bucket.push(face)
    }
    for (const [materialIndex, faces] of batches) {
      const positions = [],
        normals = [],
        textureCoordinates = [],
        indices = []
      for (const face of faces) {
        const base = positions.length / 3
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = node.vertices[face.indices[corner]]
          if (vertex === undefined)
            throw new RangeError(`XBF face in node «${node.name}» references a missing vertex`)
          positions.push(...vertex.position)
          normals.push(...vertex.normal)
          textureCoordinates.push(...face.uvs[corner])
        }
        indices.push(base, base + 1, base + 2)
      }
      if (indices.length === 0) continue
      const meshId = `xbf-mesh-${meshes.length}`,
        primitiveId = `xbf-primitive-${primitives.length}`
      decodedBytes +=
        positions.length * 4 +
        normals.length * 4 +
        textureCoordinates.length * 4 +
        indices.length * 4
      if (decodedBytes > budget.maxScalarBytes)
        throw new RangeError('XBF decoded geometry exceeds maxScalarBytes')
      meshes.push({ id: meshId, name: node.name, primitiveIds: [primitiveId] })
      primitives.push({
        id: primitiveId,
        topology: 'triangles',
        positions: Float32Array.from(positions),
        normals: Float32Array.from(normals),
        textureCoordinates: Float32Array.from(textureCoordinates),
        indices: Uint32Array.from(indices),
        ...(materialIndex < parsed.textures.length
          ? { materialId: `xbf-material-${materialIndex}` }
          : {}),
      })
      const ids = meshIdsByNode.get(node.index)
      if (ids === undefined) meshIdsByNode.set(node.index, [meshId])
      else ids.push(meshId)
    }
  }
  return { meshes, primitives, meshIdsByNode, decodedBytes }
}

function animationClips(parsed) {
  const animatedNodes = parsed.nodes.filter(node => node.keyAnimation || node.vertexAnimation)
  const channels = (firstFrame, lastFrame) =>
    animatedNodes.flatMap(node => [
      ...(node.keyAnimation
        ? [{ target: `xbf-node-${node.index}`, kind: 'transform', firstFrame, lastFrame }]
        : []),
      ...(node.vertexAnimation
        ? [{ target: `xbf-node-${node.index}`, kind: 'vertex-morph', firstFrame, lastFrame }]
        : []),
    ])
  if (parsed.fx.clips.length > 0)
    return parsed.fx.clips.map((clip, index) => {
      const firstFrame = Math.min(...clip.ranges.map(range => range.startFrame))
      const lastFrame = Math.max(...clip.ranges.map(range => range.endFrame))
      return {
        id: `xbf-animation-${index}`,
        name: clip.name,
        kind: firstFrame === lastFrame ? 'rest-pose' : 'animation',
        provenance: 'direct',
        frames: lastFrame - firstFrame + 1,
        frameRate: FRAME_RATE,
        channels: channels(firstFrame, lastFrame),
      }
    })
  const lastFrame = Math.max(
    0,
    ...animatedNodes.map(node =>
      Math.max(node.keyAnimation?.frameCount ?? 0, node.vertexAnimation?.frameCount ?? 0),
    ),
  )
  return lastFrame === 0
    ? []
    : [
        {
          id: 'xbf-animation-0',
          name: 'Emperor XBF animation',
          kind: lastFrame === 1 ? 'rest-pose' : 'animation',
          provenance: 'direct',
          frames: lastFrame + 1,
          frameRate: FRAME_RATE,
          channels: channels(0, lastFrame),
        },
      ]
}

function modelSources(parsed, budget) {
  const decoded = geometry(parsed, budget),
    materials = materialRecords(parsed),
    animations = animationClips(parsed)
  const resources = [...new Set(materials.flatMap(material => material.resources))]
  const nativeNodes = parsed.nodes.map(node => ({
    id: `xbf-node-${node.index}`,
    name: node.name,
    childIds: node.children.map(child => `xbf-node-${child.index}`),
    meshIds: decoded.meshIdsByNode.get(node.index) ?? [],
    transform: node.transform,
  }))
  // Preserve the pre-depth contract for a legal structure-only XBF: this is a presentation root,
  // deliberately named as such, not a claim that the file contained a native hierarchy node.
  const nodes =
    nativeNodes.length > 0
      ? nativeNodes
      : [
          {
            id: 'xbf-root',
            name: 'Emperor XBF structural root',
            childIds: [],
            meshIds: [],
            transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          },
        ]
  const dataSources = {
    'common.view/model-scene-source': createModelSceneSource({
      info: {
        scenes: 1,
        nodes: nodes.length,
        meshes: decoded.meshes.length,
        primitives: decoded.primitives.length,
        materials: materials.length,
        textures: resources.length,
        animations: animations.length,
        geometryAccess: decoded.primitives.length > 0 ? 'decoded' : 'metadata-only',
      },
      nodes,
      meshes: decoded.meshes,
      primitives: decoded.primitives,
    }),
  }
  if (resources.length > 0)
    dataSources['common.view/model-resource-refs-source'] = createModelResourceRefsSource({
      references: resources.map(id => ({ id, role: 'texture', provenance: 'reference-only' })),
    })
  if (materials.length > 0)
    dataSources['common.view/model-material-source'] = createModelMaterialSource({
      materials: materials.map(({ id, name }) => ({ id, name })),
    })
  if (animations.length > 0)
    dataSources['common.view/model-animation-source'] = createModelAnimationSource({
      clips: animations,
    })
  return { dataSources, decoded, materials, animations, resources, nodes }
}

function treeNode(node) {
  return {
    kind: 'node',
    label: node.name,
    preview: `${node.vertices.length} vertices, ${node.faces.length} faces`,
    children: node.children.map(treeNode),
  }
}

function structurallyValid(prefix) {
  if (prefix.byteLength < HEADER_BYTES) return 'invalid'
  const view = dataView(prefix)
  if (view.getInt32(0, true) !== VERSION) return 'invalid'
  const fxDataSize = view.getInt32(4, true)
  if (fxDataSize < 0 || fxDataSize > MAX_PROBE_SECTION_BYTES) return 'invalid'
  const textureSizeOffset = HEADER_BYTES + fxDataSize
  if (textureSizeOffset + 4 > prefix.byteLength) return 'bounded-header'
  const textureDataSize = view.getUint32(textureSizeOffset, true)
  if (textureDataSize > MAX_PROBE_SECTION_BYTES) return 'invalid'
  return textureDataSize <= prefix.byteLength - textureSizeOffset - 4
    ? 'complete-structure'
    : 'bounded-header'
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'emperor-xbf', label: 'Emperor: Battle for Dune XBF model' }),
  async detect(prefix) {
    const state = structurallyValid(prefix)
    if (state === 'complete-structure')
      return { confidence: 0.995, kind: 'structure', note: 'XBF v1 bounded structure' }
    if (state === 'bounded-header')
      return { confidence: 0.8, kind: 'magic', note: 'XBF v1 bounded header' }
    return { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const parsed = parseXbf(bytes, context.budget, context.signal)
    const projected = modelSources(parsed, context.budget)
    const geometryState = projected.decoded.primitives.length > 0 ? 'preserved' : 'lost'
    const materialState = projected.materials.length > 0 ? 'preserved' : 'lost'
    const animationState = projected.animations.length > 0 ? 'preserved' : 'lost'
    const hasAnimationSamples = parsed.nodes.some(node => node.keyAnimation || node.vertexAnimation)
    const hasSurfaceAttributes = parsed.nodes.some(
      node => (node.flags & (FLAG_PRELIGHT | FLAG_SMOOTHING_GROUPS)) !== 0,
    )
    return {
      summary: {
        format: 'emperor-xbf',
        version: parsed.version,
        nodes: projected.nodes.length,
        meshes: projected.decoded.meshes.length,
        primitives: projected.decoded.primitives.length,
        materials: projected.materials.length,
        textures: parsed.textures,
        resourceReferences: projected.resources.length,
        animations: projected.animations.length,
        fxDataBytes: parsed.fxDataSize,
        textureTableBytes: parsed.textureDataSize,
        undecodedNodeBytes: 0,
        hasEndMarker: parsed.hasEndMarker,
        geometryAccess: geometryState === 'preserved' ? 'decoded' : 'metadata-only',
      },
      metadata: [
        {
          id: 'emperor-xbf-model',
          label: 'Emperor XBF model',
          entries: [
            { key: 'version', value: parsed.version },
            { key: 'fxDataBytes', value: parsed.fxDataSize },
            { key: 'textureTableBytes', value: parsed.textureDataSize },
            { key: 'nodes', value: projected.nodes.length },
            { key: 'meshes', value: projected.decoded.meshes.length },
            { key: 'materials', value: projected.materials.length },
            { key: 'animations', value: projected.animations.length },
            {
              key: 'geometryAccess',
              value: geometryState === 'preserved' ? 'decoded' : 'metadata-only',
            },
          ],
        },
      ],
      traits: [
        ...(projected.decoded.primitives.length === 0
          ? []
          : [
              {
                id: 'model.geometry',
                parameters: {
                  meshes: projected.decoded.meshes.length,
                  primitives: projected.decoded.primitives.length,
                },
              },
            ]),
        ...(projected.materials.length === 0
          ? []
          : [{ id: 'model.materials', parameters: { count: projected.materials.length } }]),
        ...(projected.resources.length === 0
          ? []
          : [{ id: 'model.textures', parameters: { count: projected.resources.length } }]),
        ...(projected.animations.length === 0
          ? []
          : [{ id: 'model.animations', parameters: { count: projected.animations.length } }]),
        { id: 'structure.hierarchy', parameters: { nodes: projected.nodes.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      projectionReceipt: createProjectionReceipt({
        adapter: { id: ID, version: '1.0.0' },
        subjectRevision: context.input.revisions.revision,
        companions: [],
        basis: { handedness: 'left', upAxis: 'y', forwardAxis: '+z', unit: 'source-unit' },
        planes: [
          {
            planeId: 'structure',
            state: parsed.nodes.length > 0 ? 'preserved' : 'lost',
            note:
              parsed.nodes.length > 0
                ? 'recursive child counts and local transforms'
                : 'the artifact declares no native node; model-scene carries only its labelled presentation root',
          },
          {
            planeId: 'geometry',
            state: geometryState,
            note: `${projected.decoded.primitives.length} triangle primitive(s)`,
          },
          {
            planeId: 'materials',
            state: materialState,
            note: `${projected.materials.length} native and FX material definition(s)`,
          },
          {
            planeId: 'resources',
            state: projected.resources.length > 0 ? 'preserved' : 'lost',
            note: `${projected.resources.length} logical texture reference(s)`,
          },
          {
            planeId: 'animation-index',
            state: animationState,
            note: `${projected.animations.length} FX clip(s) with native frame ranges and driven node ids`,
          },
          {
            planeId: 'animation-samples',
            state: hasAnimationSamples ? 'lost' : 'preserved',
            note: hasAnimationSamples
              ? 'native key matrices and per-frame vertex samples are bounded but not published by an admitted source'
              : 'the file declares no key or vertex animation payload',
          },
          {
            planeId: 'surface-attributes',
            state: hasSurfaceAttributes ? 'lost' : 'preserved',
            note: hasSurfaceAttributes
              ? 'prelight colours and smoothing groups are bounded but have no admitted live facet'
              : 'the file declares neither prelight colours nor smoothing groups',
          },
          {
            planeId: 'effects',
            state: parsed.fx.emitters.length > 0 ? 'lost' : 'preserved',
            note:
              parsed.fx.emitters.length > 0
                ? `${parsed.fx.emitters.length} particle definition(s) inventory only; no admitted effect facet exists`
                : 'no particle definition decoded',
          },
        ],
        evidence: [
          {
            kind: 'observed',
            statement: `${projected.nodes.length} node(s), ${projected.decoded.meshes.length} mesh(es), ${projected.materials.length} material(s), ${projected.animations.length} animation clip(s) decoded`,
            bytesRead: BigInt(bytes.byteLength),
          },
          {
            kind: 'declared',
            statement:
              'the retail XBF reader exposes native Y-up values without a physical-unit claim',
            source: 'emperor-xbf-v1-container',
          },
          ...parsed.diagnostics.map(item => ({
            kind: 'diagnostic',
            code: item.code,
            message: item.message,
          })),
        ],
        confidence: geometryState === 'preserved' ? 'high' : 'partial',
      }),
      dataSources: {
        ...projected.dataSources,
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'Emperor XBF',
          preview: `${projected.nodes.length} nodes, ${projected.decoded.meshes.length} meshes`,
          children: parsed.roots.map(treeNode),
        }),
      },
      diagnostics: parsed.diagnostics,
      maxDecodedBytes: BigInt(
        projected.decoded.decodedBytes + parsed.fxDataSize + parsed.textureDataSize,
      ),
      unsupportedFeatures: [
        ...(hasAnimationSamples ? ['animation-samples'] : []),
        ...(hasSurfaceAttributes ? ['prelight-and-smoothing-groups'] : []),
        ...(parsed.fx.emitters.length > 0 ? ['fx-runtime-execution'] : []),
        'model-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
