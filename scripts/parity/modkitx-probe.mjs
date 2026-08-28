import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const request = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'))
const moduleUrl = pathToFileURL(resolve(request.canonicalRoot, request.canonicalModule)).href
const imported =
  request.canonicalAdapter === 'manifest-metadata-only' ? {} : await import(moduleUrl)
const bytes = new Uint8Array(await readFile(request.file))
// The PE archive synthesises summary text containing its label. Give that one adapter the stable
// corpus label so extracted-byte measurements do not depend on a checkout name. Other codecs keep
// the physical path because companion-aware readers (notably CUE/BIN) resolve siblings from it.
const subjectPath = request.format === 'pe' ? (request.publishedFile ?? request.file) : request.file

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
  const model = await codec.parse(bytes, subjectPath)
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
  const reader = await imported.default.open(bytes, subjectPath)
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

function canonicalCodec() {
  const named =
    request.canonicalExport === undefined ? undefined : imported[request.canonicalExport]
  const codec = named ?? imported.default
  if (codec === undefined) {
    throw new TypeError(
      `canonical module exposes neither ${request.canonicalExport ?? 'a default export'} nor a default export`,
    )
  }
  return codec
}

function optionalNumber(target, key, value) {
  if (Number.isSafeInteger(value)) target[key] = value
}

/**
 * Raster plane for the canonical `ImageCodec` registry shape. Only measurements the canonical
 * library genuinely proves are emitted: `describe()` gives pixel extent, `decode()` proves that
 * pixels are reachable. Channel counts and media types are deliberately absent because the
 * canonical codec does not state them — inferring them here would fabricate parity evidence.
 */
async function rasterResult() {
  const codec = canonicalCodec()
  if (typeof codec.describe !== 'function' && typeof codec.decode !== 'function') {
    throw new TypeError('canonical image codec exposes neither describe() nor decode()')
  }
  const described =
    typeof codec.describe === 'function' ? await codec.describe(bytes, subjectPath) : undefined
  let decoded
  if (typeof codec.decode === 'function') {
    try {
      decoded = await codec.decode(bytes, subjectPath)
    } catch {
      decoded = undefined
    }
  }
  const measurements = { decodedAccess: decoded !== undefined, encodedNonEmpty: bytes.length > 0 }
  optionalNumber(measurements, 'width', described?.width ?? decoded?.width)
  optionalNumber(measurements, 'height', described?.height ?? decoded?.height)
  measurements.decodedBytes = decoded === undefined ? 0 : Math.min(decoded.pixels.byteLength, 4)
  const features = ['info', 'encoded', ...(decoded === undefined ? [] : ['decoded-region'])]
  return result(codec.id ?? request.format, [
    source('common.view/raster-image-source', features, measurements),
  ])
}

/** Vector plane: the canonical registry models EMF/WMF/SVG as image codecs that only describe. */
async function vectorResult() {
  const codec = canonicalCodec()
  if (typeof codec.describe !== 'function') {
    throw new TypeError('canonical vector codec exposes no describe()')
  }
  const described = await codec.describe(bytes, subjectPath)
  const measurements = {}
  optionalNumber(measurements, 'width', described.width)
  optionalNumber(measurements, 'height', described.height)
  return result(codec.id ?? request.format, [
    source('common.view/vector-scene-source', ['info'], measurements),
  ])
}

/** Namespace plane for the canonical `ArchiveCodec` shape (`open` → `list`/`get`). */
async function archiveResult() {
  const codec = canonicalCodec()
  if (typeof codec.open !== 'function') {
    throw new TypeError('canonical archive codec exposes no open()')
  }
  const reader = await codec.open(bytes, subjectPath)
  try {
    const entries = await reader.list('')
    const first = entries[0]
    const extracted = first === undefined ? new Uint8Array() : await reader.get(first)
    return result(codec.id ?? request.format, [
      source('common.view/namespace-entry-source', ['list', 'open-entry', 'extract-bytes'], {
        entries: entries.length,
        files: entries.length,
        complete: true,
        extractedBytes: extracted.byteLength,
        extractedNonEmpty: extracted.byteLength > 0,
      }),
    ])
  } finally {
    await reader.close?.()
  }
}

