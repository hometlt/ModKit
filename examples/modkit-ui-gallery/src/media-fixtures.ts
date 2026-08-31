/**
 * Real bytes for the media stages — generated in the page, not checked in.
 *
 * The point is that the stages decode genuine PNG and WAV byte streams through the platform
 * decoder, exactly as they will when a codec supplies the bytes. No codec is involved here, which
 * is the whole reason these components can be built and demonstrated before the codecs land.
 */
import type {
  AudioMediaSource,
  ByteRangeSource,
  EncodedMediaSource,
  ModelSceneSource,
  RasterImageSource,
  VectorSceneSource,
  VideoMediaSource,
} from '@modkit/sdk'

function encodedFor(bytes: Uint8Array, mediaType: string): EncodedMediaSource {
  return {
    async descriptor() {
      return { mediaType, bytes: BigInt(bytes.byteLength) }
    },
    async read(offset: bigint, length: number) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
  }
}

/**
 * The image and audio stages consume the dedicated media contracts, not raw bytes. These fixtures
 * report `decodedAccess`/`pcmAccess` as false, which is exactly the "no decoder provider selected"
 * case: the stage then falls back to the platform decoder over the encoded representation.
 */
export function rasterImageSourceFor(
  bytes: Uint8Array,
  width: number,
  height: number,
): RasterImageSource {
  return {
    async info() {
      return {
        width,
        height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: 4,
        bitDepth: 8,
        colorSpace: 'srgb',
        alphaMode: 'straight',
        orientation: 'top-left',
        decodedAccess: false,
      }
    },
    async encoded() {
      return encodedFor(bytes, 'image/png')
    },
  }
}

export function audioMediaSourceFor(bytes: Uint8Array, durationMs: number): AudioMediaSource {
  return {
    async info() {
      return {
        durationMs,
        seekable: true,
        tracks: [
          {
            id: 'pcm-1',
            kind: 'audio',
            codec: 'pcm_s16le',
            selected: true,
            channels: 2,
            sampleRate: 44_100,
          },
        ],
        pcmAccess: false,
      }
    },
    async encoded() {
      return encodedFor(bytes, 'audio/wav')
    },
  } as AudioMediaSource
}

export function byteSourceFor(bytes: Uint8Array): ByteRangeSource {
  return {
    async size() {
      return BigInt(bytes.byteLength)
    },
    async read(offset: bigint, length: number) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
  }
}

/** A checkerboard + gradient + alpha wedge, encoded as a real PNG by the platform encoder. */
export async function makePngBytes(width = 256, height = 160): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new TypeError('2d canvas context is unavailable')

  for (let y = 0; y < height; y += 16) {
    for (let x = 0; x < width; x += 16) {
      const even = ((x / 16) | 0) % 2 === ((y / 16) | 0) % 2
      context.fillStyle = even ? '#1f2a37' : '#111820'
      context.fillRect(x, y, 16, 16)
    }
  }
  const gradient = context.createLinearGradient(0, 0, width, 0)
  gradient.addColorStop(0, 'rgba(255, 80, 80, 1)')
  gradient.addColorStop(0.5, 'rgba(80, 255, 140, 1)')
  gradient.addColorStop(1, 'rgba(80, 160, 255, 1)')
  context.fillStyle = gradient
  context.fillRect(0, 24, width, 48)

  // An alpha wedge, so the channel isolation buttons have something to show.
  const wedge = context.createLinearGradient(0, 0, width, 0)
  wedge.addColorStop(0, 'rgba(255, 255, 255, 0)')
  wedge.addColorStop(1, 'rgba(255, 255, 255, 1)')
  context.fillStyle = wedge
  context.fillRect(0, 96, width, 40)

  context.fillStyle = '#e6edf3'
  context.font = '14px monospace'
  context.fillText('MODKIT UI · image stage', 8, 18)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (blob === null) throw new TypeError('PNG encoding failed')
  return new Uint8Array(await blob.arrayBuffer())
}

/** A 16-bit PCM WAV: two tones plus an envelope, so the waveform has visible structure. */
export function makeWavBytes(seconds = 3, sampleRate = 44_100): Uint8Array {
  const frames = Math.floor(seconds * sampleRate)
  const channels = 2
  const blockAlign = channels * 2
  const dataBytes = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / sampleRate
    // Two partials and a slow tremolo, then a decaying envelope over the last second.
    const tone = Math.sin(2 * Math.PI * 220 * t) * 0.5 + Math.sin(2 * Math.PI * 330 * t) * 0.25
    const tremolo = 0.75 + 0.25 * Math.sin(2 * Math.PI * 3 * t)
    const envelope = t > seconds - 1 ? Math.max(0, seconds - t) : 1
    const sample = Math.max(-1, Math.min(1, tone * tremolo * envelope))
    const encoded = Math.round(sample * 32_767)
    view.setInt16(44 + frame * blockAlign, encoded, true)
    view.setInt16(44 + frame * blockAlign + 2, Math.round(encoded * 0.7), true)
  }
  return new Uint8Array(buffer)
}

