import {
  createAudioMediaSource,
  createInspectionCodec,
  createTransportHandlers,
  createTransportSource,
  createTreeDataSource,
  editPlanFromInput,
  replaceBytes,
  TRANSPORT_OPERATIONS,
} from '@modkit/codec-kit'

const latin1 = new TextDecoder('latin1')
const utf8 = new TextEncoder()
const ID3_HEADER_BYTES = 10
const UNSYNCHRONISED = 0x80
const EXTENDED_HEADER = 0x40
const FOOTER_PRESENT = 0x10
/** A synchsafe integer carries 7 bits per byte, so a tag or a v2.4 frame stops here. */
const MAX_SYNCHSAFE = 0x0fffffff

function isId3(bytes) {
  return bytes.byteLength >= 10 && latin1.decode(bytes.subarray(0, 3)) === 'ID3'
}

function id3Size(bytes) {
  if (!isId3(bytes)) return 0
  const size =
    (((bytes[6] ?? 0) & 0x7f) << 21) |
    (((bytes[7] ?? 0) & 0x7f) << 14) |
    (((bytes[8] ?? 0) & 0x7f) << 7) |
    ((bytes[9] ?? 0) & 0x7f)
  return 10 + size + (((bytes[5] ?? 0) & 0x10) !== 0 ? 10 : 0)
}

function frameAt(bytes, offset) {
  if (
    offset + 4 > bytes.byteLength ||
    bytes[offset] !== 0xff ||
    ((bytes[offset + 1] ?? 0) & 0xe0) !== 0xe0
  ) {
    return undefined
  }
  const b1 = bytes[offset + 1] ?? 0
  const b2 = bytes[offset + 2] ?? 0
  const b3 = bytes[offset + 3] ?? 0
  const versionBits = (b1 >> 3) & 3
  const layerBits = (b1 >> 1) & 3
  const bitrateIndex = (b2 >> 4) & 0x0f
  const sampleIndex = (b2 >> 2) & 3
  if (
    versionBits === 1 ||
    layerBits !== 1 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleIndex === 3
  ) {
    return undefined
  }
  const version = versionBits === 3 ? 'MPEG-1' : versionBits === 2 ? 'MPEG-2' : 'MPEG-2.5'
  const sampleBase = [44_100, 48_000, 32_000][sampleIndex]
  const sampleRate =
    versionBits === 3 ? sampleBase : versionBits === 2 ? sampleBase / 2 : sampleBase / 4
  const bitrates =
    versionBits === 3
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  return Object.freeze({
    offset,
    version,
    layer: 'III',
    sampleRate,
    bitrateKbps: bitrates[bitrateIndex],
    channels: ((b3 >> 6) & 3) === 3 ? 1 : 2,
  })
}

function findFrame(bytes) {
  const start = Math.min(id3Size(bytes), bytes.byteLength)
  const end = Math.min(bytes.byteLength - 3, start + 16_384)
  for (let offset = start; offset < end; offset += 1) {
    const frame = frameAt(bytes, offset)
    if (frame !== undefined) return frame
  }
  return undefined
}

function id3Info(bytes) {
  if (!isId3(bytes)) return undefined
  return Object.freeze({
    version: `2.${bytes[3] ?? 0}.${bytes[4] ?? 0}`,
    bytes: id3Size(bytes),
  })
}

/**
 * ADR-HOST-002 Path A — the one mutating operation of this codec. `edit.field` sets or replaces an
 * ID3v2 text frame and returns an edit plan: a single byte-range replace of the tag region, where
 * every frame the edit does not name is copied verbatim, the padding keeps its length, only the
 * tag header's size field and the named frame change, and not one audio byte moves. The codec
 * never writes: the host commits the plan under `write-source`.
 *
 * Bounded on purpose: ID3v2.3/2.4 tags without unsynchronisation, an extended header or a footer
 * are editable; anything else is refused with the reason rather than guessed at.
 */
