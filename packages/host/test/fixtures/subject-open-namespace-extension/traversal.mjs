export const abiVersion = 1

export const createCodec = () =>
  Object.freeze({
    async probe({ source }, signal) {
      const namespaceLease = await source.openNamespace(signal)
      try {
        for await (const entry of namespaceLease.value.list('', signal)) {
          throw new Error(`namespace traversal unexpectedly returned ${entry.path}`)
        }
      } finally {
        await namespaceLease.release()
      }
      throw new Error('namespace traversal should have been refused')
    },
    async open() {
      throw new Error('host must reject namespace traversal before open')
    },
  })
