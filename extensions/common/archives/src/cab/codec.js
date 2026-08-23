import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/cab'
const latin1 = new TextDecoder('latin1')
const utf8 = new TextDecoder('utf-8', { fatal: true })

const matches = bytes =>
  bytes[0] === 0x4d && bytes[1] === 0x53 && bytes[2] === 0x43 && bytes[3] === 0x46

function ensureRange(bytes, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new TypeError(`CAB ${label} range is invalid`)
  }
  if (offset + length > bytes.byteLength) throw new TypeError(`CAB ${label} is truncated`)
}

function view(bytes, offset, length, label) {
  ensureRange(bytes, offset, length, label)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length)
}

const u16 = (bytes, offset, label) => view(bytes, offset, 2, label).getUint16(0, true)
const u32 = (bytes, offset, label) => view(bytes, offset, 4, label).getUint32(0, true)

function terminated(bytes, offset, end, label) {
  for (let cursor = offset; cursor < end; cursor += 1) {
    if (bytes[cursor] === 0)
      return Object.freeze({ bytes: bytes.slice(offset, cursor), next: cursor + 1 })
  }
  throw new TypeError(`CAB ${label} is not NUL-terminated`)
}

function safePath(nameBytes, utfName) {
  const decoded = (utfName ? utf8 : latin1).decode(nameBytes).replaceAll('\\', '/')
  const parts = decoded.split('/').filter(Boolean)
  if (
    decoded === '' ||
    decoded.startsWith('/') ||
    /^[a-z]:/iu.test(decoded) ||
    decoded.includes('\0') ||
    parts.length === 0 ||
    parts.some(part => part === '.' || part === '..')
  ) {
    throw new TypeError(`unsafe CAB entry path: ${decoded}`)
  }
  return parts.join('/')
}

function xorChecksum(bytes, offset, length) {
  let checksum = 0
  let cursor = 0
  while (cursor + 4 <= length) {
    checksum ^= u32(bytes, offset + cursor, 'CFDATA checksum input')
    cursor += 4
  }
  let tail = 0
  let shift = 0
  while (cursor < length) {
    tail |= (bytes[offset + cursor] ?? 0) << shift
    shift += 8
    cursor += 1
  }
  return (checksum ^ tail) >>> 0
}

