import { diagnostic, throwIfAborted, uint64 } from '@modkitx-x3/core'
import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource,
} from '@modkitx-x3/host'
import { revisionId } from '@modkitx-x3/sdk'
import { lease, newlineOf } from './basic.js'

function decodeInput(input) {
  if (typeof input.text === 'string') {
    return {
      text: input.text,
      bytes: new TextEncoder().encode(input.text),
      source: { encoding: 'utf-8', bom: false, newline: newlineOf(input.text) },
    }
  }
  const bytes = input.bytes
  let encoding = input.encoding
  let bom = false
  let offset = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = encoding ?? 'utf-8'
    bom = true
    offset = 3
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = encoding ?? 'utf-16le'
    bom = true
    offset = 2
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = encoding ?? 'utf-16be'
    bom = true
    offset = 2
  }
  encoding ??= 'utf-8'
  const content = bytes.subarray(offset)
  let text
  if (encoding === 'utf-16be') {
    const swapped = new Uint8Array(content.length)
    for (let index = 0; index + 1 < content.length; index += 2) {
      swapped[index] = content[index + 1]
      swapped[index + 1] = content[index]
    }
    text = new TextDecoder('utf-16le', { fatal: true }).decode(swapped)
  } else {
    text = new TextDecoder(encoding, { fatal: true }).decode(content)
  }
  return { text, bytes, source: { encoding, bom, newline: newlineOf(text) } }
}

export function span(text, offset = 0, length = text.length) {
  const prefix = text.slice(0, offset)
  const lastLf = prefix.lastIndexOf('\n')
  return Object.freeze({
    byteOffset: uint64(BigInt(new TextEncoder().encode(prefix).byteLength)),
    byteLength: uint64(
      BigInt(new TextEncoder().encode(text.slice(offset, offset + length)).byteLength),
    ),
    utf16Offset: offset,
    utf16Length: length,
    line: (prefix.match(/\n/gu) ?? []).length,
    column: offset - (lastLf === -1 ? 0 : lastLf + 1),
  })
}

export function failure(code, message, text = '', offset = 0, length = 0) {
  return {
    state: 'failed',
    diagnostics: [
      diagnostic('error', code, message, undefined, undefined, span(text, offset, length)),
    ],
  }
}

function preflight(decoded, budget, signal) {
  throwIfAborted(signal)
  if (BigInt(decoded.bytes.byteLength) > budget.maxInputBytes) {
    return failure(
      'org.modkitx/text-data-input-budget',
      'input exceeds maxInputBytes',
      decoded.text,
    )
  }
  if (decoded.text.includes('\0')) {
    return failure('org.modkitx/text-data-nul', 'NUL is forbidden in text input', decoded.text)
  }
  return undefined
}

export function encodeText(text, source, target = {}) {
  const facts = { ...source, ...target }
  const newline = facts.newline === 'none' ? source.newline : facts.newline
  const separator = newline === 'crlf' ? '\r\n' : newline === 'cr' ? '\r' : '\n'
  const normalized =
    newline === 'mixed' || newline === 'none' ? text : text.replace(/\r\n|\r|\n/gu, separator)
  let bytes
  if (facts.encoding === 'utf-8') bytes = new TextEncoder().encode(normalized)
  else {
    const little = new Uint8Array(normalized.length * 2)
    const view = new DataView(little.buffer)
    for (let index = 0; index < normalized.length; index += 1) {
      view.setUint16(index * 2, normalized.charCodeAt(index), facts.encoding === 'utf-16le')
    }
    bytes = little
  }
  if (facts.bom) {
    const marker =
      facts.encoding === 'utf-8'
        ? new Uint8Array([0xef, 0xbb, 0xbf])
        : facts.encoding === 'utf-16le'
          ? new Uint8Array([0xff, 0xfe])
          : new Uint8Array([0xfe, 0xff])
    const joined = new Uint8Array(marker.length + bytes.length)
    joined.set(marker)
    joined.set(bytes, marker.length)
    bytes = joined
  }
  return {
    bytes,
    encoding: facts.encoding,
    bom: facts.bom,
    newline: facts.newline,
    diagnostics: [],
  }
}

