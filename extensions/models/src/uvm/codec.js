/** UVM/core subject codec: bounded validation/inspection, common document edits and export.
 * Native output is delegated to common.model/native-encoder; per-call conversion diagnostics
 * travel through Host reportDiagnostic with bytes. No native-format or source-game branches.
 * Render/resource/edit ownership remains in the shared Scene/UV/Host services.
 * Manifest: extensions/models/contributions/codec-uvm.json; Node and worker use this module. */
import { validateUvmDocument } from '@modkit/uv/model/validation'
import { DEFAULT_UVM_CONTAINER_BUDGET, readUvmContainer } from '@modkit/uv/model/container'
import {
  prepareUvmFieldWrite,
  prepareUvmEditRequest,
  prepareUvmAnimationAttachmentRequest,
  createUvmJsonEditInputSchema,
} from '@modkit/scene/uvm'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { sha256Hex } from '@modkit/codec-kit/crypto/digest'
import { createInspectionCodec, editPlanFromInput, replaceBytes } from '@modkit/codec-kit'
import { createUvmInspection } from '@modkit/scene/uvm/inspection'
import { NATIVE_MODEL_ENCODER_CONTRACT } from '@modkit/sdk/model-encoding'

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const decoder = new TextDecoder('utf-8', { fatal: true })
const prefixDecoder = new TextDecoder('utf-8', { fatal: false })

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

