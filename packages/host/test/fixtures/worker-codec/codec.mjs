// A single-file codec module (CodecModule ABI v1) for the Node worker backend tests. It runs
// inside the worker: probes through the host-executed source it receives, reports a diagnostic
// through the host sink, and opens a session whose data source is a text source.
export const abiVersion = 1

export function createCodec(context) {
  return {
    async probe(request, signal) {
      const head = await request.source.read(0n, 4, signal)
      context.diagnostics.report({
        code: 'x3.demo/probed',
        severity: 'information',
        message: `probed ${request.source.ref?.path ?? '?'} size=${String(request.source.size)}`,
      })
      return {
        confidence: head[0] === 0x89 ? 1 : 0,
        head: [...head],
        budgetNodes: context.budgets.maxNodes,
        planKind: request.plan?.kind ?? null,
      }
    },
    async planInput() {
      return {
        originKind: 'single',
        candidate: { bindingId: 'worker-plan', role: 'content', ownership: 'owned' },
        requirements: [],
      }
    },
    async open(input, intent, budget) {
      const primary = input.bindingsFor('x')
      const lease = await input.openBinding(input.primaryBindingId)
      const first = await lease.value.read(0n, 2)
      await lease.release()
      return {
        revision: input.revisions.revision,
        state: () => 'live',
        descriptor: async () => ({
          id: 'demo',
          intent,
          budgetNodes: budget.maxNodes,
          originKind: input.originKind,
          requirementBindings: primary.length,
          first: [...first],
        }),
        dataSource: async contract => ({
          value:
            contract === 'common.view/text-data-source'
              ? {
                  info: async () => ({
                    bytes: 5n,
                    encoding: 'utf-8',
                    bom: false,
                    newline: 'lf',
                    lines: 1,
                    longestLineBytes: 5,
                  }),
                  slice: async r => 'hello'.slice(r.from, r.to),
                  search: async function* () {
                    yield* []
                  },
                }
              : { size: async () => 5n, read: async () => new Uint8Array([104, 105]) },
          release: async () => undefined,
        }),
        operations: () => ({
          // exercises the ABI placements: signal + onProgress live inside the third argument
          invoke: async (handlerId, value, options) => {
            options?.onProgress?.({ completed: 1, total: 2, message: 'half' })
            options?.onProgress?.({ completed: 2, total: 2 })
            return {
              kind: 'ok',
              handlerId,
              value,
              sawSignal: options?.signal instanceof AbortSignal,
              aborted: options?.signal?.aborted === true,
            }
          },
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
