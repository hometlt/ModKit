import { createInspectionCodec } from '../../../../../packages/codec-kit/dist/index.js'

const state = () =>
  (globalThis.__x3ContainerComposition ??= {
    carrierPackCalls: 0,
    carrierRawCalls: 0,
    semanticRawCalls: 0,
    entryRefReleases: 0,
    carrierExtractCalls: 0,
  })

const definition = Object.freeze({
  id: 'org.example/test-semantic',
  format: Object.freeze({ id: 'test-semantic', label: 'Test semantic' }),
  operations: Object.freeze([
    Object.freeze({
      id: 'edit.content',
      handlerId: 'edit-world',
      mutatesSource: true,
      requiredPermissions: Object.freeze(['read-source', 'write-source']),
      outputKinds: Object.freeze(['edit-plan']),
    }),
    Object.freeze({
      id: 'export.raw',
      handlerId: 'export-raw',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
    Object.freeze({
      id: 'org.example/test-semantic.preview-edit',
      handlerId: 'read-edit',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
    }),
    Object.freeze({
      id: 'org.example/test-semantic.read-lazy',
      handlerId: 'read-lazy',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['json']),
    }),
  ]),
  namespace: {
    async detect(markers) {
      const directory = markers.some(
        marker => marker.path === 'Base.SC2Data' && marker.kind === 'directory',
      )
      const world = markers.some(
        marker => marker.path === 'Base.SC2Data/world.bin' && marker.kind === 'file',
      )
      return { confidence: directory && world ? 0.99 : 0, kind: 'structure', note: 'world marker' }
    },
    async inspect(namespace, context) {
      const preamble = await namespace.readPreamble?.(context.budget.maxScalarBytes, context.signal)
      const opened = await namespace.open('Base.SC2Data/world.bin', context.signal)
      try {
        if (opened.value.kind !== 'bytes') throw new TypeError('world entry is not bytes')
        const bytes = globalThis.__x3ContainerSkipInspectRead
          ? new Uint8Array()
          : await opened.value.read(0n, Number(opened.value.size ?? 0n), context.signal)
        const entryRef = opened.value.ref
        const entryRevision = opened.value.revision
        const entryPlan = input => {
          const replacement = new TextEncoder().encode(String(input?.text ?? 'new-world'))
          if (input?.abortBeforePack) globalThis.__x3ContainerAbortController?.abort()
          const targetId = 'world-entry-target'
          const target = {
            targetId,
            subjectUri: entryRef.uri,
            ownerSource: input?.malformedTarget ? null : entryRef,
            semanticPath: [],
            expectedRevision: {
              bindings: {
                world: input?.stale ? 'provider-token:stale-entry' : entryRevision,
              },
              compositionFingerprint: 'test-entry-composition',
            },
          }
          const targets = input?.duplicateTargets
            ? [target, { ...target }]
            : input?.unreferencedTarget
              ? [target, { ...target, targetId: 'unused-target' }]
              : [target]
          return {
            kind: 'edit-plan',
            plan: {
              planId: 'semantic-entry-edit',
              targets,
              edits: [
                {
                  operation: 'replace',
                  targetId,
                  source: entryRef,
                  payload: { kind: 'inline', bytes: replacement },
                },
              ],
              semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
              fidelity: { roundTrip: 'semantic', preservesUnknownData: true },
              diagnostics: [],
            },
          }
        }
        return {
          detection: { confidence: 0.99, kind: 'structure', note: 'world marker' },
          summary: {
            format: 'semantic',
            entries: 2,
            world: globalThis.__x3ContainerSkipInspectRead
              ? 'not-read'
              : new TextDecoder().decode(bytes),
            preamble: preamble === undefined ? '' : new TextDecoder().decode(preamble),
          },
          metadata: [],
          traits: [{ id: 'structure.hierarchy' }],
          handlers: {
            'edit-world': async input => entryPlan(input),
            'read-edit': async input => entryPlan(input),
            'read-lazy': async (_input, options) => {
              const lazy = await namespace.open('Base.SC2Data/world.bin', options?.signal)
              try {
                if (lazy.value.kind !== 'bytes') throw new TypeError('world entry is not bytes')
                const length = Number(lazy.value.size ?? 0n)
                const first = await lazy.value.read(0n, length, options?.signal)
                const second = await lazy.value.read(0n, length, options?.signal)
                const streamed = []
                for await (const chunk of lazy.value.stream(
                  { offset: 0n, length: BigInt(length) },
                  options?.signal,
                )) {
                  streamed.push(...chunk)
                }
                return {
                  kind: 'json',
                  value: {
                    first: first.byteLength,
                    second: second.byteLength,
                    streamed: streamed.length,
                  },
                }
              } finally {
                await lazy.release()
              }
            },
            'export-raw': async () => {
              state().semanticRawCalls += 1
              return { kind: 'bytes', value: new TextEncoder().encode('LEAKED') }
            },
          },
        }
      } finally {
        await opened.release()
      }
    },
  },
})

export const abiVersion = 1
export const createCodec = context => {
  const codec = createInspectionCodec(definition, context)
  return Object.freeze({
    ...codec,
    async probe(request, signal) {
      const namespace = await request.source.openNamespace(signal)
      try {
        let listed = false
        for await (const item of namespace.value.list('Base.SC2Data', signal)) {
          listed ||= item.path === 'Base.SC2Data/world.bin'
          break
        }
        if (!listed) throw new TypeError('declared probe prefix did not expose world.bin')
      } finally {
        await namespace.release()
      }
      return codec.probe(request, signal)
    },
  })
}
