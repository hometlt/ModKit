import {
  createInspectionCodec,
  createRasterImageSource,
  createTreeDataSource,
} from '@modkit/codec-kit'
import { decodeEmbeddedIconFrame } from '../ico/container.js'

const ID = 'modkit/ani'
const latin1 = new TextDecoder('latin1')

function tag(bytes, offset) {
  return latin1.decode(bytes.subarray(offset, offset + 4))
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new RangeError('ANI field is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function isWindowsAni(bytes) {
  return bytes.byteLength >= 12 && tag(bytes, 0) === 'RIFF' && tag(bytes, 8) === 'ACON'
}

function walkChunks(bytes, start, end, depth, state) {
  if (state.signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  if (depth > state.maxDepth) throw new RangeError('ANI RIFF nesting exceeds maxDepth budget')
  const chunks = []
  let offset = start
  while (offset < end) {
    if (state.signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
    if (state.nodes >= state.maxNodes)
      throw new RangeError('ANI chunk count exceeds maxNodes budget')
    state.nodes += 1
    if (offset + 8 > end) throw new TypeError('ANI RIFF chunk header is truncated')
    const id = tag(bytes, offset)
    const size = u32(bytes, offset + 4)
    const payload = offset + 8
    const payloadEnd = payload + size
    const paddedEnd = payloadEnd + (size & 1)
    if (payloadEnd > end || paddedEnd > end) throw new TypeError(`ANI ${id} chunk is truncated`)
    let listType
    let children = []
    if (id === 'LIST' || id === 'RIFF') {
      if (size < 4) throw new TypeError(`ANI ${id} chunk has no form type`)
      listType = tag(bytes, payload)
      children = walkChunks(bytes, payload + 4, payloadEnd, depth + 1, state)
    }
    chunks.push(
      Object.freeze({
        id,
        size,
        payload,
        listType,
        children: Object.freeze(children),
      }),
    )
    offset = paddedEnd
  }
  if (offset !== end) throw new TypeError('ANI RIFF padding is malformed')
  return Object.freeze(chunks)
}

function flatten(chunks) {
  return chunks.flatMap(chunk => [chunk, ...flatten(chunk.children)])
}

function parseWindowsAni(bytes, context) {
  if (context.signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  if (!isWindowsAni(bytes)) throw new TypeError('Windows ANI RIFF/ACON header is invalid')
  const riffEnd = 8 + u32(bytes, 4)
  if (riffEnd !== bytes.byteLength)
    throw new TypeError('Windows ANI RIFF size does not match the source')
  const state = {
    nodes: 0,
    maxNodes: context.budget.maxNodes,
    maxDepth: context.budget.maxDepth,
    signal: context.signal,
  }
  const chunks = walkChunks(bytes, 12, riffEnd, 0, state)
  const all = flatten(chunks)
  const headerChunk = all.find(chunk => chunk.id === 'anih')
  if (headerChunk === undefined || headerChunk.size < 36) {
    throw new TypeError('Windows ANI anih chunk is missing or truncated')
  }
  const base = headerChunk.payload
  const header = Object.freeze({
    headerBytes: u32(bytes, base),
    frames: u32(bytes, base + 4),
    steps: u32(bytes, base + 8),
    width: u32(bytes, base + 12),
    height: u32(bytes, base + 16),
    bitDepth: u32(bytes, base + 20),
    planes: u32(bytes, base + 24),
    jiffiesPerStep: u32(bytes, base + 28),
    flags: u32(bytes, base + 32),
  })
  if (header.headerBytes < 36 || header.frames === 0 || header.steps === 0) {
    throw new TypeError('Windows ANI header values are invalid')
  }
  const iconChunks = all.filter(chunk => chunk.id === 'icon')
  if (iconChunks.length === 0 || iconChunks.length < header.frames) {
    throw new TypeError('Windows ANI frame declarations exceed embedded icon chunks')
  }
  for (const [index, chunk] of iconChunks.entries()) {
    if (chunk.size < 4) throw new TypeError(`Windows ANI icon frame ${index} is empty`)
    const type = bytes[chunk.payload + 2]
    if (
      bytes[chunk.payload] !== 0 ||
      bytes[chunk.payload + 1] !== 0 ||
      (type !== 1 && type !== 2)
    ) {
      throw new TypeError(`Windows ANI icon frame ${index} has no ICO/CUR header`)
    }
  }
  const sequence = all.find(chunk => chunk.id === 'seq ')
  const rates = all.find(chunk => chunk.id === 'rate')
  if (sequence !== undefined && sequence.size % 4 !== 0) {
    throw new TypeError('Windows ANI sequence chunk length is invalid')
  }
  if (rates !== undefined && rates.size % 4 !== 0) {
    throw new TypeError('Windows ANI rate chunk length is invalid')
  }
  return Object.freeze({ header, chunks, all, iconChunks, sequence, rates })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'ani', label: 'Windows Animated Cursor' }),
  async detect(prefix) {
    if (isWindowsAni(prefix)) return { confidence: 0.99, kind: 'structure', note: 'riff-acon' }
    return { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const ani = parseWindowsAni(bytes, context)
    const firstIcon = ani.iconChunks[0]
    if (firstIcon === undefined) throw new TypeError('Windows ANI has no first icon frame')
    const firstFrameBytes = bytes.subarray(firstIcon.payload, firstIcon.payload + firstIcon.size)
    const firstFrame = decodeEmbeddedIconFrame(firstFrameBytes, context.budget)
    if (
      firstFrame.decodedBytes !== undefined &&
      firstFrame.decodedBytes > BigInt(context.budget.maxScalarBytes)
    ) {
      throw new RangeError('Windows ANI first frame exceeds maxScalarBytes budget')
    }
    const raster = createRasterImageSource(
      bytes,
      'application/x-navi-animation',
      {
        width: firstFrame.width,
        height: firstFrame.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: 4,
        bitDepth: 8,
        colorSpace: 'srgb',
        alphaMode: 'straight',
        orientation: 'top-left',
        decodedAccess: firstFrame.decodedAccess,
      },
      firstFrame.readRegion,
    )
    const tree = createTreeDataSource({
      kind: 'animation',
      label: 'Windows ANI',
      preview: `${ani.header.frames} frame(s), ${ani.header.steps} playback step(s)`,
      children: ani.chunks.map((chunk, index) => ({
        kind: 'chunk',
        label: `${index}: ${chunk.id}${chunk.listType === undefined ? '' : `/${chunk.listType}`}`,
        preview: `${chunk.size} data bytes`,
      })),
    })
    return {
      summary: {
        format: 'ani',
        variant: 'windows-riff-acon',
        frames: ani.header.frames,
        steps: ani.header.steps,
        width: ani.header.width,
        height: ani.header.height,
        jiffiesPerStep: ani.header.jiffiesPerStep,
        firstFramePayloadKind: firstFrame.payloadKind,
        firstFrameDecodedAccess: firstFrame.decodedAccess,
      },
      metadata: [
        {
          id: 'ani-header',
          label: 'Windows animated cursor',
          entries: [
            { key: 'frames', value: ani.header.frames },
            { key: 'steps', value: ani.header.steps },
            { key: 'width', value: ani.header.width },
            { key: 'height', value: ani.header.height },
            { key: 'bitDepth', value: ani.header.bitDepth },
            { key: 'planes', value: ani.header.planes },
            { key: 'jiffiesPerStep', value: ani.header.jiffiesPerStep },
            { key: 'flags', value: ani.header.flags },
            { key: 'embeddedIcons', value: ani.iconChunks.length },
            { key: 'hasSequence', value: ani.sequence !== undefined },
            { key: 'hasRates', value: ani.rates !== undefined },
            { key: 'firstFramePayloadKind', value: firstFrame.payloadKind },
            { key: 'firstFrameDecodedAccess', value: firstFrame.decodedAccess },
          ],
        },
      ],
      traits: [
        { id: 'image.frames', parameters: { count: ani.header.frames } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      ...(firstFrame.decodedBytes === undefined
        ? {}
        : { maxDecodedBytes: firstFrame.decodedBytes }),
      unsupportedFeatures: [
        ...(firstFrame.decodedAccess ? [] : ['embedded-icon-pixel-decoding']),
        ...(ani.header.frames > 1 ? ['remaining-embedded-icon-frame-decoding'] : []),
        'animation-playback',
        'ani-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
