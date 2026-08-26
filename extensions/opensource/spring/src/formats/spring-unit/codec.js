import {
  createInspectionCodec,
  createModelAnimationSource,
  createModelResourceRefsSource,
  createModelSceneSource,
  createProjectionReceipt,
} from '@modkitx-x3/codec-kit'

import { parseBos } from '../../scripts/bos.js'
import { parseCob } from '../../scripts/cob.js'
import { modelTree, parseS3o } from '../../spring-s3o/codec.js'
import {
  bosPathFor,
  modelPathFor,
  parseUnitDefinition,
  scriptPathFor,
} from '../../unit-definition/parse.js'

const ID = 'org.modkitx/spring-unit-definition'
const MODEL_REQUIREMENT = 'spring-object-model'
const SCRIPT_REQUIREMENT = 'spring-unit-script'
const SOURCE_REQUIREMENT = 'spring-script-source'
const DETECT_BUDGET = Object.freeze({
  maxInputBytes: 65_536n,
  maxDepth: 16,
  maxNodes: 16_384,
  maxScalarBytes: 65_536,
  maxDiagnostics: 16,
})

function diagnostic(id, severity, code, message, data) {
  return Object.freeze({
    id,
    severity,
    code,
    message,
    category: 'dependency',
    ...(data === undefined ? {} : { data }),
  })
}

async function readBinding(input, requirementId, budget, signal, parser, label) {
  const binding = (input.bindingsFor?.(requirementId) ?? [])[0]
  if (binding === undefined) {
    return Object.freeze({ state: 'absent', bindingId: null, value: null, diagnostics: [] })
  }
  const lease = await input.openBinding(binding.bindingId, signal)
  try {
    if (lease.value.kind !== 'bytes') throw new TypeError(`${label} binding is not a byte source`)
    if (
      lease.value.size > budget.maxInputBytes ||
      lease.value.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new RangeError(`${label} binding exceeds maxInputBytes`)
    }
    const bytes = await lease.value.read(0n, Number(lease.value.size), signal)
    return Object.freeze({
      state: 'resolved',
      bindingId: binding.bindingId,
      value: parser(bytes, budget, signal),
      diagnostics: [],
    })
  } catch (error) {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    if (
      error instanceof RangeError &&
      /maxInputBytes|maxNodes|maxScalarBytes|bounded range/u.test(error.message)
    ) {
      throw error
    }
    return Object.freeze({
      state: 'corrupt',
      bindingId: binding.bindingId,
      value: null,
      diagnostics: Object.freeze([
        diagnostic(
          `${requirementId}-unreadable`,
          'error',
          `x3.spring/${requirementId}-unreadable`,
          `the bound ${label} could not be parsed as inert data: ${error instanceof Error ? error.message : String(error)}`,
          { bindingId: binding.bindingId },
        ),
      ]),
    })
  } finally {
    await lease.release()
  }
}

async function readModel(input, budget, signal) {
  const binding = (input.bindingsFor?.(MODEL_REQUIREMENT) ?? [])[0]
  if (binding === undefined) throw new TypeError('Spring unit definition has no bound object model')
  const lease = await input.openBinding(binding.bindingId, signal)
  try {
    if (lease.value.kind !== 'bytes')
      throw new TypeError('Spring object model is not a byte source')
    if (
      lease.value.size > budget.maxInputBytes ||
      lease.value.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new RangeError('Spring object model exceeds maxInputBytes')
    }
    const bytes = await lease.value.read(0n, Number(lease.value.size), signal)
    return Object.freeze({
      bindingId: binding.bindingId,
      parsed: parseS3o(bytes, budget, signal),
      bytes: bytes.byteLength,
    })
  } finally {
    await lease.release()
  }
}