function parseCab(bytes, budget) {
  if (!matches(bytes) || bytes.byteLength < 44) throw new TypeError('CAB header is invalid')
  if (
    u32(bytes, 4, 'reserved field 1') !== 0 ||
    u32(bytes, 12, 'reserved field 2') !== 0 ||
    u32(bytes, 20, 'reserved field 3') !== 0
  ) {
    throw new TypeError('CAB reserved header fields must be zero')
  }
  const cabinetSize = u32(bytes, 8, 'cabinet size')
  if (cabinetSize !== bytes.byteLength)
    throw new TypeError('CAB declared cabinet size does not match the source')
  const filesOffset = u32(bytes, 16, 'file table offset')
  const minorVersion = bytes[24] ?? 0
  const majorVersion = bytes[25] ?? 0
  if (majorVersion !== 1 || minorVersion !== 3) throw new TypeError('CAB version is unsupported')
  const folderCount = u16(bytes, 26, 'folder count')
  const fileCount = u16(bytes, 28, 'file count')
  const flags = u16(bytes, 30, 'flags')
  if ((flags & ~0x0007) !== 0) throw new TypeError('CAB header has unknown flags')
  if (folderCount === 0 || fileCount === 0) throw new TypeError('CAB exposes no folders or files')
  if (fileCount > budget.maxNodes) throw new RangeError('CAB file count exceeds maxNodes budget')
  let cursor = 36
  let folderReserve = 0
  let dataReserve = 0
  if ((flags & 0x0004) !== 0) {
    const headerReserve = u16(bytes, cursor, 'header reserve size')
    folderReserve = bytes[cursor + 2] ?? 0
    dataReserve = bytes[cursor + 3] ?? 0
    cursor += 4
    ensureRange(bytes, cursor, headerReserve, 'header reserve')
    cursor += headerReserve
  }
  if ((flags & 0x0001) !== 0) {
    cursor = terminated(bytes, cursor, filesOffset, 'previous cabinet name').next
    cursor = terminated(bytes, cursor, filesOffset, 'previous disk name').next
  }
  if ((flags & 0x0002) !== 0) {
    cursor = terminated(bytes, cursor, filesOffset, 'next cabinet name').next
    cursor = terminated(bytes, cursor, filesOffset, 'next disk name').next
  }
  const folders = []
  for (let index = 0; index < folderCount; index += 1) {
    ensureRange(bytes, cursor, 8 + folderReserve, `folder ${index}`)
    const dataOffset = u32(bytes, cursor, `folder ${index} data offset`)
    const blockCount = u16(bytes, cursor + 4, `folder ${index} block count`)
    const compression = u16(bytes, cursor + 6, `folder ${index} compression`)
    if (compression !== 0) {
      throw new TypeError(`CAB folder ${index} compression is outside the stored subset`)
    }
    if (blockCount === 0) throw new TypeError(`CAB folder ${index} exposes no data blocks`)
    folders.push({ index, dataOffset, blockCount, compression, blocks: [], decodedBytes: 0 })
    cursor += 8 + folderReserve
  }
  if (cursor > filesOffset) throw new TypeError('CAB folder table overlaps the file table')
  cursor = filesOffset
  const files = []
  const paths = new Set()
  for (let index = 0; index < fileCount; index += 1) {
    ensureRange(bytes, cursor, 16, `file ${index}`)
    const size = u32(bytes, cursor, `file ${index} size`)
    const folderOffset = u32(bytes, cursor + 4, `file ${index} folder offset`)
    const folderIndex = u16(bytes, cursor + 8, `file ${index} folder index`)
    const attributes = u16(bytes, cursor + 14, `file ${index} attributes`)
    if (folderIndex >= folders.length)
      throw new TypeError(`CAB file ${index} spans cabinets or names an invalid folder`)
    const named = terminated(bytes, cursor + 16, cabinetSize, `file ${index} name`)
    const path = safePath(named.bytes, (attributes & 0x0080) !== 0)
    if (paths.has(path)) throw new TypeError(`duplicate CAB entry path: ${path}`)
    paths.add(path)
    files.push(
      Object.freeze({
        id: `file-${index}`,
        path,
        name: path.split('/').at(-1),
        size,
        folderOffset,
        folderIndex,
        attributes,
      }),
    )
    cursor = named.next
  }
  let previousDataEnd = cursor
  for (const folder of folders) {
    if (folder.dataOffset < previousDataEnd) {
      throw new TypeError(
        `CAB folder ${folder.index} data overlaps header, files, or another folder`,
      )
    }
    let dataCursor = folder.dataOffset
    let decodedOffset = 0
    for (let blockIndex = 0; blockIndex < folder.blockCount; blockIndex += 1) {
      ensureRange(bytes, dataCursor, 8 + dataReserve, `folder ${folder.index} block ${blockIndex}`)
      const checksum = u32(bytes, dataCursor, 'CFDATA checksum')
      const storedBytes = u16(bytes, dataCursor + 4, 'CFDATA stored size')
      const decodedBytes = u16(bytes, dataCursor + 6, 'CFDATA decoded size')
      const payloadOffset = dataCursor + 8 + dataReserve
      ensureRange(
        bytes,
        payloadOffset,
        storedBytes,
        `folder ${folder.index} block ${blockIndex} payload`,
      )
      if (storedBytes !== decodedBytes)
        throw new TypeError('stored CAB block has unequal encoded and decoded sizes')
      if (
        checksum !== 0 &&
        checksum !== xorChecksum(bytes, dataCursor + 4, 4 + dataReserve + storedBytes)
      ) {
        throw new TypeError(`CAB folder ${folder.index} block ${blockIndex} checksum is invalid`)
      }
      folder.blocks.push(
        Object.freeze({ decodedOffset, payloadOffset, storedBytes, decodedBytes, checksum }),
      )
      decodedOffset += decodedBytes
      dataCursor = payloadOffset + storedBytes
    }
    folder.decodedBytes = decodedOffset
    previousDataEnd = dataCursor
  }
  for (const file of files) {
    if (file.folderOffset + file.size > folders[file.folderIndex].decodedBytes) {
      throw new TypeError(`CAB file ${file.path} exceeds its folder stream`)
    }
  }
  return Object.freeze({
    cabinetSize,
    majorVersion,
    minorVersion,
    flags,
    folders: Object.freeze(folders),
    files: Object.freeze(files),
  })
}