const EDIT_FIELD_OPERATION = Object.freeze({
  id: 'edit.field',
  handlerId: 'set-text-frame',
  mutatesSource: true,
  requiredPermissions: Object.freeze(['read-source', 'write-source']),
  inputSchema: Object.freeze({
    $ref: 'modkit://audio-mp3/edit-field.v1',
    document: Object.freeze({
      schemaVersion: 1,
      forms: Object.freeze([
        Object.freeze({
          id: 'mp3-set-text-frame',
          label: 'Set an ID3v2 text frame',
          summary:
            'Sets or replaces one ID3v2 text frame, creating the tag when absent; audio bytes stay in place.',
          binding: Object.freeze({ groupId: 'id3' }),
          fields: Object.freeze([
            Object.freeze({
              key: 'key',
              label: 'Frame',
              type: Object.freeze({ kind: 'text', pattern: '^T[A-Z0-9]{3}$', maxLength: 4 }),
              inputPath: Object.freeze(['key']),
              required: true,
              initial: 'TIT2',
              source: 'entry-key',
              description: 'A four-character ID3v2 text frame id',
            }),
            Object.freeze({
              key: 'value',
              label: 'Text',
              type: Object.freeze({ kind: 'text' }),
              inputPath: Object.freeze(['value']),
              initial: 'set from the Modkit inspector',
              source: 'entry-value',
            }),
          ]),
        }),
      ]),
    }),
  }),
  outputKinds: Object.freeze(['edit-plan']),
})

const MP3_OPERATIONS = Object.freeze([...TRANSPORT_OPERATIONS, EDIT_FIELD_OPERATION])
/**
 * Decode the text-information frames for display.
 *
 * Deliberately tolerant where `id3TagForEditing` is strict: that parser *refuses* tags it would
 * not rewrite safely (unsynchronised, extended header, unparsed padding), which is right for
 * editing and wrong for showing — a user must be able to *see* a title this codec declines to
 * rewrite. Anything malformed simply ends the walk; whatever decoded up to that point is real.
 */
function decodeTextFrames(bytes) {
  if (!isId3(bytes)) return []
  const major = bytes[3] ?? 0
  if (major !== 3 && major !== 4) return []
  const end = Math.min(ID3_HEADER_BYTES + synchsafe(bytes, 6), bytes.byteLength)
  const out = []
  let offset = ID3_HEADER_BYTES
  while (offset + ID3_HEADER_BYTES <= end && bytes[offset] !== 0) {
    const id = latin1.decode(bytes.subarray(offset, offset + 4))
    if (!/^[A-Z0-9]{4}$/u.test(id)) break
    const frameSize = major === 4 ? synchsafe(bytes, offset + 4) : u32be(bytes, offset + 4)
    const frameEnd = offset + ID3_HEADER_BYTES + frameSize
    if (frameSize <= 0 || frameEnd > end) break
    if (TEXT_FRAME_ID.test(id) && id !== 'TXXX') {
      const body = bytes.subarray(offset + ID3_HEADER_BYTES, frameEnd)
      const encoding = body[0] ?? 0
      const payload = body.subarray(1)
      let text
      if (encoding === 0) text = latin1.decode(payload)
      else if (encoding === 3) text = new TextDecoder('utf-8').decode(payload)
      else if (encoding === 1) text = new TextDecoder('utf-16').decode(payload)
      else if (encoding === 2) text = new TextDecoder('utf-16be').decode(payload)
      if (text !== undefined) {
        const nul = text.indexOf('\u0000')
        out.push({ id, text: nul === -1 ? text : text.slice(0, nul) })
      }
    }
    offset = frameEnd
  }
  return out
}

/** Text information frames share one shape; `TXXX` does not, so it is not one of them. */
const TEXT_FRAME_ID = /^T[A-Z0-9]{3}$/u

function synchsafe(bytes, offset) {
  return (
    (((bytes[offset] ?? 0) & 0x7f) << 21) |
    (((bytes[offset + 1] ?? 0) & 0x7f) << 14) |
    (((bytes[offset + 2] ?? 0) & 0x7f) << 7) |
    ((bytes[offset + 3] ?? 0) & 0x7f)
  )
}

