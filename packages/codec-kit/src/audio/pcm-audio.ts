/**
 * A decoded sound published the way every Modkit audio codec publishes one: a 16-bit PCM WAV
 * (`encodeWav`) behind `common.view/audio-media-source`, and `export.convert { target: 'wav' }`
 * writing the same file, or, with `pick`, another stream of a bank. A sound whose WAV would pass
 * the open's `maxScalarBytes` is described but not played, and the conversion says why. Lifted from
 * the copies SAGE (EA-XA) and Westwood (AUD, VQA) had written, which ps1-xa and fsb had by hand too.
 */
import { createAudioMediaSource, type InspectionCodecDefinition } from '../index.js'
import { encodeWav } from './index.js'

type OperationDecl = NonNullable<InspectionCodecDefinition['operations']>[number]

/** `export.convert { target: 'wav' }`; `summary` names the input fields a codec reads. */
export function convertToWav(
  summary = 'Writes the decoded sound as a 16-bit PCM WAV file.',
): OperationDecl {
  return Object.freeze({
    id: 'export.convert' as OperationDecl['id'],
    handlerId: 'convert-audio',
    mutatesSource: false,
    requiredPermissions: Object.freeze(['read-source'] as const),
    inputSchema: Object.freeze({
      $ref: 'modkit://codec-kit/audio-export-convert.v1',
      document: Object.freeze({
        schemaVersion: 1,
        forms: Object.freeze([
          Object.freeze({
            id: 'wav',
            label: 'WAV',
            summary,
            baseInput: Object.freeze({ target: 'wav' }),
            fields: Object.freeze([]),
            writes: Object.freeze({
              format: Object.freeze({ id: 'wav', label: 'WAV' }),
              extension: '.wav',
              mediaType: 'audio/wav',
            }),
          }),
        ]),
      }),
    }),
    outputKinds: Object.freeze(['bytes'] as const),
  })
}

export const CONVERT_TO_WAV: OperationDecl = convertToWav()

export interface PcmStream {
  readonly channels: number
  readonly sampleRate: number
  /** Samples per channel the stream holds. */
  readonly samples: number
  /** The interleaved samples; not called when the WAV would pass the budget. */
  decode(): Int16Array | Promise<Int16Array>
}

export interface PcmAudioOptions {
  /**
   * The stream a conversion input other than the plain `{ target: 'wav' }` names (a bank's
   * `stream`, an XA file's `file` and `channel`); `undefined` refuses it.
   */
  readonly pick?: (
    input: Readonly<Record<string, unknown>>,
  ) => PcmStream | undefined | Promise<PcmStream | undefined>
  /** The audio source's track id; `sound` by default. */
  readonly trackId?: string
}

/** Why `stream` is not written as WAV within `maxBytes`, or `undefined` when it is. */
function refusalOf(stream: PcmStream, maxBytes: number): string | undefined {
  const wavBytes = 44 + stream.samples * stream.channels * 2
  return wavBytes > maxBytes
    ? `the decoded WAV (${String(wavBytes)} bytes) passes maxScalarBytes`
    : undefined
}

async function wavOf(stream: PcmStream): Promise<Uint8Array> {
  const pcm = await stream.decode()
  return encodeWav(
    { channels: stream.channels, sampleRate: stream.sampleRate, bitsPerSample: 16 },
    new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
  )
}

/**
 * The playable source of `stream`, the `convert-audio` handler and, when the sound is not played,
 * why (`why` when there is no stream to decode) as the disabled state of `export.convert`.
 */
export async function pcmAudio(
  stream: PcmStream | undefined,
  why: string | undefined,
  maxBytes: number,
  options: PcmAudioOptions = {},
) {
  const durationMs =
    stream === undefined ? 0 : Math.round((stream.samples * 1000) / stream.sampleRate)
  const refusal =
    stream === undefined
      ? (why ?? 'the stream holds no sound this codec decodes')
      : refusalOf(stream, maxBytes)
  const wav = stream === undefined || refusal !== undefined ? undefined : await wavOf(stream)
  return {
    durationMs,
    refusal,
    dataSources:
      wav === undefined || stream === undefined
        ? {}
        : {
            'common.view/audio-media-source': createAudioMediaSource(wav, 'audio/wav', {
              durationMs,
              seekable: true,
              tracks: [
                {
                  id: options.trackId ?? 'sound',
                  codec: 'pcm',
                  channels: stream.channels,
                  sampleRate: stream.sampleRate,
                  selected: true,
                },
              ],
              pcmAccess: false,
            }),
          },
    handlers: {
      'convert-audio': async (input: unknown) => {
        const record =
          input !== null && typeof input === 'object' && !Array.isArray(input)
            ? (input as Readonly<Record<string, unknown>>)
            : {}
        if (record['target'] !== 'wav')
          throw new TypeError("the sound converts to { target: 'wav' }")
        const plain = Object.keys(record).every(key => key === 'target')
        if (plain || options.pick === undefined) {
          if (wav === undefined) throw new TypeError(refusal)
          return { kind: 'bytes' as const, value: wav.slice() }
        }
        const chosen = await options.pick(record)
        if (chosen === undefined) {
          throw new TypeError(`no stream matches ${JSON.stringify(record)}`)
        }
        if (chosen === stream && wav !== undefined)
          return { kind: 'bytes' as const, value: wav.slice() }
        const chosenRefusal = refusalOf(chosen, maxBytes)
        if (chosenRefusal !== undefined) throw new TypeError(chosenRefusal)
        return { kind: 'bytes' as const, value: await wavOf(chosen) }
      },
    },
    operationStates:
      refusal === undefined
        ? []
        : [
            {
              id: 'export.convert' as OperationDecl['id'],
              state: 'disabled' as const,
              reason: refusal,
            },
          ],
  }
}
