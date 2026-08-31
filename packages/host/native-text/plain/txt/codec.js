/**
 * `modkit/txt` — the plain-text codec, relocated out of MK2 staging by block 11 slice 11A.
 *
 * Read-only by construction: the codec decodes, describes and hands out sources. Editing plain text
 * is the separate `modkit/plain-text-writer` contribution, so nothing here can write a source.
 */
import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource,
} from '@modkit/host'
import { createTreeDataSource, lease as simpleLease, newlineOf } from '../../runtime/basic.js'
import { revisionId } from '@modkit/sdk'

const CODEC_ID = 'modkit/txt'
/** Control characters that are text: tab, line feed, carriage return, form feed. */
const TEXT_CONTROLS = new Set([0x09, 0x0a, 0x0c, 0x0d])
/** Above this share of other control bytes the sample is binary, not prose. */
const CONTROL_RATIO_LIMIT = 0.02

const OPERATION_DECLARATIONS = Object.freeze([
  {
    id: 'view.inspect',
    handlerId: 'inspect',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['json'],
  },
  {
    id: 'asset.validate',
    handlerId: 'validate',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['none'],
  },
  {
    id: 'asset.search',
    handlerId: 'search',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['json'],
  },
  {
    id: 'export.raw',
    handlerId: 'export-raw',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['bytes'],
  },
])

