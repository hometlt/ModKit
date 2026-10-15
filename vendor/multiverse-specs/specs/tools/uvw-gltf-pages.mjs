/** Bounded scalar-page materialization for the distinct UVW/glTF paged profile.
 * The caller supplies immutable, verified buffer byte witnesses; this module does no I/O.
 * All resulting geometry is checked by the existing inline UVW validator.
 */
import { unpackUvwExactPage, assertUvwExactPageDescriptor, UVW_EXACT_PAGE_MAX_VALUES } from './uvw-exact-page.ts'
import { assertUvwProfile } from './uvw-profile.mjs'
import { jcsStringify, jcsBytes, uvpMediaArtifactDigest } from './uv-canonical-form.mjs'
import { resolveUvpResourceUri } from './uvp-resource-paths.mjs'

export const UVW_GLTF_PAGES_ARTIFACT_DOMAIN = 'uvp/artifact/uvw-gltf-pages@1'
const maxBufferBytes = 64 * 1024 * 1024
const maxAllBufferBytes = 256 * 1024 * 1024
const maxScalars = 16_000_000
const fields = Object.freeze({ heightfield: { samples: 'f64-le' },
  navigation: { samples: 'u32-le' },
  'game-raster': { samples: 'f64-le' },
  traversal: { walkable: 'bool-lsb0', exits: 'u8' } })
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, required) => object(value) && Object.keys(value).length === required.length
  && required.every(key => Object.hasOwn(value, key))
const refuse = (rule, message) => { throw new TypeError(`${rule}: ${message}`) }

/** Resolve every declared buffer, including unused ones, within the UVP package. */
export function uvwGltfPagedBufferReferences(document, documentPath) {
  if (!Array.isArray(document?.buffers) || !document.buffers.length)
    refuse('uvw-pages-buffers', 'A paged document needs glTF buffers')
  let total = 0
  return document.buffers.map((row, index) => {
    if (!exactKeys(row, ['uri', 'byteLength']) || typeof row.uri !== 'string'
      || !Number.isSafeInteger(row.byteLength) || row.byteLength < 1
      || row.byteLength > maxBufferBytes || (total += row.byteLength) > maxAllBufferBytes)
      refuse('uvw-pages-buffer-budget', `Invalid buffer ${index}`)
    return { index, path: resolveUvpResourceUri(documentPath, row.uri), byteLength: row.byteLength }
  })
}

