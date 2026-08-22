import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'
// FPackageFileSummary/FName/FObjectImport/FObjectExport layout follows Epic's public UE4
// serialization declarations and the independently maintained UEViewer package reader:
// https://github.com/gildor2/UEViewer/blob/master/Unreal/UnPackage.h
// This port deliberately supports the versioned UE4 layout only; it does not guess UE5's
// package-saved-hash, unversioned-property, Zen package, or split UEXP/UBULK layouts.

export const PACKAGE_TAG = 0x9e2a83c1
const IMPORT_BYTES = 28
const EXPORT_MIN_BYTES = 44
const MAX_TABLE_COUNT = 1_000_000

function range(bytes, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0)
    throw new TypeError(`Unreal package ${label} range is invalid`)
  if (offset + length > bytes.byteLength)
    throw new RangeError(`Unreal package ${label} is truncated`)
}

function count(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_TABLE_COUNT)
    throw new TypeError(`Unreal package ${label} count is invalid`)
  return value
}

function tableRange(bytes, offset, tableCount, stride, headerSize, label) {
  if (tableCount === 0) return
  const size = tableCount * stride
  if (!Number.isSafeInteger(size) || offset < 0 || offset + size > headerSize)
    throw new RangeError(`Unreal package ${label} table is outside the header`)
  range(bytes, offset, size, `${label} table`)
}

function fString(bytes, view, offset, limit, label) {
  range(bytes, offset, 4, label)
  const length = view.getInt32(offset, true)
  if (length <= 0 || length > 65_536)
    throw new TypeError(`Unreal package ${label} FString length is unsupported`)
  const end = offset + 4 + length
  if (end > limit || end > bytes.byteLength)
    throw new RangeError(`Unreal package ${label} FString is truncated`)
  const raw = bytes.subarray(offset + 4, end)
  if (raw[raw.length - 1] !== 0)
    throw new TypeError(`Unreal package ${label} FString lacks a terminator`)
  const value = new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(0, -1))
  if (/\0/u.test(value)) throw new TypeError(`Unreal package ${label} FString contains NUL`)
  return Object.freeze({ value, next: end, scalarBytes: raw.byteLength - 1 })
}

function fname(view, offset, names, label) {
  const index = view.getInt32(offset, true)
  const number = view.getInt32(offset + 4, true)
  if (index < 0 || index >= names.length || number < 0)
    throw new TypeError(`Unreal package ${label} FName is invalid`)
  const base = names[index]
  return number === 0 ? base : `${base}_${number - 1}`
}

function safeI64(view, offset, label) {
  const value = view.getBigInt64(offset, true)
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError(`Unreal package ${label} is outside the safe integer range`)
  return Number(value)
}

function ensureBudgets(budget, nodes, scalarBytes) {
  if (budget.maxDepth < 4) throw new RangeError('Unreal package exceeds maxDepth budget')
  if (nodes > budget.maxNodes) throw new RangeError('Unreal package tables exceed maxNodes budget')
  if (scalarBytes > budget.maxScalarBytes)
    throw new RangeError('Unreal package metadata exceeds maxScalarBytes budget')
}

export function hasPackageTag(bytes) {
  return (
    bytes.byteLength >= 4 &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === PACKAGE_TAG
  )
}

export function packageClassProbe(prefix, classNames) {
  if (!hasPackageTag(prefix))
    return { confidence: 0, kind: 'magic', note: 'unreal-package-tag-missing' }
  const text = new TextDecoder('latin1').decode(prefix)
  const matched = classNames.find(name => text.includes(`${name}\0`))
  return matched === undefined
    ? { confidence: 0, kind: 'structure', note: 'unreal-export-class-missing' }
    : { confidence: 0.995, kind: 'structure', note: `unreal-export-${matched}` }
}

