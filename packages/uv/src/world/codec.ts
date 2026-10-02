import {
  createInspectionCodec,
  createTreeDataSource,
  editPlanFromInput,
  replaceBytes,
  type InspectionContext,
} from '@modkit/codec-kit'
import { sha256Hex } from '@modkit/codec-kit/crypto/digest'
import { applyJsonEdit, type JsonEdit } from '@modkit/codec-kit/json-edit'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { operationId, type Diagnostic } from '@modkit/core'
import type { JsonObject, JsonValue } from '@modkit/sdk'
import {
  MAP_LAYERS_INPUT_SCHEMA,
  MAP_LAYERS_OPERATION,
  MAP_LAYER_READ_INPUT_SCHEMA,
  MAP_LAYER_READ_OPERATION,
  MAP_LAYER_WRITE_INPUT_SCHEMA,
  MAP_LAYER_WRITE_OPERATION,
  NATIVE_MAP_ENCODER_CONTRACT,
  WORLD_SCENE_SOURCE_CONTRACT,
  mapLayerWindow,
  type MapLayerDescriptor,
  type MapLayerGrid,
  type MapLayerReadRequest,
  type NativeMapEncoder,
} from '@modkit/sdk/maps'

import {
  canonicalizeUvwProfile,
  createUvwWorldSceneSource,
  parseUvwProfile,
  serializeUvwProfile,
  type UvwHeightfieldLayer,
} from './index.js'

const decoder = new TextDecoder('utf-8', { fatal: false })

function looksLikeUvw(bytes: Uint8Array): boolean {
  const text = decoder.decode(bytes)
  return (
    /"format"\s*:\s*"UVW"/u.test(text) &&
    /"version"\s*:\s*"1\.0"/u.test(text) &&
    /"status"\s*:\s*"profile"/u.test(text) &&
    /"spaces"\s*:/u.test(text)
  )
}

function editObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`)
  return value as Record<string, unknown>
}

function jsonPointer(path: readonly string[]): string {
  return `/${path.map(key => key.replace(/~/gu, '~0').replace(/\//gu, '~1')).join('/')}`
}

function fieldEdits(input: unknown, context: InspectionContext) {
  const request = editObject(
    snapshotJson(
      input,
      {
        maxBytes: context.budget.maxScalarBytes,
        maxNodes: context.budget.maxNodes,
        maxDepth: context.budget.maxDepth + 2,
      },
      context.signal,
    ),
    'UVW field request',
  )
  const path = request['path']
  if (
    !Array.isArray(path) ||
    path.length === 0 ||
    !path.every(key => typeof key === 'string') ||
    request['groupId'] !== 'tree' ||
    request['key'] !== path.at(-1) ||
    !Object.hasOwn(request, 'value') ||
    Object.keys(request).some(key => !['groupId', 'key', 'path', 'value'].includes(key))
  )
    throw new TypeError('UVW field write requires a complete tree semantic path and value')
  return Object.freeze([
    Object.freeze({
      op: 'replace' as const,
      path: jsonPointer(path),
      value: request['value'] as JsonValue,
    }),
  ])
}

function genericDocumentEdits(request: Record<string, unknown>) {
  const json = request['json']
  if (Object.keys(request).some(key => key !== 'json') || !Array.isArray(json) || json.length === 0)
    throw new TypeError('UVW world.edit requires a nonempty json edit array')
  if (json.length > 4_096) throw new RangeError('UVW edit batch exceeds maxEdits')
  return Object.freeze(
    json.map(raw => {
      const edit = editObject(raw, 'UVW JSON edit')
      if (
        typeof edit['path'] !== 'string' ||
        !['add', 'replace', 'remove'].includes(String(edit['op'])) ||
        Object.keys(edit).some(key => !['op', 'path', 'value'].includes(key)) ||
        (edit['op'] === 'remove' ? Object.hasOwn(edit, 'value') : !Object.hasOwn(edit, 'value'))
      )
        throw new TypeError('invalid UVW JSON edit')
      return edit['op'] === 'remove'
        ? Object.freeze({ op: 'remove' as const, path: edit['path'] })
        : Object.freeze({
            op: edit['op'] as 'add' | 'replace',
            path: edit['path'],
            value: edit['value'] as JsonValue,
          })
    }),
  )
}

function worldObjectEdits(
  request: Record<string, unknown>,
  document: ReturnType<typeof parseUvwProfile>,
  context: InspectionContext,
) {
  if (Object.keys(request).some(key => !['expectedSourceRevision', 'edits'].includes(key)))
    throw new TypeError('UVW object edit contains an unknown field')
  if (request['expectedSourceRevision'] !== context.input.revisions.revision)
    throw new TypeError('stale UVW source revision')
  const edits = request['edits']
  if (!Array.isArray(edits) || edits.length === 0)
    throw new TypeError('UVW object edit requires a nonempty edits array')
  if (edits.length > 4_096) throw new RangeError('UVW edit batch exceeds maxEdits')

  const canonical = canonicalizeUvwProfile(document)
  const canonicalObjectLayers = canonical.spaces.flatMap(space =>
    space.layers
      .filter(layer => layer.kind === 'objects')
      .map(layer => Object.freeze({ spaceId: space.id, layer })),
  )
  if (canonicalObjectLayers.length !== 1)
    throw new TypeError('UVW object editing requires exactly one objects layer')
  const canonicalLayer = canonicalObjectLayers[0]
  if (canonicalLayer === undefined) throw new TypeError('UVW objects layer is missing')

  const spaceIndex = document.spaces.findIndex(space => space.id === canonicalLayer.spaceId)
  const sourceSpace = document.spaces[spaceIndex]
  if (sourceSpace === undefined) throw new TypeError('UVW object space is missing')
  const layerIndex = sourceSpace.layers.findIndex(layer => layer.id === canonicalLayer.layer.id)
  const sourceLayer = sourceSpace.layers[layerIndex]
  if (sourceLayer?.kind !== 'objects') throw new TypeError('UVW objects layer is missing')

  return Object.freeze(
    edits.map(raw => {
      const edit = editObject(raw, 'UVW object edit')
      if (
        Object.keys(edit).some(key => !['kind', 'objectId', 'patch'].includes(key)) ||
        edit['kind'] !== 'object.update' ||
        !Number.isSafeInteger(edit['objectId']) ||
        Number(edit['objectId']) < 0
      )
        throw new TypeError('invalid UVW object.update edit')
      const objectId = Number(edit['objectId'])
      const canonicalInstance = canonicalLayer.layer.instances[objectId]
      if (canonicalInstance === undefined) throw new RangeError('UVW objectId is out of range')
      const patch = editObject(edit['patch'], 'UVW object patch')
      if (Object.keys(patch).some(key => key !== 'position') || !Object.hasOwn(patch, 'position'))
        throw new TypeError('UVW object.update currently requires exactly a position patch')
      const position = editObject(patch['position'], 'UVW object position')
      if (
        Object.keys(position).some(key => !['x', 'y', 'z'].includes(key)) ||
        !['x', 'y', 'z'].every(key => Object.hasOwn(position, key)) ||
        ![position['x'], position['y'], position['z']].every(
          value => typeof value === 'number' && Number.isFinite(value),
        )
      )
        throw new TypeError('UVW object position must contain finite x, y and z values')
      const instanceIndex = sourceLayer.instances.findIndex(
        instance => instance.id === canonicalInstance.id,
      )
      if (instanceIndex < 0) throw new TypeError('UVW object identity is missing from source')
      return Object.freeze({
        op: 'replace' as const,
        path: jsonPointer([
          'spaces',
          String(spaceIndex),
          'layers',
          String(layerIndex),
          'instances',
          String(instanceIndex),
          'position',
        ]),
        value: Object.freeze([
          position['x'] as number,
          position['y'] as number,
          position['z'] as number,
        ]),
      })
    }),
  )
}

function documentEdits(
  input: unknown,
  context: InspectionContext,
  document: ReturnType<typeof parseUvwProfile>,
) {
  const request = editObject(
    snapshotJson(
      input,
      {
        maxBytes: context.budget.maxScalarBytes,
        maxNodes: context.budget.maxNodes,
        maxDepth: context.budget.maxDepth + 3,
      },
      context.signal,
    ),
    'UVW edit request',
  )
  return Object.hasOwn(request, 'json')
    ? genericDocumentEdits(request)
    : worldObjectEdits(request, document, context)
}

function editHandler(
  source: Uint8Array,
  document: ReturnType<typeof parseUvwProfile>,
  context: InspectionContext,
  editsFromInput: (input: unknown, context: InspectionContext) => readonly JsonEdit[],
) {
  return async (input: unknown, operationContext: { signal?: AbortSignal } = {}) => {
    const signal = operationContext.signal ?? context.signal
    signal?.throwIfAborted()
    const base = editPlanFromInput(context.input, {
      planId: `uvw-edit:${context.input.revisions.revision}`,
      edits: [],
      fidelity: {
        roundTrip: 'semantic',
        preservesUnknownData: true,
        notes: ['UVW is revalidated and serialized in required canonical order'],
      },
    })
    const edits = editsFromInput(input, { ...context, signal })
    let candidate = document as unknown as JsonObject
    for (const edit of edits) candidate = applyJsonEdit(candidate, edit, context.budget.maxDepth)
    const bytes = serializeUvwProfile(candidate as unknown as ReturnType<typeof parseUvwProfile>, {
      maxBytes: context.budget.maxScalarBytes,
      maxDepth: context.budget.maxDepth,
      maxNodes: context.budget.maxNodes,
      maxSamples: Math.floor(context.budget.maxScalarBytes / 8),
      ...(signal === undefined ? {} : { signal }),
    })
    const digest = await sha256Hex(bytes)
    signal?.throwIfAborted()
    const target = base.targets[0]
    if (target === undefined) throw new TypeError('UVW edit target is missing')
    return {
      kind: 'edit-plan' as const,
      plan: Object.freeze({
        ...base,
        planId: `${base.planId}:${digest}`,
        edits: Object.freeze([
          Object.freeze({
            ...replaceBytes(0, source.byteLength, bytes, 'Edit canonical UVW document'),
            targetId: target.targetId,
            source: target.ownerSource,
          }),
        ]),
      }),
    }
  }
}

const SAMPLE_MAXIMUM = 0xffff

interface HeightGrid {
  readonly descriptor: MapLayerDescriptor
  readonly spaceIndex: number
  readonly layerIndex: number
  readonly layer: UvwHeightfieldLayer
}

/**
 * Every heightfield as a `map.layers` grid of integers n, height = valueOffset + n · valueScale.
 * The scale is the finest power of two, at most 1/256 unless the heights need a finer one, that
 * fits the layer's range in 16 bits; the offset centres the heights so a write can raise or lower
 * them. Both belong to the revision: a write that widens the range changes them. A layer whose
 * heights are not exact on that grid, or that has missing ground, reads rounded and is not editable.
 */
function heightGrids(document: ReturnType<typeof parseUvwProfile>): ReadonlyMap<string, HeightGrid> {
  const grids = new Map<string, HeightGrid>()
  document.spaces.forEach((space, spaceIndex) =>
    space.layers.forEach((layer, layerIndex) => {
      if (layer.kind !== 'heightfield') return
      let minimum = Infinity
      let maximum = -Infinity
      let missing = false
      // The coarsest power of two on which every height is an integer; 17 means none up to 2^16.
      let exponent = -16
      for (const row of layer.samples) {
        for (const value of row) {
          if (value === layer.noDataValue) {
            missing = true
            continue
          }
          minimum = Math.min(minimum, value)
          maximum = Math.max(maximum, value)
          while (exponent <= 16 && !Number.isInteger(value * 2 ** exponent)) exponent += 1
        }
      }
      if (minimum === Infinity) minimum = maximum = 0
      let fit = Math.max(8, Math.min(exponent, 16))
      while (fit > -16 && (maximum - minimum) * 2 ** fit > SAMPLE_MAXIMUM) fit -= 1
      const valueScale = 2 ** -fit
      const headroom = SAMPLE_MAXIMUM - Math.round((maximum - minimum) * 2 ** fit)
      const id = `${space.id}/${layer.id}`
      grids.set(id, {
        descriptor: Object.freeze({
          id,
          label: layer.label ?? layer.id,
          meaning: 'height',
          width: layer.columns,
          height: layer.rows,
          minimum: 0,
          maximum: SAMPLE_MAXIMUM,
          editable: !missing && exponent <= fit,
          valueScale,
          valueOffset: minimum - Math.floor(headroom / 2) * valueScale,
          unit: space.basis.unit === 'meter' ? 'm' : (space.basis.sourceUnit ?? 'source-unit'),
          sampling: 'vertex',
        }),
        spaceIndex,
        layerIndex,
        layer,
      })
    }),
  )
  return grids
}

function heightGrid(grids: ReadonlyMap<string, HeightGrid>, id: unknown): HeightGrid {
  const grid = typeof id === 'string' ? grids.get(id) : undefined
  if (grid === undefined) throw new RangeError(`the UVW world has no height layer ${String(id)}`)
  return grid
}

function readHeightGrid(grids: ReadonlyMap<string, HeightGrid>, input: unknown): JsonValue {
  const request = editObject(input, 'map.layer-read request') as unknown as MapLayerReadRequest
  const { descriptor, layer } = heightGrid(grids, request.layer)
  const window = mapLayerWindow(descriptor, request)
  const scale = descriptor.valueScale ?? 1
  const offset = descriptor.valueOffset ?? 0
  const values: number[] = []
  for (let y = window.y; y < window.y + window.height; y += 1) {
    const row = layer.samples[y] ?? []
    for (let x = window.x; x < window.x + window.width; x += 1) {
      const n = Math.round(((row[x] ?? offset) - offset) / scale)
      values.push(Math.min(SAMPLE_MAXIMUM, Math.max(0, n)))
    }
  }
  return {
    layer: descriptor.id,
    ...(request.x === undefined ? {} : { x: window.x, y: window.y }),
    width: window.width,
    height: window.height,
    values,
  }
}

/** One `replace` per touched row; the heights of a write are exact by construction of the scale. */
function heightGridEdits(
  grids: ReadonlyMap<string, HeightGrid>,
  input: unknown,
  context: InspectionContext,
): readonly JsonEdit[] {
  const request = editObject(input, 'map.layer-write request')
  if (
    request['expectedSourceRevision'] !== undefined &&
    request['expectedSourceRevision'] !== context.input.revisions.revision
  )
    throw new TypeError('stale UVW source revision')
  const grid = request as unknown as MapLayerGrid
  const { descriptor, layer, spaceIndex, layerIndex } = heightGrid(grids, grid.layer)
  const window = mapLayerWindow(descriptor, grid)
  const scale = descriptor.valueScale ?? 1
  const offset = descriptor.valueOffset ?? 0
  const edits: JsonEdit[] = []
  for (let row = 0; row < window.height; row += 1) {
    const y = window.y + row
    const samples = [...(layer.samples[y] ?? [])]
    for (let column = 0; column < window.width; column += 1) {
      const height = offset + (grid.values[row * window.width + column] ?? 0) * scale
      if (height === layer.noDataValue)
        throw new RangeError(`height ${String(height)} at ${String(window.x + column)},${String(y)} is the layer's noDataValue`)
      samples[window.x + column] = height
    }
    edits.push(
      Object.freeze({
        op: 'replace' as const,
        path: jsonPointer(['spaces', String(spaceIndex), 'layers', String(layerIndex), 'samples', String(y)]),
        value: Object.freeze(samples),
      }),
    )
  }
  return Object.freeze(edits)
}

const NATIVE_EXPORT_OPERATION = operationId('map.export-native', { contributionId: 'modkit/world-uvw' })

/** The native export's form: the target map format and the encoder's own options. */
const NATIVE_MAP_EXPORT_INPUT_SCHEMA = Object.freeze({
  $ref: 'modkit://schemas/uvw/native-map-export.v1',
  document: Object.freeze({
    schemaVersion: 1,
    forms: Object.freeze([
      Object.freeze({
        id: 'uvw-native-map-export',
        label: 'Save as a game map',
        summary: "Write this world with an installed game's map encoder.",
        baseInput: Object.freeze({ schemaVersion: 1 }),
        fields: Object.freeze([
          Object.freeze({
            key: 'formatId',
            label: 'Target format',
            type: Object.freeze({ kind: 'text' }),
            inputPath: Object.freeze(['formatId']),
            required: true,
            description: 'Installed native map format id, for example ra2-map or minecraft-anvil.',
          }),
          Object.freeze({
            key: 'options',
            label: 'Encoder options',
            type: Object.freeze({ kind: 'json' }),
            inputPath: Object.freeze(['options']),
            initial: Object.freeze({}),
          }),
        ]),
      }),
    ]),
  }),
})

/**
 * map.export-native: the world written by the installed game's map encoder (common.map/native-
 * encoder, WT10), its losses reported with the result. This codec selects and checks; it writes no
 * game's map.
 */
function nativeExportHandler(bytes: Uint8Array, context: InspectionContext) {
  return async (
    input: unknown,
    operationContext: {
      readonly signal?: AbortSignal
      readonly reportDiagnostic?: (value: Diagnostic) => void
    } = {},
  ) => {
    if (context.contracts === undefined)
      throw new TypeError('host native map encoder capability is absent')
    const request = editObject(
      snapshotJson(
        input,
        {
          maxBytes: context.budget.maxScalarBytes,
          maxNodes: context.budget.maxNodes,
          maxDepth: context.budget.maxDepth + 2,
        },
        operationContext.signal,
      ),
      'native map export request',
    )
    const formatId = request['formatId']
    if (
      request['schemaVersion'] !== 1 ||
      typeof formatId !== 'string' ||
      formatId.trim().length === 0 ||
      Object.keys(request).some(key => !['schemaVersion', 'formatId', 'options'].includes(key))
    )
      throw new TypeError('native map export requires {schemaVersion: 1, formatId}')
    const signal = operationContext.signal
    signal?.throwIfAborted()
    const lease = await context.contracts.resolve({
      contract: NATIVE_MAP_ENCODER_CONTRACT,
      major: 1,
      facet: { formatId },
      operation: NATIVE_EXPORT_OPERATION,
      ...(signal === undefined ? {} : { signal }),
    })
    try {
      const encoder: unknown = lease.value
      const candidate = encoder as Partial<NativeMapEncoder> | null
      if (
        candidate === null ||
        typeof candidate !== 'object' ||
        candidate.contract !== NATIVE_MAP_ENCODER_CONTRACT ||
        candidate.formatId !== formatId ||
        typeof candidate.encode !== 'function'
      )
        throw new TypeError(`resolved provider is not a ${formatId} native map encoder`)
      const encoded = await candidate.encode({
        uvw: bytes.slice(),
        ...(request['options'] === undefined ? {} : { options: request['options'] as JsonValue }),
        ...(signal === undefined ? {} : { signal }),
      })
      if (
        encoded === null ||
        typeof encoded !== 'object' ||
        encoded.formatId !== formatId ||
        !(encoded.bytes instanceof Uint8Array)
      )
        throw new TypeError(`native map encoder returned an invalid ${formatId} result`)
      for (const item of encoded.diagnostics ?? []) operationContext.reportDiagnostic?.(item)
      // the encoder's extension and media type name the file the application writes
      return {
        kind: 'bytes' as const,
        value: encoded.bytes,
        extension: encoded.extension,
        ...(encoded.mediaType === undefined ? {} : { mediaType: encoded.mediaType }),
      }
    } finally {
      await lease.release()
    }
  }
}

const definition = Object.freeze({
  id: 'modkit/world-uvw',
  operations: Object.freeze([
    Object.freeze({
      id: operationId('edit.field', { contributionId: 'modkit/world-uvw' }),
      handlerId: 'set-uvw-field',
      mutatesSource: true,
      requiredPermissions: Object.freeze(['read-source', 'write-source'] as const),
      outputKinds: Object.freeze(['edit-plan'] as const),
    }),
    Object.freeze({
      id: operationId('edit.structure', { contributionId: 'modkit/world-uvw' }),
      handlerId: 'edit-uvw-document',
      mutatesSource: true,
      requiredPermissions: Object.freeze(['read-source', 'write-source'] as const),
      outputKinds: Object.freeze(['edit-plan'] as const),
    }),
    Object.freeze({
      id: operationId('map.export-uvw', { contributionId: 'modkit/world-uvw' }),
      handlerId: 'export-canonical-uvw',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source'] as const),
      outputKinds: Object.freeze(['bytes'] as const),
    }),
    Object.freeze({
      id: NATIVE_EXPORT_OPERATION,
      handlerId: 'export-uvw-native',
      inputSchema: NATIVE_MAP_EXPORT_INPUT_SCHEMA,
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source'] as const),
      outputKinds: Object.freeze(['bytes'] as const),
    }),
    Object.freeze({
      id: operationId(MAP_LAYERS_OPERATION, { contributionId: 'modkit/world-uvw' }),
      handlerId: 'map-layers',
      inputSchema: MAP_LAYERS_INPUT_SCHEMA,
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source'] as const),
      outputKinds: Object.freeze(['json'] as const),
    }),
    Object.freeze({
      id: operationId(MAP_LAYER_READ_OPERATION, { contributionId: 'modkit/world-uvw' }),
      handlerId: 'map-layer-read',
      inputSchema: MAP_LAYER_READ_INPUT_SCHEMA,
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source'] as const),
      outputKinds: Object.freeze(['json'] as const),
    }),
    Object.freeze({
      id: operationId(MAP_LAYER_WRITE_OPERATION, { contributionId: 'modkit/world-uvw' }),
      handlerId: 'map-layer-write',
      inputSchema: MAP_LAYER_WRITE_INPUT_SCHEMA,
      mutatesSource: true,
      requiredPermissions: Object.freeze(['read-source', 'write-source'] as const),
      outputKinds: Object.freeze(['edit-plan'] as const),
    }),
  ]),
  format: Object.freeze({
    id: 'uvw',
    label: 'Universal Verse World 1.0',
    mediaType: 'application/vnd.modkit.uvw+json; profile=uvw-1.0',
  }),
  async detect(bytes: Uint8Array, uri: string) {
    const structure = looksLikeUvw(bytes)
    const named = /\.uvw(?:\.json)?(?:[?#]|$)/iu.test(uri)
    return structure
      ? { confidence: named ? 0.995 : 0.985, kind: 'structure' as const, note: 'uvw-profile-1.0' }
      : named
        ? { confidence: 0.45, kind: 'extension' as const, note: 'uvw-named-profile-marker-missing' }
        : { confidence: 0.01, kind: 'structure' as const, note: 'uvw-profile-marker-missing' }
  },
  async inspect(bytes: Uint8Array, context: InspectionContext) {
    const maxSamples = Math.floor(context.budget.maxScalarBytes / 8)
    const document = parseUvwProfile(bytes, {
      maxBytes: bytes.byteLength,
      maxDepth: context.budget.maxDepth,
      maxNodes: context.budget.maxNodes,
      maxSamples,
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    const layerCount = document.spaces.reduce((sum, space) => sum + space.layers.length, 0)
    const sampleCount = document.spaces.reduce(
      (sum, space) =>
        sum +
        space.layers.reduce(
          (layerSum, layer) =>
            layerSum + ('columns' in layer && 'rows' in layer ? layer.columns * layer.rows : 0),
          0,
        ),
      0,
    )
    const source = createUvwWorldSceneSource(document, {
      snapshotId: context.input.revisions.revision,
      mapId: context.primary.source.id,
      maxPageSize: Math.max(1, Math.min(65_536, context.budget.maxNodes)),
      limits: { maxDepth: context.budget.maxDepth, maxNodes: context.budget.maxNodes, maxSamples },
      ...(context.rasterResources === undefined
        ? {}
        : { rasterResources: context.rasterResources }),
    })
    const grids = heightGrids(document)
    const tree = createTreeDataSource({
      kind: 'world',
      label: 'UVW world',
      preview: `${String(document.spaces.length)} spaces, ${String(layerCount)} layers`,
      children: document.spaces.map(space => ({
        kind: 'space',
        label: space.label ?? space.id,
        preview: `${space.topology}, ${space.basis.unit}`,
        children: space.layers.map(layer => ({
          kind: layer.kind,
          label: layer.label ?? layer.id,
          preview:
            'columns' in layer && 'rows' in layer && 'cellSize' in layer
              ? `${String(layer.columns)} × ${String(layer.rows)}, cell ${String(layer.cellSize)}`
              : layer.kind,
        })),
      })),
    })
    return {
      summary: {
        format: 'uvw',
        version: '1.0',
        profile: 'heightfield',
        spaces: document.spaces.length,
        layers: layerCount,
        samples: sampleCount,
      },
      metadata: [
        {
          id: 'uvw-profile',
          label: 'UVW profile',
          entries: [
            { key: 'version', value: '1.0' },
            { key: 'spaces', value: document.spaces.length },
            { key: 'layers', value: layerCount },
            { key: 'samples', value: sampleCount },
          ],
        },
      ],
      traits: [
        {
          id: 'structure.hierarchy',
          parameters: { spaces: document.spaces.length, layers: layerCount },
        },
      ],
      text: true,
      dataSources: {
        [WORLD_SCENE_SOURCE_CONTRACT]: source,
        'common.view/tree-data-source': tree,
      },
      handlers: {
        'set-uvw-field': editHandler(bytes, document, context, fieldEdits),
        'edit-uvw-document': editHandler(bytes, document, context, (input, operationContext) =>
          documentEdits(input, operationContext, document),
        ),
        'export-canonical-uvw': async () => ({
          kind: 'bytes' as const,
          value: serializeUvwProfile(document, {
            maxBytes: bytes.byteLength * 2 + 1_024,
            maxDepth: context.budget.maxDepth,
            maxNodes: context.budget.maxNodes,
            maxSamples,
            ...(context.signal === undefined ? {} : { signal: context.signal }),
          }),
        }),
        'export-uvw-native': nativeExportHandler(bytes, context),
        'map-layers': async () => ({
          kind: 'json' as const,
          value: { layers: [...grids.values()].map(grid => grid.descriptor) } as unknown as JsonValue,
        }),
        'map-layer-read': async (input: unknown) => ({
          kind: 'json' as const,
          value: readHeightGrid(grids, input),
        }),
        'map-layer-write': editHandler(bytes, document, context, (input, operationContext) =>
          heightGridEdits(grids, input, operationContext),
        ),
      },
      diagnostics: [...grids.values()]
        .filter(grid => !grid.descriptor.editable)
        .map(grid => ({
          id: `uvw.height-layer-inexact.${grid.descriptor.id}`,
          code: 'modkit/uvw-height-layer-inexact',
          category: 'fidelity' as const,
          severity: 'information' as const,
          message: `Height layer ${grid.descriptor.id} has missing ground or heights off a 16-bit power-of-two grid: map.layer-read rounds it, map.layer-write refuses it`,
          data: { layer: grid.descriptor.id },
        })),
      maxDecodedBytes: bytes.byteLength + sampleCount * 8,
      unsupportedFeatures: [
        'UVW 1.0 connections are reserved',
        'UVW 1.0 non-heightfield topology remains reserved',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = (context: Parameters<typeof createInspectionCodec>[1]) =>
  createInspectionCodec(definition, context)