function extractFile(bytes, cab, file, maximum) {
  if (file.size > maximum) throw new RangeError('CAB entry exceeds maxScalarBytes budget')
  const output = new Uint8Array(file.size)
  const fileStart = file.folderOffset
  const fileEnd = fileStart + file.size
  let written = 0
  for (const block of cab.folders[file.folderIndex].blocks) {
    const blockStart = block.decodedOffset
    const blockEnd = blockStart + block.decodedBytes
    const overlapStart = Math.max(fileStart, blockStart)
    const overlapEnd = Math.min(fileEnd, blockEnd)
    if (overlapStart >= overlapEnd) continue
    const sourceStart = block.payloadOffset + overlapStart - blockStart
    const length = overlapEnd - overlapStart
    output.set(bytes.subarray(sourceStart, sourceStart + length), written)
    written += length
  }
  if (written !== file.size)
    throw new TypeError('CAB entry could not be reconstructed from folder blocks')
  return output
}

function namespaceSource(files, source) {
  const byId = new Map(files.map(file => [file.id, file]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('CAB namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid CAB page cursor')
      const matching = files.filter(file => file.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(file =>
        Object.freeze({
          id: file.id,
          path: file.path,
          name: file.name,
          kind: 'file',
          size: BigInt(file.size),
          storedSize: BigInt(file.size),
          compression: 'stored',
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
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const file = byId.get(entryId)
      if (file === undefined) throw new TypeError('CAB file entry was not found')
      const encoded = file.path.split('/').map(encodeURIComponent).join('/')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${file.path}`,
          uri: `cab-entry:${encodeURIComponent(source.ref.uri)}!/${encoded}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'cab',
    label: 'Microsoft Cabinet archive',
    mediaType: 'application/vnd.ms-cab-compressed',
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
  async detect(prefix) {
    return matches(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'mscf-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const cab = parseCab(bytes, context.budget)
    const byId = new Map(cab.files.map(file => [file.id, file]))
    const payloadBytes = cab.files.reduce((total, file) => total + BigInt(file.size), 0n)
    return {
      summary: {
        format: 'cab',
        version: `${cab.majorVersion}.${cab.minorVersion}`,
        files: cab.files.length,
        folders: cab.folders.length,
        payloadBytes: payloadBytes.toString(10),
      },
      metadata: [
        {
          id: 'cabinet',
          label: 'Microsoft Cabinet',
          entries: [
            { key: 'version', value: `${cab.majorVersion}.${cab.minorVersion}` },
            { key: 'cabinetBytes', value: cab.cabinetSize },
            { key: 'folders', value: cab.folders.length },
            { key: 'files', value: cab.files.length },
            { key: 'flags', value: cab.flags },
            { key: 'compression', value: 'stored' },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: cab.files.length } },
        { id: 'container.compression', parameters: { methods: ['stored'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Microsoft Cabinet',
          preview: `${cab.files.length} files in ${cab.folders.length} folders`,
          children: cab.files.map(file => ({
            kind: 'file',
            label: file.path,
            preview: `${file.size} stored bytes, folder ${file.folderIndex}`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(cab.files, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const file = byId.get(String(input.entryId ?? ''))
          if (file === undefined) throw new TypeError('CAB file entry was not found')
          return {
            kind: 'bytes',
            value: extractFile(bytes, cab, file, context.budget.maxScalarBytes),
          }
        },
      },
      maxDecodedBytes: payloadBytes,
      unsupportedFeatures: [
        'mszip-lzx-quantum-compression',
        'split-and-spanned-cabinets',
        'msi-compound-documents',
        'cab-writing',
        'archive-mutation',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
