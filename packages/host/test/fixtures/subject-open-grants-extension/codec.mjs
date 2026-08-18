// R5 two-phase fixture: a codec whose variant requests read-source AND write-source. Detection
// must run it under the probe-scoped child grant (read-source only); the open must run under a
// re-activation carrying the full request. The module counts createCodec calls so the test can
// see one probe codec + one open codec for the winner.
export const abiVersion = 1

globalThis.__x3GrantsFixture ??= { createCodecCalls: 0 }

export const createCodec = () => {
  globalThis.__x3GrantsFixture.createCodecCalls += 1
  return Object.freeze({
    async probe({ source }) {
      const head = await source.read(0n, 4)
      const match = head[0] === 0x47 && head[1] === 0x52 && head[2] === 0x41 && head[3] === 0x4e
      return {
        codecId: 'org.example/grants-codec',
        confidence: match ? 1 : 0,
        evidence: match ? [{ kind: 'magic', weight: 1 }] : [],
        requiredRanges: [{ byteOffset: '0', byteLength: '4' }],
      }
    },
    async open(input) {
      const lease = await input.openBinding(input.primaryBindingId)
      await lease.release()
      const binding = input.bindings[0]
      return {
        revision: input.revisions.revision,
        state: () => 'live',
        descriptor: async () => ({
          schemaVersion: 2,
          subjectUri: binding.source.uri,
          revision: binding.revision,
          interpretation: 'codec',
          identity: {
            codecId: 'org.example/grants-codec',
            codecVersion: '1.0.0',
            formatId: 'grants',
            formatLabel: 'Grants fixture',
            confidence: 1,
            detection: [{ kind: 'magic', weight: 1 }],
          },
          origin: {
            kind: 'single',
            binding: {
              id: binding.bindingId,
              role: binding.role,
              source: { id: binding.source.id, uri: binding.source.uri },
              required: true,
              ownership: binding.ownership,
              revision: binding.revision,
            },
          },
          traits: [],
          operations: [],
          constraints: { readOnly: true, seekable: true, randomAccess: true, trusted: false },
          dataSources: [{ contract: 'common.view/byte-range-source', major: 1 }],
          diagnostics: [],
          metadata: [],
        }),
        dataSource: async () => ({ value: {}, release: async () => undefined }),
        operations: () => ({
          invoke: async () => ({ kind: 'ok' }),
          dispose: async () => undefined,
        }),
        events: async function* () {
          yield* []
        },
        dispose: async () => undefined,
      }
    },
  })
}