function writeSynchsafe(target, offset, value) {
  target[offset] = (value >>> 21) & 0x7f
  target[offset + 1] = (value >>> 14) & 0x7f
  target[offset + 2] = (value >>> 7) & 0x7f
  target[offset + 3] = value & 0x7f
}

function u32be(bytes, offset) {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  )
}

function writeU32be(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

/** Parse the tag well enough to rewrite it, or refuse; `undefined` means "no ID3v2 tag". */
function id3TagForEditing(bytes) {
  if (!isId3(bytes)) return undefined
  const major = bytes[3] ?? 0
  const flags = bytes[5] ?? 0
  if (major !== 3 && major !== 4) {
    throw new TypeError(`editing an ID3v2.${major} tag is not supported (2.3 and 2.4 only)`)
  }
  if ((flags & UNSYNCHRONISED) !== 0) {
    throw new TypeError('this ID3v2 tag is unsynchronised; rewriting it would have to guess')
  }
  if ((flags & EXTENDED_HEADER) !== 0) {
    throw new TypeError('this ID3v2 tag carries an extended header this codec does not rewrite')
  }
  if ((flags & FOOTER_PRESENT) !== 0) {
    throw new TypeError('this ID3v2 tag carries a footer this codec does not rewrite')
  }
  const size = synchsafe(bytes, 6)
  const end = ID3_HEADER_BYTES + size
  if (end > bytes.byteLength) throw new TypeError('the ID3v2 tag overruns the file')
  const frames = []
  let offset = ID3_HEADER_BYTES
  while (offset + ID3_HEADER_BYTES <= end && bytes[offset] !== 0) {
    const id = latin1.decode(bytes.subarray(offset, offset + 4))
    if (!/^[A-Z0-9]{4}$/u.test(id)) throw new TypeError(`ID3v2 frame id «${id}» is invalid`)
    const frameSize = major === 4 ? synchsafe(bytes, offset + 4) : u32be(bytes, offset + 4)
    const frameEnd = offset + ID3_HEADER_BYTES + frameSize
    if (frameSize < 0 || frameEnd > end) throw new TypeError('an ID3v2 frame overruns its tag')
    frames.push(
      Object.freeze({
        id,
        offset,
        end: frameEnd,
        flags: (((bytes[offset + 8] ?? 0) << 8) | (bytes[offset + 9] ?? 0)) >>> 0,
      }),
    )
    offset = frameEnd
  }
  if (bytes.subarray(offset, end).some(value => value !== 0)) {
    throw new TypeError('the ID3v2 tag holds unparsed bytes where its padding should be')
  }
  return Object.freeze({
    major,
    end,
    frames: Object.freeze(frames),
    paddingBytes: end - offset,
  })
}

/** v2.4 writes UTF-8; v2.3 has no UTF-8, so it is Latin-1 when it fits and UTF-16+BOM otherwise. */
function textFrameContent(text, major) {
  if (text.includes('\0')) throw new TypeError('an ID3v2 text frame cannot carry NUL')
  if (major === 4) {
    const payload = utf8.encode(text)
    const content = new Uint8Array(1 + payload.byteLength)
    content[0] = 3
    content.set(payload, 1)
    return content
  }
  if ([...text].every(char => (char.codePointAt(0) ?? 0) <= 0xff)) {
    const content = new Uint8Array(1 + text.length)
    content.set(
      Uint8Array.from(text, char => char.codePointAt(0) ?? 0),
      1,
    )
    return content
  }
  const content = new Uint8Array(3 + text.length * 2)
  content[0] = 1
  content[1] = 0xff
  content[2] = 0xfe
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index)
    content[3 + index * 2] = unit & 0xff
    content[4 + index * 2] = (unit >> 8) & 0xff
  }
  return content
}

