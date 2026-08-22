// Hand-ported from org.modkitx/war3-mdx. This portable profile inventories the MDLX chunk
// container and bounded MDL declarations without importing the historical war3-model graph.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/war3-mdx'
const ascii = new TextDecoder('ascii')
const utf8 = new TextDecoder('utf-8', { fatal: false })

function tag(bytes, offset) {
  return ascii.decode(bytes.subarray(offset, offset + 4))
}

function mdxSignature(bytes) {
  return bytes.byteLength >= 4 && tag(bytes, 0) === 'MDLX'
}

function mdlSignature(bytes) {
  const prefix = ascii.decode(bytes.subarray(0, Math.min(bytes.byteLength, 64)))
  return /^\s*Version\s*\{/u.test(prefix)
}

function fixedString(bytes, offset, length) {
  const end = bytes.indexOf(0, offset)
  const limit = end < 0 || end > offset + length ? offset + length : end
  return utf8.decode(bytes.subarray(offset, limit)).trim()
}

function parseMdx(bytes, context) {
  if (!mdxSignature(bytes)) throw new TypeError('Warcraft III MDX signature is invalid')
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks = []
  let offset = 4
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new RangeError('MDX chunk header is truncated')
    if (chunks.length >= context.budget.maxNodes)
      throw new RangeError('MDX chunk count exceeds maxNodes budget')
    const id = tag(bytes, offset)
    if (!/^[A-Z0-9]{4}$/u.test(id)) throw new TypeError(`MDX chunk id at ${offset} is invalid`)
    const size = data.getUint32(offset + 4, true)
    const payload = offset + 8
    if (payload + size > bytes.byteLength) throw new RangeError(`MDX ${id} chunk is out of bounds`)
    chunks.push(Object.freeze({ id, offset, payload, size }))
    offset = payload + size
  }
  const versionChunk = chunks.find(chunk => chunk.id === 'VERS')
  if (versionChunk === undefined || versionChunk.size < 4)
    throw new TypeError('MDX VERS chunk is missing')
  const version = data.getUint32(versionChunk.payload, true)
  if (version < 800 || version > 1200) throw new TypeError(`unsupported MDX version ${version}`)
  const model = chunks.find(chunk => chunk.id === 'MODL')
  const name = model === undefined || model.size < 80 ? '' : fixedString(bytes, model.payload, 80)
  const sequences = chunks
    .filter(chunk => chunk.id === 'SEQS')
    .reduce((count, chunk) => count + Math.floor(chunk.size / 132), 0)
  return Object.freeze({ format: 'mdx', version, name, sequences, chunks: Object.freeze(chunks) })
}

function parseMdl(bytes, context) {
  if (!mdlSignature(bytes)) throw new TypeError('Warcraft III MDL declaration header is invalid')
  if (bytes.byteLength > context.budget.maxScalarBytes)
    throw new RangeError('MDL text exceeds maxScalarBytes budget')
  const text = utf8.decode(bytes)
  let declarations = 0
  for (const match of text.matchAll(
    /^\s*(?:Version|Model|Sequences|GlobalSequences|Textures|Materials|Geoset|Bone|Helper|PivotPoints)\b/gmu,
  )) {
    void match
    declarations += 1
    if (declarations > context.budget.maxNodes)
      throw new RangeError('MDL declarations exceed maxNodes budget')
  }
  const version = /\bFormatVersion\s+(\d+)/u.exec(text)?.[1]
  const name = /^\s*Model\s+"([^"]*)"/mu.exec(text)?.[1] ?? ''
  const sequences = /\bNumSequences\s+(\d+)/u.exec(text)?.[1]
  return Object.freeze({
    format: 'mdl',
    version: version === undefined ? null : Number(version),
    name,
    sequences: sequences === undefined ? 0 : Number(sequences),
    declarations,
    textBytes: bytes.byteLength,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'war3-mdx', label: 'Warcraft III MDX/MDL' }),
  async detect(prefix) {
    if (mdxSignature(prefix)) return { confidence: 0.99, kind: 'magic', note: 'mdlx-signature' }
    if (mdlSignature(prefix))
      return { confidence: 0.92, kind: 'structure', note: 'mdl-version-declaration' }
    return { confidence: 0, kind: 'structure', note: 'war3-model-mismatch' }
  },
  async inspect(bytes, context) {
    const model = mdxSignature(bytes) ? parseMdx(bytes, context) : parseMdl(bytes, context)
    const chunks = model.format === 'mdx' ? model.chunks : []
    return {
      summary: {
        format: 'war3-mdx',
        encoding: model.format,
        version: model.version,
        name: model.name,
        sequences: model.sequences,
        ...(model.format === 'mdx'
          ? { chunks: model.chunks.length }
          : { declarations: model.declarations }),
      },
      metadata: [
        {
          id: 'war3-model',
          label: `Warcraft III ${model.format.toUpperCase()} model`,
          entries: [
            { key: 'encoding', value: model.format },
            { key: 'version', value: model.version ?? 'unknown' },
            { key: 'name', value: model.name || '(unnamed)' },
            { key: 'sequences', value: model.sequences },
            ...(model.format === 'mdx'
              ? [{ key: 'chunks', value: model.chunks.length }]
              : [{ key: 'declarations', value: model.declarations }]),
          ],
        },
      ],
      traits: [{ id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: model.name || `Warcraft III ${model.format.toUpperCase()}`,
          preview: `${model.format.toUpperCase()} version ${model.version ?? 'unknown'}`,
          children:
            model.format === 'mdx'
              ? chunks.map(chunk => ({
                  kind: 'chunk',
                  label: chunk.id,
                  preview: `${chunk.size} bytes at ${chunk.payload}`,
                }))
              : [
                  {
                    kind: 'declarations',
                    label: 'Declarations',
                    preview: String(model.declarations),
                  },
                  { kind: 'sequences', label: 'Sequences', preview: String(model.sequences) },
                ],
        }),
      },
      unsupportedFeatures: [
        'geometry-decoding',
        'materials-and-texture-resolution',
        'skeleton-and-animation-decoding',
        'model-rendering',
        'model-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