/** A secure-static SVG: no script, no external refs — the profile the vector stage accepts. */
export function vectorSceneSourceFor(): VectorSceneSource {
  const text = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160" width="240" height="160">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4daafc"/>
      <stop offset="1" stop-color="#89d185"/>
    </linearGradient>
  </defs>
  <rect width="240" height="160" fill="#11151c"/>
  <path d="M20 130 L70 40 L120 130 Z" fill="url(#g)"/>
  <circle cx="170" cy="70" r="34" fill="none" stroke="#e5ba3c" stroke-width="6"/>
  <text x="20" y="152" fill="#d7dee8" font-family="monospace" font-size="12">vector stage</text>
</svg>`
  return {
    async info() {
      return {
        width: 240,
        height: 160,
        viewBox: [0, 0, 240, 160] as const,
        nodes: 5,
        paths: 1,
        shapes: 2,
        textNodes: 1,
        gradients: 1,
      }
    },
    async document() {
      return {
        mediaType: 'image/svg+xml' as const,
        profile: 'uvg.secure-static.v1' as const,
        text,
      }
    },
  } as VectorSceneSource
}

/** A unit cube with real positions and indices, so the model stage draws actual geometry. */
export function modelSceneSourceFor(): ModelSceneSource {
  const positions = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ])
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7, 0, 1,
    5, 0, 5, 4,
  ])
  return {
    async info() {
      return {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 1,
        textures: 0,
        animations: 0,
        bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
        geometryAccess: 'decoded' as const,
      }
    },
    async nodes() {
      return { items: [{ id: 'node-0', name: 'Cube', meshId: 'mesh-0', children: [] }] }
    },
    async meshes() {
      return { items: [{ id: 'mesh-0', name: 'Cube', primitiveIds: ['prim-0'] }] }
    },
    async primitive() {
      return {
        id: 'prim-0',
        topology: 'triangles' as const,
        positions,
        indices,
        bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      }
    },
  } as unknown as ModelSceneSource
}

/** A real WebM recorded from a canvas by the platform encoder. */
export async function makeWebmBytes(
  milliseconds = 1200,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const canvas = document.createElement('canvas')
  canvas.width = 240
  canvas.height = 135
  const context = canvas.getContext('2d')
  if (context === null) throw new TypeError('2d canvas context is unavailable')
  const stream = canvas.captureStream(24)
  const mediaType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type =>
    MediaRecorder.isTypeSupported(type),
  )
  if (mediaType === undefined) throw new TypeError('no supported WebM encoder')
  const recorder = new MediaRecorder(stream, { mimeType: mediaType })
  const chunks: Blob[] = []
  recorder.ondataavailable = event => chunks.push(event.data)
  const finished = new Promise<void>(resolve => {
    recorder.onstop = () => resolve()
  })
  recorder.start()
  const started = performance.now()
  // A timer, not requestAnimationFrame: rAF does not tick in a tab that is not compositing,
  // which would leave the recorder running and hang the caller forever.
  const timer = setInterval(() => {
    const elapsed = performance.now() - started
    const t = Math.min(1, elapsed / milliseconds)
    context.fillStyle = '#11151c'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#4daafc'
    context.fillRect(20 + t * 160, 50, 40, 40)
    context.fillStyle = '#d7dee8'
    context.font = '12px monospace'
    context.fillText('video stage', 16, 124)
    if (elapsed >= milliseconds && recorder.state === 'recording') recorder.stop()
  }, 40)
  // Hard stop: a fixture must never be able to block the gallery from finishing its boot.
  const guard = setTimeout(
    () => {
      if (recorder.state === 'recording') recorder.stop()
    },
    milliseconds * 4 + 2000,
  )
  await finished
  clearInterval(timer)
  clearTimeout(guard)
  const blob = new Blob(chunks, { type: mediaType })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mediaType }
}

export function videoMediaSourceFor(
  bytes: Uint8Array,
  mediaType: string,
  durationMs: number,
): VideoMediaSource {
  return {
    async info() {
      return {
        durationMs,
        seekable: true,
        tracks: [
          {
            id: 'video-0',
            kind: 'video' as const,
            codec: mediaType,
            selected: true,
            width: 240,
            height: 135,
            frameRate: 24,
          },
        ],
      }
    },
    async encoded() {
      return encodedFor(bytes, mediaType)
    },
  } as unknown as VideoMediaSource
}