function uvmDocumentBudget(budget) {
  // Serialized JSON has a separate ceiling from decoded geometry/animation scalar buffers.
  return {
    maxInputBytes: Number(budget.maxInputBytes),
    maxJsonBytes: Math.min(Number(budget.maxInputBytes), DEFAULT_UVM_CONTAINER_BUDGET.maxJsonBytes),
    maxDepth: budget.maxDepth,
    maxNodes: budget.maxNodes,
  }
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

const UVM_OPERATIONS = Object.freeze([
  Object.freeze({
    id: 'model.export-native',
    handlerId: 'export-uvm-native',
    inputSchema: Object.freeze({
      $ref: 'modkit://schemas/uvm/native-model-export.v1',
      document: Object.freeze({
        schemaVersion: 1,
        forms: Object.freeze([
          Object.freeze({
            id: 'uvm-native-model-export',
            label: 'Export native model',
            summary: 'Encode this UVM scene with an installed target model codec.',
            baseInput: Object.freeze({ schemaVersion: 1 }),
            fields: Object.freeze([
              Object.freeze({
                key: 'formatId',
                label: 'Target format',
                type: Object.freeze({ kind: 'text' }),
                inputPath: Object.freeze(['formatId']),
                required: true,
                description: 'Installed native model format id, for example m3 or warzone-pie.',
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
    }),
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source']),
    outputKinds: Object.freeze(['bytes']),
  }),
  Object.freeze({
    id: 'model.export-uvm',
    handlerId: 'export-uvm',
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source']),
    outputKinds: Object.freeze(['bytes']),
  }),
  Object.freeze({
    id: 'model.attach-animation',
    handlerId: 'attach-uvm-animation',
    mutatesSource: true,
    requiredPermissions: Object.freeze(['read-source', 'write-source']),
    outputKinds: Object.freeze(['edit-plan']),
  }),
  Object.freeze({
    id: 'model.render',
    handlerId: 'render-uvm-scene',
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source']),
    outputKinds: Object.freeze(['bytes']),
  }),
  Object.freeze({
    id: 'edit.field',
    handlerId: 'set-uvm-field',
    mutatesSource: true,
    requiredPermissions: Object.freeze(['read-source', 'write-source']),
    outputKinds: Object.freeze(['edit-plan']),
  }),
  Object.freeze({
    id: 'model.edit',
    handlerId: 'edit-uvm-document',
    inputSchema: createUvmJsonEditInputSchema({ reference: 'modkit://schemas/uvm/document-edit' }),
    mutatesSource: true,
    requiredPermissions: Object.freeze(['read-source', 'write-source']),
    outputKinds: Object.freeze(['edit-plan']),
  }),
])

function nativeExportHandler(bytes, context) {
  return async (input, operationContext = {}) => {
    if (context.contracts === undefined)
      throw new TypeError('host native model encoder capability is absent')
    const request = object(input, 'native model export request')
    if (
      request.schemaVersion !== 1 ||
      typeof request.formatId !== 'string' ||
      request.formatId.trim().length === 0 ||
      Object.keys(request).some(key => !['schemaVersion', 'formatId', 'options'].includes(key))
    )
      throw new TypeError('native model export requires {schemaVersion: 1, formatId}')
    const signal = operationContext.signal
    signal?.throwIfAborted()
    const lease = await context.contracts.resolve({
      contract: NATIVE_MODEL_ENCODER_CONTRACT,
      major: 1,
      facet: { formatId: request.formatId },
      operation: 'model.export-native',
      ...(signal === undefined ? {} : { signal }),
    })
    try {
      const encoder = lease.value
      if (
        encoder === null ||
        typeof encoder !== 'object' ||
        encoder.contract !== NATIVE_MODEL_ENCODER_CONTRACT ||
        encoder.formatId !== request.formatId ||
        typeof encoder.encode !== 'function'
      )
        throw new TypeError(`resolved provider is not a ${request.formatId} native model encoder`)
      const encoded = await encoder.encode({
        uvm: bytes.slice(),
        ...(request.options === undefined ? {} : { options: request.options }),
        ...(signal === undefined ? {} : { signal }),
      })
      if (
        encoded === null ||
        typeof encoded !== 'object' ||
        encoded.formatId !== request.formatId ||
        !(encoded.bytes instanceof Uint8Array)
      )
        throw new TypeError(`native model encoder returned an invalid ${request.formatId} result`)
      // the encoder's extension and media type name the file the application writes
      for (const diagnostic of encoded.diagnostics ?? [])
        operationContext.reportDiagnostic?.(diagnostic)
      return {
        kind: 'bytes',
        value: encoded.bytes,
        ...(typeof encoded.extension === 'string' ? { extension: encoded.extension } : {}),
        ...(typeof encoded.mediaType === 'string' ? { mediaType: encoded.mediaType } : {}),
      }
    } finally {
      await lease.release()
    }
  }
}

function uvmEditHandler(bytes, context, prepare) {
  return async (input, operationContext = {}) => {
    const signal = operationContext.signal
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    // Capture the source revision and owner before computing any prospective bytes.
    const base = editPlanFromInput(context.input, {
      planId: `uvm-edit:${context.input.revisions.revision}`,
      edits: [],
      fidelity: {
        roundTrip: 'semantic',
        preservesUnknownData: true,
        notes: [
          'untouched JSON fields, native metadata, BIN bytes and opaque GLB chunks are retained',
        ],
      },
    })
    const candidate = await prepare(bytes, input, {
      budget: uvmDocumentBudget(context.budget),
      signal,
      validate: container =>
        validateUvmDocument(container.document, {
          binaryByteLength: container.binary.length,
          signal,
        }),
    })
    // Validate the full scene/rig as well as the profile before returning a commit plan.
    inspectUvm(candidate, { ...context, signal })
    const target = base.targets[0]
    const digest = await sha256Hex(candidate)
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    return {
      kind: 'edit-plan',
      plan: Object.freeze({
        ...base,
        planId: `${base.planId}:${digest}`,
        edits: Object.freeze([
          Object.freeze({
            ...replaceBytes(0, bytes.length, candidate, 'Edit UVM document'),
            targetId: target.targetId,
            source: target.ownerSource,
          }),
        ]),
      }),
    }
  }
}

/** Only the host resolves the selected source. The scene package owns the UVM composition. */
function animationAttachmentHandler(bytes, context) {
  return uvmEditHandler(bytes, context, async (base, input, options) => {
    const request = object(
      snapshotJson(
        input,
        {
          maxBytes: options.budget.maxJsonBytes,
          maxNodes: options.budget.maxNodes,
          maxDepth: options.budget.maxDepth,
        },
        options.signal,
      ),
      'UVM attachment request',
    )
    if (Object.keys(request).some(key => key !== 'source' && key !== 'binding'))
      throw new TypeError('UVM attachment requires source and binding only')
    const source = object(request.source, 'UVM animation source')
    if (
      Object.keys(source).some(key => !['logicalId', 'expectedRevision', 'size'].includes(key)) ||
      typeof source.logicalId !== 'string' ||
      typeof source.expectedRevision !== 'string' ||
      (source.size !== undefined &&
        (typeof source.size !== 'string' || !/^(0|[1-9]\d*)$/u.test(source.size)))
    )
      throw new TypeError(
        'UVM animation source requires a logical id, expected revision and optional decimal size',
      )
    const binding = object(request.binding, 'UVM animation binding')
    if (context.logicalResources === undefined)
      throw new TypeError('UVM animation attachment requires host logical resources')
    const limit =
      context.budget.maxInputBytes < BigInt(context.budget.maxScalarBytes)
        ? context.budget.maxInputBytes
        : BigInt(context.budget.maxScalarBytes)
    const available = limit - BigInt(base.length)
    if (available < 0n) throw new RangeError('UVM base exceeds the attachment byte budget')
    const batch = await context.logicalResources.readBatch(
      {
        items: [
          {
            requirement: {
              id: 'uvm-animation-bundle',
              logicalId: source.logicalId,
              role: 'sidecar',
              scopes: [
                'explicit-user-selection',
                'sibling-directory',
                'current-mount',
                'enclosing-container',
                'workspace-dependency-layer',
              ],
            },
            expectedRevision: source.expectedRevision,
            ...(source.size === undefined ? {} : { size: BigInt(source.size) }),
          },
        ],
        concurrency: 1,
        readTimeoutMs: 8000,
        totalTimeoutMs: 10000,
        maxBytes: available,
      },
      options.signal,
    )
    if (batch.state !== 'complete')
      throw new TypeError(`UVM animation source refused: ${batch.reason}`)
    const loaded = batch.items[0]
    if (loaded?.state !== 'read')
      throw new TypeError(`UVM animation source unavailable: ${loaded?.reason ?? 'missing-result'}`)
    return prepareUvmAnimationAttachmentRequest(base, loaded.bytes, binding, {
      ...options,
      maxWorkingBytes: context.budget.maxScalarBytes,
    })
  })
}

function inspectUvm(bytes, context) {
  const container = readUvmContainer(bytes, uvmDocumentBudget(context.budget), context.signal)
  const inspection = createUvmInspection(container, {
    budget: { ...context.budget, maxJsonBytes: uvmDocumentBudget(context.budget).maxJsonBytes },
    subjectRevision: context.input.revisions.revision,
    adapter: { id: 'modkit/model-uvm', version: '1.0.0' },
    bytesRead: BigInt(bytes.byteLength),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    ...(context.input.originKind === 'single' ? { treeWrite: { operation: 'edit.field' } } : {}),
  })
  return {
    ...inspection,
    operationStates: [
      ...(context.input.originKind === 'single'
        ? []
        : UVM_OPERATIONS.filter(operation => operation.mutatesSource).map(operation => ({
            id: operation.id,
            state: 'disabled',
            reason: 'UVM document editing requires one revision-pinned source',
          }))),
      ...(context.contracts === undefined
        ? [
            {
              id: 'model.render',
              state: 'dependency-required',
              reason: 'rendering requires the host capability resolver',
            },
            {
              id: 'model.export-native',
              state: 'dependency-required',
              reason: 'native export requires the host capability resolver',
            },
          ]
        : []),
      ...(context.logicalResources === undefined
        ? [
            {
              id: 'model.attach-animation',
              state: 'dependency-required',
              reason: 'animation attachment requires host logical resources',
            },
          ]
        : []),
    ],
    handlers: {
      'export-uvm': async () => ({ kind: 'bytes', value: bytes.slice() }),
      'export-uvm-native': nativeExportHandler(bytes, context),
      'render-uvm-scene': async (input, options) => {
        if (context.contracts === undefined)
          throw new TypeError('host renderer capability is absent')
        const { renderUvmPng } = await import('@modkit/scene/uvm/render')
        return renderUvmPng(bytes, input, {
          ...(context.modelResources === undefined
            ? {}
            : { modelResources: context.modelResources }),
          ...(context.rasterResources === undefined
            ? {}
            : { rasterResources: context.rasterResources }),
          contracts: context.contracts,
          budget: context.budget,
          ...options,
        })
      },
      'set-uvm-field': uvmEditHandler(bytes, context, prepareUvmFieldWrite),
      'edit-uvm-document': uvmEditHandler(bytes, context, prepareUvmEditRequest),
      'attach-uvm-animation': animationAttachmentHandler(bytes, context),
    },
  }
}

const definition = Object.freeze({
  id: 'modkit/model-uvm',
  operations: UVM_OPERATIONS,
  format: Object.freeze({
    id: 'uvm',
    label: 'Universal Verse Model 1.0',
    mediaType: 'model/gltf-binary; profile=uvm-1.0',
  }),
  async detect(bytes, uri = '') {
    const match = looksLikeUvmPrefix(bytes)
    // Large, valid JSON may put the profile after animations/native extras outside the probe.
    // A named UVM candidate is only an extension hint; inspect still validates the complete profile.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const namedPartialGlb =
      bytes.byteLength >= 20 &&
      view.getUint32(0, true) === GLB_MAGIC &&
      view.getUint32(4, true) === 2 &&
      view.getUint32(16, true) === JSON_CHUNK &&
      20 + view.getUint32(12, true) > bytes.byteLength &&
      20 + view.getUint32(12, true) <= view.getUint32(8, true) &&
      /\.uvm(?:\.glb)?(?:[?#]|$)/iu.test(uri)
    return match
      ? { confidence: 0.995, kind: 'structure', note: 'uvm-core-1.0' }
      : namedPartialGlb
        ? { confidence: 0.98, kind: 'extension', note: 'uvm-named-partial-glb' }
        : { confidence: 0.01, kind: 'structure', note: 'uvm-profile-marker-missing' }
  },
  async inspect(bytes, context) {
    return inspectUvm(bytes, context)
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
