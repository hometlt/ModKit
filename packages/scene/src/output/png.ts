const SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ascii = new TextEncoder()

function crc32(bytes: Uint8Array, start: number, end: number) {
  let crc = 0xffffffff
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset] ?? 0
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunkBytes(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.byteLength, false)
  out.set(ascii.encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.byteLength, crc32(out, 4, 8 + data.byteLength), false)
  return out
}

async function deflate(bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal) {
  if (typeof CompressionStream !== 'function') {
    throw new TypeError('no portable zlib encoder is available')
  }
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream('deflate'))
    .getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      chunks.push(chunk.value)
      total += chunk.value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Deterministically encode a tightly packed RGBA8 frame as PNG. */
export async function encodeRgbaPng(
  frame: { width: number; height: number; rgba: Uint8Array },
  signal?: AbortSignal,
) {
  if (
    !Number.isSafeInteger(frame.width) ||
    frame.width <= 0 ||
    !Number.isSafeInteger(frame.height) ||
    frame.height <= 0 ||
    !(frame.rgba instanceof Uint8Array) ||
    frame.rgba.byteLength !== frame.width * frame.height * 4
  ) {
    throw new TypeError('PNG input must be a tightly packed positive RGBA8 frame')
  }
  const rowBytes = frame.width * 4
  const raw = new Uint8Array((rowBytes + 1) * frame.height)
  for (let row = 0; row < frame.height; row += 1) {
    raw.set(frame.rgba.subarray(row * rowBytes, (row + 1) * rowBytes), row * (rowBytes + 1) + 1)
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, frame.width, false)
  view.setUint32(4, frame.height, false)
  header[8] = 8
  header[9] = 6
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunkBytes('IHDR', header),
    chunkBytes('IDAT', await deflate(raw, signal)),
    chunkBytes('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}
