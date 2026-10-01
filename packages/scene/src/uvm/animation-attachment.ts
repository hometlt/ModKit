import type { JsonObject, JsonValue } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  readUvmContainer,
  writeUvmContainer,
  type UvmContainer,
  type UvmContainerBudget,
} from '@modkit/uv/model/container'
import { readUvmAccessor } from '@modkit/uv/model/accessor'
import {
  readUvmAnimationClips,
  readUvmPrimitiveVisibility,
  readUvmAnimationMaterialTargets,
  uvmVisibilityPointer,
  uvmVisibilityTarget,
  type UvmAnimationClip,
} from '@modkit/uv/model/animation-clips'
import { validateUvmDocument } from '@modkit/uv/model/validation'
import { array, field, object, safeIndex, required } from './values.js'
import { attachMaterialSequences } from './animation-materials.js'
import type { UvmDocument, UvmDocumentStatus } from './document.js'

export interface UvmAnimationTargetMap {
  readonly source: number
  readonly target: number
}
export interface UvmAnimationMaterialTargetMap extends UvmAnimationTargetMap {
  readonly sourceKind?: 'material' | 'animation-target'
}
export interface UvmAnimationPrimitiveTarget {
  readonly mesh: number
  readonly primitive: number
}
export interface UvmAnimationAttachmentRequest {
  readonly id: string
  /** Selectable catalog ids; every destination identity and material timeline index is explicit. */
  readonly clips: readonly {
    readonly sourceId: string
    readonly id: string
    readonly sequenceIndex: number
  }[]
  readonly nodes?: readonly UvmAnimationTargetMap[]
  readonly materials?: readonly UvmAnimationMaterialTargetMap[]
  readonly primitives?: readonly {
    readonly source: UvmAnimationPrimitiveTarget
    readonly target: UvmAnimationPrimitiveTarget
  }[]
  readonly pointers?: readonly { readonly source: string; readonly target: string }[]
}
export interface UvmAnimationAttachmentOptions {
  readonly budget?: UvmContainerBudget
  /** Conservative input, output and decode working allocations. */
  readonly maxWorkingBytes?: number
  readonly signal?: AbortSignal
}
export interface UvmAnimationAttachmentResult {
  readonly container: UvmContainer
  readonly clips: readonly UvmAnimationClip[]
  /** Preserved active channels outside current common scene playback support. */
  readonly playbackLimitations: readonly string[]
}

