import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/ps1-cue-bin'
const COMPANION_ID = 'disc-payload'
const MAX_CUE_BYTES = 1024 * 1024
const ISO_SECTOR_BYTES = 2048
const ISO_DESCRIPTOR_START = 16 * ISO_SECTOR_BYTES
const utf8 = new TextDecoder('utf-8', { fatal: true })
const latin1 = new TextDecoder('latin1')

const TRACK_MODES = Object.freeze({
  AUDIO: Object.freeze({ sectorBytes: 2352, payloadOffset: 0, payloadBytes: 2352, data: false }),
  'MODE1/2048': Object.freeze({
    sectorBytes: 2048,
    payloadOffset: 0,
    payloadBytes: 2048,
    data: true,
  }),
  'MODE1/2352': Object.freeze({
    sectorBytes: 2352,
    payloadOffset: 16,
    payloadBytes: 2048,
    data: true,
  }),
  'MODE2/2048': Object.freeze({
    sectorBytes: 2048,
    payloadOffset: 0,
    payloadBytes: 2048,
    data: true,
  }),
  'MODE2/2352': Object.freeze({
    sectorBytes: 2352,
    payloadOffset: 24,
    payloadBytes: 2048,
    data: true,
  }),
})

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}

function decodeCue(bytes) {
  let text
  try {
    text = utf8.decode(bytes)
  } catch {
    throw new TypeError('CUE sheet is not valid UTF-8/ASCII text')
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (text.includes('\0')) throw new TypeError('CUE sheet contains a NUL byte')
  return text.replace(/\r\n?/gu, '\n')
}

function safeCompanionPath(value) {
  const normalized = value.replace(/\\/gu, '/')
  if (
    normalized === '' ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split('/').some(part => part === '' || part === '.' || part === '..')
  ) {
    throw new TypeError(`CUE companion path is unsafe: ${value}`)
  }
  if (!/\.bin$/iu.test(normalized)) {
    throw new TypeError('the portable CUE subset requires one BINARY .bin companion')
  }
  return normalized
}

function cueFrame(value, label) {
  const match = /^(\d{2,}):(\d{2}):(\d{2})$/u.exec(value)
  if (match === null) throw new TypeError(`CUE ${label} timestamp is invalid`)
  const minute = Number(match[1])
  const second = Number(match[2])
  const frame = Number(match[3])
  if (!Number.isSafeInteger(minute) || second >= 60 || frame >= 75) {
    throw new TypeError(`CUE ${label} timestamp is outside the CD timebase`)
  }
  return (minute * 60 + second) * 75 + frame
}

function parseCue(bytes, budget) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CUE_BYTES) {
    throw new RangeError(`CUE sheet exceeds the ${MAX_CUE_BYTES}-byte parser limit`)
  }
  const files = new Set()
  const tracks = []
  let currentFile
  let currentTrack
  const lines = decodeCue(bytes).split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    abortIfNeeded(budget.signal)
    const line = lines[index].trim()
    if (line === '' || /^REM(?:\s|$)/iu.test(line)) continue
    const file = /^FILE\s+(?:"([^"]+)"|(\S+))\s+(\S+)\s*$/iu.exec(line)
    if (file !== null) {
      if (String(file[3]).toUpperCase() !== 'BINARY') {
        throw new TypeError('the portable CUE subset supports only FILE ... BINARY')
      }
      currentFile = safeCompanionPath(file[1] ?? file[2] ?? '')
      files.add(currentFile)
      currentTrack = undefined
      continue
    }
    if (/^FILE(?:\s|$)/iu.test(line)) throw new TypeError(`malformed CUE FILE at line ${index + 1}`)
    const track = /^TRACK\s+(\d{1,2})\s+(\S+)\s*$/iu.exec(line)
    if (track !== null) {
      if (currentFile === undefined) throw new TypeError('CUE TRACK appears before FILE')
      const number = Number(track[1])
      const modeName = String(track[2]).toUpperCase()
      const mode = TRACK_MODES[modeName]
      if (mode === undefined) throw new TypeError(`unsupported CUE track mode: ${modeName}`)
      if (number < 1 || number > 99 || tracks.some(item => item.number === number)) {
        throw new TypeError(`CUE track number ${number} is invalid or duplicated`)
      }
      if (tracks.length >= budget.maxNodes) {
        throw new RangeError('CUE track count exceeds maxNodes budget')
      }
      currentTrack = { number, modeName, mode, fileName: currentFile, indexFrame: undefined }
      tracks.push(currentTrack)
      continue
    }
    if (/^TRACK(?:\s|$)/iu.test(line))
      throw new TypeError(`malformed CUE TRACK at line ${index + 1}`)
    const cueIndex = /^INDEX\s+(\d{2})\s+(\S+)\s*$/iu.exec(line)
    if (cueIndex !== null) {
      if (currentTrack === undefined) throw new TypeError('CUE INDEX appears before TRACK')
      if (cueIndex[1] === '01') {
        if (currentTrack.indexFrame !== undefined)
          throw new TypeError('CUE track has duplicate INDEX 01')
        currentTrack.indexFrame = cueFrame(cueIndex[2], `track ${currentTrack.number} INDEX 01`)
      } else {
        cueFrame(cueIndex[2], `track ${currentTrack.number} INDEX ${cueIndex[1]}`)
      }
      continue
    }
    if (/^INDEX(?:\s|$)/iu.test(line))
      throw new TypeError(`malformed CUE INDEX at line ${index + 1}`)
  }
  if (files.size !== 1) throw new TypeError('the portable CUE subset requires exactly one FILE')
  if (tracks.length === 0) throw new TypeError('CUE sheet declares no tracks')
  if (!tracks.some(track => track.mode.data))
    throw new TypeError('CUE sheet declares no data track')
  const fileName = [...files][0]
  if (tracks.some(track => track.fileName !== fileName || track.indexFrame === undefined)) {
    throw new TypeError('every CUE track must reference the one FILE and declare INDEX 01')
  }
  if (tracks[0].indexFrame !== 0) {
    throw new TypeError('the portable CUE subset requires the first INDEX 01 at 00:00:00')
  }
  for (let index = 1; index < tracks.length; index += 1) {
    if (tracks[index].number <= tracks[index - 1].number) {
      throw new TypeError('CUE track numbers must be strictly increasing')
    }
    if (tracks[index].indexFrame <= tracks[index - 1].indexFrame) {
      throw new TypeError('CUE INDEX 01 positions must be strictly increasing')
    }
  }
  const sectorBytes = tracks[0].mode.sectorBytes
  if (tracks.some(track => track.mode.sectorBytes !== sectorBytes)) {
    throw new TypeError('mixed physical sector sizes in one BIN are not supported')
  }
  return Object.freeze({
    fileName,
    sectorBytes,
    tracks: Object.freeze(tracks.map(track => Object.freeze({ ...track }))),
  })
}