/** Decode pages into a private ordinary space-graph document. No caller input is changed. */
export function materializeUvwGltfPages(document, bufferBytes) {
  if (!object(document) || !object(document.asset?.extras?.uv)
    || document.asset.extras.uv.format !== 'UVW'
    || document.asset.extras.uv.version !== '1.0'
    || document.asset.extras.uv.profile !== 'space-graph-paged'
    || !Array.isArray(document.buffers) || !document.buffers.length
    || !Array.isArray(bufferBytes) || bufferBytes.length !== document.buffers.length
    || !Array.isArray(document.bufferViews))
    refuse('uvw-pages-envelope', 'Expected a distinct UVW space-graph-paged document and its buffers')
  try { jcsStringify(document) }
  catch { refuse('uvw-pages-envelope', 'Paged document must be finite JSON') }
  let totalBytes = 0
  const bytes = document.buffers.map((row, index) => {
    const witness = bufferBytes[index]
    const external = exactKeys(row, ['uri', 'byteLength']) && typeof row.uri === 'string'
    const embedded = index === 0 && exactKeys(row, ['byteLength'])
    if (!(external || embedded)
      || !Number.isSafeInteger(row.byteLength) || row.byteLength < 1
      || row.byteLength > maxBufferBytes || (totalBytes += row.byteLength) > maxAllBufferBytes
      || !(witness instanceof Uint8Array) || witness.byteLength !== row.byteLength
      || !(witness.buffer instanceof ArrayBuffer)
      || ('resizable' in witness.buffer && witness.buffer.resizable === true))
      refuse('uvw-pages-buffer-budget', `Buffer ${index} has no exact bounded byte witness`)
    return witness
  })
  const views = document.bufferViews.map((view, index) => {
    if (!exactKeys(view, ['buffer', 'byteOffset', 'byteLength'])
      || !Number.isSafeInteger(view.buffer) || view.buffer < 0 || view.buffer >= bytes.length
      || !Number.isSafeInteger(view.byteOffset) || view.byteOffset < 0 || view.byteOffset % 8 !== 0
      || !Number.isSafeInteger(view.byteLength) || view.byteLength < 1
      || view.byteOffset + view.byteLength > bytes[view.buffer].byteLength)
      refuse('uvw-pages-buffer-view', `Invalid exact scalar view ${index}`)
    return view
  })
  const used = new Set(), ranges = bytes.map(() => [])
  const decoded = structuredClone(document)
  decoded.asset.extras.uv.profile = 'space-graph'
  delete decoded.buffers
  delete decoded.bufferViews
  let totalScalars = 0, pagedFields = 0
  for (const space of decoded.extensions?.UV_world_graph?.spaces ?? []) for (const layer of space.layers ?? []) {
    const allowed = fields[layer.kind]
    if (allowed === undefined) continue
    for (const [field, encoding] of Object.entries(allowed)) {
      const payload = layer[field]
      if (Array.isArray(payload)) {
        if (!Number.isSafeInteger(layer.rows * layer.columns)
          || (totalScalars += layer.rows * layer.columns) > maxScalars)
          refuse('uvw-pages-field', 'Decoded scalar budget exceeded')
        continue
      }
      if (!object(payload)) continue
      if (!exactKeys(payload, ['count', 'pages']) || !Number.isSafeInteger(payload.count)
        || payload.count < 1 || !Array.isArray(payload.pages) || !payload.pages.length
        || !Number.isSafeInteger(layer.rows) || !Number.isSafeInteger(layer.columns)
        || layer.rows < 1 || layer.columns < 1
        || layer.rows * layer.columns !== payload.count
        || (totalScalars += payload.count) > maxScalars)
        refuse('uvw-pages-field', `Invalid ${layer.kind}.${field} page extent`)
      const grid = Array.from({ length: layer.rows }, () => new Array(layer.columns))
      let cursor = 0
      for (const [pageIndex, page] of payload.pages.entries()) {
        if (!exactKeys(page, ['start', 'bufferView', 'descriptor'])
          || !Number.isSafeInteger(page.start) || page.start !== cursor
          || !Number.isSafeInteger(page.bufferView) || page.bufferView < 0
          || page.bufferView >= views.length || used.has(page.bufferView))
          refuse('uvw-pages-page', `Invalid page ${pageIndex} for ${layer.kind}.${field}`)
        const descriptor = assertUvwExactPageDescriptor(page.descriptor)
        if (descriptor.encoding !== encoding
          || (pageIndex < payload.pages.length - 1 && descriptor.count !== UVW_EXACT_PAGE_MAX_VALUES)
          || descriptor.count > payload.count - cursor)
          refuse('uvw-pages-page', `Invalid count or encoding for ${layer.kind}.${field}`)
        const view = views[page.bufferView]
        if (view.byteLength !== descriptor.byteLength)
          refuse('uvw-pages-page', 'Page descriptor and bufferView lengths differ')
        const source = bytes[view.buffer].subarray(view.byteOffset, view.byteOffset + view.byteLength)
        const valuesInPage = unpackUvwExactPage(descriptor, source)
        for (let i = 0; i < valuesInPage.length; i++) {
          const at = cursor + i
          grid[Math.floor(at / layer.columns)][at % layer.columns] = valuesInPage[i]
        }
        cursor += descriptor.count
        used.add(page.bufferView)
        ranges[view.buffer].push([view.byteOffset, view.byteOffset + view.byteLength])
      }
      if (cursor !== payload.count) refuse('uvw-pages-coverage', `Incomplete ${layer.kind}.${field}`)
      layer[field] = grid
      pagedFields++
    }
  }
  if (!pagedFields || used.size !== views.length)
    refuse('uvw-pages-view-closure', 'Every view must belong to one supported scalar field')
  for (const [index, entries] of ranges.entries()) {
    if (!entries.length) continue // unused buffers still contribute to logical identity
    entries.sort((a, b) => a[0] - b[0])
    let cursor = 0
    for (const [start, end] of entries) {
      if (start < cursor || bytes[index].subarray(cursor, start).some(byte => byte !== 0))
        refuse('uvw-pages-view-closure', `Overlapping views or nonzero padding in buffer ${index}`)
      cursor = end
    }
    if (bytes[index].subarray(cursor).some(byte => byte !== 0))
      refuse('uvw-pages-view-closure', `Nonzero trailing bytes in buffer ${index}`)
  }
  assertUvwProfile(decoded)
  return decoded
}

/** Validate and bind the authored identity to a private inline geometry projection. */
export async function verifyUvwGltfPagedArtifact(document, bufferBytes) {
  const decoded = materializeUvwGltfPages(document, bufferBytes)
  const buffers = []
  for (const [index, bytes] of bufferBytes.entries())
    buffers.push({ index, byteLength: bytes.byteLength, hash: await uvpMediaArtifactDigest(bytes) })
  return { digest: await uvpMediaArtifactDigest(jcsBytes({ schemaVersion: 1,
    domain: UVW_GLTF_PAGES_ARTIFACT_DOMAIN, value: document, buffers })), document: decoded }
}

/** Logical identity over the authored document and every independently hashed buffer. */
export async function uvwGltfPagedArtifactDigest(document, bufferBytes) {
  return (await verifyUvwGltfPagedArtifact(document, bufferBytes)).digest
}
