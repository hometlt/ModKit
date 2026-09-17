/**
 * ADR-HOST-002 Path B — a `common.edit/writer@1` provider that encodes raw RGBA8 pixels as a PNG.
 *
 * The change set an image editor authors is a whole-source `replace` whose inline payload is the
 * raster it produced (`semanticIntent: { width, height }`, 4 bytes per pixel, top-left first row).
 * This writer plans a whole-source `replace` carrying a freshly encoded PNG: IHDR colour type 6
 * (RGBA), 8 bits per channel, no interlacing, filter 0 on every scanline, one IDAT deflated with
 * the platform's `CompressionStream('deflate')` (the zlib wrapper PNG requires), CRC32 per chunk,
 * IEND. Nothing is written here: the plan goes to the host coordinator, which commits it.
 *
 * Fidelity is `semantic`, honestly: the pixels survive exactly, everything else about the file
 * the editor started from — ancillary chunks (tEXt, gAMA, sRGB, iCCP, …), the palette, the
 * original bit depth, the interlacing and the filter choices — does not.
 */

import { defineWriter } from '@modkit/codec-kit'

const SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ascii = new TextEncoder()
const CHANNELS = 4
const MAX_DIMENSION = 0x7fffffff

function crc32(bytes, start, end) {
  let crc = 0xffffffff
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset] ?? 0
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunkBytes(type, data) {
  const out = new Uint8Array(12 + data.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.byteLength, false)
  out.set(ascii.encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.byteLength, crc32(out, 4, 8 + data.byteLength), false)
  return out
}

function deflateUnavailable() {
  return typeof CompressionStream !== 'function'
}

async function deflate(bytes, signal) {
  if (deflateUnavailable()) {
    throw new TypeError('no portable zlib encoder is available (CompressionStream is missing)')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const chunk = await reader.read()
      if (chunk.done) break
      chunks.push(chunk.value)
      total += chunk.value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  const compressed = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    compressed.set(chunk, offset)
    offset += chunk.byteLength
  }
  return compressed
}

/** RGBA8 → PNG bytes; also the `export.convert` PNG target of every image codec. */
export async function encodePng(width, height, pixels, signal) {
  const rowBytes = width * CHANNELS
  const raw = new Uint8Array((rowBytes + 1) * height)
  for (let row = 0; row < height; row += 1) {
    // filter 0 (None) on every scanline: the filter byte is already zero
    raw.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes), row * (rowBytes + 1) + 1)
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width, false)
  view.setUint32(4, height, false)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: truecolour with alpha
  header[10] = 0 // compression: deflate
  header[11] = 0 // filter method 0
  header[12] = 0 // no interlacing
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunkBytes('IHDR', header),
    chunkBytes('IDAT', await deflate(raw, signal)),
    chunkBytes('IEND', new Uint8Array(0)),
  ]
  const png = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.byteLength
  }
  return png
}

function dimension(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_DIMENSION
}

/**
 * Read the one change set shape this writer encodes, or say exactly what is wrong with it.
 * Returns `{ target, width, height, pixels }` or a list of error diagnostics.
 */
function readRequest(change) {
  const problems = []
  const push = (code, message) => problems.push({ severity: 'error', code, message })
  const [target] = change.targets
  const [edit] = change.edits
  if (change.targets.length !== 1 || change.edits.length !== 1 || target === undefined) {
    push(
      'x3.images/png-encoder-single-edit-only',
      'the PNG encoder plans exactly one whole-source replace for one target',
    )
  }
  if (
    edit === undefined ||
    edit.operation !== 'replace' ||
    edit.range !== undefined ||
    edit.payload?.kind !== 'inline'
  ) {
    push(
      'x3.images/png-encoder-whole-source-only',
      'the edit must be a whole-source replace carrying an inline raster payload',
    )
  }
  const intent = change.semanticIntent
  const width = typeof intent === 'object' && intent !== null ? intent.width : undefined
  const height = typeof intent === 'object' && intent !== null ? intent.height : undefined
  if (!dimension(width) || !dimension(height)) {
    push(
      'x3.images/png-encoder-intent-missing',
      'semanticIntent must carry { width, height } as positive integers',
    )
  } else if (
    edit?.payload?.kind === 'inline' &&
    edit.payload.bytes.byteLength !== width * height * CHANNELS
  ) {
    push(
      'x3.images/png-encoder-payload-mismatch',
      `the payload is ${edit.payload.bytes.byteLength} bytes; ${width}×${height} RGBA8 needs ${width * height * CHANNELS}`,
    )
  }
  if (deflateUnavailable()) {
    push(
      'x3.images/png-encoder-unavailable',
      'this runtime has no CompressionStream, so no PNG can be encoded here',
    )
  }
  if (problems.length > 0) return { problems }
  return {
    problems,
    target,
    width,
    height,
    pixels: edit.payload.bytes,
  }
}

const PROVIDER_ID = 'modkit/png-encoder-writer'
const OFFER_ID = 'png-rgba8-encoder'

const writerModule = defineWriter({
  providerId: PROVIDER_ID,
  providerVersion: '1.0.0',
  // not a content hash: the artifact this identity names is the module inside the bundled images
  // extension, and a writer module cannot honestly digest itself at runtime
  artifactDigest: 'artifact:modkit/images#png-encoder-v1',
  offerId: OFFER_ID,
  formatId: 'png',
  representationId: 'rgba8',
  mutationMode: 'mutate',
  minimumRoundTrip: 'semantic',
  fidelityEvidenceId: 'png-encoder-v1',
  fidelity: Object.freeze({
    roundTrip: 'semantic',
    preservesUnknownData: false,
    notes: Object.freeze([
      'every pixel of the RGBA8 payload is preserved exactly (colour type 6, 8-bit, no interlacing)',
      'ancillary chunks of the file being replaced (tEXt, gAMA, sRGB, iCCP, …) are dropped',
    ]),
  }),
  async validate(change) {
    const request = readRequest(change)
    return { valid: request.problems.length === 0, diagnostics: request.problems }
  },
  async planEdits(change, signal) {
    const request = readRequest(change)
    const [first] = request.problems
    if (first !== undefined) throw new TypeError(first.message)
    return [
      {
        operation: 'replace',
        targetId: request.target.targetId,
        source: request.target.ownerSource,
        payload: {
          kind: 'inline',
          bytes: await encodePng(request.width, request.height, request.pixels, signal),
        },
        label: `encode ${request.width}×${request.height} RGBA8 as PNG`,
      },
    ]
  },
})

export const abiVersion = writerModule.abiVersion
export const provides = writerModule.provides
export const createProvider = writerModule.createProvider