function looksLikeCue(bytes) {
  if (bytes.byteLength === 0) return false
  let text
  try {
    text = decodeCue(bytes)
  } catch {
    return false
  }
  return (
    /^\s*FILE\s+(?:"[^"]+"|\S+)\s+BINARY\s*$/imu.test(text) &&
    /^\s*TRACK\s+\d{1,2}\s+(?:AUDIO|MODE[12]\/(?:2048|2352))\s*$/imu.test(text) &&
    /^\s*INDEX\s+01\s+\d{2,}:\d{2}:\d{2}\s*$/imu.test(text)
  )
}

async function readSizedSource(source, maxBytes, maxInputBytes, signal, label) {
  if (source.kind !== 'bytes' || source.size === undefined) {
    throw new TypeError(`${label} must be a sized byte source`)
  }
  if (
    source.size > BigInt(maxBytes) ||
    source.size > maxInputBytes ||
    source.size > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new RangeError(`${label} exceeds maxScalarBytes or maxInputBytes budget`)
  }
  const total = Number(source.size)
  const output = new Uint8Array(total)
  let offset = 0
  while (offset < total) {
    abortIfNeeded(signal)
    const chunk = await source.read(BigInt(offset), Math.min(64 * 1024, total - offset), signal)
    if (chunk.byteLength === 0 || chunk.byteLength > total - offset) {
      throw new RangeError(`${label} ended before its declared size`)
    }
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function ensureRange(bytes, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new TypeError(`${label} range is invalid`)
  }
  if (offset + length > bytes.byteLength) throw new TypeError(`${label} is truncated`)
}

function view(bytes, offset, length, label) {
  ensureRange(bytes, offset, length, label)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length)
}

