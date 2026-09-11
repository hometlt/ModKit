import type { JsonObject, JsonValue } from '@modkit/sdk'
import { array, field, object, finite, integer, oneOf, safeIndex } from './values.js'
import { uvmAccessorWidth } from '../accessor.js'
import { readUvmKeyTimes } from '../key-times.js'

export function validateAnimationPointers(
  document: JsonObject,
  used: readonly JsonValue[],
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted()
  let count = 0
  const accessors = array(document, 'accessors')
  for (const [animationIndex, candidate] of array(document, 'animations').entries()) {
    signal?.throwIfAborted()
    const animation = object(candidate, `animation ${animationIndex}`)
    const samplers = array(animation, 'samplers')
    const animationUv =
      field(animation['extras'], 'uv') === undefined
        ? undefined
        : object(field(animation['extras'], 'uv'), `animation ${animationIndex} extras.uv`)
    const scope = animationUv?.['effectTrackScope']
    const hasGlobalSeqId = Object.prototype.hasOwnProperty.call(animationUv ?? {}, 'globalSeqId')
    if (scope !== undefined && scope !== 'global' && scope !== 'absolute') {
      throw new TypeError(`animation ${animationIndex} effect track scope is invalid`)
    }
    if (
      scope === 'global' &&
      (!integer(animationUv?.['globalSeqId']) || animationUv?.['globalSeqId'] < 0)
    ) {
      throw new TypeError(`animation ${animationIndex} globalSeqId is invalid or missing`)
    }
    if (scope !== 'global' && hasGlobalSeqId) {
      throw new TypeError(`animation ${animationIndex} globalSeqId needs global scope`)
    }
    if (
      animationUv?.['sourceSequenceIndex'] !== undefined &&
      (!integer(animationUv['sourceSequenceIndex']) || animationUv['sourceSequenceIndex'] < 0)
    ) {
      throw new TypeError(`animation ${animationIndex} sourceSequenceIndex is invalid`)
    }
    const targets = new Set<string>()
    for (const [channelIndex, channelCandidate] of array(animation, 'channels').entries()) {
      signal?.throwIfAborted()
      const channel = object(
        channelCandidate,
        `animation ${animationIndex} channel ${channelIndex}`,
      )
      const target = object(channel['target'], `animation ${animationIndex} channel target`)
      const exactTimes = readUvmKeyTimes(
        field(field(channel['extras'], 'uv'), 'keyTimes'),
        undefined,
        signal,
      )
      if (exactTimes !== undefined) {
        const timeSampler = object(
          samplers[safeIndex(channel['sampler'], samplers.length, 'keyTimes sampler')],
          'keyTimes sampler',
        )
        const timeAccessor = object(
          accessors[safeIndex(timeSampler['input'], accessors.length, 'keyTimes accessor')],
          'keyTimes accessor',
        )
        if (
          timeAccessor['count'] !== exactTimes.length ||
          timeAccessor['type'] !== 'SCALAR' ||
          timeAccessor['componentType'] !== 5126
        )
          throw new TypeError('UVM keyTimes accessor shape mismatch')
      }
      const extension = field(target['extensions'], 'KHR_animation_pointer')
      if (target['path'] !== 'pointer' && extension === undefined) continue
      count += 1
      const samplerIndex = safeIndex(
        channel['sampler'],
        samplers.length,
        `animation ${animationIndex} pointer sampler`,
      )
      const sampler = object(samplers[samplerIndex], `animation ${animationIndex} pointer sampler`)
      const pointer = object(extension, `animation ${animationIndex} KHR_animation_pointer`)
      const pointerPath = pointer['pointer']
      if (!safeAnimationPointer(pointerPath))
        throw new TypeError(`animation ${animationIndex} pointer target is unsafe or unresolved`)
      const targetValue = resolvePointer(document, pointerPath)
      if (target['path'] !== 'pointer' || targetValue === undefined) {
        throw new TypeError(`animation ${animationIndex} pointer target is unsafe or unresolved`)
      }
      if (targets.has(pointerPath)) {
        throw new TypeError(`animation ${animationIndex} pointer target is duplicated`)
      }
      targets.add(pointerPath)
      const interpolation = sampler['interpolation'] ?? 'LINEAR'
      if (!oneOf(interpolation, ['STEP', 'LINEAR', 'CUBICSPLINE'])) {
        throw new TypeError(`animation ${animationIndex} pointer interpolation is invalid`)
      }
      const channelUv =
        field(channel['extras'], 'uv') === undefined
          ? undefined
          : object(field(channel['extras'], 'uv'), `animation ${animationIndex} channel extras.uv`)
      const sourceLineType = channelUv?.['sourceLineType']
      if (
        sourceLineType !== undefined &&
        (!integer(sourceLineType) || sourceLineType < 0 || sourceLineType > 3)
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
        sampler['input'],
        accessors.length,
        `animation ${animationIndex} pointer input`,
      )
      const outputIndex = safeIndex(
        sampler['output'],
        accessors.length,
        `animation ${animationIndex} pointer output`,
      )
      const input = object(accessors[inputIndex], `animation ${animationIndex} pointer input`)
      const output = object(accessors[outputIndex], `animation ${animationIndex} pointer output`)
      const targetWidth = finite(targetValue)
        ? 1
        : Array.isArray(targetValue) &&
            targetValue.length > 0 &&
            targetValue.length <= 4 &&
            targetValue.every(finite)
          ? targetValue.length
          : undefined
      const multiplier = interpolation === 'CUBICSPLINE' ? 3 : 1
      if (
        targetWidth === undefined ||
        input['normalized'] === true ||
        output['normalized'] === true ||
        input['componentType'] !== 5126 ||
        input['type'] !== 'SCALAR' ||
        !integer(input['count']) ||
        input['count'] <= 0 ||
        output['componentType'] !== 5126 ||
        uvmAccessorWidth(output['type']) !== targetWidth ||
        output['count'] !== input['count'] * multiplier
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

function safeAnimationPointer(pointer: unknown): pointer is string {
  if (
    typeof pointer !== 'string' ||
    !pointer.startsWith('/') ||
    pointer.includes('\u0000') ||
    /~(?![01])/u.test(pointer)
  )
    return false
  return !['/buffers', '/bufferViews', '/accessors'].some(
    prefix => pointer === prefix || pointer.startsWith(`${prefix}/`),
  )
}

function resolvePointer(root: JsonValue, pointer: string): JsonValue | undefined {
  let current: JsonValue | undefined = root
  for (const encoded of pointer.slice(1).split('/')) {
    const token = encoded.replace(/~1/gu, '/').replace(/~0/gu, '~')
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(token)) return undefined
      const index = Number(token)
      if (!integer(index) || index >= current.length) return undefined
      current = current[index]
    } else if (
      current !== null &&
      typeof current === 'object' &&
      Object.prototype.hasOwnProperty.call(current, token)
    ) {
      current = (current as JsonObject)[token]
    } else {
      return undefined
    }
  }
  return current
}
