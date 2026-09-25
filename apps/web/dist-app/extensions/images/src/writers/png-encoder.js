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
import { encodePng } from '@modkit/codec-kit/raster'

const CHANNELS = 4
const MAX_DIMENSION = 0x7fffffff

function deflateUnavailable() {
  return typeof CompressionStream !== 'function'
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