const u16le = (bytes, offset, label) => view(bytes, offset, 2, label).getUint16(0, true)
const u16be = (bytes, offset, label) => view(bytes, offset, 2, label).getUint16(0, false)
const u32le = (bytes, offset, label) => view(bytes, offset, 4, label).getUint32(0, true)
const u32be = (bytes, offset, label) => view(bytes, offset, 4, label).getUint32(0, false)

function bothEndian16(bytes, offset, label) {
  const little = u16le(bytes, offset, label)
  if (little !== u16be(bytes, offset + 2, label))
    throw new TypeError(`${label} endian copies disagree`)
  return little
}

function bothEndian32(bytes, offset, label) {
  const little = u32le(bytes, offset, label)
  if (little !== u32be(bytes, offset + 4, label))
    throw new TypeError(`${label} endian copies disagree`)
  return little
}

const descriptorSignature = (bytes, offset) =>
  bytes[offset + 1] === 0x43 &&
  bytes[offset + 2] === 0x44 &&
  bytes[offset + 3] === 0x30 &&
  bytes[offset + 4] === 0x30 &&
  bytes[offset + 5] === 0x31 &&
  bytes[offset + 6] === 1

function parseDirectoryRecord(bytes, offset, available, label) {
  ensureRange(bytes, offset, 1, label)
  const recordLength = bytes[offset] ?? 0
  if (recordLength === 0) return undefined
  if (recordLength < 34 || recordLength > available) {
    throw new TypeError(`${label} directory record length is invalid`)
  }
  ensureRange(bytes, offset, recordLength, label)
  const identifierLength = bytes[offset + 32] ?? 0
  if (identifierLength === 0 || 33 + identifierLength > recordLength) {
    throw new TypeError(`${label} identifier is truncated`)
  }
  const flags = bytes[offset + 25] ?? 0
  if ((flags & 0x80) !== 0) throw new TypeError(`${label} uses unsupported multi-extent data`)
  return Object.freeze({
    recordLength,
    extent: bothEndian32(bytes, offset + 2, `${label} extent`),
    size: bothEndian32(bytes, offset + 10, `${label} size`),
    flags,
    identifier: bytes.slice(offset + 33, offset + 33 + identifierLength),
  })
}

function isoName(identifier) {
  if (identifier.byteLength === 1 && (identifier[0] === 0 || identifier[0] === 1)) return undefined
  const raw = latin1.decode(identifier)
  const name = raw.replace(/;[0-9]+$/u, '').replace(/\.$/u, '')
  if (name === '' || name === '.' || name === '..' || /[\\/\0]/u.test(name)) {
    throw new TypeError(`unsafe ISO identifier: ${raw}`)
  }
  return name
}

