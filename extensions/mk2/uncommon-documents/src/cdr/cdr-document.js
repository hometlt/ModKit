import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ascii = new TextDecoder('latin1')
const u32 = (bytes, offset) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)

function fourCc(bytes, offset) {
  return ascii.decode(bytes.subarray(offset, offset + 4))
}

function parseRecords(bytes, start, end, depth, budget, state) {
  if (depth > budget.maxDepth) throw new RangeError('CorelDRAW RIFF exceeds maxDepth budget')
  const records = []
  let offset = start
  while (offset < end) {
    if (offset + 8 > end) throw new TypeError('CorelDRAW RIFF record header is truncated')
    const id = fourCc(bytes, offset)
    const length = u32(bytes, offset + 4)
    const payload = offset + 8
    const payloadEnd = payload + length
    const next = payloadEnd + (length & 1)
    if (payloadEnd < payload || next > end) {
      throw new TypeError(`CorelDRAW RIFF record ${id} exceeds its parent bounds`)
    }
    state.nodes += 1
    state.scalarBytes += id.length * 2 + 64
    if (state.nodes > budget.maxNodes) {
      throw new RangeError('CorelDRAW RIFF records exceed maxNodes budget')
    }
    if (state.scalarBytes > budget.maxScalarBytes) {
      throw new RangeError('CorelDRAW RIFF metadata exceeds maxScalarBytes budget')
    }
    const record = { id, length, children: [], subtype: undefined }
    if (id === 'RIFF' || id === 'LIST') {
      if (length < 4) throw new TypeError(`CorelDRAW ${id} record is too short`)
      record.subtype = fourCc(bytes, payload)
      if (record.subtype === 'cmpr') state.compressedLists += 1
      else record.children = parseRecords(bytes, payload + 4, payloadEnd, depth + 1, budget, state)
      if (record.subtype === 'page') state.pages += 1
      else if (record.subtype === 'obj ') state.objects += 1
      else if (record.subtype === 'grp ' || record.subtype === 'lnkg') state.groups += 1
    }
    records.push(record)
    offset = next
  }
  if (offset !== end) throw new TypeError('CorelDRAW RIFF padding is inconsistent')
  return records
}

function tree(record) {
  return {
    kind: record.id === 'RIFF' || record.id === 'LIST' ? 'list' : 'chunk',
    label: record.subtype === undefined ? record.id : `${record.id} ${record.subtype}`,
    preview: `${record.length} bytes`,
    ...(record.children.length === 0 ? {} : { children: record.children.map(tree) }),
  }
}

function parseCdr(bytes, budget) {
  if (budget.maxDepth < 1) throw new RangeError('CorelDRAW RIFF exceeds maxDepth budget')
  if (bytes.byteLength < 12 || fourCc(bytes, 0) !== 'RIFF') {
    throw new TypeError('CorelDRAW RIFF header is missing')
  }
  const declared = u32(bytes, 4)
  if (declared + 8 !== bytes.byteLength) {
    throw new TypeError('CorelDRAW RIFF size does not match the file length')
  }
  const form = fourCc(bytes, 8)
  if (!/^(?:CDR|cdr).$/u.test(form)) {
    throw new TypeError('CorelDRAW RIFF form type is invalid')
  }
  const state = { nodes: 1, scalarBytes: 64, pages: 0, objects: 0, groups: 0, compressedLists: 0 }
  const records = parseRecords(bytes, 12, bytes.byteLength, 1, budget, state)
  const versionCode = form[3]
  const version = /[0-9]/u.test(versionCode)
    ? Number(versionCode)
    : /[A-Z]/u.test(versionCode)
      ? versionCode.charCodeAt(0) - 55
      : undefined
  const summary = {
    format: 'cdr',
    container: 'riff',
    form,
    version: version ?? 'unknown',
    records: state.nodes,
    pages: state.pages,
    objects: state.objects,
    groups: state.groups,
    compressedLists: state.compressedLists,
  }
  return {
    summary,
    decodedBytes: state.scalarBytes,
    root: {
      kind: 'document',
      label: `CorelDRAW ${form}`,
      preview: `${state.pages} page(s), ${state.objects} object list(s)`,
      children: records.map(tree),
    },
  }
}

function detect(prefix) {
  const matched =
    prefix.byteLength >= 12 &&
    fourCc(prefix, 0) === 'RIFF' &&
    /^(?:CDR|cdr).$/u.test(fourCc(prefix, 8))
  return {
    confidence: matched ? 0.995 : 0,
    kind: 'structure',
    note: matched ? `riff-${fourCc(prefix, 8)}` : 'cdr-riff-form-missing',
  }
}

export function createCdrCodec(context) {
  return createInspectionCodec(
    Object.freeze({
      id: 'org.modkitx/cdr',
      format: Object.freeze({
        id: 'cdr',
        label: 'CorelDRAW document',
        mediaType: 'application/vnd.corel-draw',
      }),
      async detect(prefix) {
        return detect(prefix)
      },
      async inspect(bytes, inspectionContext) {
        const parsed = parseCdr(bytes, inspectionContext.budget)
        return {
          summary: parsed.summary,
          metadata: [
            {
              id: 'cdr-document',
              label: 'CorelDRAW document',
              entries: Object.entries(parsed.summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
            { id: 'content.metadata', parameters: { version: parsed.summary.version } },
            {
              id: 'structure.nodes',
              parameters: { records: parsed.summary.records, objects: parsed.summary.objects },
            },
          ],
          dataSources: { 'common.view/tree-data-source': createTreeDataSource(parsed.root) },
          maxDecodedBytes: parsed.decodedBytes,
          unsupportedFeatures: [
            'compressed-cdr-list-decoding',
            'shape-and-text-decoding',
            'layout-rendering',
            'embedded-asset-decoding',
            'source-editing',
          ],
        }
      },
    }),
    context,
  )
}
