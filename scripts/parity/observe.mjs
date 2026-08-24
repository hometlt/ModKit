const PAGE_LIMIT = 256

function observation(contract, major, features, measurements) {
  return Object.freeze({
    contract,
    major,
    state: 'opened',
    features: [...features].sort(),
    measurements: Object.fromEntries(
      Object.entries(measurements).sort(([left], [right]) => left.localeCompare(right)),
    ),
  })
}

async function observeNamespace(contract, major, source, options) {
  const entries = []
  let cursor
  do {
    const page = await source.list('', {
      limit: PAGE_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    })
    entries.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== undefined && entries.length < PAGE_LIMIT)
  const features = ['list']
  let extractedBytes = 0
  let productReopenCompleted = false
  const firstFile = entries.find(entry => entry.kind === 'file')
  if (firstFile !== undefined) {
    const lease = await source.openEntry(firstFile.id)
    try {
      if (lease.value !== undefined) features.push('open-entry')
    } finally {
      await lease.release()
    }
    if (options.readNamespaceEntry !== undefined) {
      const evidence = await options.readNamespaceEntry(firstFile)
      extractedBytes = evidence.bytes
      productReopenCompleted = evidence.productReopenCompleted
      features.push('extract-bytes', 'product-reopen')
    }
  }
  return observation(contract, major, features, {
    entries: entries.length,
    files: entries.filter(entry => entry.kind === 'file').length,
    directories: entries.filter(entry => entry.kind === 'directory').length,
    complete: cursor === undefined,
    ...(options.readNamespaceEntry === undefined
      ? {}
      : {
          extractedBytes,
          extractedNonEmpty: extractedBytes > 0,
          productReopenCompleted,
        }),
  })
}

async function observeTree(contract, major, source) {
  const root = await source.root()
  const queue = [{ node: root, depth: 0 }]
  const seen = new Set()
  const kinds = new Set()
  let maxDepth = 0
  let complete = true
  while (queue.length > 0 && seen.size < PAGE_LIMIT) {
    const current = queue.shift()
    if (current === undefined || seen.has(current.node.id)) continue
    seen.add(current.node.id)
    maxDepth = Math.max(maxDepth, current.depth)
    const facts = await source.facts(current.node)
    kinds.add(facts.kind)
    if (!current.node.hasChildren) continue
    let cursor
    do {
      const page = await source.children(current.node, {
        limit: PAGE_LIMIT - seen.size,
        ...(cursor === undefined ? {} : { cursor }),
      })
      for (const node of page.items) queue.push({ node, depth: current.depth + 1 })
      cursor = page.nextCursor
      if (seen.size + queue.length >= PAGE_LIMIT && cursor !== undefined) complete = false
    } while (cursor !== undefined && seen.size + queue.length < PAGE_LIMIT)
  }
  if (queue.length > 0) complete = false
  return observation(contract, major, ['root', 'facts', 'children'], {
    nodes: seen.size,
    maxDepth,
    kinds: kinds.size,
    complete,
  })
}

async function observeTable(contract, major, source) {
  const shape = await source.shape()
  const page = await source.rows({ kind: 'range', from: 0, count: 1 })
  const features = ['shape', 'rows']
  if (shape.columns > 0 && page.items.length > 0) {
    await source.cell({ row: page.items[0].index, column: 0 })
    features.push('cell')
  }
  return observation(contract, major, features, {
    rows: shape.rows === 'unknown' ? 0 : shape.rows,
    rowsKnown: shape.rows !== 'unknown',
    columns: shape.columns,
    typedColumns: shape.header?.length ?? 0,
    firstPageRows: page.items.length,
  })
}

async function observeText(contract, major, source) {
  const info = await source.info()
  const slice = await source.slice({
    kind: 'from-line',
    line: 0,
    lineCount: 16,
    maxBytes: 16 * 1024,
  })
  return observation(contract, major, ['info', 'slice'], {
    encoding: info.encoding,
    lines: info.lines === 'unknown' ? 0 : info.lines,
    linesKnown: info.lines !== 'unknown',
    sliceLines: slice.lineCount,
    sliceNonEmpty: slice.text.length > 0,
  })
}

async function observeRaster(contract, major, source) {
  const info = await source.info()
  const encoded = await source.encoded()
  const descriptor = await encoded.descriptor()
  const firstBytes = await encoded.read(0n, 16)
  const features = ['info', 'encoded']
  let decodedBytes = 0
  if (source.readRegion !== undefined) {
    const region = await source.readRegion({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      pixelFormat: 'rgba8',
      maxBytes: 4,
    })
    decodedBytes = region.pixels.byteLength
    features.push('decoded-region')
  }
  return observation(contract, major, features, {
    width: info.width,
    height: info.height,
    channels: info.channels,
    decodedAccess: info.decodedAccess,
    decodedBytes,
    encodedNonEmpty: firstBytes.byteLength > 0,
    encodedMediaType: descriptor.mediaType,
  })
}

async function observeModel(contract, major, source) {
  const info = await source.info()
  await source.nodes({ limit: 1 })
  const meshes = await source.meshes({ limit: 1 })
  const features = ['info', 'nodes', 'meshes']
  let decodedVertices = 0
  let decodedIndices = 0
  const primitiveId = meshes.items[0]?.primitiveIds[0]
  if (
    info.geometryAccess === 'decoded' &&
    primitiveId !== undefined &&
    source.primitive !== undefined
  ) {
    const primitive = await source.primitive(primitiveId, { maxBytes: 16 * 1024 * 1024 })
    decodedVertices = Math.floor(primitive.positions.length / 3)
    decodedIndices = primitive.indices?.length ?? 0
    features.push('primitive')
  }
  return observation(contract, major, features, {
    scenes: info.scenes,
    nodes: info.nodes,
    meshes: info.meshes,
    primitives: info.primitives,
    materials: info.materials,
    textures: info.textures,
    animations: info.animations,
    decodedGeometry: info.geometryAccess === 'decoded',
    decodedVertices,
    decodedIndices,
  })
}

async function observeBytes(contract, major, source) {
  const size = await source.size()
  const length = Number(size > 16n ? 16n : size)
  const bytes = await source.read(0n, length)
  return observation(contract, major, ['size', 'read'], {
    nonEmpty: size > 0n,
    firstReadBytes: bytes.byteLength,
  })
}

export async function observeDataSource(contract, major, source, options = {}) {
  try {
    if (contract === 'common.view/namespace-entry-source')
      return await observeNamespace(contract, major, source, options)
    if (contract === 'common.view/raster-image-source')
      return await observeRaster(contract, major, source)
    if (contract === 'common.view/tree-data-source')
      return await observeTree(contract, major, source)
    if (contract === 'common.view/table-data-source')
      return await observeTable(contract, major, source)
    if (contract === 'common.view/text-data-source')
      return await observeText(contract, major, source)
    if (contract === 'common.view/model-scene-source')
      return await observeModel(contract, major, source)
    if (contract === 'common.view/byte-range-source')
      return await observeBytes(contract, major, source)
    if (typeof source.summary === 'function') await source.summary()
    else if (typeof source.info === 'function') await source.info()
    else if (typeof source.descriptor === 'function') await source.descriptor()
    return observation(contract, major, ['smoke'], {})
  } catch (error) {
    return Object.freeze({
      contract,
      major,
      state: 'failed',
      features: [],
      measurements: {},
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