function parseIso(bytes, budget) {
  if (
    bytes.byteLength < ISO_DESCRIPTOR_START + 7 ||
    !descriptorSignature(bytes, ISO_DESCRIPTOR_START)
  ) {
    throw new TypeError('PlayStation data track has no ISO 9660 descriptor')
  }
  let primary
  let terminated = false
  let descriptorCount = 0
  for (
    let offset = ISO_DESCRIPTOR_START;
    offset + ISO_SECTOR_BYTES <= bytes.byteLength;
    offset += ISO_SECTOR_BYTES
  ) {
    if (!descriptorSignature(bytes, offset)) throw new TypeError('ISO volume descriptor is invalid')
    descriptorCount += 1
    const type = bytes[offset] ?? 0
    if (type === 1 && primary === undefined) primary = offset
    if (type === 255) {
      terminated = true
      break
    }
    if (descriptorCount > 128) throw new RangeError('ISO descriptor count exceeds the parser limit')
  }
  if (primary === undefined || !terminated)
    throw new TypeError('ISO primary descriptor or terminator is missing')
  const logicalBlockSize = bothEndian16(bytes, primary + 128, 'ISO logical block size')
  if (
    logicalBlockSize < 512 ||
    logicalBlockSize > 32768 ||
    (logicalBlockSize & (logicalBlockSize - 1)) !== 0
  ) {
    throw new TypeError('ISO logical block size is unsupported')
  }
  const volumeBlocks = bothEndian32(bytes, primary + 80, 'ISO volume space size')
  if (volumeBlocks === 0 || volumeBlocks * logicalBlockSize > bytes.byteLength) {
    throw new TypeError('ISO declared volume space exceeds the data track')
  }
  const root = parseDirectoryRecord(bytes, primary + 156, ISO_SECTOR_BYTES - 156, 'ISO root')
  if (root === undefined || (root.flags & 0x02) === 0)
    throw new TypeError('ISO root directory record is missing')
  const entries = []
  const paths = new Set()
  const seenDirectories = new Set([`${root.extent}:${root.size}`])
  const pending = [{ path: '', extent: root.extent, size: root.size, depth: 0 }]
  while (pending.length > 0) {
    abortIfNeeded(budget.signal)
    const directory = pending.pop()
    if (directory.depth > budget.maxDepth)
      throw new RangeError('ISO directory exceeds maxDepth budget')
    const start = directory.extent * logicalBlockSize
    ensureRange(bytes, start, directory.size, `ISO directory ${directory.path || '/'}`)
    let cursor = 0
    while (cursor < directory.size) {
      const recordLength = bytes[start + cursor] ?? 0
      if (recordLength === 0) {
        cursor = Math.ceil((cursor + 1) / logicalBlockSize) * logicalBlockSize
        continue
      }
      const remainingInBlock = logicalBlockSize - (cursor % logicalBlockSize)
      const record = parseDirectoryRecord(
        bytes,
        start + cursor,
        Math.min(remainingInBlock, directory.size - cursor),
        `ISO entry at ${start + cursor}`,
      )
      cursor += record.recordLength
      const name = isoName(record.identifier)
      if (name === undefined) continue
      if (entries.length >= budget.maxNodes)
        throw new RangeError('ISO entries exceed maxNodes budget')
      const kind = (record.flags & 0x02) !== 0 ? 'directory' : 'file'
      const path = `${directory.path}${name}${kind === 'directory' ? '/' : ''}`
      if (paths.has(path)) throw new TypeError(`duplicate ISO entry path: ${path}`)
      paths.add(path)
      const dataOffset = record.extent * logicalBlockSize
      ensureRange(bytes, dataOffset, record.size, `ISO entry ${path}`)
      entries.push(
        Object.freeze({ path, name, kind, size: record.size, extent: record.extent, dataOffset }),
      )
      if (kind === 'directory') {
        const key = `${record.extent}:${record.size}`
        if (seenDirectories.has(key)) throw new TypeError(`ISO directory cycle at ${path}`)
        seenDirectories.add(key)
        pending.push({ path, extent: record.extent, size: record.size, depth: directory.depth + 1 })
      }
    }
  }
  if (entries.length === 0) throw new TypeError('ISO volume exposes no entries')
  return Object.freeze({
    volumeIdentifier: latin1.decode(bytes.subarray(primary + 40, primary + 72)).trim(),
    logicalBlockSize,
    volumeBlocks,
    descriptorCount,
    entries: Object.freeze(entries),
  })
}

