// A codec module (CodecModule ABI v1) that opens a *derived* AssetInput inside the worker: it
// reads the copied `subjects` list through the locally-derived `subjectsFor`, opens one input
// subject as a session through the host-executed `openSubject`, and opens the optional
// `materialized` artifact through `openMaterialized`. Proves the derived asset-input surface
// crosses the boundary (S2).
export const abiVersion = 1

export function createCodec() {
  return {
    async probe() {
      return { confidence: 1 }
    },
    async open(input) {
      const forA = input.subjectsFor('a')
      const subjectLease = await input.openSubject(forA[0].bindingId)
      const descriptor = await subjectLease.value.descriptor()
      await subjectLease.release()
      const materialized = await input.openMaterialized()
      const head = await materialized.value.read(0n, 3)
      await materialized.release()
      return {
        revision: input.revisions.revision,
        state: () => 'live',
        descriptor: async () => ({
          originKind: input.originKind,
          subjectCount: input.subjects.length,
          forA: forA.length,
          innerDescriptor: descriptor,
          materializedHead: [...head],
        }),
        dataSource: async () => ({
          value: { info: async () => ({}) },
          release: async () => undefined,
        }),
        operations: () => ({
          invoke: async () => ({ kind: 'ok' }),
          dispose: async () => undefined,
        }),
        events: async function* () {
          yield { kind: 'state', state: 'live' }
        },
        dispose: async () => undefined,
      }
    },
  }
}
