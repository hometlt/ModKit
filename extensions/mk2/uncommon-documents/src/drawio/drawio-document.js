import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const utf8 = new TextDecoder('utf-8', { fatal: true })
const latin1 = new TextDecoder('latin1')
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function decodeText(bytes, label) {
  try {
    return utf8.decode(bytes)
  } catch {
    throw new TypeError(`${label} is not well-formed UTF-8`)
  }
}

function attributes(token) {
  const values = new Map()
  for (const match of token.matchAll(
    /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu,
  )) {
    values.set(match[1], match[2] ?? match[3] ?? '')
  }
  return values
}

function analyzeXml(source, label, budget, state) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) throw new TypeError(`${label} contains a forbidden DTD`)
  state.scalarBytes += source.length * 2
  if (state.scalarBytes > budget.maxScalarBytes) {
    throw new RangeError('draw.io decoded XML exceeds maxScalarBytes budget')
  }
  const stack = []
  let root
  for (const match of source.matchAll(/<[^>]+>/gu)) {
    const token = match[0]
    if (/^<\?|^<!--|^<!\[CDATA\[/u.test(token)) continue
    const closing = /^<\/\s*([^\s>]+)/u.exec(token)
    if (closing !== null) {
      if (stack.pop() !== closing[1]) throw new TypeError(`${label} has mismatched XML elements`)
      continue
    }
    const opening = /^<\s*([^\s/>]+)/u.exec(token)
    if (opening === null) throw new TypeError(`${label} has malformed XML markup`)
    const name = opening[1]
    root ??= name
    state.nodes += 1
    if (state.nodes > budget.maxNodes) throw new RangeError('draw.io XML exceeds maxNodes budget')
    if (!/\/\s*>$/u.test(token)) {
      stack.push(name)
      if (stack.length > budget.maxDepth)
        throw new RangeError('draw.io XML exceeds maxDepth budget')
    }
  }
  if (stack.length !== 0) throw new TypeError(`${label} has unclosed XML elements`)
  return root
}

function base64Bytes(text) {
  const compact = text.replace(/\s+/gu, '')
  if (compact.length === 0 || compact.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(compact)) {
    throw new TypeError('draw.io compressed diagram is not canonical base64')
  }
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0
  const output = new Uint8Array((compact.length / 4) * 3 - padding)
  let cursor = 0
  for (let index = 0; index < compact.length; index += 4) {
    const values = [...compact.slice(index, index + 4)].map(character =>
      character === '=' ? 0 : BASE64.indexOf(character),
    )
    if (values.some(value => value < 0)) throw new TypeError('draw.io base64 alphabet is invalid')
    const value = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3]
    if (cursor < output.length) output[cursor++] = value >>> 16
    if (cursor < output.length) output[cursor++] = value >>> 8
    if (cursor < output.length) output[cursor++] = value
  }
  return output
}

async function inflateRaw(bytes, budget) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('draw.io deflate extraction is unavailable in this runtime')
  }
  const stream = new Blob([Uint8Array.from(bytes).buffer])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks = []
  let length = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    length += result.value.byteLength
    if (length * 2 > budget.maxScalarBytes || length > Math.max(1024, bytes.byteLength * 100)) {
      await reader.cancel('draw.io compressed diagram exceeds expansion budget')
      throw new RangeError('draw.io compressed diagram exceeds expansion budget')
    }
    chunks.push(result.value)
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function inspectModel(xml, name, budget, state) {
  if (analyzeXml(xml, `draw.io diagram ${name}`, budget, state) !== 'mxGraphModel') {
    throw new TypeError(`draw.io diagram ${name} has no mxGraphModel root`)
  }
  const cells = []
  const ids = new Set()
  for (const match of xml.matchAll(/<mxCell\b[^>]*\/?>/gu)) {
    const attrs = attributes(match[0])
    const id = attrs.get('id')
    if (id === undefined || id === '')
      throw new TypeError(`draw.io diagram ${name} has a cell without id`)
    if (ids.has(id)) throw new TypeError(`draw.io diagram ${name} duplicates cell id ${id}`)
    ids.add(id)
    cells.push({
      id,
      parent: attrs.get('parent'),
      source: attrs.get('source'),
      target: attrs.get('target'),
      vertex: attrs.get('vertex') === '1',
      edge: attrs.get('edge') === '1',
      value: attrs.get('value') ?? '',
    })
  }
  if (cells.length < 2 || !ids.has('0'))
    throw new TypeError(`draw.io diagram ${name} lacks root cells`)
  for (const cell of cells) {
    for (const [field, value] of [
      ['parent', cell.parent],
      ['source', cell.source],
      ['target', cell.target],
    ]) {
      if (value !== undefined && !ids.has(value)) {
        throw new TypeError(`draw.io cell ${cell.id} has unknown ${field} ${value}`)
      }
    }
    if (cell.edge && (cell.source === undefined || cell.target === undefined)) {
      throw new TypeError(`draw.io edge ${cell.id} lacks source or target`)
    }
  }
  return {
    name,
    cells,
    nodes: cells.filter(cell => cell.vertex).length,
    edges: cells.filter(cell => cell.edge).length,
    layers: cells.filter(cell => !cell.vertex && !cell.edge && cell.parent === '0').length,
    geometries: (xml.match(/<mxGeometry\b/gu) ?? []).length,
  }
}