function validateRawSector(sector, modeName, number) {
  if (sector[0] !== 0 || sector[11] !== 0)
    throw new TypeError(`CD sector ${number} sync is invalid`)
  for (let index = 1; index <= 10; index += 1) {
    if (sector[index] !== 0xff) throw new TypeError(`CD sector ${number} sync is invalid`)
  }
  const expectedMode = modeName.startsWith('MODE1/') ? 1 : 2
  if (sector[15] !== expectedMode) throw new TypeError(`CD sector ${number} mode byte is invalid`)
  if (expectedMode === 2) {
    for (let index = 0; index < 4; index += 1) {
      if (sector[16 + index] !== sector[20 + index]) {
        throw new TypeError(`CD sector ${number} XA subheader copies disagree`)
      }
    }
  }
}

function cookedTrack(bin, track) {
  const raw = bin.subarray(track.byteOffset, track.byteOffset + track.byteLength)
  if (!track.mode.data) return undefined
  if (track.mode.sectorBytes === track.mode.payloadBytes && track.mode.payloadOffset === 0)
    return raw.slice()
  const cooked = new Uint8Array(track.sectors * track.mode.payloadBytes)
  for (let index = 0; index < track.sectors; index += 1) {
    const sector = raw.subarray(
      index * track.mode.sectorBytes,
      (index + 1) * track.mode.sectorBytes,
    )
    validateRawSector(sector, track.modeName, track.startFrame + index)
    cooked.set(
      sector.subarray(track.mode.payloadOffset, track.mode.payloadOffset + track.mode.payloadBytes),
      index * track.mode.payloadBytes,
    )
  }
  return cooked
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      abortIfNeeded(signal)
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('CUE/BIN namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0)
        throw new TypeError('invalid namespace page cursor')
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.name,
          kind: entry.kind,
          ...(entry.kind === 'file'
            ? { size: BigInt(entry.size), storedSize: BigInt(entry.size), compression: 'stored' }
            : {}),
          revision: source.revision,
        }),
      )
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < matching.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
    async openEntry(entryId, signal) {
      abortIfNeeded(signal)
      const entry = byId.get(entryId)
      if (entry === undefined || entry.kind !== 'file')
        throw new TypeError('CUE/BIN entry is not a file')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.path}`,
          uri: `cue-bin-entry:${encodeURIComponent(source.ref.uri)}!/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