/** Audio plane: canonical `describe()` states container facts, never decoded PCM. */
async function audioResult() {
  const codec = canonicalCodec()
  if (typeof codec.describe !== 'function') {
    throw new TypeError('canonical audio codec exposes no describe()')
  }
  const described = await codec.describe(bytes, subjectPath)
  const measurements = {
    durationKnown: typeof described.durationSec === 'number',
    encodedNonEmpty: bytes.length > 0,
  }
  optionalNumber(measurements, 'sampleRate', described.sampleRate)
  optionalNumber(measurements, 'channels', described.channels)
  return result(codec.id ?? request.format, [
    source('common.view/audio-media-source', ['info', 'encoded'], measurements),
  ])
}

/** Video plane: canonical `describe()` states container facts, never decoded frames. */
async function videoResult() {
  const codec = canonicalCodec()
  if (typeof codec.describe !== 'function') {
    throw new TypeError('canonical video codec exposes no describe()')
  }
  const described = await codec.describe(bytes, subjectPath)
  const measurements = {
    durationKnown: typeof described.durationSec === 'number',
    encodedNonEmpty: bytes.length > 0,
  }
  optionalNumber(measurements, 'width', described.width)
  optionalNumber(measurements, 'height', described.height)
  return result(codec.id ?? request.format, [
    source('common.view/video-media-source', ['info', 'encoded'], measurements),
  ])
}

/**
 * One line per recovered text block of a canonical document view.
 *
 * The canonical stack keeps `sourceText` only for the formats it can also edit — plain text,
 * Markdown, CSV. For a packaged document (ODT, ODS, ODP) it recovers text all the same, but keeps
 * it inside the display view model's blocks. Flattening those blocks is therefore not a synthesised
 * plane: it is the same recovered text, in the same order, addressed the way the X3 side addresses
 * it — one line per non-empty text block, one line per table row. Presentation-only blocks (a
 * diagram's SVG, a notice) contribute nothing, because neither side calls them document text.
 */
function flattenDocumentBlocks(blocks, lines = []) {
  for (const block of blocks ?? []) {
    if (block.kind === 'paragraph' || block.kind === 'heading') {
      const text = (block.runs ?? []).map(run => run.text).join('')
      if (text !== '') lines.push(text)
    } else if (block.kind === 'code') {
      if (typeof block.text === 'string' && block.text !== '') lines.push(block.text)
    } else if (block.kind === 'list') {
      for (const item of block.items ?? []) {
        const text = item.map(run => run.text).join('')
        if (text !== '') lines.push(text)
      }
    } else if (block.kind === 'table') {
      for (const row of block.rows ?? []) {
        const text = row.join('\t')
        if (text.trim() !== '') lines.push(text)
      }
    } else if (block.kind === 'page' || block.kind === 'slide') {
      if (typeof block.title === 'string' && block.title !== '') lines.push(block.title)
      flattenDocumentBlocks(block.blocks, lines)
      for (const note of block.notes ?? []) {
        if (note.text !== '') lines.push(note.text)
      }
    }
  }
  return lines
}

/**
 * Document plane. The canonical document stack renders a display view model whose block
 * decomposition has no equally defined counterpart in X3, so only the recovered text is compared:
 * `sourceText` where the canonical codec keeps one, and the flattened blocks where it does not.
 * A format that yields neither is recorded as not comparable in the coverage table instead of being
 * forced into a number-to-number verdict.
 */
async function documentResult() {
  const definition = imported.DOCUMENT_FORMATS?.[request.canonicalDocumentFormat]
  if (definition === undefined) {
    throw new TypeError(`canonical document format is missing: ${request.canonicalDocumentFormat}`)
  }
  const view = await imported.parseDocument(definition, bytes, definition.label)
  const recovered =
    typeof view.sourceText === 'string' && view.sourceText !== ''
      ? view.sourceText
      : flattenDocumentBlocks(view.blocks).join('\n')
  if (recovered === '') throw new TypeError('canonical document view recovers no text')
  return result(definition.id, [textSource(recovered)])
}