async function parseDrawio(bytes, budget) {
  if (budget.maxDepth < 3) throw new RangeError('draw.io structure exceeds maxDepth budget')
  if (bytes.byteLength * 2 > budget.maxScalarBytes) {
    throw new RangeError('draw.io source exceeds maxScalarBytes budget')
  }
  const source = decodeText(bytes, 'draw.io source')
  const state = { nodes: 0, scalarBytes: 0 }
  const root = analyzeXml(source, 'draw.io source', budget, state)
  const diagrams = []
  let compressedDiagrams = 0
  if (root === 'mxGraphModel') {
    diagrams.push(inspectModel(source, 'Diagram 1', budget, state))
  } else if (root === 'mxfile') {
    for (const match of source.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/gu)) {
      const name =
        attributes(`<diagram ${match[1]}>`).get('name') ?? `Diagram ${diagrams.length + 1}`
      const body = match[2].trim()
      let model
      if (/^<mxGraphModel\b/u.test(body)) model = body
      else {
        compressedDiagrams += 1
        const inflated = await inflateRaw(base64Bytes(body), budget)
        const encoded = decodeText(inflated, `draw.io diagram ${name}`)
        try {
          model = decodeURIComponent(encoded)
        } catch {
          throw new TypeError(`draw.io diagram ${name} has invalid URI-encoded XML`)
        }
      }
      diagrams.push(inspectModel(model, name, budget, state))
    }
  } else {
    throw new TypeError('draw.io root must be mxfile or mxGraphModel')
  }
  if (diagrams.length === 0) throw new TypeError('draw.io file contains no diagrams')
  const summary = {
    format: 'drawio',
    diagrams: diagrams.length,
    cells: diagrams.reduce((total, diagram) => total + diagram.cells.length, 0),
    nodes: diagrams.reduce((total, diagram) => total + diagram.nodes, 0),
    edges: diagrams.reduce((total, diagram) => total + diagram.edges, 0),
    layers: diagrams.reduce((total, diagram) => total + diagram.layers, 0),
    geometries: diagrams.reduce((total, diagram) => total + diagram.geometries, 0),
    compressedDiagrams,
  }
  return {
    summary,
    decodedBytes: state.scalarBytes + state.nodes * 64,
    root: {
      kind: 'document',
      label: 'draw.io diagram',
      preview: `${diagrams.length} diagram(s), ${summary.nodes} node(s), ${summary.edges} edge(s)`,
      children: diagrams.map(diagram => ({
        kind: 'diagram',
        label: diagram.name,
        preview: `${diagram.nodes} node(s), ${diagram.edges} edge(s)`,
        children: diagram.cells.map(cell => ({
          kind: cell.edge ? 'edge' : cell.vertex ? 'node' : 'cell',
          label: cell.value || cell.id,
          preview: `id ${cell.id}${cell.parent === undefined ? '' : `, parent ${cell.parent}`}`,
        })),
      })),
    },
  }
}

function detect(prefix) {
  const source = latin1.decode(prefix)
  const root = /^\uFEFF?\s*(?:<\?xml[^>]*>\s*)?<(mxfile|mxGraphModel)\b/u.exec(source)?.[1]
  return {
    confidence: root === undefined ? 0 : 0.98,
    kind: 'structure',
    note: root === undefined ? 'drawio-xml-root-missing' : `${root}-root`,
  }
}

export function createDrawioCodec(context) {
  return createInspectionCodec(
    Object.freeze({
      id: 'org.modkitx/drawio',
      format: Object.freeze({
        id: 'drawio',
        label: 'draw.io diagram',
        mediaType: 'application/vnd.jgraph.mxfile',
      }),
      async detect(prefix) {
        return detect(prefix)
      },
      async inspect(bytes, inspectionContext) {
        const parsed = await parseDrawio(bytes, inspectionContext.budget)
        return {
          summary: parsed.summary,
          metadata: [
            {
              id: 'drawio-document',
              label: 'draw.io diagram',
              entries: Object.entries(parsed.summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
            { id: 'content.metadata', parameters: { diagrams: parsed.summary.diagrams } },
            {
              id: 'structure.nodes',
              parameters: { nodes: parsed.summary.nodes, edges: parsed.summary.edges },
            },
            { id: 'structure.hierarchy', parameters: { diagrams: parsed.summary.diagrams } },
          ],
          dataSources: { 'common.view/tree-data-source': createTreeDataSource(parsed.root) },
          maxDecodedBytes: parsed.decodedBytes,
          unsupportedFeatures: [
            'layout-rendering',
            'shape-style-resolution',
            'external-resource-fetch',
            'source-editing',
          ],
        }
      },
    }),
    context,
  )
}