function byteRangeSource(bytes) {
  return Object.freeze({
    async size() {
      return BigInt(bytes.byteLength)
    },
    async read(offset, length, signal) {
      abortIfNeeded(signal)
      if (
        offset < 0n ||
        offset > BigInt(bytes.byteLength) ||
        !Number.isSafeInteger(length) ||
        length < 0
      ) {
        throw new RangeError('BIN byte range is outside the companion')
      }
      return bytes.slice(Number(offset), Math.min(bytes.byteLength, Number(offset) + length))
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'ps1-cue-bin',
    label: 'PlayStation CUE/BIN disc image',
    mediaType: 'application/x-cue',
  }),
  operations: Object.freeze([
    Object.freeze({
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
  ]),
  async planInput(source, evidence, signal, context) {
    void evidence
    if (source.kind !== 'bytes') throw new TypeError('CUE/BIN requires a byte candidate')
    const maxScalarBytes = context?.budgets.maxScalarBytes ?? MAX_CUE_BYTES
    const maxInputBytes = context?.budgets.maxInputBytes ?? BigInt(MAX_CUE_BYTES)
    const maxNodes = context?.budgets.maxNodes ?? 99
    const cueBytes = await readSizedSource(
      source,
      Math.min(MAX_CUE_BYTES, maxScalarBytes),
      maxInputBytes,
      signal,
      'CUE sheet',
    )
    const cue = parseCue(cueBytes, { maxNodes, signal })
    return Object.freeze({
      originKind: 'bundle',
      candidate: Object.freeze({ bindingId: 'cue-sheet', role: 'cue-sheet', ownership: 'owned' }),
      requirements: Object.freeze([
        Object.freeze({
          id: COMPANION_ID,
          role: 'disc-payload',
          ownership: 'companion',
          cardinality: 'one',
          required: true,
          patterns: Object.freeze([cue.fileName]),
          scopes: Object.freeze(['sibling-directory', 'enclosing-container']),
        }),
      ]),
    })
  },
  async detect(prefix) {
    return looksLikeCue(prefix)
      ? { confidence: 0.96, kind: 'structure', note: 'cue-file-track-index-grammar' }
      : { confidence: 0, kind: 'structure', note: 'cue-grammar-mismatch' }
  },
  async inspect(cueBytes, context) {
    if (context.input.originKind !== 'bundle') {
      throw new TypeError(
        `CUE/BIN requires a bundle input, received ${String(context.input.originKind)}`,
      )
    }
    const cue = parseCue(cueBytes, { maxNodes: context.budget.maxNodes, signal: context.signal })
    const bindings = context.input.bindingsFor(COMPANION_ID)
    if (bindings.length !== 1)
      throw new TypeError('CUE/BIN requires exactly one resolved BIN companion')
    const companionLease = await context.input.openBinding(bindings[0].bindingId, context.signal)
    let bin
    try {
      bin = await readSizedSource(
        companionLease.value,
        context.budget.maxScalarBytes,
        context.budget.maxInputBytes,
        context.signal,
        'BIN companion',
      )
    } finally {
      await companionLease.release()
    }
    if (bin.byteLength === 0 || bin.byteLength % cue.sectorBytes !== 0) {
      throw new TypeError('BIN companion length is not an integral number of declared sectors')
    }
    const totalSectors = bin.byteLength / cue.sectorBytes
    const tracks = cue.tracks.map((track, index) => {
      const endFrame = cue.tracks[index + 1]?.indexFrame ?? totalSectors
      if (
        track.indexFrame >= totalSectors ||
        endFrame > totalSectors ||
        endFrame <= track.indexFrame
      ) {
        throw new TypeError(`CUE track ${track.number} lies outside the BIN companion`)
      }
      return Object.freeze({
        ...track,
        startFrame: track.indexFrame,
        sectors: endFrame - track.indexFrame,
        byteOffset: track.indexFrame * cue.sectorBytes,
        byteLength: (endFrame - track.indexFrame) * cue.sectorBytes,
      })
    })
    const entries = []
    let isoVolume
    for (const track of tracks) {
      const number = String(track.number).padStart(2, '0')
      entries.push(
        Object.freeze({
          id: `track-${number}-raw`,
          path: `tracks/track${number}.raw`,
          name: `track${number}.raw`,
          kind: 'file',
          size: track.byteLength,
          bytes: () => bin.slice(track.byteOffset, track.byteOffset + track.byteLength),
        }),
      )
      const cooked = cookedTrack(bin, track)
      if (cooked === undefined) continue
      entries.push(
        Object.freeze({
          id: `track-${number}-cooked`,
          path: `tracks/track${number}.iso`,
          name: `track${number}.iso`,
          kind: 'file',
          size: cooked.byteLength,
          bytes: () => cooked.slice(),
        }),
      )
      if (isoVolume !== undefined) continue
      const remainingNodes = context.budget.maxNodes - tracks.length - entries.length
      if (remainingNodes < 0) throw new RangeError('CUE/BIN entries exceed maxNodes budget')
      const iso = parseIso(cooked, {
        maxDepth: context.budget.maxDepth,
        maxNodes: remainingNodes,
        signal: context.signal,
      })
      isoVolume = Object.freeze({ track: track.number, ...iso })
      for (let index = 0; index < iso.entries.length; index += 1) {
        const isoEntry = iso.entries[index]
        entries.push(
          Object.freeze({
            id: `track-${number}-iso-${index}`,
            path: `filesystem/${isoEntry.path}`,
            name: isoEntry.name,
            kind: isoEntry.kind,
            size: isoEntry.size,
            ...(isoEntry.kind === 'file'
              ? {
                  bytes: () =>
                    cooked.slice(isoEntry.dataOffset, isoEntry.dataOffset + isoEntry.size),
                }
              : {}),
          }),
        )
      }
    }
    if (isoVolume === undefined) throw new TypeError('CUE/BIN has no readable ISO 9660 data track')
    if (entries.length > context.budget.maxNodes)
      throw new RangeError('CUE/BIN entries exceed maxNodes budget')
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    const files = entries.filter(entry => entry.kind === 'file')
    const decodedBytes = files.reduce((total, entry) => total + BigInt(entry.size), 0n)
    return {
      summary: {
        format: 'ps1-cue-bin',
        companion: cue.fileName,
        tracks: tracks.length,
        sectors: totalSectors,
        isoVolume: isoVolume.volumeIdentifier,
        entries: entries.length,
      },
      metadata: [
        {
          id: 'cue-sheet',
          label: 'CUE sheet',
          entries: [
            { key: 'companion', value: cue.fileName },
            { key: 'tracks', value: tracks.length },
            { key: 'sectorBytes', value: cue.sectorBytes },
            { key: 'sectors', value: totalSectors },
          ],
        },
        {
          id: 'iso-volume',
          label: 'ISO 9660 data track',
          entries: [
            { key: 'track', value: isoVolume.track },
            { key: 'volumeIdentifier', value: isoVolume.volumeIdentifier },
            { key: 'logicalBlockSize', value: isoVolume.logicalBlockSize },
            { key: 'volumeBlocks', value: isoVolume.volumeBlocks },
            { key: 'descriptorCount', value: isoVolume.descriptorCount },
          ],
        },
      ],
      companions: [
        {
          id: COMPANION_ID,
          role: 'disc-payload',
          required: true,
          cardinality: 'one',
          state: 'resolved',
          bindingIds: [bindings[0].bindingId],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: entries.length } },
        { id: 'container.directories', parameters: { count: entries.length - files.length } },
        { id: 'container.compression', parameters: { methods: ['stored', 'raw-cd-sector'] } },
        { id: 'content.binary', parameters: { bytes: String(bin.byteLength) } },
      ],
      dataSources: {
        'common.view/byte-range-source': byteRangeSource(bin),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: isoVolume.volumeIdentifier || 'PlayStation CUE/BIN',
          preview: `${tracks.length} tracks, ${files.length} extractable entries`,
          children: entries.map(entry => ({
            kind: entry.kind,
            label: entry.path,
            preview: entry.kind === 'file' ? `${entry.size} bytes` : 'directory',
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined || entry.kind !== 'file')
            throw new TypeError('CUE/BIN file entry was not found')
          if (entry.size > context.budget.maxScalarBytes) {
            throw new RangeError('CUE/BIN entry exceeds maxScalarBytes budget')
          }
          return { kind: 'bytes', value: entry.bytes() }
        },
      },
      maxDecodedBytes: decodedBytes,
      unsupportedFeatures: [
        'multiple-file-cue-sheets',
        'mixed-sector-sizes-in-one-bin',
        'nonzero-first-index-and-pregap-materialization',
        'joliet-rock-ridge-and-udf-filesystems',
        'raw-sector-edc-and-ecc-validation',
        'full-disc-companions-over-maxScalarBytes',
        'disc-writing-and-mutation',
      ],
    }
  },
})

export const abiVersion = 1

export const createCodec = context => createInspectionCodec(definition, context)