function extensionOf(uri) {
  const clean = uri.split(/[?#]/u, 1)[0] ?? ''
  const name = clean.slice(clean.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * Byte-order mark first: it is provenance, never content. Without a mark the sample must decode as
 * strict UTF-8 — a lone `FF FE` inside prose is not an encoding claim.
 */
function decodeSample(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeWith(bytes.subarray(3), 'utf-8', true)
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeWith(bytes.subarray(2), 'utf-16le', true)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeWith(bytes.subarray(2), 'utf-16be', true)
  return decodeWith(bytes, 'utf-8', false)
}

function decodeWith(content, encoding, bom) {
  if (encoding === 'utf-8' && content.includes(0)) {
    return { ok: false, encoding, bom, reason: 'nul-byte' }
  }
  let text
  try {
    if (encoding === 'utf-16be') {
      const swapped = new Uint8Array(content.length - (content.length % 2))
      for (let index = 0; index + 1 < swapped.length; index += 2) {
        swapped[index] = content[index + 1]
        swapped[index + 1] = content[index]
      }
      text = new TextDecoder('utf-16le', { fatal: true }).decode(swapped)
    } else if (encoding === 'utf-16le') {
      text = new TextDecoder('utf-16le', { fatal: true }).decode(
        content.subarray(0, content.length - (content.length % 2)),
      )
    } else {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content)
    }
  } catch {
    return { ok: false, encoding, bom, reason: 'undecodable' }
  }
  if (text.includes('\0')) return { ok: false, encoding, bom, reason: 'nul-byte' }
  let controls = 0
  for (const character of text) {
    const code = character.codePointAt(0)
    if (code < 0x20 && !TEXT_CONTROLS.has(code)) controls += 1
  }
  const ratio = text.length === 0 ? 0 : controls / text.length
  if (ratio > CONTROL_RATIO_LIMIT) return { ok: false, encoding, bom, reason: 'control-ratio' }
  return { ok: true, encoding, bom, text, reason: 'bounded-text' }
}

/** Blank-line separated paragraphs, bounded by the session node budget. */
function outline(text, maxNodes) {
  const lines = text.split(/\r\n|\n|\r/u)
  const paragraphs = []
  let current = []
  const flush = () => {
    if (current.length === 0) return
    paragraphs.push(current.join('\n'))
    current = []
    if (paragraphs.length > maxNodes) throw new RangeError('text paragraphs exceed maxNodes budget')
  }
  for (const line of lines) {
    if (line.trim() === '') flush()
    else current.push(line)
  }
  flush()
  const trimmed = text.trim()
  return {
    lines: lines.length,
    words: trimmed === '' ? 0 : trimmed.split(/\s+/u).length,
    characters: text.length,
    paragraphs,
  }
}

function preview(value) {
  const compact = value.replace(/\s+/gu, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
}

function treeFor(shape) {
  return {
    kind: 'document',
    label: 'Plain text',
    preview: `${shape.lines} line(s), ${shape.words} word(s)`,
    children: shape.paragraphs.map((value, index) => ({
      kind: 'paragraph',
      label: `Paragraph ${index + 1}`,
      preview: preview(value),
    })),
  }
}

export const abiVersion = 1

export const createCodec = () =>
  Object.freeze({
    async probe(request, signal) {
      if (request.source.kind !== 'bytes' || request.plan.kind !== 'bytes') {
        throw new TypeError('plain text accepts only byte candidates and byte probe plans')
      }
      // The probe window is what the plan asks for, clamped by what the source actually has: a
      // 53-byte note must not be read as 8192 bytes, or the host refuses the range outright.
      const declared = Math.min(
        request.plan.maxBytes,
        request.plan.ranges[0]?.length ?? request.plan.maxBytes,
      )
      const available = request.source.size === undefined ? declared : Number(request.source.size)
      const length = Math.max(0, Math.min(declared, available))
      const bytes = await request.source.read(0n, length, signal)
      const uri = request.source.ref.uri
      const required = [{ byteOffset: '0', byteLength: String(bytes.byteLength) }]
      const decoded = decodeSample(bytes)
      if (!decoded.ok) {
        return {
          codecId: CODEC_ID,
          confidence: 0.02,
          evidence: [{ kind: 'structure', weight: -1, note: decoded.reason }],
          requiredRanges: required,
        }
      }
      const known = extensionOf(uri) === 'txt'
      return {
        codecId: CODEC_ID,
        confidence: known ? 0.9 : 0.6,
        evidence: [
          {
            kind: 'structure',
            weight: 0.6,
            note: `${decoded.encoding}${decoded.bom ? '-bom' : ''}`,
          },
          ...(known ? [{ kind: 'extension', weight: 0.3, note: 'txt' }] : []),
        ],
        requiredRanges: required,
      }
    },

    async planInput(source) {
      if (source.kind === 'derived') throw new TypeError('plain text requires a byte candidate')
      return {
        originKind: 'single',
        candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
        requirements: [],
      }
    },

    async open(input, _intent, budget, signal) {
      if (input.originKind !== 'single') throw new TypeError('plain text requires a single source')
      const binding = input.bindings[0]
      const sourceLease = await input.openBinding(binding.bindingId, signal)
      const source = sourceLease.value
      if (source.kind !== 'bytes' || source.size === undefined) {
        await sourceLease.release()
        throw new TypeError('plain text requires a sized byte source')
      }
      if (source.size > budget.maxInputBytes) {
        await sourceLease.release()
        throw new RangeError('plain text input exceeds the session budget')
      }
      const raw = await source.read(0n, Number(source.size), signal)
      const decoded = decodeSample(raw)
      if (!decoded.ok) {
        await sourceLease.release()
        throw new TypeError(`plain text rejected a binary source (${decoded.reason})`)
      }
      if (decoded.text.length * 2 > budget.maxScalarBytes) {
        await sourceLease.release()
        throw new RangeError('decoded text exceeds the maxScalarBytes budget')
      }
      const shape = outline(decoded.text, budget.maxNodes)
      const bytes = Object.freeze({
        size: async () => source.size,
        read: (offset, length, readSignal) => source.read(offset, length, readSignal),
      })
      const tree = createTreeDataSource(treeFor(shape))
      // The lazy text source indexes lines over the source bytes; that index is only true for
      // UTF-8, so a UTF-16 document publishes the outline and the bytes and says so.
      const utf8 = decoded.encoding === 'utf-8'
      const text = utf8 ? createUtf8TextDataSource(bytes) : undefined
      const dataSources = [
        { contract: 'common.view/tree-data-source', major: 1 },
        ...(utf8 ? [{ contract: 'common.view/text-data-source', major: 1 }] : []),
        { contract: 'common.view/byte-range-source', major: 1 },
      ]
      const summary = {
        format: 'txt',
        encoding: decoded.encoding,
        bom: decoded.bom,
        newline: newlineOf(decoded.text),
        characters: shape.characters,
        lines: shape.lines,
        words: shape.words,
        paragraphs: shape.paragraphs.length,
      }
      const descriptor = await assembleSubjectDescriptor({
        schemaVersion: 2,
        subjectUri: binding.source.uri,
        origin: {
          kind: 'single',
          binding: {
            id: binding.bindingId,
            role: binding.role,
            source: binding.source,
            required: true,
            ownership: binding.ownership,
            revision: binding.revision,
            mediaType: 'text/plain',
          },
        },
        interpretation: 'codec',
        identity: {
          codecId: CODEC_ID,
          codecVersion: '1.0.0',
          formatId: 'txt',
          formatLabel: 'Plain Text Document',
          mediaType: 'text/plain',
          confidence: 1,
          detection: [{ kind: 'structure', weight: 0.9, note: decoded.encoding }],
        },
        traits: [
          {
            id: 'document.flow',
            descriptorVersion: 1,
            state: 'available',
            parameters: { paragraphs: shape.paragraphs.length, lines: shape.lines },
          },
          {
            id: 'structure.hierarchy',
            descriptorVersion: 1,
            state: 'available',
            parameters: { nodeCount: shape.paragraphs.length, lazy: true, hasLocations: false },
          },
          {
            id: 'content.text',
            descriptorVersion: 1,
            state: 'available',
            parameters: {
              encoding: decoded.encoding,
              bom: decoded.bom,
              newline: summary.newline,
              lineCount: shape.lines,
              characters: shape.characters,
            },
          },
          {
            id: 'content.binary',
            descriptorVersion: 1,
            state: 'available',
            parameters: { bytes: source.size.toString(10) },
          },
        ],
        operations: OPERATION_DECLARATIONS.map(operation => ({
          id: operation.id,
          handlerId: operation.handlerId,
          mutatesSource: false,
          state: 'available',
        })),
        constraints: {
          readOnly: true,
          seekable: true,
          randomAccess: true,
          trusted: false,
          maxDecodedBytes: source.size.toString(10),
        },
        dataSources,
        diagnostics: [],
        metadata: [
          {
            id: 'plain-text',
            label: 'Plain text',
            entries: Object.entries(summary).map(([key, value]) => ({ key, value })),
          },
        ],
        revision: input.revisions.revision,
      })
      const handlers = new Map([
        ['inspect', async () => ({ kind: 'json', value: summary })],
        ['validate', async () => ({ kind: 'none' })],
        [
          'search',
          async operationInput => {
            const pattern =
              operationInput !== null &&
              typeof operationInput === 'object' &&
              typeof operationInput.pattern === 'string'
                ? operationInput.pattern
                : ''
            if (pattern === '') return { kind: 'json', value: [] }
            const matches = []
            let index = decoded.text.indexOf(pattern)
            while (index !== -1 && matches.length < budget.maxDiagnostics) {
              matches.push({ utf16Offset: index, utf16Length: pattern.length })
              index = decoded.text.indexOf(pattern, index + Math.max(1, pattern.length))
            }
            return { kind: 'json', value: matches }
          },
        ],
        ['export-raw', async () => ({ kind: 'bytes', value: raw })],
      ])
      const managed = createAssetSession({
        revision: revisionId(input.revisions.revision),
        descriptor,
        operationDeclarations: OPERATION_DECLARATIONS,
        permissionGrant: { id: 'plain-text-session', classes: ['read-source'] },
        handlers,
        async openDataSource(contract) {
          if (contract === 'common.view/tree-data-source') return simpleLease(tree)
          if (contract === 'common.view/byte-range-source') return simpleLease(bytes)
          if (contract === 'common.view/text-data-source' && text !== undefined) {
            return simpleLease(text)
          }
          throw new TypeError(`modkit/txt does not publish ${contract}`)
        },
        release: [() => sourceLease.release()],
      })
      return managed.session
    },
  })