export function parseUnrealPackage(bytes, budget) {
  if (!hasPackageTag(bytes)) throw new TypeError('Unreal package tag is missing')
  range(bytes, 0, 64, 'summary')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const legacyFileVersion = view.getInt32(4, true)
  if (legacyFileVersion > -1 || legacyFileVersion <= -8)
    throw new TypeError(`Unreal package legacy version ${legacyFileVersion} is unsupported`)
  const legacyUE3FileVersion = view.getInt32(8, true)
  const ue4FileVersion = view.getInt32(12, true)
  const ue4LicenseeVersion = view.getInt32(16, true)
  const customVersionCount = count(view.getInt32(20, true), 'custom version')
  let cursor = 24 + customVersionCount * 20
  range(bytes, 20, 4 + customVersionCount * 20 + 4, 'custom version table')
  const totalHeaderSize = view.getInt32(cursor, true)
  cursor += 4
  if (totalHeaderSize < cursor || totalHeaderSize > bytes.byteLength)
    throw new RangeError('Unreal package total header size is invalid')
  const folder = fString(bytes, view, cursor, totalHeaderSize, 'folder name')
  cursor = folder.next
  range(bytes, cursor, 48, 'summary tables')
  const packageFlags = view.getUint32(cursor, true)
  cursor += 4
  const nameCount = count(view.getInt32(cursor, true), 'name')
  cursor += 4
  const nameOffset = view.getInt32(cursor, true)
  cursor += 4
  const gatherableTextDataCount = count(view.getInt32(cursor, true), 'gatherable text')
  cursor += 4
  const gatherableTextDataOffset = view.getInt32(cursor, true)
  cursor += 4
  const exportCount = count(view.getInt32(cursor, true), 'export')
  cursor += 4
  const exportOffset = view.getInt32(cursor, true)
  cursor += 4
  const importCount = count(view.getInt32(cursor, true), 'import')
  cursor += 4
  const importOffset = view.getInt32(cursor, true)
  cursor += 4
  const dependsOffset = view.getInt32(cursor, true)

  if (gatherableTextDataCount !== 0 || gatherableTextDataOffset !== 0)
    throw new TypeError('Unreal package gatherable-text tables are not supported')
  if (nameCount === 0 || exportCount === 0 || importCount === 0)
    throw new TypeError('Unreal package requires name, import, and export tables')
  if (nameOffset < cursor || importOffset <= nameOffset || exportOffset <= importOffset)
    throw new RangeError('Unreal package table offsets are not ordered')
  if (dependsOffset <= exportOffset || dependsOffset > totalHeaderSize)
    throw new RangeError('Unreal package dependency offset is invalid')

  const importStride = (exportOffset - importOffset) / importCount
  const exportStride = (dependsOffset - exportOffset) / exportCount
  if (!Number.isInteger(importStride) || importStride !== IMPORT_BYTES)
    throw new TypeError(`Unreal package import stride ${importStride} is unsupported`)
  if (!Number.isInteger(exportStride) || exportStride < EXPORT_MIN_BYTES || exportStride > 256)
    throw new TypeError(`Unreal package export stride ${exportStride} is unsupported`)
  tableRange(bytes, importOffset, importCount, importStride, totalHeaderSize, 'import')
  tableRange(bytes, exportOffset, exportCount, exportStride, totalHeaderSize, 'export')

  const names = []
  let scalarBytes = folder.scalarBytes
  cursor = nameOffset
  for (let index = 0; index < nameCount; index += 1) {
    const entry = fString(bytes, view, cursor, importOffset, `name ${index}`)
    names.push(entry.value)
    scalarBytes += entry.scalarBytes
    cursor = entry.next
    range(bytes, cursor, 4, `name ${index} hash`)
    cursor += 4
  }
  if (cursor > importOffset) throw new RangeError('Unreal package name table overlaps imports')

  const imports = []
  for (let index = 0; index < importCount; index += 1) {
    const offset = importOffset + index * importStride
    imports.push(
      Object.freeze({
        index,
        classPackage: fname(view, offset, names, `import ${index} class package`),
        className: fname(view, offset + 8, names, `import ${index} class`),
        outerIndex: view.getInt32(offset + 16, true),
        objectName: fname(view, offset + 20, names, `import ${index} object`),
      }),
    )
  }

  const exports = []
  for (let index = 0; index < exportCount; index += 1) {
    const offset = exportOffset + index * exportStride
    const classIndex = view.getInt32(offset, true)
    if (classIndex >= 0 || -classIndex > imports.length)
      throw new TypeError(`Unreal package export ${index} class index is invalid`)
    const serialSize = safeI64(view, offset + 28, `export ${index} serial size`)
    const serialOffset = safeI64(view, offset + 36, `export ${index} serial offset`)
    if (serialSize === 0 || serialOffset < totalHeaderSize || serialOffset + serialSize > bytes.byteLength)
      throw new RangeError(`Unreal package export ${index} payload is outside the file`)
    exports.push(
      Object.freeze({
        index,
        classIndex,
        className: imports[-classIndex - 1].objectName,
        objectName: fname(view, offset + 16, names, `export ${index} object`),
        serialSize,
        serialOffset,
      }),
    )
  }

  range(bytes, dependsOffset, exportCount * 4, 'dependency table')
  cursor = dependsOffset
  const dependencies = []
  for (let index = 0; index < exportCount; index += 1) {
    const dependencyCount = count(view.getInt32(cursor, true), `export ${index} dependency`)
    cursor += 4
    range(bytes, cursor, dependencyCount * 4, `export ${index} dependencies`)
    if (cursor + dependencyCount * 4 > totalHeaderSize)
      throw new RangeError('Unreal package dependency table exceeds the header')
    const row = []
    for (let dependency = 0; dependency < dependencyCount; dependency += 1) {
      const packageIndex = view.getInt32(cursor, true)
      if (packageIndex < -imports.length || packageIndex > exports.length)
        throw new TypeError('Unreal package dependency index is invalid')
      row.push(packageIndex)
      cursor += 4
    }
    dependencies.push(Object.freeze(row))
  }
  const nodes = 1 + names.length + imports.length + exports.length + dependencies.length
  ensureBudgets(budget, nodes, scalarBytes)
  return Object.freeze({
    summary: Object.freeze({
      legacyFileVersion,
      legacyUE3FileVersion,
      ue4FileVersion,
      ue4LicenseeVersion,
      totalHeaderSize,
      folderName: folder.value,
      packageFlags,
      nameCount,
      importCount,
      exportCount,
    }),
    names: Object.freeze(names),
    imports: Object.freeze(imports),
    exports: Object.freeze(exports),
    dependencies: Object.freeze(dependencies),
    scalarBytes,
    nodes,
  })
}