export function scalar(value, raw = JSON.stringify(value)) {
  if (value === null) return { kind: 'null', raw: 'null' }
  if (typeof value === 'boolean') return { kind: 'boolean', value, raw: String(value) }
  if (typeof value === 'string') return { kind: 'string', value, raw: raw ?? JSON.stringify(value) }
  if (typeof value === 'bigint')
    return { kind: 'integer', decimal: String(value), raw: String(value) }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return { kind: 'integer', decimal: String(value), raw: raw ?? String(value) }
  }
  if (typeof value === 'number')
    return { kind: 'number', raw: raw ?? String(value), finiteValue: value }
  return { kind: 'string', value: String(value), raw: raw ?? String(value) }
}

function treeDataSource(document) {
  const nodes = new Map([['root', { value: document, children: [] }]])
  const entries =
    document.root?.kind === 'object'
      ? document.root.members.map(member => [member.key, member.value])
      : Object.entries(document)
  nodes.get('root').children = entries.map(([key, value], index) => {
    const id = `root/${index}`
    nodes.set(id, { value, label: String(key), children: [] })
    return { id, hasChildren: false }
  })
  return Object.freeze({
    async root() {
      return { id: 'root', hasChildren: true }
    },
    async children(node, page) {
      const all = nodes.get(node.id)?.children ?? []
      const start = page.cursor ? Number(page.cursor) : 0
      const items = all.slice(start, start + page.limit)
      return {
        items,
        ...(start + items.length < all.length ? { nextCursor: String(start + items.length) } : {}),
      }
    },
    async facts(node) {
      const item = nodes.get(node.id)
      return { kind: item?.value?.kind ?? 'value', label: item?.label ?? 'root' }
    },
    async *search(query) {
      for (const [id, item] of nodes) {
        if ((item.label ?? '').includes(query.pattern)) yield { id, hasChildren: false }
      }
    },
  })
}

export function createTextSyntaxProvider(definition) {
  const provider = Object.freeze({
    contract: definition.contract,
    async parse(request) {
      throwIfAborted(request.signal)
      let decoded
      try {
        decoded = decodeInput(request.input)
      } catch (cause) {
        return failure(
          'org.modkitx/text-data-decode',
          cause instanceof Error ? cause.message : String(cause),
        )
      }
      const rejected = preflight(decoded, request.budget, request.signal)
      return rejected ?? definition.parse(decoded, request)
    },
    async serialize(request) {
      throwIfAborted(request.signal)
      const result = await definition.serialize(request)
      if (BigInt(result.bytes.byteLength) <= request.budget.maxInputBytes) return result
      return {
        ...result,
        bytes: new Uint8Array(),
        diagnostics: [
          diagnostic(
            'error',
            'org.modkitx/text-data-output-budget',
            'serialized output exceeds maxInputBytes',
          ),
        ],
      }
    },
    async dataSource(request) {
      const parsed = await provider.parse(request)
      if (parsed.state === 'failed')
        throw new TypeError(parsed.diagnostics[0]?.message ?? 'parse failed')
      return lease(treeDataSource(parsed.document))
    },
  })
  return provider
}

export function createSelectedProvider(definition, selection, factory = createTextSyntaxProvider) {
  if (selection?.contract !== definition.contract) {
    throw new TypeError(`provider does not implement ${String(selection?.contract)}`)
  }
  return factory(definition)
}

const OPERATIONS = Object.freeze([
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
  {
    id: 'data.parse',
    handlerId: 'parse',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['json'],
  },
  {
    id: 'data.serialize',
    handlerId: 'serialize',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['bytes'],
  },
])