function animationFacts(model, cob, bos) {
  if (cob.value === null || bos.value === null) {
    return Object.freeze({ clips: Object.freeze([]), unsupportedChannels: 0, boundPieces: 0 })
  }
  const scriptNames = new Set(cob.value.scriptNames.map(value => value.toLowerCase()))
  const cobPieces = new Set(cob.value.pieceNames.map(value => value.toLowerCase()))
  const bosPieces = new Set(bos.value.pieceNames.map(value => value.toLowerCase()))
  const modelPieces = new Map(
    model.parsed.nodes
      .filter(node => typeof node.name === 'string')
      .map(node => [node.name.toLowerCase(), node.id]),
  )
  let unsupportedChannels = 0
  const boundPieceIds = new Set()
  const clips = []
  for (const source of bos.value.functions) {
    if (!scriptNames.has(source.name.toLowerCase())) continue
    // A function with no explicit source frame markers is ordinary BOS control flow, not a track
    // candidate. Counting its commands as unsupported channels would imply animation evidence the
    // source never supplied and would make "parse != execution" less, not more, honest.
    if (source.frames.length === 0) continue
    const channels = []
    for (const channel of source.channels) {
      const key = channel.target.toLowerCase()
      const target = modelPieces.get(key)
      if (target === undefined || !cobPieces.has(key) || !bosPieces.has(key)) {
        unsupportedChannels += 1
        continue
      }
      boundPieceIds.add(target)
      channels.push(
        Object.freeze({
          target,
          kind: channel.kind,
          axis: channel.axis,
          firstFrame: channel.firstFrame,
          lastFrame: channel.lastFrame,
        }),
      )
    }
    unsupportedChannels += source.unsupportedStatements
    if (channels.length === 0 || source.frames.length === 0) continue
    const lastFrame = Math.max(...source.frames)
    clips.push(
      Object.freeze({
        id: `bos-${source.name.toLowerCase()}`,
        name: source.name,
        kind: lastFrame === 0 ? 'rest-pose' : 'animation',
        provenance: 'companion',
        frames: lastFrame + 1,
        channels: Object.freeze(channels),
        unsupportedChannels: source.unsupportedStatements,
      }),
    )
  }
  return Object.freeze({
    clips: Object.freeze(clips),
    unsupportedChannels,
    boundPieces: boundPieceIds.size,
  })
}

function relationGraph(unit, model, cob, bos, animation, snapshotId) {
  const nodes = []
  const edges = []
  const counts = new Map()
  const addNode = (id, label, type) => {
    nodes.push(Object.freeze({ id, label, type }))
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  const addEdge = (from, to, role) => edges.push(Object.freeze({ from, to, role }))
  addNode('spring-unit', 'Spring unit definition', 'unit-definition')
  addNode('spring-model', unit.objectName, 'object-model')
  addEdge('spring-unit', 'spring-model', 'objectName')
  if (unit.script !== undefined) {
    addNode('spring-script', unit.script, 'unit-script')
    addEdge('spring-unit', 'spring-script', 'script')
  }
  if (bos.value !== null) {
    addNode('spring-script-source', 'BOS source sidecar', 'script-source')
    addEdge('spring-script', 'spring-script-source', 'source-sidecar')
  }
  for (const piece of model.parsed.nodes) {
    addNode(piece.id, piece.name ?? piece.id, 'model-piece')
    addEdge('spring-model', piece.id, 'piece')
  }
  for (const clip of animation.clips) {
    addNode(clip.id, clip.name, 'animation-clip')
    addEdge('spring-script-source', clip.id, 'declares')
    for (const channel of clip.channels) {
      addEdge(clip.id, channel.target, `${channel.kind}:${channel.axis}`)
    }
  }
  const frozenNodes = Object.freeze(nodes)
  const frozenEdges = Object.freeze(edges)
  const summary = Object.freeze({
    snapshotId,
    totalNodes: frozenNodes.length,
    totalEdges: frozenEdges.length,
    types: Object.freeze(
      [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, count], tone) => Object.freeze({ id, label: id, count, tone })),
    ),
    completeness: cob.state === 'resolved' && bos.state === 'resolved' ? 'complete' : 'partial',
  })
  const page = (items, request, signal) => {
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    if (!Number.isSafeInteger(request?.limit) || request.limit <= 0) {
      throw new RangeError('relation graph page limit must be positive')
    }
    const offset = request.cursor === undefined ? 0 : Number(request.cursor)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) {
      throw new RangeError('relation graph page cursor is invalid')
    }
    const end = Math.min(items.length, offset + request.limit)
    return Promise.resolve(
      Object.freeze({
        items: Object.freeze(items.slice(offset, end)),
        ...(end < items.length ? { nextCursor: String(end) } : {}),
      }),
    )
  }
  return Object.freeze({
    summary: async signal => {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return summary
    },
    nodes: (request, signal) => page(frozenNodes, request, signal),
    edges: (request, signal) => page(frozenEdges, request, signal),
  })
}

