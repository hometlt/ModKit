export const abiVersion = 1

export const createCodec = () =>
  Object.freeze({
    async probe({ source }, signal) {
      const namespaceLease = await source.openNamespace(signal)
      try {
        const markerLease = await namespaceLease.value.open('project.marker', signal)
        try {
          if (markerLease.value.kind !== 'bytes') throw new TypeError('marker must be bytes')
          await markerLease.value.read(0n, 65, signal)
        } finally {
          await markerLease.release()
        }
      } finally {
        await namespaceLease.release()
      }
      throw new Error('namespace overread should have been refused')
    },
    async open() {
      throw new Error('host must reject the namespace overread before open')
    },
  })