export function createTextCodec(definition, context) {
  return Object.freeze({
    async probe(request, signal) {
      if (request.source.kind !== 'bytes' || request.plan.kind !== 'bytes')
        throw new TypeError('text codecs require byte probes')
      const declared = Math.min(
        request.plan.maxBytes,
        request.plan.ranges[0]?.length ?? request.plan.maxBytes,
      )
      const available = request.source.size === undefined ? declared : Number(request.source.size)
      const bytes = await request.source.read(
        0n,
        Math.max(0, Math.min(declared, available)),
        signal,
      )
      let text = ''
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        return {
          codecId: `org.modkitx/text-${definition.format}`,
          confidence: 0.01,
          evidence: [{ kind: 'structure', weight: -1, note: 'invalid-utf8' }],
          requiredRanges: [{ byteOffset: '0', byteLength: String(bytes.byteLength) }],
        }
      }
      const result = definition.detect(text, request.source.ref.uri)
      return {
        codecId: `org.modkitx/text-${definition.format}`,
        confidence: result.confidence,
        evidence: [{ kind: 'structure', weight: result.confidence, note: result.note }],
        requiredRanges: [{ byteOffset: '0', byteLength: String(bytes.byteLength) }],
      }
    },
    async planInput() {
      return {
        originKind: 'single',
        candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
        requirements: [],
      }
    },
    async open(input, _intent, budget, signal) {
      if (input.originKind !== 'single') throw new TypeError('text codec requires a single source')
      const binding = input.bindings[0]
      const sourceLease = await input.openBinding(binding.bindingId, signal)
      const source = sourceLease.value
      if (
        source.kind !== 'bytes' ||
        source.size === undefined ||
        source.size > budget.maxInputBytes
      ) {
        await sourceLease.release()
        throw new RangeError('text codec requires a sized source inside budget')
      }
      const bytes = await source.read(0n, Number(source.size), signal)
      const providerLease = await context.contracts.resolve({
        contract: definition.contract,
        major: 1,
        signal,
      })
      const provider = providerLease.value
      const parsed = await provider.parse({
        input: { bytes },
        dialect: definition.dialect,
        budget,
        signal,
      })
      if (parsed.state === 'failed') {
        await providerLease.release()
        await sourceLease.release()
        throw new TypeError(parsed.diagnostics[0]?.message ?? 'parse failed')
      }
      const dataLease = await provider.dataSource({
        input: { bytes },
        dialect: definition.dialect,
        budget,
        signal,
      })
      const byteSource = {
        size: async () => source.size,
        read: (offset, length, readSignal) => source.read(offset, length, readSignal),
      }
      const textSource = createUtf8TextDataSource(byteSource)
      const textInfo = await textSource.info()
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
          },
        },
        interpretation: 'codec',
        identity: {
          codecId: `org.modkitx/text-${definition.format}`,
          codecVersion: '1.0.0',
          formatId: definition.format,
          formatLabel: definition.format.toUpperCase(),
          mediaType: definition.mediaType,
          confidence: 1,
          detection: [{ kind: 'structure', weight: 1 }],
        },
        traits: [
          {
            id: 'structure.hierarchy',
            descriptorVersion: 1,
            state: 'available',
            parameters: { nodeCount: 'unknown', lazy: true, hasLocations: true },
          },
          {
            id: 'content.text',
            descriptorVersion: 1,
            state: 'available',
            parameters: {
              encoding: textInfo.encoding,
              lineCount: textInfo.lines,
              bom: textInfo.bom,
              newline: textInfo.newline,
            },
          },
          {
            id: 'content.binary',
            descriptorVersion: 1,
            state: 'available',
            parameters: { bytes: source.size.toString(10) },
          },
        ],
        operations: OPERATIONS.map(operation => ({
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
        dataSources: [
          { contract: 'common.view/tree-data-source', major: 1 },
          { contract: 'common.view/text-data-source', major: 1 },
          { contract: 'common.view/byte-range-source', major: 1 },
        ],
        diagnostics: [],
        metadata: [],
        revision: input.revisions.revision,
      })
      const handlers = new Map([
        [
          'inspect',
          async () => ({
            kind: 'json',
            value: { format: definition.format, parseState: parsed.state },
          }),
        ],
        ['validate', async () => ({ kind: 'none' })],
        ['search', async () => ({ kind: 'json', value: [] })],
        ['export-raw', async () => ({ kind: 'bytes', value: bytes })],
        ['parse', async () => ({ kind: 'json', value: { state: parsed.state } })],
        [
          'serialize',
          async () => ({
            kind: 'bytes',
            value: (
              await provider.serialize({
                document: parsed.document,
                dialect: definition.dialect,
                budget,
                signal,
              })
            ).bytes,
          }),
        ],
      ])
      return createAssetSession({
        revision: revisionId(input.revisions.revision),
        descriptor,
        operationDeclarations: OPERATIONS,
        permissionGrant: { id: `text-${definition.format}-session`, classes: ['read-source'] },
        handlers,
        async openDataSource(contract) {
          if (contract === 'common.view/tree-data-source') return lease(dataLease.value)
          if (contract === 'common.view/text-data-source') return lease(textSource)
          if (contract === 'common.view/byte-range-source') return lease(byteSource)
          throw new TypeError(`text-${definition.format} does not publish ${contract}`)
        },
        release: [
          () => dataLease.release(),
          () => providerLease.release(),
          () => sourceLease.release(),
        ],
      }).session
    },
  })
}