function requirement(id, role, pattern, required) {
  return Object.freeze({
    id,
    role,
    ownership: 'companion',
    patterns: Object.freeze([pattern]),
    scopes: Object.freeze(['current-mount', 'enclosing-container']),
    cardinality: required ? 'one' : 'zero-or-one',
    required,
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({
    id: 'spring-unit-definition',
    label: 'Spring/Recoil unit definition with external model and script bindings',
  }),
  async detect(prefix) {
    try {
      const unit = parseUnitDefinition(prefix, DETECT_BUDGET)
      if (unit.objectName === undefined) {
        return { confidence: 0, kind: 'structure', note: 'objectName-assignment-missing' }
      }
      return {
        confidence: unit.script === undefined ? 0.92 : 0.985,
        kind: 'structure',
        note: unit.script === undefined ? 'static-unit-definition' : 'model-and-script-assignments',
      }
    } catch {
      return { confidence: 0, kind: 'structure', note: 'unit-definition-parse-mismatch' }
    }
  },
  async planInput(source, _detection, signal) {
    if (
      source.size > DETECT_BUDGET.maxInputBytes ||
      source.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new RangeError('Spring unit definition exceeds the bounded planning window')
    }
    const bytes = await source.read(0n, Number(source.size), signal)
    const unit = parseUnitDefinition(bytes, DETECT_BUDGET, signal)
    if (unit.objectName === undefined)
      throw new TypeError('Spring unit definition has no objectName')
    const requirements = [
      requirement(MODEL_REQUIREMENT, 'object-model', modelPathFor(unit.objectName), true),
    ]
    if (unit.script !== undefined) {
      const scriptPath = scriptPathFor(unit.script)
      requirements.push(requirement(SCRIPT_REQUIREMENT, 'unit-script', scriptPath, false))
      const bosPath = bosPathFor(scriptPath)
      if (bosPath !== undefined) {
        requirements.push(requirement(SOURCE_REQUIREMENT, 'script-source', bosPath, false))
      }
    }
    return Object.freeze({
      originKind: 'bundle',
      candidate: Object.freeze({
        bindingId: 'content',
        role: 'unit-definition',
        ownership: 'owned',
      }),
      requirements: Object.freeze(requirements),
    })
  },
  async inspect(bytes, context) {
    const unit = parseUnitDefinition(bytes, context.budget, context.signal)
    if (unit.objectName === undefined)
      throw new TypeError('Spring unit definition has no objectName')
    const model = await readModel(context.input, context.budget, context.signal)
    const scriptPath = unit.script === undefined ? undefined : scriptPathFor(unit.script)
    const cob =
      scriptPath !== undefined && /\.cob$/iu.test(scriptPath)
        ? await readBinding(
            context.input,
            SCRIPT_REQUIREMENT,
            context.budget,
            context.signal,
            parseCob,
            'COB script',
          )
        : Object.freeze({ state: 'absent', bindingId: null, value: null, diagnostics: [] })
    const bos =
      scriptPath !== undefined && /\.cob$/iu.test(scriptPath)
        ? await readBinding(
            context.input,
            SOURCE_REQUIREMENT,
            context.budget,
            context.signal,
            parseBos,
            'BOS source',
          )
        : Object.freeze({ state: 'absent', bindingId: null, value: null, diagnostics: [] })
    const animation = animationFacts(model, cob, bos)
    const info = {
      scenes: 1,
      nodes: model.parsed.nodes.length,
      meshes: model.parsed.meshes.length,
      primitives: model.parsed.primitives.length,
      materials: 0,
      textures: model.parsed.resources.length,
      animations: animation.clips.length,
      geometryAccess: 'decoded',
    }
    const remainder = [
      'spring-3do',
      's3o-writing',
      'material-semantics',
      'script-control-flow-execution',
      ...(scriptPath !== undefined && /\.lua$/iu.test(scriptPath)
        ? ['external-lua-motion-data']
        : []),
      ...(cob.value !== null && bos.value === null ? ['compiled-cob-motion-bytecode'] : []),
    ]
    const companions = [
      {
        requirementId: MODEL_REQUIREMENT,
        role: 'object-model',
        state: 'bound',
        bindingId: model.bindingId,
      },
      ...(unit.script === undefined
        ? []
        : [
            {
              requirementId: SCRIPT_REQUIREMENT,
              role: 'unit-script',
              state: cob.bindingId === null ? 'absent' : 'bound',
              ...(cob.bindingId === null ? {} : { bindingId: cob.bindingId }),
            },
            ...(bosPathFor(scriptPath) === undefined
              ? []
              : [
                  {
                    requirementId: SOURCE_REQUIREMENT,
                    role: 'script-source',
                    state: bos.bindingId === null ? 'absent' : 'bound',
                    ...(bos.bindingId === null ? {} : { bindingId: bos.bindingId }),
                  },
                ]),
          ]),
    ]
    const descriptorCompanions = [
      {
        id: MODEL_REQUIREMENT,
        role: 'object-model',
        cardinality: 'one',
        required: true,
        state: 'resolved',
        bindingIds: [model.bindingId],
      },
      ...(unit.script === undefined
        ? []
        : [
            {
              id: SCRIPT_REQUIREMENT,
              role: 'unit-script',
              cardinality: 'zero-or-one',
              required: false,
              ...(cob.bindingId === null
                ? { state: 'missing' }
                : { state: 'resolved', bindingIds: [cob.bindingId] }),
            },
            ...(bosPathFor(scriptPath) === undefined
              ? []
              : [
                  {
                    id: SOURCE_REQUIREMENT,
                    role: 'script-source',
                    cardinality: 'zero-or-one',
                    required: false,
                    ...(bos.bindingId === null
                      ? { state: 'missing' }
                      : { state: 'resolved', bindingIds: [bos.bindingId] }),
                  },
                ]),
          ]),
    ]
    const dataSources = {
      'common.view/model-scene-source': createModelSceneSource({
        info,
        nodes: model.parsed.nodes,
        meshes: model.parsed.meshes,
        primitives: model.parsed.primitives,
      }),
      'common.view/tree-data-source': modelTree('Spring/Recoil bound unit', model.parsed.nodes),
      'common.view/relation-graph-source': relationGraph(
        unit,
        model,
        cob,
        bos,
        animation,
        context.input.revisions.revision,
      ),
      ...(model.parsed.resources.length === 0
        ? {}
        : {
            'common.view/model-resource-refs-source': createModelResourceRefsSource({
              references: model.parsed.resources.map(id => ({
                id,
                role: 'texture',
                provenance: 'reference-only',
              })),
            }),
          }),
      ...(animation.clips.length === 0
        ? {}
        : {
            'common.view/model-animation-source': createModelAnimationSource({
              clips: animation.clips,
            }),
          }),
    }
    return {
      summary: {
        format: 'spring-unit-definition',
        objectName: unit.objectName,
        script: unit.script ?? null,
        pieces: model.parsed.nodes.length,
        cob: {
          state: cob.state,
          scripts: cob.value?.scriptCount ?? 0,
          pieces: cob.value?.pieceCount ?? 0,
        },
        bos: {
          state: bos.state,
          functions: bos.value?.functions.length ?? 0,
          motionStatements: bos.value?.motionStatements ?? 0,
        },
        animations: animation.clips.length,
        channels: animation.clips.reduce((sum, clip) => sum + clip.channels.length, 0),
        boundPieces: animation.boundPieces,
        unsupportedChannels: animation.unsupportedChannels,
        namedRemainder: remainder,
      },
      traits: [
        { id: 'model.geometry', parameters: { pieces: model.parsed.nodes.length } },
        { id: 'structure.hierarchy', parameters: { nodes: model.parsed.nodes.length } },
        ...(animation.clips.length === 0
          ? []
          : [
              {
                id: 'model.animations',
                parameters: {
                  animations: animation.clips.length,
                  channels: animation.clips.reduce((sum, clip) => sum + clip.channels.length, 0),
                  boundPieces: animation.boundPieces,
                  provenance: 'companion',
                },
              },
            ]),
        ...(model.parsed.resources.length === 0 ? [] : [{ id: 'model.textures' }]),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      diagnostics: [...cob.diagnostics, ...bos.diagnostics],
      companions: descriptorCompanions,
      maxDecodedBytes: model.parsed.primitives.reduce(
        (sum, primitive) =>
          sum +
          primitive.positions.byteLength +
          primitive.indices.byteLength +
          primitive.normals.byteLength +
          primitive.textureCoordinates.byteLength,
        0,
      ),
      projectionReceipt: createProjectionReceipt({
        adapter: { id: ID, version: '1.0.0' },
        subjectRevision: context.input.revisions.revision,
        companions,
        basis: {
          handedness: 'right',
          upAxis: 'y',
          forwardAxis: '+z',
          unit: 'source-unit',
          sourceUnit: 'elmo',
          unitsPerCell: 8,
        },
        planes: [
          {
            planeId: 'geometry',
            state: 'normalized',
            note: 'bound S3O vertices and normals are converted from left-handed space by negating X; winding is reversed',
          },
          {
            planeId: 'structure',
            state: 'preserved',
            note: `${model.parsed.nodes.length} S3O piece(s), with unit→model→script relations kept separately`,
          },
          {
            planeId: 'resources',
            state: 'preserved',
            note: `${model.parsed.resources.length} confined S3O texture reference(s)`,
          },
          {
            planeId: 'animation',
            state: animation.clips.length === 0 ? 'lost' : 'normalized',
            note:
              animation.clips.length === 0
                ? `no executable-independent tracks proved (COB=${cob.state}, BOS=${bos.state}); no script was run`
                : `${animation.clips.length} BOS function(s), ${animation.boundPieces} stable S3O piece binding(s); explicit source Frame markers only, with no COB/BOS/Lua execution`,
          },
          {
            planeId: 'materials',
            state: 'lost',
            note: 'S3O texture slots do not define material or shader semantics',
          },
          {
            planeId: 'collision',
            state:
              model.parsed.modelCollisionOffset === 0 && model.parsed.pieceCollisionRecords === 0
                ? 'preserved'
                : 'lost',
            note:
              model.parsed.modelCollisionOffset === 0 && model.parsed.pieceCollisionRecords === 0
                ? 'no collision records are declared'
                : 'bound S3O collision records are not decoded',
          },
        ],
        evidence: [
          {
            kind: 'observed',
            statement: `${model.parsed.nodes.length} S3O piece(s), ${animation.clips.length} static BOS clip(s), ${animation.boundPieces} bound piece(s)`,
            bytesRead: BigInt(bytes.byteLength + model.bytes),
          },
          {
            kind: 'declared',
            statement:
              'COB headers and name tables follow Recoil CobFile.cpp; BOS tracks require explicit source Frame markers and matching COB/S3O piece names',
            source: 'recoil-cob-and-bos-data-layout',
          },
        ],
        confidence: animation.clips.length > 0 ? 'high' : 'partial',
      }),
      dataSources,
      unsupportedFeatures: remainder,
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
