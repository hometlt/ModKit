import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const request = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'))
const moduleUrl = pathToFileURL(resolve(request.canonicalRoot, request.canonicalModule)).href
const imported = await import(moduleUrl)
const bytes = new Uint8Array(await readFile(request.file))

function source(contract, features, measurements) {
  return {
    contract,
    major: 1,
    state: 'opened',
    features: [...features].sort(),
    measurements,
  }
}

function treeSource({ nodes, maxDepth, kinds }) {
  return source('common.view/tree-data-source', ['root', 'facts', 'children'], {
    nodes,
    maxDepth,
    kinds,
    complete: true,
  })
}

function tableSource({ rows, columns }) {
  return source('common.view/table-data-source', ['shape', 'rows', ...(rows > 0 ? ['cell'] : [])], {
    rows,
    rowsKnown: true,
    columns,
    typedColumns: columns,
    firstPageRows: Math.min(rows, 1),
  })
}

function textSource(text, encoding = 'utf-8') {
  const lines = text === '' ? 0 : text.split(/\r\n|\r|\n/u).length
  return source('common.view/text-data-source', ['info', 'slice'], {
    encoding,
    lines,
    linesKnown: true,
    sliceLines: Math.min(lines, 16),
    sliceNonEmpty: text.length > 0,
  })
}

function result(formatId, sources, extra = {}) {
  const contracts = sources.map(item => item.contract).sort()
  return {
    formatId,
    declaredSources: contracts,
    actualSources: contracts,
    sources: [...sources].sort((left, right) => left.contract.localeCompare(right.contract)),
    operations: [],
    geometryAccess: 'unavailable',
    features: contracts.map(contract => `source:${contract}`).sort(),
    ...extra,
  }
}

async function modelResult() {
  const candidate = imported[request.canonicalExport]
  if (candidate === undefined) {
    throw new TypeError(`canonical export is missing: ${request.canonicalExport}`)
  }
  const codec = request.canonicalFactory === true ? candidate() : candidate
  if (typeof codec?.parse !== 'function')
    throw new TypeError('canonical model codec has no parse()')
  const model = await codec.parse(bytes, request.file)
  const primitiveCount = Array.isArray(model.meshes)
    ? model.meshes.reduce((total, mesh) => total + (mesh?.positions?.length > 0 ? 1 : 0), 0)
    : 0
  const summary = {
    scenes: Number.isSafeInteger(model.metadata?.sceneCount) ? model.metadata.sceneCount : 1,
    nodes: Number.isSafeInteger(model.metadata?.nodeCount) ? model.metadata.nodeCount : 0,
    meshes: Array.isArray(model.meshes) ? model.meshes.length : 0,
    primitives: primitiveCount,
    materials: Array.isArray(model.materials) ? model.materials.length : 0,
    textures: Array.isArray(model.metadata?.textures) ? model.metadata.textures.length : 0,
    animations: Array.isArray(model.animations) ? model.animations.length : 0,
  }
  const geometry = Array.isArray(model.meshes)
    ? model.meshes.some(
        mesh => mesh?.positions instanceof Float32Array && mesh.positions.length >= 3,
      )
    : false
  const firstMesh = Array.isArray(model.meshes) ? model.meshes[0] : undefined
  const decodedVertices =
    firstMesh?.positions instanceof Float32Array ? Math.floor(firstMesh.positions.length / 3) : 0
  const decodedIndices = firstMesh?.indices?.length ?? 0
  const sources = [
    source(
      'common.view/model-scene-source',
      ['info', 'nodes', 'meshes', ...(geometry ? ['primitive'] : [])],
      { ...summary, decodedGeometry: geometry, decodedVertices, decodedIndices },
    ),
  ]
  return result(model.format ?? request.format, sources, {
    summary,
    geometryAccess: geometry ? 'decoded' : 'metadata-only',
    features: [
      'source:common.view/model-scene-source',
      ...(geometry ? ['geometry:decoded'] : []),
    ].sort(),
  })
}

async function imageResult() {
  const candidate = imported[request.canonicalExport] ?? imported.default
  if (typeof candidate?.decode !== 'function')
    throw new TypeError('canonical image codec has no decode()')
  const image = await candidate.decode(bytes)
  return result(candidate.id ?? request.format, [
    source('common.view/raster-image-source', ['info', 'encoded', 'decoded-region'], {
      width: image.width,
      height: image.height,
      channels: request.canonicalChannels ?? 4,
      decodedAccess: true,
      decodedBytes: Math.min(image.pixels.byteLength, 4),
      encodedNonEmpty: bytes.byteLength > 0,
      encodedMediaType: request.canonicalMediaType,
    }),
  ])
}

function zipResult() {
  const reader = imported.ZipReader.openSync(bytes)
  try {
    const entries = reader.list()
    const extracted = entries[0] === undefined ? new Uint8Array() : reader.read(entries[0])
    return result('zip', [
      source(
        'common.view/namespace-entry-source',
        ['list', 'open-entry', 'extract-bytes', 'product-reopen'],
        {
          entries: entries.length,
          files: entries.length,
          directories: 0,
          complete: true,
          extractedBytes: extracted.byteLength,
          extractedNonEmpty: extracted.byteLength > 0,
          productReopenCompleted: true,
        },
      ),
      treeSource({
        nodes: 1 + entries.length,
        maxDepth: entries.length > 0 ? 1 : 0,
        kinds: entries.length > 0 ? 2 : 1,
      }),
    ])
  } finally {
    reader.close()
  }
}

