export const abiVersion = 1

// Reaches the host's credential broker from a worker: status, a fetch the broker signs, and the
// refusals an extension must get (the key itself, a credential it did not declare).
export function createCodec(context) {
  const credentials = context.credentials
  return {
    async probe({ source }) {
      const bytes = await source.read(0n, 4)
      return {
        codecId: 'org.example/credentials-worker',
        confidence: bytes[0] === 67 ? 1 : 0,
        evidence: [{ kind: 'magic', weight: 1 }],
        requiredRanges: [{ byteOffset: '0', byteLength: '4' }],
      }
    },
    async open(input) {
      if (credentials === undefined) throw new Error('Missing credential port')
      const binding = input.bindings[0]
      const refusal = async promise => {
        try {
          await promise
        } catch (error) {
          return error.code
        }
        return 'accepted'
      }
      if ((await credentials.status('org.example/cloud')) !== 'available')
        throw new Error('The declared key is not available')
      const response = await credentials.fetch('org.example/cloud', {
        url: 'https://api.example.test/v1/ping',
      })
      const reply = new TextDecoder().decode(response.body)
      if (response.status !== 200 || reply !== 'pong') throw new Error(`Unexpected reply ${reply}`)
      const secret = await refusal(credentials.secret('org.example/cloud'))
      const foreign = await refusal(credentials.status('org.example/other'))
      const outside = await refusal(
        credentials.fetch('org.example/cloud', { url: 'https://elsewhere.test/v1/ping' }),
      )
      const outcome = [secret, foreign, outside].join(',')
      if (
        outcome !==
        'x3.host/credential-not-exposed,x3.host/credential-undeclared,x3.host/credential-audience'
      )
        throw new Error(`Unexpected refusals ${outcome}`)
      return {
        revision: input.revisions.revision,
        state: () => 'live',
        async descriptor() {
          return {
            schemaVersion: 2,
            subjectUri: binding.source.uri,
            revision: binding.revision,
            interpretation: 'codec',
            identity: {
              codecId: 'org.example/credentials-worker',
              codecVersion: '1.0.0',
              formatId: 'credentials-fixture',
              formatLabel: 'Credentials fixture',
              confidence: 1,
              detection: [{ kind: 'magic', weight: 1 }],
            },
            origin: {
              kind: 'single',
              binding: {
                id: binding.bindingId,
                role: binding.role,
                source: binding.source,
                required: true,
                ownership: binding.ownership,
                revision: binding.revision,
              },
            },
            traits: [],
            operations: [],
            dataSources: [],
            diagnostics: [],
            metadata: [],
            constraints: { readOnly: true, seekable: true, randomAccess: true, trusted: false },
          }
        },
        async dataSource() {
          throw new Error('No data sources published by this fixture')
        },
        operations: () => ({
          invoke: async () => {
            throw new Error('No operations published')
          },
          dispose: async () => undefined,
        }),
        async *events() {
          yield* []
        },
        async dispose() {},
      }
    },
  }
}
