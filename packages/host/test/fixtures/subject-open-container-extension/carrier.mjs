import {
  createInspectionCodec,
  editPlanFromInput,
} from '../../../../../packages/codec-kit/dist/index.js'

const encoder = new TextEncoder()
const entryBytes = encoder.encode('old-world')
const entry = Object.freeze({
  id: 'world-entry',
  path: 'Base.SC2Data/world.bin',
  name: 'world.bin',
  kind: 'file',
})
const state = () =>
  (globalThis.__x3ContainerComposition ??= {
    carrierPackCalls: 0,
    carrierRawCalls: 0,
    semanticRawCalls: 0,
    entryRefReleases: 0,
  })

function namespaceSource(source) {
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
      const items = entry.path.startsWith(prefix) ? [entry] : []
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      return Object.freeze({
        items: Object.freeze(
          items.slice(start, start + page.limit).map(item =>
            Object.freeze({
              ...item,
              size: BigInt(entryBytes.byteLength),
              revision: source.revision,
            }),
          ),
        ),
      })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
      if (entryId !== entry.id) throw new TypeError('entry was not found')
      let released = false
      return Object.freeze({
        value: Object.freeze({
          id: `${source.ref.id}!/${entry.path}`,
          uri: `test-entry:${encodeURIComponent(source.ref.uri)}!/${entry.path}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
        async release() {
          if (released) return
          released = true
          state().entryRefReleases += 1
        },
      })
    },
  })
}

const definition = Object.freeze({
  id: 'org.example/test-carrier',
  format: Object.freeze({ id: 'test-carrier', label: 'Test carrier' }),
  operations: Object.freeze([
    Object.freeze({
      id: 'container.extract',
      handlerId: 'extract',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
    Object.freeze({
      id: 'container.pack',
      handlerId: 'pack',
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
  ]),
  async detect(bytes) {
    return {
      confidence: new TextDecoder().decode(bytes.subarray(0, 4)) === 'CARR' ? 0.95 : 0,
      kind: 'magic',
      note: 'test carrier signature',
    }
  },
  async inspect(bytes, context) {
    return {
      summary: { kind: 'carrier' },
      metadata: [],
      traits: [{ id: 'container.entries', parameters: { count: 1 } }],
      ...(globalThis.__x3ContainerDisablePack
        ? {
            operationStates: [
              {
                id: 'container.pack',
                state: 'disabled',
                reason: 'fixture disables pack after the carrier opens',
              },
            ],
          }
        : {}),
      dataSources: {
        'common.view/namespace-entry-source': namespaceSource(context.source),
      },
      handlers: {
        extract: async input => {
          if (input?.entryId !== entry.id) throw new TypeError('entry was not found')
          return { kind: 'bytes', value: entryBytes.slice() }
        },
        pack: async input => {
          state().carrierPackCalls += 1
          if (
            input?.schemaVersion !== 1 ||
            input.expectedContainerRevision !== context.input.revisions.revision ||
            input.replacements?.length !== 1 ||
            input.replacements[0]?.entryId !== entry.id ||
            input.replacements[0]?.expectedRevision !== context.source.revision
          ) {
            throw new TypeError('invalid container.pack request')
          }
          const replacement = Uint8Array.from(atob(input.replacements[0].bytesBase64), character =>
            character.charCodeAt(0),
          )
          const assembled = new Uint8Array(5 + replacement.byteLength)
          assembled.set(encoder.encode('CARR:'), 0)
          assembled.set(replacement, 5)
          return {
            kind: 'edit-plan',
            plan: editPlanFromInput(context.input, {
              planId: 'carrier-pack',
              edits: [{ operation: 'replace', payload: { kind: 'inline', bytes: assembled } }],
              fidelity: { roundTrip: 'semantic', preservesUnknownData: true },
            }),
          }
        },
        'export-raw': async () => {
          state().carrierRawCalls += 1
          return { kind: 'bytes', value: bytes.slice() }
        },
      },
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
