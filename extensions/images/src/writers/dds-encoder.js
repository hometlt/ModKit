/**
 * A `common.edit/writer@1` provider that encodes raw RGBA8 pixels as a DDS file.
 *
 * This is the MK3 home of the legacy `image.write` operation: MK2's DDS codec exposed
 * `encode: (image, options) => encodeDds(image, { format: options?.ddsFormat ?? 'rgba8' })`
 * (`references/modkitmk2/extensions/common/images/codecs/dds/src/codec.ts`). The encoder itself is
 * ported byte-for-byte in `../dds/encode.js`; this module is only the contract seam that lets a
 * host reach it — the same seam `png-encoder.js` uses.
 *
 * The change set is a whole-source `replace` whose inline payload is the raster
 * (`semanticIntent: { width, height }`, 4 bytes per pixel, top-left first row). `semanticIntent`
 * may also carry:
 *
 *   format        one of `rgba8` (default), `dxt1`, `dxt3`, `dxt5`, or `auto` — `auto` is the
 *                 legacy `convertPngToDds` rule: DXT5 if any texel is partially transparent,
 *                 DXT1 otherwise
 *   mipMapCount   the header's declared level count; one level of pixels is written either way,
 *                 which is exactly what legacy did
 *
 * Fidelity is declared `lossy`, which is the honest minimum across what this writer emits: an
 * `rgba8` payload survives every pixel exactly, and the three DXT formats are block compression
 * and do not. Nothing about the file being replaced other than its pixels survives in any case.
 */

import { defineWriter } from '@modkit/codec-kit'
import { ENCODABLE_FORMATS, chooseDdsFormatForImage, encodeDds } from '../dds/encode.js'

const CHANNELS = 4
const MAX_DIMENSION = 0x7fff_ffff

function dimension(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_DIMENSION
}

/**
 * Read the one change-set shape this writer encodes, or say exactly what is wrong with it.
 * Returns `{ target, width, height, format, mipMapCount, pixels }` or a list of error diagnostics.
 */
function readRequest(change) {
  const problems = []
  const push = (code, message) => problems.push({ severity: 'error', code, message })
  const [target] = change.targets
  const [edit] = change.edits
  if (change.targets.length !== 1 || change.edits.length !== 1 || target === undefined) {
    push(
      'x3.images/dds-encoder-single-edit-only',
      'the DDS encoder plans exactly one whole-source replace for one target',
    )
  }
  if (
    edit === undefined ||
    edit.operation !== 'replace' ||
    edit.range !== undefined ||
    edit.payload?.kind !== 'inline'
  ) {
    push(
      'x3.images/dds-encoder-whole-source-only',
      'the edit must be a whole-source replace carrying an inline raster payload',
    )
  }
  const intent = change.semanticIntent
  const named = typeof intent === 'object' && intent !== null ? intent : {}
  const width = named.width
  const height = named.height
  const format = named.format ?? 'rgba8'
  const mipMapCount = named.mipMapCount ?? 1
  if (!dimension(width) || !dimension(height)) {
    push(
      'x3.images/dds-encoder-intent-missing',
      'semanticIntent must carry { width, height } as positive integers',
    )
  } else if (
    edit?.payload?.kind === 'inline' &&
    edit.payload.bytes.byteLength !== width * height * CHANNELS
  ) {
    push(
      'x3.images/dds-encoder-payload-mismatch',
      `the payload is ${edit.payload.bytes.byteLength} bytes; ${width}×${height} RGBA8 needs ${width * height * CHANNELS}`,
    )
  }
  if (format !== 'auto' && !ENCODABLE_FORMATS.includes(format)) {
    push(
      'x3.images/dds-encoder-format-unsupported',
      `DDS: encoding ${format} is not supported (encodable: ${ENCODABLE_FORMATS.join(', ')}, auto)`,
    )
  }
  if (!Number.isSafeInteger(mipMapCount) || mipMapCount < 1) {
    push(
      'x3.images/dds-encoder-mip-count-invalid',
      'semanticIntent.mipMapCount must be a positive integer',
    )
  }
  if (problems.length > 0) return { problems }
  return {
    problems,
    target,
    width,
    height,
    format,
    mipMapCount,
    pixels: edit.payload.bytes,
  }
}

const PROVIDER_ID = 'modkit/dds-encoder-writer'
const OFFER_ID = 'dds-rgba8-encoder'

const writerModule = defineWriter({
  providerId: PROVIDER_ID,
  providerVersion: '1.0.0',
  // not a content hash: the artifact this identity names is the module inside the bundled images
  // extension, and a writer module cannot honestly digest itself at runtime
  artifactDigest: 'artifact:modkit/images#dds-encoder-v1',
  offerId: OFFER_ID,
  formatId: 'dds',
  representationId: 'rgba8',
  mutationMode: 'mutate',
  minimumRoundTrip: 'lossy',
  fidelityEvidenceId: 'dds-encoder-v1',
  fidelity: Object.freeze({
    roundTrip: 'lossy',
    preservesUnknownData: false,
    notes: Object.freeze([
      'format rgba8 preserves every pixel exactly; the payload is stored as B8G8R8A8, which is what the written header declares',
      'formats dxt1, dxt3 and dxt5 are block compression and are lossy by construction',
      'a 128-byte legacy header is written: no DX10 block, no cubemap, no array layers, no volume, and one mip level of pixels whatever mipMapCount declares',
      'nothing but the pixels of the file being replaced survives',
    ]),
  }),
  async validate(change) {
    const request = readRequest(change)
    return { valid: request.problems.length === 0, diagnostics: request.problems }
  },
  async planEdits(change) {
    const request = readRequest(change)
    const [first] = request.problems
    if (first !== undefined) throw new TypeError(first.message)
    const image = { width: request.width, height: request.height, pixels: request.pixels }
    const format = request.format === 'auto' ? chooseDdsFormatForImage(image) : request.format
    return [
      {
        operation: 'replace',
        targetId: request.target.targetId,
        source: request.target.ownerSource,
        payload: {
          kind: 'inline',
          bytes: encodeDds(image, { format, mipMapCount: request.mipMapCount }),
        },
        label: `encode ${request.width}×${request.height} RGBA8 as DDS ${format}`,
      },
    ]
  },
})

export const abiVersion = writerModule.abiVersion
export const provides = writerModule.provides
export const createProvider = writerModule.createProvider
