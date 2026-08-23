import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/ani'
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

function isWarzoneAni(bytes) {
  return latin1.decode(bytes.subarray(0, Math.min(bytes.byteLength, 16))).startsWith('ANIM3DFRAMES')
}

function walkChunks(bytes, start, end, depth, state) {
  if (depth > state.maxDepth) throw new RangeError('ANI RIFF nesting exceeds maxDepth budget')
  const chunks = []
  let offset = start
  while (offset < end) {
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
  if (!isWindowsAni(bytes)) throw new TypeError('Windows ANI RIFF/ACON header is invalid')
  const riffEnd = 8 + u32(bytes, 4)
  if (riffEnd !== bytes.byteLength)
    throw new TypeError('Windows ANI RIFF size does not match the source')
  const state = { nodes: 0, maxNodes: context.budget.maxNodes, maxDepth: context.budget.maxDepth }
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

function parseWarzoneAni(bytes, maxNodes) {
  if (!isWarzoneAni(bytes)) throw new TypeError('Warzone ANIM3DFRAMES header is invalid')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n')
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length === 0 || lines.length > maxNodes) {
    throw new RangeError('Warzone animation line count is invalid or exceeds maxNodes budget')
  }
  const header = /^ANIM3DFRAMES(?:\s+(\d+))?$/u.exec(lines[0])
  if (header === null) throw new TypeError('Warzone animation first line is malformed')
  const declaredFrames = header[1] === undefined ? undefined : Number(header[1])
  if (
    declaredFrames !== undefined &&
    (!Number.isSafeInteger(declaredFrames) ||
      declaredFrames < 0 ||
      declaredFrames > lines.length - 1)
  ) {
    throw new TypeError('Warzone animation declared frame count is invalid')
  }
  return Object.freeze({ lines: Object.freeze(lines), declaredFrames })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'ani', label: 'Windows Animated Cursor / Warzone Animation' }),
  async detect(prefix) {
    if (isWindowsAni(prefix)) return { confidence: 0.99, kind: 'structure', note: 'riff-acon' }
    if (isWarzoneAni(prefix))
      return { confidence: 0.95, kind: 'structure', note: 'warzone-anim3dframes' }
    return { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    if (isWindowsAni(bytes)) {
      const ani = parseWindowsAni(bytes, context)
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
            ],
          },
        ],
        traits: [
          { id: 'image.frames', parameters: { count: ani.header.frames } },
          { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
        ],
        dataSources: { 'common.view/tree-data-source': tree },
        unsupportedFeatures: ['embedded-icon-pixel-decoding', 'animation-playback', 'ani-writing'],
      }
    }
    const warzone = parseWarzoneAni(bytes, context.budget.maxNodes)
    const tree = createTreeDataSource({
      kind: 'animation',
      label: 'Warzone ANIM3DFRAMES',
      preview: `${warzone.declaredFrames ?? warzone.lines.length - 1} declared frame line(s)`,
      children: warzone.lines.slice(1).map((line, index) => ({
        kind: 'frame',
        label: `Frame line ${index}`,
        preview: line,
      })),
    })
    return {
      summary: {
        format: 'ani',
        variant: 'warzone-anim3dframes',
        declaredFrames: warzone.declaredFrames,
        lines: warzone.lines.length,
      },
      metadata: [
        {
          id: 'warzone-animation',
          label: 'Warzone animation sidecar',
          entries: [
            { key: 'declaredFrames', value: warzone.declaredFrames ?? 'unspecified' },
            { key: 'lines', value: warzone.lines.length },
          ],
        },
      ],
      traits: [{ id: 'content.text', parameters: { lines: warzone.lines.length } }],
      dataSources: { 'common.view/tree-data-source': tree },
      unsupportedFeatures: ['model-animation-application', 'ani-writing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