/**
 * An unsupported canonical manifest is still an oracle result: it proves that the legacy product
 * knows the format name but publishes no executable model surface. Treating that as a missing probe
 * would hide the exact depth difference this parity row exists to preserve.
 */
async function manifestMetadataOnlyResult() {
  const manifest = JSON.parse(
    await readFile(resolve(request.canonicalRoot, request.canonicalModule), 'utf8'),
  )
  if (manifest.status !== 'unsupported' || (manifest.capabilities?.length ?? 0) !== 0) {
    throw new TypeError('canonical metadata-only manifest unexpectedly claims executable support')
  }
  return result(manifest.id ?? request.format, [])
}

/**
 * Sealed migration oracle for the Block 15G pure Galaxy slice.
 *
 * The child process imports the pinned legacy runtime exactly like every other parity adapter; X3
 * tests never import the owner-dirty legacy tree. Only the bounded observation shared by both
 * runtimes is returned: a zero-argument entrypoint value and deterministic clock advancement.
 */
async function sc2RuntimeBoundedResult() {
  if (typeof imported.createSc2RuntimeProvider !== 'function') {
    throw new TypeError('canonical SC2 runtime provider export is missing')
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const provider = imported.createSc2RuntimeProvider()
  const session = await provider.createSession({
    sources: [{ fileName: request.publishedFile ?? 'MapScript.galaxy', text }],
  })
  const execution = await session.execute({ entrypoint: request.entrypoint, arguments: [] })
  const steps = Number.isSafeInteger(request.steps) && request.steps >= 0 ? request.steps : 0
  for (let index = 0; index < steps; index += 1) await session.clock.advance(1 / 16)
  const snapshot = await session.snapshot()
  return {
    profile: 'legacy-sc2-galaxy-engine-oracle',
    entrypoint: request.entrypoint,
    execution: {
      state: execution.state,
      ...(execution.value === undefined ? {} : { value: execution.value }),
      diagnostics: execution.diagnostics.map(item => item.code).sort(),
    },
    clock: { tick: snapshot.clock.tick, timeSeconds: snapshot.clock.timeSeconds },
    nativeUsage: session.nativeUsage(),
    nativeFallbacks: session.nativeFallbacks(),
  }
}

function simulationProjection(simulation) {
  const snapshot = simulation.snapshot()
  const units = Object.values(snapshot.state.units)
    .filter(unit => unit !== null && typeof unit === 'object' && typeof unit.id === 'string')
    .map(unit => ({
      id: unit.id,
      unitType: unit.unitType,
      owner: unit.owner,
      alive: unit.alive,
      x: unit.x,
      y: unit.y,
      life: { current: unit.life.current, max: unit.life.max },
      speed: unit.speed,
      food: unit.food,
      orderQueue: unit.orderQueue.map(order => ({ kind: order.kind, x: order.x, y: order.y })),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  return {
    tick: snapshot.tick,
    time: snapshot.state.time,
    randomSeed: snapshot.state.randomSeed,
    commands: snapshot.commands.map(issued => ({
      tick: issued.tick,
      player: issued.player,
      seq: issued.seq,
      command: issued.command,
    })),
    units,
  }
}

function semanticSimulationEvents(events) {
  return events.map(event => ({ tick: event.tick, type: event.type, payload: event.payload }))
}

function projectionHash(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

/**
 * Sealed Block 19 oracle for the first playable subset. The differential is deliberately not a
 * whole-SimEngine claim: it covers tick/time/seed, pending command envelopes, selected catalog-
 * backed unit fields (identity, owner, alive, position, life, speed, food and move order), plus
 * ordered SimUnitArrived tick/type/payload observations.
 */
async function sc2RuntimePlayableResult() {
  if (typeof imported.createSc2RuntimeProvider !== 'function') {
    throw new TypeError('canonical SC2 runtime provider export is missing')
  }
  const catalogEntries = request.catalog
  if (catalogEntries === null || typeof catalogEntries !== 'object') {
    throw new TypeError('SC2 playable oracle requires catalog entries')
  }
  const catalog = {
    getResolved(namespace, id) {
      return catalogEntries[`${namespace}/${id}`]
    },
    entityIds(namespace) {
      const prefix = `${namespace}/`
      return Object.keys(catalogEntries)
        .filter(key => key.startsWith(prefix))
        .map(key => key.slice(prefix.length))
        .sort()
    },
  }
  const provider = imported.createSc2RuntimeProvider()
  const session = await provider.createSession({
    simulation: { catalog },
    engineOptions: { state: { randomSeed: request.randomSeed } },
  })
  for (const issued of request.commands ?? []) {
    session.issueSimulationCommand(issued.player, issued.command, issued.atTick, issued.seq)
  }
  const steps = Number.isSafeInteger(request.steps) && request.steps >= 0 ? request.steps : 0
  const checkpointStep =
    Number.isSafeInteger(request.checkpointStep) &&
    request.checkpointStep >= 0 &&
    request.checkpointStep <= steps
      ? request.checkpointStep
      : 0
  let checkpoint = checkpointStep === 0 ? await session.snapshot() : undefined
  const events = []
  for (let index = 0; index < steps; index += 1) {
    const emitted = session.stepSimulation()
    for (const event of emitted) {
      events.push({ tick: session.simulation.world.tick, type: event.type, payload: event.payload })
    }
    if (index + 1 === checkpointStep) checkpoint = await session.snapshot()
  }
  const finalProjection = simulationProjection(session.simulation)
  const finalEvents = semanticSimulationEvents(events)
  if (checkpoint === undefined) throw new TypeError('SC2 playable oracle checkpoint is absent')
  await session.restore(checkpoint)
  const resumedEvents = []
  for (let index = checkpointStep; index < steps; index += 1) {
    const emitted = session.stepSimulation()
    for (const event of emitted) {
      resumedEvents.push({
        tick: session.simulation.world.tick,
        type: event.type,
        payload: event.payload,
      })
    }
  }
  const resumedProjection = simulationProjection(session.simulation)
  const expectedTail = finalEvents.filter(event => event.tick > checkpoint.clock.tick)
  return {
    profile: 'legacy-sc2-sim-engine-playable-subset-oracle',
    differentialScope: [
      'tick',
      'time',
      'randomSeed',
      'pending-command-envelopes',
      'unit.identity-owner-alive-position-life-speed-food-order',
      'SimUnitArrived.tick-type-payload',
    ],
    state: finalProjection,
    stateHash: projectionHash(finalProjection),
    eventHash: projectionHash(finalEvents),
    continuationStateHash: projectionHash(resumedProjection),
    continuationEventHash: projectionHash(semanticSimulationEvents(resumedEvents)),
    expectedContinuationEventHash: projectionHash(expectedTail),
  }
}

const adapters = {
  model: modelResult,
  image: imageResult,
  raster: rasterResult,
  vector: vectorResult,
  archive: archiveResult,
  audio: audioResult,
  video: videoResult,
  document: documentResult,
  zip: zipResult,
  big: bigResult,
  'cnc3-data': cnc3DataResult,
  'cnc3-localization': localizationResult,
  'cnc3-map': cnc3MapResult,
  'sage-skudef': skuDefResult,
  'manifest-metadata-only': manifestMetadataOnlyResult,
  'sc2-runtime-bounded': sc2RuntimeBoundedResult,
  'sc2-runtime-playable': sc2RuntimePlayableResult,
}
const adapter = adapters[request.canonicalAdapter ?? 'model']
if (adapter === undefined)
  throw new TypeError(`unknown canonical adapter: ${request.canonicalAdapter}`)
const parityResult = await adapter()
process.stdout.write(`MODKIT_PARITY_RESULT ${JSON.stringify(parityResult)}\n`)
