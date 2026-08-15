import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource,
} from '@modkitx-x3/host'
import { revisionId } from '@modkitx-x3/sdk'

const CONFIG = Object.freeze({
  json: { contract: 'common.text-data/json-syntax', dialect: 'json', tree: true },
  jsonc: { contract: 'common.text-data/jsonc-syntax', dialect: 'jsonc', tree: true },
  xml: { contract: 'common.text-data/xml-syntax', dialect: 'xml-1.0', tree: true },
  yaml: { contract: 'common.text-data/yaml-syntax', dialect: 'yaml-1.2-core', tree: true },
  toml: { contract: 'common.text-data/toml-syntax', dialect: 'toml-1.0', tree: true },
  ini: { contract: 'common.text-data/ini-syntax', dialect: 'ini-basic', tree: true },
  csv: { contract: 'common.text-data/csv-syntax', dialect: 'csv-rfc4180', tree: false },
  tsv: { contract: 'common.text-data/tsv-syntax', dialect: 'tsv-iana', tree: false },
})

const BASE_OPERATIONS = Object.freeze([
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

const DELIMITED_SCAN_OPERATION = Object.freeze({
  id: 'data.scan',
  handlerId: 'scan',
  mutatesSource: false,
  requiredPermissions: ['read-source'],
  outputKinds: ['json'],
})

function operationsFor(format) {
  return format === 'csv' || format === 'tsv'
    ? Object.freeze([...BASE_OPERATIONS, DELIMITED_SCAN_OPERATION])
    : BASE_OPERATIONS
}

function markerOutsideString(text, marker) {
  let quote = false
  let escaped = false
  for (let index = 0; index <= text.length - marker.length; index += 1) {
    const character = text[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quote = false
      continue
    }
    if (character === '"') quote = true
    else if (text.startsWith(marker, index)) return true
  }
  return false
}

function detection(format, text, uri) {
  if (text.includes('\0')) return { confidence: 0.01, note: 'nul-byte' }
  const trimmed = text.trimStart()
  const extension = uri.split(/[?#]/u, 1)[0]?.split('.').at(-1)?.toLowerCase()
  if (format === 'json' || format === 'jsonc') {
    const structure = trimmed.startsWith('{') || trimmed.startsWith('[')
    const comment = markerOutsideString(text, '//') || markerOutsideString(text, '/*')
    if (!structure) return { confidence: 0.05, note: 'no-json-root' }
    if (format === 'jsonc' && comment) return { confidence: 0.98, note: 'jsonc-marker' }
    if (format === 'json' && comment) return { confidence: 0.1, note: 'jsonc-marker' }
    return { confidence: extension === format ? 0.78 : 0.72, note: 'json-jsonc-ambiguous' }
  }
  if (format === 'xml') {
    if (/\.sc2(?:mod|map|campaign)$/iu.test(uri))
      return { confidence: 0.05, note: 'owned-container-context' }
    return { confidence: /^<\??[A-Za-z_]/u.test(trimmed) ? 0.92 : 0.05, note: 'xml-root' }
  }
  if (format === 'yaml')
    return {
      confidence: /^(?:---\s*$|[-?]?\s*[\w"']+\s*:)/mu.test(text) ? 0.72 : 0.15,
      note: 'yaml-shape',
    }
  if (format === 'toml')
    return {
      confidence: /^(?:\[[^\]]+\]|[\w.-]+\s*=)/mu.test(text)
        ? extension === 'toml'
          ? 0.88
          : 0.68
        : 0.1,
      note: 'toml-shape',
    }
  if (format === 'ini')
    return {
      confidence: /^\[[^\]]+\]|^[^=\r\n]+=/mu.test(text)
        ? extension === 'ini'
          ? 0.82
          : 0.55
        : 0.1,
      note: 'ini-shape',
    }
  const delimiter = format === 'tsv' ? '\t' : ','
  const lines = text
    .split(/\r\n|\r|\n/u)
    .filter(Boolean)
    .slice(0, 4)
  const widths = lines.map(line => line.split(delimiter).length)
  const stable = widths.length >= 2 && widths[0] >= 2 && widths.every(width => width === widths[0])
  return {
    confidence: stable ? (extension === format ? 0.94 : 0.76) : 0.05,
    note: 'delimited-arity',
  }
}

function simpleLease(value) {
  let released = false
  return Object.freeze({
    value,
    async release() {
      released = true
    },
    isReleased: () => released,
  })
}

export function createTextCodec(format, context) {
  const config = CONFIG[format]
  if (!config) throw new TypeError(`unknown text codec format: ${format}`)
  const operations = operationsFor(format)
  return Object.freeze({
    async probe(request, signal) {
      if (request.source.kind !== 'bytes' || request.plan.kind !== 'bytes')
        throw new TypeError('text codecs require byte probes')
      const length = Math.min(
        request.plan.maxBytes,
        request.plan.ranges[0]?.length ?? request.plan.maxBytes,
      )
      const bytes = await request.source.read(0n, length, signal)
      let text = ''
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        return {
          codecId: `org.modkitx/text-${format}`,
          confidence: 0.01,
          evidence: [{ kind: 'structure', weight: -1, note: 'invalid-utf8' }],
          requiredRanges: [{ byteOffset: '0', byteLength: String(bytes.byteLength) }],
        }
      }
      const result = detection(format, text, request.source.ref.uri)
      return {
        codecId: `org.modkitx/text-${format}`,
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
        contract: config.contract,
        major: 1,
        signal,
      })
      const provider = providerLease.value
      const parsed = await provider.parse({
        input: { bytes },
        dialect: config.dialect,
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
        dialect: config.dialect,
        budget,
        signal,
      })
      const byteSource = {
        size: async () => source.size,
        read: (offset, length, readSignal) => source.read(offset, length, readSignal),
      }
      const textSource = createUtf8TextDataSource(byteSource)
      const textInfo = await textSource.info()
      const semanticContract = config.tree
        ? 'common.view/tree-data-source'
        : 'common.view/table-data-source'
      const semanticTrait = config.tree ? 'structure.hierarchy' : 'table.cells'
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
          codecId: `org.modkitx/text-${format}`,
          codecVersion: '1.0.0',
          formatId: format,
          formatLabel: format.toUpperCase(),
          confidence: 1,
          detection: [{ kind: 'structure', weight: 1 }],
        },
        traits: [
          {
            id: semanticTrait,
            descriptorVersion: 1,
            state: 'available',
            parameters: config.tree
              ? { nodeCount: 'unknown', lazy: true, hasLocations: true }
              : { rows: 'unknown', columns: 'unknown', sparse: false },
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
        operations: operations.map(operation => ({
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
          { contract: semanticContract, major: 1 },
          { contract: 'common.view/text-data-source', major: 1 },
          { contract: 'common.view/byte-range-source', major: 1 },
        ],
        diagnostics: [],
        metadata: [],
        revision: input.revisions.revision,
      })
      const handlers = new Map([
        ['inspect', async () => ({ kind: 'json', value: { format, parseState: parsed.state } })],
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
                dialect: config.dialect,
                budget,
                signal,
              })
            ).bytes,
          }),
        ],
      ])
      if (!config.tree) {
        handlers.set('scan', async input => {
          const request =
            input && typeof input === 'object' && input.kind === 'cursor'
              ? { kind: 'cursor', cursor: String(input.cursor ?? '0'), count: 100 }
              : {
                  kind: 'range',
                  from:
                    input && typeof input === 'object' && Number.isSafeInteger(input.from)
                      ? Math.max(0, input.from)
                      : 0,
                  count:
                    input && typeof input === 'object' && Number.isSafeInteger(input.count)
                      ? Math.min(1000, Math.max(1, input.count))
                      : 100,
                }
          return { kind: 'json', value: await dataLease.value.rows(request) }
        })
      }
      const managed = createAssetSession({
        revision: revisionId(input.revisions.revision),
        descriptor,
        operationDeclarations: operations,
        permissionGrant: { id: `text-${format}-session`, classes: ['read-source'] },
        handlers,
        async openDataSource(contract) {
          if (contract === semanticContract) return simpleLease(dataLease.value)
          if (contract === 'common.view/text-data-source') return simpleLease(textSource)
          if (contract === 'common.view/byte-range-source') return simpleLease(byteSource)
          throw new TypeError(`text-${format} does not publish ${contract}`)
        },
        release: [
          () => dataLease.release(),
          () => providerLease.release(),
          () => sourceLease.release(),
        ],
      })
      return managed.session
    },
  })
}