export function exportOf(packageModel, classNames) {
  const entry = packageModel.exports.find(candidate => classNames.includes(candidate.className))
  if (entry === undefined)
    throw new TypeError(`Unreal package has no supported ${classNames.join('/')} export`)
  return entry
}

export function exportBytes(bytes, entry) {
  return bytes.subarray(entry.serialOffset, entry.serialOffset + entry.serialSize)
}

export function packageTree(packageModel, entry, children = []) {
  return createTreeDataSource({
    kind: 'package',
    label: entry.objectName,
    preview: `${entry.className}, ${entry.serialSize} export bytes`,
    children: [
      {
        kind: 'summary',
        label: 'FPackageFileSummary',
        preview: `UE4 ${packageModel.summary.ue4FileVersion}, ${packageModel.summary.folderName}`,
      },
      {
        kind: 'table',
        label: 'Name map',
        preview: `${packageModel.names.length} entries`,
      },
      {
        kind: 'table',
        label: 'Import map',
        preview: `${packageModel.imports.length} entries`,
      },
      {
        kind: 'table',
        label: 'Export map',
        preview: `${packageModel.exports.length} entries`,
      },
      ...children,
    ],
  })
}

export const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

const ID = 'org.modkitx/unreal-uasset'

function half(value) {
  const sign = value & 0x8000 ? -1 : 1
  const exponent = (value >>> 10) & 0x1f
  const fraction = value & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

function need(bytes, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength)
    throw new RangeError(`Unreal StaticMesh ${label} is truncated`)
}

function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < positions.length; offset += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[offset + axis])
      max[axis] = Math.max(max[axis], positions[offset + axis])
    }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function normalsOf(positions, indices) {
  const normals = new Float32Array(positions.length)
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ia = indices[offset] * 3
    const ib = indices[offset + 1] * 3
    const ic = indices[offset + 2] * 3
    const ax = positions[ib] - positions[ia]
    const ay = positions[ib + 1] - positions[ia + 1]
    const az = positions[ib + 2] - positions[ia + 2]
    const bx = positions[ic] - positions[ia]
    const by = positions[ic + 1] - positions[ia + 1]
    const bz = positions[ic + 2] - positions[ia + 2]
    const nx = ay * bz - az * by
    const ny = az * bx - ax * bz
    const nz = ax * by - ay * bx
    const length = Math.hypot(nx, ny, nz)
    if (!(length > 0)) throw new TypeError('Unreal StaticMesh triangle is degenerate')
    for (const index of [ia, ib, ic]) {
      normals[index] += nx / length
      normals[index + 1] += ny / length
      normals[index + 2] += nz / length
    }
  }
  return normals
}

