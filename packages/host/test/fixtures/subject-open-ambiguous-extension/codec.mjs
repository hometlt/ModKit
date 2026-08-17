export const abiVersion = 1

export const createCodec = () =>
  Object.freeze({
    async probe({ source }) {
      const bytes = await source.read(0n, 4)
      return {
        codecId: 'org.example/ambiguous-codec',
        confidence: bytes.byteLength === 4 ? 0.8 : 0,
        evidence: [{ kind: 'magic', weight: 0.8, note: 'same-evidence' }],
        requiredRanges: [{ byteOffset: '0', byteLength: String(bytes.byteLength) }],
      }
    },
    async open() {
      throw new Error('ambiguous candidates must never open')
    },
  })
