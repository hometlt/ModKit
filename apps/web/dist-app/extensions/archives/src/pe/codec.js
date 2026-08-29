import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/pe'
const latin1 = new TextDecoder('latin1')

function ensureRange(bytes, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new TypeError(`PE ${label} range is invalid`)
  }
  if (offset + length > bytes.byteLength) throw new TypeError(`PE ${label} is truncated`)
}

function view(bytes, offset, length, label) {
  ensureRange(bytes, offset, length, label)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length)
}

const u16 = (bytes, offset, label) => view(bytes, offset, 2, label).getUint16(0, true)
const u32 = (bytes, offset, label) => view(bytes, offset, 4, label).getUint32(0, true)

function u64(bytes, offset, label) {
  return view(bytes, offset, 8, label).getBigUint64(0, true)
}

function peOffset(bytes) {
  if (bytes.byteLength < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return undefined
  return new DataView(bytes.buffer, bytes.byteOffset + 60, 4).getUint32(0, true)
}

function matches(bytes) {
  const offset = peOffset(bytes)
  return (
    offset !== undefined &&
    offset >= 64 &&
    offset + 4 <= bytes.byteLength &&
    bytes[offset] === 0x50 &&
    bytes[offset + 1] === 0x45 &&
    bytes[offset + 2] === 0 &&
    bytes[offset + 3] === 0
  )
}

function sectionName(bytes, offset) {
  const raw = bytes.subarray(offset, offset + 8)
  const end = raw.indexOf(0)
  const decoded = latin1.decode(end < 0 ? raw : raw.subarray(0, end)).trim()
  if (decoded === '' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
    throw new TypeError('PE section name is invalid')
  }
  return decoded
}

const machineName = machine =>
  ({ 0x014c: 'x86', 0x8664: 'x86-64', 0x01c0: 'arm', 0xaa64: 'arm64' })[machine] ??
  `0x${machine.toString(16).padStart(4, '0')}`

const subsystemName = subsystem =>
  ({ 1: 'native', 2: 'windows-gui', 3: 'windows-console', 10: 'efi-application', 14: 'xbox' })[
    subsystem
  ] ?? `unknown-${subsystem}`

function parsePe(bytes, budget) {
  if (!matches(bytes)) throw new TypeError('PE signature is missing')
  const signatureOffset = peOffset(bytes)
  const coffOffset = signatureOffset + 4
  ensureRange(bytes, coffOffset, 20, 'COFF header')
  const machine = u16(bytes, coffOffset, 'machine')
  const sectionCount = u16(bytes, coffOffset + 2, 'section count')
  const timestamp = u32(bytes, coffOffset + 4, 'timestamp')
  const optionalSize = u16(bytes, coffOffset + 16, 'optional header size')
  const characteristics = u16(bytes, coffOffset + 18, 'characteristics')
  if (sectionCount === 0) throw new TypeError('PE exposes no sections')
  if (sectionCount > 96) throw new RangeError('PE section count exceeds the Windows loader limit')
  if (sectionCount + 2 > budget.maxNodes)
    throw new RangeError('PE section count exceeds maxNodes budget')
  const optionalOffset = coffOffset + 20
  ensureRange(bytes, optionalOffset, optionalSize, 'optional header')
  const magic = u16(bytes, optionalOffset, 'optional header magic')
  const pe32Plus = magic === 0x020b
  if (!pe32Plus && magic !== 0x010b) throw new TypeError('PE optional header kind is unsupported')
  const minimumOptional = pe32Plus ? 112 : 96
  if (optionalSize < minimumOptional) throw new TypeError('PE optional header is too short')
  const entryPoint = u32(bytes, optionalOffset + 16, 'entry point')
  const imageBase = pe32Plus
    ? u64(bytes, optionalOffset + 24, 'image base')
    : BigInt(u32(bytes, optionalOffset + 28, 'image base'))
  const sectionAlignment = u32(bytes, optionalOffset + 32, 'section alignment')
  const fileAlignment = u32(bytes, optionalOffset + 36, 'file alignment')
  const sizeOfImage = u32(bytes, optionalOffset + 56, 'image size')
  const sizeOfHeaders = u32(bytes, optionalOffset + 60, 'header size')
  const subsystem = u16(bytes, optionalOffset + 68, 'subsystem')
  const dllCharacteristics = u16(bytes, optionalOffset + 70, 'DLL characteristics')
  if (
    fileAlignment === 0 ||
    fileAlignment > 65536 ||
    (fileAlignment & (fileAlignment - 1)) !== 0 ||
    sectionAlignment === 0 ||
    sectionAlignment < fileAlignment
  ) {
    throw new TypeError('PE file or section alignment is invalid')
  }
  const directoryCountOffset = optionalOffset + (pe32Plus ? 108 : 92)
  const directoriesOffset = optionalOffset + (pe32Plus ? 112 : 96)
  const declaredDirectoryCount = u32(bytes, directoryCountOffset, 'data directory count')
  const availableDirectoryCount = Math.floor((optionalSize - (pe32Plus ? 112 : 96)) / 8)
  if (declaredDirectoryCount > availableDirectoryCount) {
    throw new TypeError('PE data directory count exceeds the optional header')
  }
  const directoryCount = Math.min(declaredDirectoryCount, availableDirectoryCount, 16)
  const dataDirectories = []
  for (let index = 0; index < directoryCount; index += 1) {
    dataDirectories.push(
      Object.freeze({
        index,
        virtualAddress: u32(
          bytes,
          directoriesOffset + index * 8,
          `data directory ${index} address`,
        ),
        size: u32(bytes, directoriesOffset + index * 8 + 4, `data directory ${index} size`),
      }),
    )
  }
  const sectionTable = optionalOffset + optionalSize
  ensureRange(bytes, sectionTable, sectionCount * 40, 'section table')
  if (sizeOfHeaders < sectionTable + sectionCount * 40 || sizeOfHeaders > bytes.byteLength) {
    throw new TypeError('PE header size does not contain the section table')
  }
  const sections = []
  const rawRanges = []
  let overlayOffset = sizeOfHeaders
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionTable + index * 40
    const name = sectionName(bytes, offset)
    const virtualSize = u32(bytes, offset + 8, `section ${name} virtual size`)
    const virtualAddress = u32(bytes, offset + 12, `section ${name} virtual address`)
    const rawSize = u32(bytes, offset + 16, `section ${name} raw size`)
    const rawOffset = u32(bytes, offset + 20, `section ${name} raw offset`)
    const sectionCharacteristics = u32(bytes, offset + 36, `section ${name} characteristics`)
    if (rawSize > 0) {
      ensureRange(bytes, rawOffset, rawSize, `section ${name}`)
      if (rawOffset < sizeOfHeaders || rawOffset % fileAlignment !== 0) {
        throw new TypeError(`PE section ${name} raw offset is not file-aligned after the headers`)
      }
      if (rawSize % fileAlignment !== 0) {
        throw new TypeError(`PE section ${name} raw size is not a file-aligned multiple`)
      }
      rawRanges.push({ start: rawOffset, end: rawOffset + rawSize, name })
      overlayOffset = Math.max(overlayOffset, rawOffset + rawSize)
    }
    sections.push(
      Object.freeze({
        id: `section-${index}`,
        path: `sections/${String(index).padStart(2, '0')}-${name}.bin`,
        name,
        virtualSize,
        virtualAddress,
        rawSize,
        rawOffset,
        characteristics: sectionCharacteristics,
      }),
    )
  }
  rawRanges.sort((left, right) => left.start - right.start)
  for (let index = 1; index < rawRanges.length; index += 1) {
    if (rawRanges[index].start < rawRanges[index - 1].end) {
      throw new TypeError(
        `PE sections ${rawRanges[index - 1].name} and ${rawRanges[index].name} overlap on disk`,
      )
    }
  }
  const entries = [
    Object.freeze({
      id: 'headers',
      path: 'headers/pe-headers.bin',
      name: 'pe-headers.bin',
      size: sizeOfHeaders,
      offset: 0,
      kind: 'headers',
    }),
    ...sections
      .filter(section => section.rawSize > 0)
      .map(section =>
        Object.freeze({
          id: section.id,
          path: section.path,
          name: section.path.split('/').at(-1),
          size: section.rawSize,
          offset: section.rawOffset,
          kind: 'section',
        }),
      ),
  ]
  if (overlayOffset < bytes.byteLength) {
    entries.push(
      Object.freeze({
        id: 'overlay',
        path: 'overlay/overlay.bin',
        name: 'overlay.bin',
        size: bytes.byteLength - overlayOffset,
        offset: overlayOffset,
        kind: 'overlay',
      }),
    )
  }
  return Object.freeze({
    signatureOffset,
    machine,
    timestamp,
    characteristics,
    pe32Plus,
    entryPoint,
    imageBase,
    sectionAlignment,
    fileAlignment,
    sizeOfImage,
    sizeOfHeaders,
    subsystem,
    dllCharacteristics,
    declaredDirectoryCount,
    dataDirectories: Object.freeze(dataDirectories),
    sections: Object.freeze(sections),
    entries: Object.freeze(entries),
  })
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('PE namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid PE page cursor')
      const matching = entries.filter(entry => entry.path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.path,
          name: entry.name,
          kind: 'file',
          size: BigInt(entry.size),
          storedSize: BigInt(entry.size),
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
      const entry = byId.get(entryId)
      if (entry === undefined) throw new TypeError('PE namespace entry was not found')
      const encoded = entry.path.split('/').map(encodeURIComponent).join('/')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.path}`,
          uri: `pe-entry:${encodeURIComponent(source.ref.uri)}!/${encoded}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'pe',
    label: 'Windows Portable Executable',
    mediaType: 'application/vnd.microsoft.portable-executable',
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
      ? { confidence: 0.99, kind: 'structure', note: 'dos-and-pe-signatures' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const pe = parsePe(bytes, context.budget)
    const byId = new Map(pe.entries.map(entry => [entry.id, entry]))
    const projectedBytes = pe.entries.reduce((total, entry) => total + BigInt(entry.size), 0n)
    return {
      summary: {
        format: pe.pe32Plus ? 'pe32+' : 'pe32',
        machine: machineName(pe.machine),
        subsystem: subsystemName(pe.subsystem),
        sections: pe.sections.length,
        entryPoint: `0x${pe.entryPoint.toString(16)}`,
        imageBase: `0x${pe.imageBase.toString(16)}`,
      },
      metadata: [
        {
          id: 'pe-headers',
          label: 'Portable Executable headers',
          entries: [
            { key: 'kind', value: pe.pe32Plus ? 'PE32+' : 'PE32' },
            { key: 'machine', value: machineName(pe.machine) },
            { key: 'subsystem', value: subsystemName(pe.subsystem) },
            { key: 'timestampSeconds', value: pe.timestamp },
            { key: 'sections', value: pe.sections.length },
            { key: 'entryPoint', value: `0x${pe.entryPoint.toString(16)}` },
            { key: 'imageBase', value: `0x${pe.imageBase.toString(16)}` },
            { key: 'imageBytes', value: pe.sizeOfImage },
            { key: 'headerBytes', value: pe.sizeOfHeaders },
            { key: 'fileAlignment', value: pe.fileAlignment },
            { key: 'sectionAlignment', value: pe.sectionAlignment },
            {
              key: 'characteristics',
              value: `0x${pe.characteristics.toString(16).padStart(4, '0')}`,
            },
            {
              key: 'dllCharacteristics',
              value: `0x${pe.dllCharacteristics.toString(16).padStart(4, '0')}`,
            },
            { key: 'dataDirectories', value: pe.declaredDirectoryCount },
          ],
        },
        {
          id: 'pe-sections',
          label: 'Sections',
          entries: pe.sections.map(section => ({
            key: section.name,
            value: `${section.rawSize} raw bytes at 0x${section.rawOffset.toString(16)}, RVA 0x${section.virtualAddress.toString(16)}`,
          })),
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: pe.entries.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'executable',
          label: `Windows ${pe.pe32Plus ? 'PE32+' : 'PE32'}`,
          preview: `${machineName(pe.machine)}, ${pe.sections.length} sections`,
          children: pe.entries.map(entry => ({
            kind: 'file',
            label: entry.path,
            preview: `${entry.size} bytes (${entry.kind})`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(pe.entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined) throw new TypeError('PE namespace entry was not found')
          if (entry.size > context.budget.maxScalarBytes) {
            throw new RangeError('PE entry exceeds maxScalarBytes budget')
          }
          return { kind: 'bytes', value: bytes.slice(entry.offset, entry.offset + entry.size) }
        },
      },
      maxDecodedBytes: projectedBytes,
      unsupportedFeatures: [
        'executable-loading-and-code-execution',
        'resource-decoding-and-icon-reconstruction',
        'installer-and-self-extracting-payload-expansion',
        'pe-writing',
        'archive-mutation',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