// UE4.27 FStaticMeshLODResources legacy profile: strip flags, sections,
// FPositionVertexBuffer, FStaticMeshVertexBuffer, FColorVertexBuffer, and the primary
// FRawStaticIndexBuffer. UE5 streamed/Nanite resources are rejected rather than guessed.
function parseStaticMesh(bytes, budget) {
  need(bytes, 0, 64, 'LOD resource')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let cursor = 8 // tagged-property terminator FName(None)
  const serverDataStripped = bytes[cursor]
  const editorDataStripped = bytes[cursor + 1]
  cursor += 2
  if (serverDataStripped !== 1 || editorDataStripped !== 0)
    throw new TypeError('Unreal StaticMesh strip flags are unsupported')
  const sectionCount = view.getUint32(cursor, true)
  cursor += 4
  if (sectionCount < 1 || sectionCount > 65_536)
    throw new TypeError('Unreal StaticMesh section count is invalid')
  if (sectionCount + 8 > budget.maxNodes)
    throw new RangeError('Unreal StaticMesh records exceed maxNodes budget')
  need(bytes, cursor, sectionCount * 28 + 4, 'section table')
  const sections = []
  for (let index = 0; index < sectionCount; index += 1) {
    const values = Array.from({ length: 7 }, (_, field) => view.getUint32(cursor + field * 4, true))
    cursor += 28
    sections.push(
      Object.freeze({
        materialIndex: values[0],
        firstIndex: values[1],
        triangles: values[2],
        minVertex: values[3],
        maxVertex: values[4],
      }),
    )
  }
  cursor += 4

  need(bytes, cursor, 16, 'position buffer header')
  const positionStride = view.getUint32(cursor, true)
  const positionVertices = view.getUint32(cursor + 4, true)
  const positionArrayStride = view.getUint32(cursor + 8, true)
  const positionArrayCount = view.getUint32(cursor + 12, true)
  cursor += 16
  if (
    positionStride !== 12 ||
    positionArrayStride !== 12 ||
    positionVertices < 3 ||
    positionVertices !== positionArrayCount
  )
    throw new TypeError('Unreal StaticMesh position buffer profile is unsupported')
  need(bytes, cursor, positionVertices * 12, 'positions')
  const positions = new Float32Array(positionVertices * 3)
  for (let index = 0; index < positions.length; index += 1) {
    const value = view.getFloat32(cursor + index * 4, true)
    if (!Number.isFinite(value)) throw new TypeError('Unreal StaticMesh position is not finite')
    positions[index] = value
  }
  cursor += positionVertices * 12

  need(bytes, cursor, 30, 'vertex buffer header')
  const textureCoordinateSets = view.getUint16(cursor, true)
  const fullPrecisionUvs = view.getUint32(cursor + 2, true)
  const firstStride = view.getUint32(cursor + 6, true)
  const firstCount = view.getUint32(cursor + 10, true)
  const highPrecisionTangents = view.getUint32(cursor + 14, true)
  const secondPrecisionFlag = view.getUint32(cursor + 18, true)
  const vertexStride = view.getUint32(cursor + 22, true)
  const vertexCount = view.getUint32(cursor + 26, true)
  cursor += 30
  if (
    textureCoordinateSets !== 1 ||
    fullPrecisionUvs !== 1 ||
    highPrecisionTangents !== 0 ||
    secondPrecisionFlag !== 0 ||
    firstStride !== 12 ||
    vertexStride !== 12 ||
    firstCount !== positionVertices ||
    vertexCount !== positionVertices
  )
    throw new TypeError('Unreal StaticMesh vertex-buffer precision profile is unsupported')
  need(bytes, cursor, vertexCount * vertexStride, 'tangent/UV vertices')
  const textureCoordinates = new Float32Array(vertexCount * 2)
  for (let index = 0; index < vertexCount; index += 1) {
    const offset = cursor + index * vertexStride + 8
    textureCoordinates[index * 2] = half(view.getUint16(offset, true))
    textureCoordinates[index * 2 + 1] = half(view.getUint16(offset + 2, true))
  }
  cursor += vertexCount * vertexStride

  need(bytes, cursor, 22, 'color/index buffers')
  const colorStripFlags = view.getUint16(cursor, true)
  const colorStride = view.getUint32(cursor + 2, true)
  const colorCount = view.getUint32(cursor + 6, true)
  cursor += 10
  if (colorStripFlags !== 1 || colorStride !== 0 || colorCount !== 0)
    throw new TypeError('Unreal StaticMesh color buffer profile is unsupported')
  const index32Bit = view.getUint32(cursor, true)
  const indexArrays = view.getUint32(cursor + 4, true)
  const indexBytes = view.getUint32(cursor + 8, true)
  cursor += 12
  if (index32Bit !== 0 || indexArrays !== 1 || indexBytes < 6 || indexBytes % 2 !== 0)
    throw new TypeError('Unreal StaticMesh index buffer profile is unsupported')
  need(bytes, cursor, indexBytes, 'indices')
  const indices = new Uint32Array(indexBytes / 2)
  for (let index = 0; index < indices.length; index += 1) {
    indices[index] = view.getUint16(cursor + index * 2, true)
    if (indices[index] >= vertexCount)
      throw new TypeError('Unreal StaticMesh index references a missing vertex')
  }
  if (indices.length % 3 !== 0)
    throw new TypeError('Unreal StaticMesh index count is not triangular')
  for (const section of sections)
    if (
      section.firstIndex + section.triangles * 3 > indices.length ||
      section.minVertex > section.maxVertex ||
      section.maxVertex >= vertexCount
    )
      throw new TypeError('Unreal StaticMesh section range is invalid')
  const normals = normalsOf(positions, indices)
  const decodedBytes =
    positions.byteLength + indices.byteLength + normals.byteLength + textureCoordinates.byteLength
  if (decodedBytes > budget.maxScalarBytes)
    throw new RangeError('Unreal StaticMesh decoded geometry exceeds maxScalarBytes budget')
  return Object.freeze({
    positions,
    indices,
    normals,
    textureCoordinates,
    sections: Object.freeze(sections),
    bounds: boundsOf(positions),
    decodedBytes,
  })
}

