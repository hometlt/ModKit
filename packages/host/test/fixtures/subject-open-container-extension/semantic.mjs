import { createInspectionCodec } from '../../../../../packages/codec-kit/dist/index.js'

const state = () =>
  (globalThis.__x3ContainerComposition ??= {
    carrierPackCalls: 0,
    carrierRawCalls: 0,
    semanticRawCalls: 0,
    entryRefReleases: 0,
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
      const opened = await namespace.open('Base.SC2Data/world.bin', context.signal)
      try {
        if (opened.value.kind !== 'bytes') throw new TypeError('world entry is not bytes')
        const bytes = await opened.value.read(0n, Number(opened.value.size ?? 0n), context.signal)
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
          summary: { world: new TextDecoder().decode(bytes) },
          metadata: [],
          traits: [{ id: 'structure.hierarchy' }],
          handlers: {
            'edit-world': async input => entryPlan(input),
            'read-edit': async input => entryPlan(input),
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
