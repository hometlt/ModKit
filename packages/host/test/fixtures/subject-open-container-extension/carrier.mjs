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
    carrierExtractCalls: 0,
  })

function maybeCorruptPlan(plan) {
  if (globalThis.__x3ContainerMaliciousPlan === 'target') {
    return {
      ...plan,
      targets: plan.targets.map(target => ({ ...target, targetId: 'provider://foreign-target' })),
    }
  }
  if (globalThis.__x3ContainerMaliciousPlan === 'revision') {
    return {
      ...plan,
      targets: plan.targets.map(target => ({
        ...target,
        expectedRevision: {
          ...target.expectedRevision,
          compositionFingerprint: 'provider-forged-revision',
        },
      })),
    }
  }
  if (globalThis.__x3ContainerMaliciousPlan === 'source-uri') {
    return {
      ...plan,
      targets: plan.targets.map(target => ({
        ...target,
        ownerSource: { ...target.ownerSource, uri: 'provider://foreign-source' },
      })),
    }
  }
  return plan
}

function namespaceSource(source) {
  return Object.freeze({
    async readPreamble(maxBytes, signal) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('invalid preamble bound')
      return encoder.encode('carrier-preamble').slice(0, maxBytes)
    },
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')
      const items =
        globalThis.__x3ContainerNoEntries === true
          ? []
          : entry.path.startsWith(prefix)
            ? [entry]
            : []
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      return Object.freeze({
        items: Object.freeze(
          items.slice(start, start + page.limit).map(item =>
            Object.freeze({
              ...item,
              size: globalThis.__x3ContainerDeclaredEntrySize ?? BigInt(entryBytes.byteLength),
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
      confidence:
        bytes.byteLength === 0
          ? 0.9
          : new TextDecoder().decode(bytes.subarray(0, 4)) === 'CARR'
            ? 0.95
            : 0,
      kind: bytes.byteLength === 0 ? 'extension' : 'magic',
      note: bytes.byteLength === 0 ? 'empty carrier creation target' : 'test carrier signature',
    }
  },
  async inspect(bytes, context) {
    const creationTarget = bytes.byteLength === 0
    return {
      summary: {
        kind: 'carrier',
        format: 'carrier',
        entries: creationTarget ? 0 : 1,
        carrierVersion: 7,
      },
      metadata: [],
      traits: [{ id: 'container.entries', parameters: { count: creationTarget ? 0 : 1 } }],
      ...(creationTarget
        ? {
            operationStates: [
              {
                id: 'container.extract',
                state: 'disabled',
                reason: 'an empty carrier creation target has no entries',
              },
              {
                id: 'export.raw',
                state: 'disabled',
                reason: 'an empty carrier creation target has no container bytes',
              },
            ],
          }
        : {}),
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
        extract: async (input, options) => {
          state().carrierExtractCalls += 1
          if (input?.entryId !== entry.id) throw new TypeError('entry was not found')
          if (globalThis.__x3ContainerAbortDuringExtract) {
            globalThis.__x3ContainerAbortController?.abort()
            if (options?.signal?.aborted) throw new DOMException('cancelled', 'AbortError')
          }
          if (globalThis.__x3ContainerFailExtract) {
            throw new TypeError('fixture extraction refused')
          }
          return { kind: 'bytes', value: entryBytes.slice() }
        },
        pack: async input => {
          state().carrierPackCalls += 1
          if (
            creationTarget &&
            input?.schemaVersion === 1 &&
            input.mode === 'create' &&
            input.expectedContainerRevision === context.input.revisions.revision &&
            Array.isArray(input.files)
          ) {
            const body = input.files
              .map(file => `${file.name}:${file.bytesBase64}`)
              .sort()
              .join('|')
            const assembled = encoder.encode(`CARR:${body}`)
            const plan = editPlanFromInput(context.input, {
              planId: 'carrier-create',
              edits: [
                {
                  operation: 'replace',
                  range: { kind: 'bytes', offset: 0n, length: 0n },
                  payload: { kind: 'inline', bytes: assembled },
                },
              ],
              fidelity: { roundTrip: 'semantic', preservesUnknownData: false },
            })
            return {
              kind: 'edit-plan',
              plan: maybeCorruptPlan(plan),
            }
          }
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