function modelSource(exportEntry, mesh) {
  const primitive = Object.freeze({
    id: 'primitive-0',
    topology: 'triangles',
    positions: mesh.positions,
    indices: mesh.indices,
    normals: mesh.normals,
    textureCoordinates: mesh.textureCoordinates,
    bounds: mesh.bounds,
  })
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: mesh.sections.length,
      textures: 0,
      animations: 0,
      bounds: mesh.bounds,
      geometryAccess: 'decoded',
    },
    nodes: [
      {
        id: 'root',
        name: exportEntry.objectName,
        childIds: [],
        meshIds: ['mesh-0'],
        transform: IDENTITY,
      },
    ],
    meshes: [{ id: 'mesh-0', name: exportEntry.objectName, primitiveIds: [primitive.id] }],
    primitives: [primitive],
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'unreal-uasset', label: 'Unreal Engine package model' }),
  async detect(prefix) {
    return packageClassProbe(prefix, ['StaticMesh'])
  },
  async inspect(bytes, context) {
    const packageModel = parseUnrealPackage(bytes, context.budget)
    const exportEntry = exportOf(packageModel, ['StaticMesh'])
    const mesh = parseStaticMesh(exportBytes(bytes, exportEntry), context.budget)
    const scene = modelSource(exportEntry, mesh)
    const tree = packageTree(packageModel, exportEntry, [
      {
        kind: 'mesh',
        label: 'FStaticMeshLODResources[0]',
        preview: `${mesh.positions.length / 3} vertices, ${mesh.indices.length / 3} triangles`,
      },
    ])
    return {
      summary: {
        format: 'unreal-uasset',
        engine: `UE4/${packageModel.summary.ue4FileVersion}`,
        exportClass: exportEntry.className,
        exportName: exportEntry.objectName,
        vertices: mesh.positions.length / 3,
        triangles: mesh.indices.length / 3,
        sections: mesh.sections.length,
        bounds: mesh.bounds,
      },
      metadata: [
        {
          id: 'unreal-static-mesh',
          label: 'Unreal StaticMesh',
          entries: [
            { key: 'folder', value: packageModel.summary.folderName },
            { key: 'ue4FileVersion', value: packageModel.summary.ue4FileVersion },
            { key: 'serialOffset', value: exportEntry.serialOffset },
            { key: 'serialSize', value: exportEntry.serialSize },
            { key: 'vertices', value: mesh.positions.length / 3 },
            { key: 'triangles', value: mesh.indices.length / 3 },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: {
            vertices: mesh.positions.length / 3,
            triangles: mesh.indices.length / 3,
            topology: 'triangles',
          },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/model-scene-source': scene,
      },
      maxDecodedBytes: mesh.decodedBytes,
      unsupportedFeatures: [
        'skeletal-meshes-and-animation',
        'uexp-and-ubulk-sidecars',
        'ue5-streamed-geometry-and-nanite',
        'high-precision-tangents-and-multiple-uv-sets',
        'package-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
