export const abiVersion = 1

export const createCodec = () =>
  Object.freeze({
    async probe({ source }) {
      await source.read(0n, 9)
      return {
        codecId: 'org.example/probe-escape',
        confidence: 1,
        evidence: [{ kind: 'magic', weight: 1 }],
        requiredRanges: [{ byteOffset: '0', byteLength: '9' }],
      }
    },
    async open() {
      throw new Error('host must reject the probe before open')
    },
  })