function textFrameBytes(frameId, text, major) {
  const content = textFrameContent(text, major)
  if (major === 4 && content.byteLength > MAX_SYNCHSAFE) {
    throw new RangeError('the ID3v2.4 frame exceeds the synchsafe size limit')
  }
  const frame = new Uint8Array(ID3_HEADER_BYTES + content.byteLength)
  frame.set(
    Uint8Array.from(frameId, char => char.codePointAt(0) ?? 0),
    0,
  )
  if (major === 4) writeSynchsafe(frame, 4, content.byteLength)
  else writeU32be(frame, 4, content.byteLength)
  frame.set(content, ID3_HEADER_BYTES)
  return frame
}

/** The whole tag region, rebuilt: header bytes and every other frame copied verbatim. */
function rebuiltTagBytes(bytes, tag, frameId, frame) {
  const matches = tag.frames.filter(existing => existing.id === frameId)
  if (matches.length > 1) {
    throw new TypeError(`this tag carries ${matches.length} ${frameId} frames; which one is meant?`)
  }
  const [existing] = matches
  if (existing !== undefined && existing.flags !== 0) {
    throw new TypeError(`the ${frameId} frame carries frame flags this codec does not rewrite`)
  }
  const pieces = tag.frames.map(item =>
    item.id === frameId ? frame : bytes.subarray(item.offset, item.end),
  )
  if (existing === undefined) pieces.push(frame)
  const bodyBytes = pieces.reduce((total, piece) => total + piece.byteLength, 0) + tag.paddingBytes
  if (bodyBytes > MAX_SYNCHSAFE) {
    throw new RangeError('the rewritten ID3v2 tag exceeds the synchsafe size limit')
  }
  const next = new Uint8Array(ID3_HEADER_BYTES + bodyBytes)
  next.set(bytes.subarray(0, ID3_HEADER_BYTES), 0)
  writeSynchsafe(next, 6, bodyBytes)
  let cursor = ID3_HEADER_BYTES
  for (const piece of pieces) {
    next.set(piece, cursor)
    cursor += piece.byteLength
  }
  return next
}

/** A file without a tag gets a minimal ID3v2.4 one, inserted before the first audio frame. */
function newTagBytes(frameId, text) {
  const frame = textFrameBytes(frameId, text, 4)
  const tag = new Uint8Array(ID3_HEADER_BYTES + frame.byteLength)
  tag.set(utf8.encode('ID3'), 0)
  tag[3] = 4
  writeSynchsafe(tag, 6, frame.byteLength)
  tag.set(frame, ID3_HEADER_BYTES)
  return tag
}

function setTextFrameHandler(bytes, input) {
  return async value => {
    const keyword = value?.groupId === 'id3' ? value.key : value?.keyword
    const text = value?.groupId === 'id3' ? value.value : value?.text
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof keyword !== 'string' ||
      typeof text !== 'string'
    ) {
      throw new TypeError('edit.field expects an id3 FieldWriteRequest')
    }
    if (!TEXT_FRAME_ID.test(keyword) || keyword === 'TXXX') {
      throw new TypeError(
        `«${keyword}» is not an ID3v2 text frame id (TIT2, TPE1, TALB, …; TXXX has another shape)`,
      )
    }
    const tag = id3TagForEditing(bytes)
    const edit =
      tag === undefined
        ? replaceBytes(0, 0, newTagBytes(keyword, text), `create an ID3v2.4 tag with ${keyword}`)
        : replaceBytes(
            0,
            tag.end,
            rebuiltTagBytes(bytes, tag, keyword, textFrameBytes(keyword, text, tag.major)),
            `set ${keyword}`,
          )
    return {
      kind: 'edit-plan',
      plan: editPlanFromInput(input, {
        planId: `mp3-set-text-frame:${keyword}`,
        edits: [edit],
        fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      }),
    }
  }
}