async function bigResult() {
  const archive = imported.parseBigArchive(bytes)
  const reader = await imported.default.open(bytes, request.file)
  const extracted =
    archive.entries[0] === undefined ? new Uint8Array() : await reader.get(archive.entries[0].name)
  return result('big', [
    source(
      'common.view/namespace-entry-source',
      ['list', 'open-entry', 'extract-bytes', 'product-reopen'],
      {
        entries: archive.entries.length,
        files: archive.entries.length,
        directories: 0,
        complete: true,
        extractedBytes: extracted.byteLength,
        extractedNonEmpty: extracted.byteLength > 0,
        productReopenCompleted: true,
      },
    ),
    treeSource({
      nodes: 1 + archive.entries.length,
      maxDepth: archive.entries.length > 0 ? 1 : 0,
      kinds: archive.entries.length > 0 ? 2 : 1,
    }),
  ])
}

function cnc3DataResult() {
  const text = new TextDecoder().decode(bytes)
  const document = imported.parseAssetDeclaration(text)
  const nodes =
    1 + document.includes.length + document.assets.length + Number(document.includes.length > 0)
  const kinds = 1 + Number(document.includes.length > 0) * 2 + Number(document.assets.length > 0)
  return result('cnc3-data', [
    treeSource({
      nodes,
      maxDepth: document.includes.length > 0 ? 2 : document.assets.length > 0 ? 1 : 0,
      kinds,
    }),
    tableSource({ rows: document.assets.length, columns: 2 }),
    textSource(text),
  ])
}

function localizationResult() {
  const document = request.format.endsWith('-str')
    ? imported.parseStr(new TextDecoder().decode(bytes))
    : imported.parseCsf(bytes)
  const values = document.entries.flatMap(entry =>
    [entry.value, ...(entry.extraValues ?? [])].map((value, duplicate) => ({
      label: entry.label,
      value,
      duplicate,
      note: duplicate === 0 ? (entry.note ?? '') : '',
    })),
  )
  const rendered = values
    .map(value => [value.label, value.value, value.duplicate, value.note].join('\t'))
    .join('\n')
  return result('cnc3-localization', [
    treeSource({
      nodes: 1 + values.length,
      maxDepth: values.length > 0 ? 1 : 0,
      kinds: values.length > 0 ? 2 : 1,
    }),
    tableSource({ rows: values.length, columns: 4 }),
    textSource(rendered),
  ])
}

async function cnc3MapResult() {
  const refpackUrl = pathToFileURL(
    resolve(request.canonicalRoot, 'extensions/ea/sage/codecs/big/src/refpack.ts'),
  ).href
  const refpack = await import(refpackUrl)
  const map = imported.parseSageMap(bytes, refpack.decodeRefPack)
  const extractedBytes = map.chunks[0]?.byteLength ?? 0
  const heightMaps = map.chunks.filter(
    chunk => chunk.name === 'HeightMapData' && chunk.byteLength >= 12,
  ).length
  const rawChunks = map.chunks.length - heightMaps
  return result('cnc3-map', [
    source(
      'common.view/namespace-entry-source',
      ['list', 'open-entry', 'extract-bytes', 'product-reopen'],
      {
        entries: map.chunks.length,
        files: map.chunks.length,
        directories: 0,
        complete: true,
        extractedBytes,
        extractedNonEmpty: extractedBytes > 0,
        productReopenCompleted: true,
      },
    ),
    treeSource({
      nodes: 3 + map.names.length + map.chunks.length + heightMaps * 3,
      maxDepth: heightMaps > 0 ? 3 : map.names.length + map.chunks.length > 0 ? 2 : 1,
      kinds: 2 + Number(map.names.length > 0) + Number(heightMaps > 0) * 2 + Number(rawChunks > 0),
    }),
  ])
}

function skuDefResult() {
  const text = new TextDecoder().decode(bytes)
  const directives = imported.parseSkuDef(text)
  const references = directives.filter(directive => directive.argument.length > 0)
  return result('sage-skudef', [
    source('common.view/namespace-entry-source', ['list'], {
      entries: references.length,
      files: references.length,
      directories: 0,
      complete: true,
    }),
    treeSource({
      nodes: 1 + directives.length,
      maxDepth: directives.length > 0 ? 1 : 0,
      kinds: 1 + new Set(directives.map(directive => directive.keyword)).size,
    }),
  ])
}

const adapters = {
  model: modelResult,
  image: imageResult,
  zip: zipResult,
  big: bigResult,
  'cnc3-data': cnc3DataResult,
  'cnc3-localization': localizationResult,
  'cnc3-map': cnc3MapResult,
  'sage-skudef': skuDefResult,
}
const adapter = adapters[request.canonicalAdapter ?? 'model']
if (adapter === undefined)
  throw new TypeError(`unknown canonical adapter: ${request.canonicalAdapter}`)
const parityResult = await adapter()
process.stdout.write(`MODKIT_PARITY_RESULT ${JSON.stringify(parityResult)}\n`)