function nonnegative(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new TypeError(`${label} must be a nonnegative integer`)
  return value
}
function name(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be nonempty`)
  return value
}
function list(value: unknown, label: string): readonly JsonValue[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  return value
}
function fields(value: JsonObject, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key)))
    throw new TypeError('unknown animation attachment field')
}
function pointerValue(document: JsonObject, pointer: string, maxDepth: number): JsonValue {
  if (!pointer.startsWith('/') || /~(?:[^01]|$)/u.test(pointer))
    throw new TypeError('invalid animation pointer')
  const tokens = pointer.slice(1).split('/')
  if (
    tokens.length > maxDepth ||
    ['buffers', 'bufferViews', 'accessors'].includes(tokens[0] ?? '')
  )
    throw new TypeError('animation pointer addresses storage or exceeds depth')
  let value: JsonValue = document
  for (const token of tokens) {
    const key = token.replace(/~1/gu, '/').replace(/~0/gu, '~')
    value = Array.isArray(value)
      ? required(
          value[
            safeIndex(/^(0|[1-9]\d*)$/u.test(key) ? Number(key) : NaN, value.length, 'pointer')
          ],
          'pointer',
        )
      : required(object(value, 'pointer parent')[key], 'pointer')
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 4 &&
    value.every(item => typeof item === 'number' && Number.isFinite(item))
  )
    return value
  throw new TypeError('animation pointer must target a numeric scalar or vector')
}
function noIndexedExtensions(value: JsonObject, label: string): void {
  if (Object.keys(object(value['extensions'] ?? {}, `${label} extensions`)).length > 0)
    throw new TypeError(`${label} has extension indices without an attachment remapping policy`)
}

/** Compose extended glTF directly. No publisher namespace, native metadata or filesystem is read. */
export async function composeUvmAnimationBundle(
  base: UvmContainer,
  bundle: UvmContainer,
  request: UvmAnimationAttachmentRequest,
  options: UvmAnimationAttachmentOptions = {},
): Promise<UvmAnimationAttachmentResult> {
  const signal = options.signal
  signal?.throwIfAborted()
  const budget = Object.freeze({ ...(options.budget ?? DEFAULT_UVM_CONTAINER_BUDGET) })
  const maxWorkingBytes = nonnegative(
    options.maxWorkingBytes ?? 536_870_912,
    'attachment maxWorkingBytes',
  )
  const jsonBudget = {
    maxDepth: budget.maxDepth,
    maxNodes: budget.maxNodes,
    maxBytes: budget.maxJsonBytes,
  }
  const input = object(snapshotJson(request, jsonBudget, signal), 'animation attachment')
  fields(input, ['id', 'clips', 'nodes', 'materials', 'primitives', 'pointers'])
  const id = name(input['id'], 'attachment id')
  let workingBytes = 0
  const reserve = (bytes: number) => {
    workingBytes += bytes
    if (!Number.isSafeInteger(workingBytes) || workingBytes > maxWorkingBytes)
      throw new RangeError('animation attachment exceeds maxWorkingBytes')
  }
  // Both complete containers and the request are owned before the only asynchronous step.
  reserve(base.binary.byteLength + bundle.binary.byteLength)
  const baseBytes = writeUvmContainer(base, budget, signal)
  const sourceBytes = writeUvmContainer(bundle, budget, signal)
  reserve((baseBytes.length + sourceBytes.length) * 3)
  const ownedBase = readUvmContainer(baseBytes, budget, signal)
  const ownedBundle = readUvmContainer(sourceBytes, budget, signal)
  await Promise.resolve()
  signal?.throwIfAborted()
  if (ownedBase.format !== 'glb' || ownedBundle.format !== 'glb')
    throw new TypeError('animation attachment requires embedded UVM GLB containers')
  for (const container of [ownedBase, ownedBundle]) {
    validateUvmDocument(container.document, {
      binaryByteLength: container.binary.length,
      ...(signal === undefined ? {} : { signal }),
    })
    const buffers = array(container.document, 'buffers')
    const buffer = object(buffers[0] ?? { byteLength: 0 }, 'embedded buffer')
    const length = nonnegative(buffer['byteLength'], 'embedded buffer length')
    if (
      buffers.length > 1 ||
      buffer['uri'] !== undefined ||
      length > container.binary.length ||
      container.binary.length - length > 3
    )
      throw new TypeError('attachment storage must be a single embedded BIN buffer')
  }
  const source = ownedBundle.document
  let document = ownedBase.document
  const existingAttachments = array(
    field(document['extensions'], 'UV_game_animation_clips'),
    'attachments',
  )
  if (existingAttachments.some(item => field(item, 'id') === id))
    throw new TypeError('animation attachment id already exists')
  const decoded = new Map<UvmContainer, Map<number, ReturnType<typeof readUvmAccessor>>>()
  const read = (container: UvmContainer, index: unknown) => {
    const accessorIndex = safeIndex(
      index,
      array(container.document, 'accessors').length,
      'attachment accessor',
    )
    const cached = decoded.get(container) ?? new Map<number, ReturnType<typeof readUvmAccessor>>()
    decoded.set(container, cached)
    const old = cached.get(accessorIndex)
    if (old !== undefined) return old
    const value = readUvmAccessor(
      container.document,
      container.binary,
      accessorIndex,
      { maxScalarBytes: maxWorkingBytes - workingBytes },
      'animation attachment',
      signal,
    )
    reserve(value.values.byteLength)
    if (!value.values.every(Number.isFinite))
      throw new TypeError('animation attachment has non-finite samples')
    cached.set(accessorIndex, value)
    return value
  }
  const catalog = (container: UvmContainer): readonly UvmAnimationClip[] => {
    const declared = readUvmAnimationClips(container.document, signal)
    if (declared !== undefined) return declared
    return array(container.document, 'animations').flatMap(
      (candidate, index): UvmAnimationClip[] => {
        const animation = object(candidate, 'legacy animation')
        const metadata = object(field(animation['extras'], 'uv') ?? {}, 'animation metadata')
        if (
          metadata['effectTrackScope'] === 'absolute' ||
          metadata['effectTrackScope'] === 'global'
        )
          return []
        let duration = 0
        const frames = new Set<number>()
        for (const sampler of array(animation, 'samplers')) {
          const time = read(container, field(sampler, 'input'))
          if (
            time.width !== 1 ||
            time.componentType !== 5126 ||
            time.normalized ||
            time.count === 0
          )
            throw new TypeError('animation time must be nonempty float SCALAR')
          let previous = -Infinity
          for (const value of time.values) {
            if (value < 0 || value <= previous) throw new TypeError('animation times must increase')
            previous = value
            duration = Math.max(duration, value)
            frames.add(value)
          }
        }
        const declaredDuration = metadata['sourceDurationSeconds']
        if (declaredDuration !== undefined) {
          if (
            typeof declaredDuration !== 'number' ||
            !Number.isFinite(declaredDuration) ||
            declaredDuration < 0
          )
            throw new TypeError('invalid source animation duration')
          duration = declaredDuration
        }
        const looping = metadata['looping']
        if (looping !== undefined && typeof looping !== 'boolean')
          throw new TypeError('invalid animation looping')
        const repeatCount = metadata['repeatCount']
        if (
          repeatCount !== undefined &&
          (typeof repeatCount !== 'number' || !Number.isSafeInteger(repeatCount) || repeatCount < 0)
        ) throw new TypeError('invalid animation repeat count')
        return [
          {
            id: `animation-${index}`,
            name: typeof animation['name'] === 'string' ? animation['name'] : '',
            animation: index,
            durationSeconds: duration,
            sourceSequenceIndex: nonnegative(
              metadata['sourceSequenceIndex'] ?? index,
              'source sequence',
              0xffffffff,
            ),
            kind: frames.size > 1 ? 'animation' : 'rest-pose',
            frames: frames.size,
            ...(looping === undefined ? {} : { looping }),
            ...(repeatCount === undefined ? {} : { repeatCount }),
          },
        ]
      },
    )
  }
  const baseCatalog = catalog(ownedBase),
    sourceCatalog = catalog(ownedBundle)
  const rawCatalog = (doc: JsonObject) =>
    new Map(
      array(field(doc['extensions'], 'UV_game_animation_clips'), 'clips').map(value => {
        const entry = object(value, 'catalog record')
        return [name(entry['id'], 'catalog id'), entry] as const
      }),
    )
  const baseRecords = rawCatalog(document),
    sourceRecords = rawCatalog(source)
  const sourceById = new Map(sourceCatalog.map(clip => [clip.id, clip]))
  const clips = list(input['clips'], 'attachment clips')
  if (clips.length === 0) throw new TypeError('attachment requires selected clips')
  const ids = new Set(baseCatalog.map(clip => clip.id)),
    sequences = new Set(baseCatalog.map(clip => clip.sourceSequenceIndex))
  const sequenceMap = new Map<number, number>()
  const selected = clips.map(candidate => {
    const entry = object(candidate, 'attachment clip')
    fields(entry, ['sourceId', 'id', 'sequenceIndex'])
    const sourceId = name(entry['sourceId'], 'source clip id'),
      targetId = name(entry['id'], 'destination clip id')
    const sequenceIndex = nonnegative(entry['sequenceIndex'], 'destination sequence', 0xffffffff)
    const clip = sourceById.get(sourceId)
    if (clip === undefined) throw new TypeError(`unknown attachment source clip: ${sourceId}`)
    if (
      ids.has(targetId) ||
      sequences.has(sequenceIndex) ||
      sequenceMap.has(clip.sourceSequenceIndex)
    )
      throw new TypeError('animation attachment has duplicate clip or sequence identities')
    ids.add(targetId)
    sequences.add(sequenceIndex)
    sequenceMap.set(clip.sourceSequenceIndex, sequenceIndex)
    return { clip, id: targetId, sequenceIndex }
  })
  const indexMap = (key: 'nodes' | 'materials') => {
    const result = new Map<number, number>()
    for (const value of list(input[key], key)) {
      const item = object(value, key)
      fields(item, ['source', 'target'])
      const from = safeIndex(item['source'], array(source, key).length, `source ${key}`)
      const to = safeIndex(item['target'], array(document, key).length, `destination ${key}`)
      if (result.has(from)) throw new TypeError(`duplicate ${key} mapping`)
      result.set(from, to)
    }
    return result
  }
  const nodeMap = indexMap('nodes')
  const materialMap = new Map<string, number>()
  for (const candidate of list(input['materials'], 'material mappings')) {
    const item = object(candidate, 'material mapping')
    fields(item, ['source', 'target', 'sourceKind'])
    const kind = item['sourceKind'] ?? 'material'
    if (kind !== 'material' && kind !== 'animation-target')
      throw new TypeError('unknown attachment material source kind')
    const count =
      kind === 'material'
        ? array(source, 'materials').length
        : readUvmAnimationMaterialTargets(source, signal).length
    const from = safeIndex(item['source'], count, 'source material target')
    const to = safeIndex(
      item['target'],
      array(document, 'materials').length,
      'destination material',
    )
    const key = `${kind}:${from}`
    if (materialMap.has(key)) throw new TypeError('duplicate material mapping')
    materialMap.set(key, to)
  }
  const primitiveMap = new Map<string, UvmAnimationPrimitiveTarget>()
  const primitiveTarget = (value: unknown, doc: JsonObject) => {
    const item = object(value, 'primitive target')
    fields(item, ['mesh', 'primitive'])
    const meshes = array(doc, 'meshes')
    const mesh = safeIndex(item['mesh'], meshes.length, 'target mesh')
    return {
      mesh,
      primitive: safeIndex(
        item['primitive'],
        array(meshes[mesh], 'primitives').length,
        'target primitive',
      ),
    }
  }
  for (const value of list(input['primitives'], 'primitive mappings')) {
    const item = object(value, 'primitive mapping')
    fields(item, ['source', 'target'])
    const from = primitiveTarget(item['source'], source),
      to = primitiveTarget(item['target'], document)
    const key = `${from.mesh}/${from.primitive}`
    if (primitiveMap.has(key)) throw new TypeError('duplicate primitive mapping')
    primitiveMap.set(key, to)
  }
  const pointerMap = new Map<string, string>()
  for (const value of list(input['pointers'], 'pointer mappings')) {
    const item = object(value, 'pointer mapping')
    fields(item, ['source', 'target'])
    const from = name(item['source'], 'source pointer'),
      to = name(item['target'], 'target pointer')
    const a = pointerValue(source, from, budget.maxDepth),
      b = pointerValue(document, to, budget.maxDepth)
    if (
      (Array.isArray(a) ? a.length : 1) !== (Array.isArray(b) ? b.length : 1) ||
      pointerMap.has(from)
    )
      throw new TypeError('pointer mapping width differs or source repeats')
    pointerMap.set(from, to)
  }
  const sourceVisibility = readUvmPrimitiveVisibility(source, signal)
  const visibility = [...readUvmPrimitiveVisibility(document, signal)]
  const animations = [...array(document, 'animations')]
  const views = [...array(document, 'bufferViews')],
    accessors = [...array(document, 'accessors')]
  const viewMap = new Map<number, number>(),
    accessorMap = new Map<number, number>()
  const chunks: { offset: number; bytes: Uint8Array }[] = []
  let binaryLength = ownedBase.binary.length
  const copyAccessor = (index: unknown) => {
    const from = safeIndex(index, array(source, 'accessors').length, 'source accessor')
    const cached = accessorMap.get(from)
    if (cached !== undefined) return cached
    read(ownedBundle, from)
    const accessor = object(array(source, 'accessors')[from], 'source accessor')
    noIndexedExtensions(accessor, 'accessor')
    const viewIndex = safeIndex(
      accessor['bufferView'],
      array(source, 'bufferViews').length,
      'source view',
    )
    let mapped = viewMap.get(viewIndex)
    if (mapped === undefined) {
      const view = object(array(source, 'bufferViews')[viewIndex], 'source view')
      noIndexedExtensions(view, 'bufferView')
      const offset = nonnegative(view['byteOffset'] ?? 0, 'view offset'),
        length = nonnegative(view['byteLength'], 'view length')
      if (offset + length > ownedBundle.binary.length)
        throw new RangeError('attachment view exceeds BIN')
      binaryLength = Math.ceil(binaryLength / 4) * 4
      reserve(length * 2)
      chunks.push({
        offset: binaryLength,
        bytes: ownedBundle.binary.subarray(offset, offset + length),
      })
      mapped = views.length
      viewMap.set(viewIndex, mapped)
      views.push({ ...view, buffer: 0, byteOffset: binaryLength })
      binaryLength += length
      if (binaryLength > budget.maxInputBytes)
        throw new RangeError('attachment BIN exceeds maxInputBytes')
    }
    const mappedAccessor = accessors.length
    accessors.push({ ...accessor, bufferView: mapped })
    accessorMap.set(from, mappedAccessor)
    return mappedAccessor
  }
  const playbackLimitations = new Set<string>()
  const appended: UvmAnimationClip[] = []
  const appendedRecords: JsonObject[] = []
  let pointerUsed = false
  let eventsUsed = false
  for (const { clip, id: clipId, sequenceIndex } of selected) {
    signal?.throwIfAborted()
    let animationIndex: number | undefined
    if (clip.animation !== undefined) {
      const sourceAnimation = object(
        array(source, 'animations')[clip.animation],
        'source animation',
      )
      // how the clip plays carries no index; its events name sockets, mapped as targets are
      const { extensions: animationExtensions, ...withoutExtensions } = sourceAnimation
      const {
        UV_game_animation_clips: playback,
        UV_game_animation_events: events,
        ...others
      } = object(animationExtensions ?? {}, 'source animation extensions')
      noIndexedExtensions({ extensions: others }, 'animation')
      const mappedEvents =
        events === undefined
          ? undefined
          : {
              events: array(events, 'events').map(value => {
                const event = object(value, 'source animation event')
                const socket = event['socket']
                return socket === undefined
                  ? event
                  : {
                      ...event,
                      socket: required(
                        nodeMap.get(safeIndex(socket, array(source, 'nodes').length, 'event node')),
                        `explicit node mapping for ${String(socket)}`,
                      ),
                    }
              }),
            }
      if (mappedEvents !== undefined) eventsUsed = true
      const animation: JsonObject = {
        ...withoutExtensions,
        ...(playback === undefined && mappedEvents === undefined
          ? {}
          : {
              extensions: {
                ...(playback === undefined ? {} : { UV_game_animation_clips: playback }),
                ...(mappedEvents === undefined ? {} : { UV_game_animation_events: mappedEvents }),
              },
            }),
      }
      const samplers = array(animation, 'samplers').map(value => {
        const sampler = object(value, 'source sampler')
        noIndexedExtensions(sampler, 'animation sampler')
        const time = read(ownedBundle, sampler['input'])
        const output = read(ownedBundle, sampler['output'])
        if (
          time.width !== 1 ||
          time.componentType !== 5126 ||
          time.normalized ||
          time.count === 0 ||
          output.componentType !== 5126 ||
          output.normalized
        )
          throw new TypeError('attachment animation requires float accessors')
        let previous = -Infinity
        for (const value of time.values) {
          if (value < 0 || value <= previous) throw new TypeError('attachment times must increase')
          previous = value
        }
        const interpolation = sampler['interpolation'] ?? 'LINEAR'
        if (!['STEP', 'LINEAR', 'CUBICSPLINE'].includes(String(interpolation)))
          throw new TypeError('invalid animation interpolation')
        if (interpolation === 'CUBICSPLINE')
          playbackLimitations.add(
            'CUBICSPLINE channels are preserved; common scene sampling is not implemented',
          )
        return {
          ...sampler,
          input: copyAccessor(sampler['input']),
          output: copyAccessor(sampler['output']),
        }
      })
      const targets = new Set<string>()
      const channels = array(animation, 'channels').map(candidate => {
        const channel = object(candidate, 'source channel')
        noIndexedExtensions(channel, 'animation channel')
        const samplerIndex = safeIndex(
          channel['sampler'],
          samplers.length,
          'animation channel sampler',
        )
        const sourceSampler = object(array(animation, 'samplers')[samplerIndex], 'source sampler')
        const inputAccessor = read(ownedBundle, sourceSampler['input'])
        const outputAccessor = read(ownedBundle, sourceSampler['output'])
        const multiplier = sourceSampler['interpolation'] === 'CUBICSPLINE' ? 3 : 1
        const target = object(channel['target'], 'source target')
        let mapped: JsonObject
        let key: string
        if (target['path'] === 'pointer') {
          const pointer = name(
            field(field(target['extensions'], 'KHR_animation_pointer'), 'pointer'),
            'source animation pointer',
          )
          const visible = uvmVisibilityTarget(pointer, sourceVisibility)
          let destination: string
          if (visible !== undefined) {
            if ('node' in visible)
              throw new TypeError('attachment of inactive batch visibility requires an explicit node binding')
            const primitive = primitiveMap.get(`${visible.mesh}/${visible.primitive}`)
            if (primitive === undefined)
              throw new TypeError('attachment lacks explicit visibility primitive mapping')
            let index = visibility.findIndex(
              item =>
                'mesh' in item &&
                item.mesh === primitive.mesh &&
                item.primitive === primitive.primitive,
            )
            if (index < 0) {
              index = visibility.length
              visibility.push({ ...primitive, value: 1 })
            }
            destination = uvmVisibilityPointer(index)
          } else {
            destination = required(
              pointerMap.get(pointer),
              `explicit pointer mapping for ${pointer}`,
            )
            playbackLimitations.add(
              `General animation pointer ${destination} is preserved; common scene sampling is not implemented`,
            )
          }
          const extensions = object(target['extensions'], 'pointer extensions')
          if (Object.keys(extensions).some(key => key !== 'KHR_animation_pointer'))
            throw new TypeError('unmapped pointer target extension')
          mapped = {
            ...target,
            extensions: {
              ...extensions,
              KHR_animation_pointer: {
                ...object(extensions['KHR_animation_pointer'], 'pointer extension'),
                pointer: destination,
              },
            },
          }
          key = destination
          pointerUsed = true
        } else {
          noIndexedExtensions(target, 'animation target')
          const path = target['path']
          if (!['translation', 'rotation', 'scale', 'weights'].includes(String(path)))
            throw new TypeError('unsupported attachment target path')
          const from = safeIndex(
            target['node'],
            array(source, 'nodes').length,
            'source target node',
          )
          const to = required(nodeMap.get(from), `explicit node mapping for ${from}`)
          if (path !== 'weights' && field(array(document, 'nodes')[to], 'matrix') !== undefined)
            throw new TypeError('animation target cannot use a matrix')
          if (path === 'weights') {
            const morphCount = (doc: JsonObject, nodeIndex: number) => {
              const node = object(array(doc, 'nodes')[nodeIndex], 'morph node')
              const meshes = array(doc, 'meshes')
              const mesh = object(
                meshes[safeIndex(node['mesh'], meshes.length, 'morph mesh')],
                'morph mesh',
              )
              const counts = new Set(
                array(mesh, 'primitives').map(primitive => array(primitive, 'targets').length),
              )
              const count = counts.values().next().value
              if (counts.size !== 1 || count === undefined || count === 0)
                throw new TypeError('morph attachment needs matching explicit primitive targets')
              return count
            }
            const count = morphCount(source, from)
            if (
              morphCount(document, to) !== count ||
              outputAccessor.width !== 1 ||
              outputAccessor.count !== inputAccessor.count * multiplier * count
            )
              throw new TypeError('attachment morph targets and output accessor shape differ')
            playbackLimitations.add(
              'Morph weight channels are preserved; common scene sampling is not implemented',
            )
          } else {
            const width = path === 'rotation' ? 4 : 3
            if (
              outputAccessor.width !== width ||
              outputAccessor.count !== inputAccessor.count * multiplier
            )
              throw new TypeError('attachment TRS output accessor shape is invalid')
            if (path === 'rotation')
              for (let frame = 0; frame < inputAccessor.count; frame++) {
                const start = (frame * multiplier + (multiplier === 3 ? 1 : 0)) * 4
                if (
                  Math.abs(Math.hypot(...outputAccessor.values.subarray(start, start + 4)) - 1) >
                  0.0001
                )
                  throw new TypeError('attachment rotation key is not a unit quaternion')
              }
            if (!array(document, 'skins').some(skin => array(skin, 'joints').includes(to)))
              playbackLimitations.add(
                `Node TRS target node-${to} has no explicit skeleton binding for common scene playback`,
              )
          }
          mapped = { ...target, node: to }
          key = `${to}/${String(path)}`
        }
        if (targets.has(key)) throw new TypeError('attachment target remapping merges channels')
        targets.add(key)
        return { ...channel, target: mapped }
      })
      if (channels.length === 0 || samplers.length === 0)
        throw new TypeError('cannot attach an empty glTF animation')
      animationIndex = animations.length
      animations.push({
        ...animation,
        channels,
        samplers,
        extras: {
          ...object(animation['extras'] ?? {}, 'animation extras'),
          uv: {
            ...object(field(animation['extras'], 'uv') ?? {}, 'animation metadata'),
            sourceSequenceIndex: sequenceIndex,
          },
        },
      })
    }
    const mappedClip = {
      ...clip,
      id: clipId,
      sourceSequenceIndex: sequenceIndex,
      ...(animationIndex === undefined ? {} : { animation: animationIndex }),
    }
    appended.push(mappedClip)
    appendedRecords.push({ ...sourceRecords.get(clip.id), ...mappedClip })
  }
  document = attachMaterialSequences(source, document, sequenceMap, materialMap, jsonBudget, signal)
  const extensions = object(document['extensions'], 'base extensions')
  const used = new Set(array(document, 'extensionsUsed'))
  used.add('UV_game_animation_clips')
  if (eventsUsed) used.add('UV_game_animation_events')
  if (pointerUsed) used.add('KHR_animation_pointer')
  if (visibility.length > 0) used.add('UV_game_variants')
  const binary = new Uint8Array(binaryLength)
  binary.set(ownedBase.binary)
  for (const chunk of chunks) binary.set(chunk.bytes, chunk.offset)
  const catalogDocument = object(
    snapshotJson(
      {
        ...document,
        ...(animations.length === 0 ? {} : { animations }),
        accessors,
        bufferViews: views,
        buffers: [
          {
            ...object(array(document, 'buffers')[0] ?? {}, 'base buffer'),
            byteLength: binaryLength,
          },
        ],
        extensionsUsed: [...used],
        extensions: {
          ...extensions,
          UV_game_animation_clips: {
            ...object(extensions['UV_game_animation_clips'] ?? {}, 'base catalog'),
            clips: [
              ...baseCatalog.map(clip => ({ ...baseRecords.get(clip.id), ...clip })),
              ...appendedRecords,
            ],
          },
          ...(visibility.length === 0
            ? {}
            : {
                UV_game_variants: {
                  ...object(extensions['UV_game_variants'] ?? {}, 'variants'),
                  visibility,
                },
              }),
        },
      },
      jsonBudget,
      signal,
    ),
    'composed document',
  )
  const candidate = { ...ownedBase, document: catalogDocument, binary }
  validateUvmDocument(catalogDocument, {
    binaryByteLength: binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  reserve(writeUvmContainer(candidate, budget, signal).length * 3)
  signal?.throwIfAborted()
  const retainedExtensions = object(candidate.document['extensions'], 'composed extensions')
  const result = readUvmContainer(
    writeUvmContainer(
      {
        ...candidate,
        document: {
          ...candidate.document,
          extensions: {
            ...retainedExtensions,
            UV_game_animation_clips: {
              ...object(retainedExtensions['UV_game_animation_clips'], 'composed catalog'),
              attachments: [
                ...existingAttachments,
                {
                  id,
                  mapping: input,
                  clips: appended.map(clip => clip.id),
                  playbackLimitations: [...playbackLimitations],
                },
              ],
            },
          },
        },
      },
      budget,
      signal,
    ),
    budget,
    signal,
  )
  validateUvmDocument(result.document, {
    binaryByteLength: result.binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  return Object.freeze({
    container: result,
    clips: Object.freeze(appended.map(clip => Object.freeze(clip))),
    playbackLimitations: Object.freeze([...playbackLimitations]),
  })
}

/** A single owned replacement commits only against the revision captured before asynchronous work. */
export async function attachUvmAnimationBundle(
  document: UvmDocument,
  expectedRevision: number,
  bundle: UvmContainer,
  request: UvmAnimationAttachmentRequest,
  options?: UvmAnimationAttachmentOptions,
): Promise<UvmAnimationAttachmentResult & { readonly status: UvmDocumentStatus }> {
  const signal = options?.signal
  if (document.status().revision !== expectedRevision)
    throw new TypeError('stale UVM document revision')
  const result = await composeUvmAnimationBundle(document.snapshot(), bundle, request, options)
  signal?.throwIfAborted()
  const status = document.replace({ expectedRevision, container: result.container })
  return Object.freeze({ ...result, status })
}