const definition = Object.freeze({
  id: 'modkit/audio-mp3',
  format: Object.freeze({ id: 'mp3', label: 'MP3 audio', mediaType: 'audio/mpeg' }),
  operations: MP3_OPERATIONS,
  async detect(bytes) {
    const frame = findFrame(bytes)
    if (frame !== undefined) return { confidence: 0.99, note: 'mpeg-layer-3-frame' }
    if (isId3(bytes)) return { confidence: 0.72, note: 'id3-prefix-without-bounded-frame' }
    return { confidence: 0.01, note: 'mp3-frame-missing' }
  },
  async inspect(bytes, context) {
    const frame = findFrame(bytes)
    if (frame === undefined) throw new TypeError('MP3 frame header is missing')
    const id3 = id3Info(bytes)
    const audioBytes = Math.max(0, bytes.byteLength - (id3?.bytes ?? 0))
    const durationMs = Math.round((audioBytes * 8 * 1000) / (frame.bitrateKbps * 1000))
    const audio = createAudioMediaSource(bytes, 'audio/mpeg', {
      durationMs,
      seekable: true,
      pcmAccess: false,
      tracks: [
        {
          id: 'audio-0',
          codec: 'mp3',
          channels: frame.channels,
          sampleRate: frame.sampleRate,
          bitrateKbps: frame.bitrateKbps,
          selected: true,
        },
      ],
    })
    const tree = createTreeDataSource({
      kind: 'audio',
      label: 'MP3',
      preview: `${frame.sampleRate} Hz, ${frame.bitrateKbps} kbps`,
      children: [
        ...(id3 === undefined
          ? []
          : [{ kind: 'metadata', label: 'ID3', preview: `${id3.version}, ${id3.bytes} bytes` }]),
        {
          kind: 'stream',
          label: `${frame.version} Layer ${frame.layer}`,
          preview: `${frame.channels} channel(s), ~${durationMs} ms`,
        },
      ],
    })
    const transport = createTransportSource({
      state: 'idle',
      positionMs: 0,
      durationMs,
      rate: 1,
      seekable: true,
      live: false,
      tracks: [{ id: 'audio-0', kind: 'audio', label: 'MPEG audio', selected: true }],
      controls: {
        playPause: 'media.play-pause',
        seek: 'media.seek',
        setRate: 'media.set-rate',
        selectTrack: 'media.select-track',
      },
    })
    return {
      summary: {
        format: 'mp3',
        sampleRate: frame.sampleRate,
        bitrateKbps: frame.bitrateKbps,
        channels: frame.channels,
        durationMs,
        id3Version: id3?.version ?? null,
      },
      metadata: [
        {
          id: 'mpeg-audio',
          label: 'MPEG audio',
          entries: [
            { key: 'version', value: frame.version },
            { key: 'layer', value: frame.layer },
            { key: 'sampleRate', value: frame.sampleRate },
            { key: 'bitrateKbps', value: frame.bitrateKbps },
            { key: 'channels', value: frame.channels },
            { key: 'durationMs', value: durationMs },
          ],
        },
        {
          id: 'id3',
          label: 'ID3',
          entries: [
            ...(id3 === undefined
              ? []
              : [
                  { key: 'version', value: id3.version },
                  { key: 'bytes', value: id3.bytes },
                ]),
            ...(decodeTextFrames(bytes).length === 0
              ? [{ key: 'TIT2', value: null }]
              : decodeTextFrames(bytes).map(frame => ({ key: frame.id, value: frame.text }))
            ).map(frame => ({
              ...frame,
              type: { kind: 'text' },
              editable: { write: { operation: 'edit.field' } },
            })),
          ],
        },
      ],
      traits: [
        {
          id: 'audio.streams',
          parameters: {
            count: 1,
            codec: 'mp3',
            sampleRate: frame.sampleRate,
            channels: frame.channels,
          },
        },
        { id: 'media.duration', parameters: { milliseconds: durationMs, estimated: true } },
        { id: 'media.seekable', parameters: { value: true } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/transport-source': transport,
        'common.view/audio-media-source': audio,
      },
      handlers: {
        ...createTransportHandlers(transport),
        'set-text-frame': setTextFrameHandler(bytes, context.input),
      },
      unsupportedFeatures: ['pcm-decoder-provider'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
