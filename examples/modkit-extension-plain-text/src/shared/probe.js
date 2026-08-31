const TEXT_EXTENSIONS = Object.freeze(['txt', 'log', 'md', 'text'])

function extensionOf(uri) {
  const clean = uri.split(/[?#]/u, 1)[0] ?? ''
  const name = clean.slice(clean.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLocaleLowerCase()
}

export function sampleLooksText(bytes) {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const content = bom ? bytes.subarray(3) : bytes
  if (content.includes(0)) return { text: false, bom, reason: 'nul-byte' }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    return { text: false, bom, reason: 'invalid-utf8' }
  }
  let controls = 0
  for (const byte of content) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) controls += 1
  }
  const ratio = content.length === 0 ? 0 : controls / content.length
  return { text: ratio < 0.02, bom, reason: ratio < 0.02 ? 'utf8-text' : 'control-ratio' }
}

export async function probePlainText(request, signal) {
  if (request.source.kind !== 'bytes' || request.plan.kind !== 'bytes') {
    throw new TypeError('plain-text accepts only byte candidates and byte probe plans')
  }
  const requested = request.plan.ranges[0]?.length ?? request.plan.maxBytes
  const length = Math.min(requested, request.plan.maxBytes)
  const bytes = await request.source.read(0n, length, signal)
  const classification = sampleLooksText(bytes)
  const extensionMatch = TEXT_EXTENSIONS.includes(extensionOf(request.source.ref.uri))
  const confidence = classification.text ? Math.min(0.99, 0.9 + (extensionMatch ? 0.05 : 0)) : 0.02
  return Object.freeze({
    codecId: 'modkit/plain-text',
    confidence,
    evidence: Object.freeze([
      {
        kind: 'structure',
        weight: classification.text ? 0.9 : -1,
        note: classification.reason,
      },
      ...(extensionMatch
        ? [{ kind: 'extension', weight: 0.05, note: 'known text extension' }]
        : []),
    ]),
    requiredRanges: Object.freeze([{ byteOffset: '0', byteLength: String(bytes.byteLength) }]),
  })
}
