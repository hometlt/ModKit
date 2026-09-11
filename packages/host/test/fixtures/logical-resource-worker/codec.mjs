export const abiVersion = 1

export function createCodec(context) {
  const resources = context.logicalResources
  const request = { role: 'sidecar', extension: '.m3a' }
  return {
    async probe({ source }) {
      const bytes = await source.read(0n, 4)
      return {
        codecId: 'org.example/logical-resource-worker',
        confidence: bytes[0] === 71 ? 1 : 0,
        evidence: [{ kind: 'magic', weight: 1 }],
        requiredRanges: [{ byteOffset: '0', byteLength: '4' }],
      }
    },
    async open(input) {
      if (resources === undefined) throw new Error('Missing logical resource port')
      const unopened = await resources.discover(request)
      if (unopened.state !== 'refused' || unopened.reason !== 'context-unavailable')
        throw new Error('Logical discovery was active before the session opened')
      if ('dispose' in resources) throw new Error('Codec must not own resource session disposal')
      const binding = input.bindings[0]
      const controller = new AbortController()
      let disposed = false
      return {
        revision: input.revisions.revision,
        state: () => (disposed ? 'disposed' : 'live'),
        async descriptor() {
          const discovery = await resources.discover(request, controller.signal)
          if (discovery.state !== 'complete' || discovery.candidates.length !== 1)
            throw new Error('Initial descriptor cannot discover its sidecar')
          const candidate = discovery.candidates[0]
          const requirement = {
            id: 'walk',
            logicalId: candidate.logicalId,
            role: 'sidecar',
            scopes: ['current-mount'],
          }
          let bytes
          if (binding.source.id === 'batch.logical') {
            if (discovery.context?.primaryLogicalId !== 'batch.logical')
              throw new Error('Missing host naming witness')
            const batch = await resources.readBatch(
              {
                items: [
                  {
                    requirement,
                    expectedRevision: candidate.expectedRevision,
                    size: candidate.size,
                  },
                ],
                concurrency: 4,
                readTimeoutMs: 1000,
                totalTimeoutMs: 1500,
                maxBytes: 4n,
              },
              controller.signal,
            )
            if (
              batch.state !== 'complete' ||
              batch.items.length !== 1 ||
              batch.items[0].state !== 'read'
            )
              throw new Error('Initial descriptor cannot read its complete batch')
            bytes = batch.items[0].bytes
          } else {
            const resolution = await resources.resolve(requirement, controller.signal)
            if (resolution.state !== 'resolved' || resolution.lease.value.kind !== 'bytes')
              throw new Error('Initial descriptor cannot lease sidecar bytes')
            try {
              if (binding.source.id === 'deadline.logical') await new Promise(() => undefined)
              bytes = await resolution.lease.value.read(0n, 4, controller.signal)
            } finally {
              await resolution.lease.release()
            }
          }
          if (bytes.join(',') !== '10,20,30,40') throw new Error('Incorrect sidecar bytes')
          const provenance = await resources.provenance()
          if (provenance.length !== 1 || provenance[0].logicalId !== 'walk.m3a')
            throw new Error('Missing sidecar provenance')
          if (binding.source.id === 'disposed.logical') disposed = true
          return {
            schemaVersion: 2,
            subjectUri: binding.source.uri,
            revision: binding.revision,
            interpretation: 'codec',
            identity: {
              codecId: 'org.example/logical-resource-worker',
              codecVersion: '1.0.0',
              formatId: 'logical-fixture',
              formatLabel: 'Logical fixture',
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
        async dispose() {
          if (disposed) return
          disposed = true
          controller.abort()
          const result = await resources.discover(request)
          if (result.state !== 'refused' || result.reason !== 'context-unavailable')
            throw new Error('Resource port must be revoked before codec disposal')
        },
      }
    },
  }
}
