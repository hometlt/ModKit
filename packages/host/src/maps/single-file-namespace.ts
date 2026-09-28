/**
 * A map that is one file (a Tiberian Sun `.map`, a Dune 2000 `.MAP`) on the map preview's container
 * route. The preview reads a map's documents and resources from its subject namespace, and a
 * single-file subject has none; this session answers as a container of one entry — the file under
 * its own name, whose bytes are the subject's byte-range source — so a preparation provider plans it
 * like any packed map. Only the preview route sees it: nothing shows the map as an archive.
 */
import { ModkitError } from '@modkit/core'
import type {
  AnyDescriptor,
  AssetSession,
  ByteRangeSource,
  NamespaceEntry,
  NamespaceEntrySource,
  OperationSession,
} from '@modkit/sdk'

const NAMESPACE = 'common.view/namespace-entry-source'
const BYTE_RANGE = 'common.view/byte-range-source'
const EXTRACT_HANDLER = 'x3.host/single-file-extract'
const ENTRY_ID = 'subject'

/** The file name a subject URI ends in, `subject` when it names none. */
function fileNameOf(subjectUri: string): string {
  const path = subjectUri.replace(/[?#].*$/u, '')
  const last = path.slice(path.lastIndexOf('/') + 1)
  try {
    return decodeURIComponent(last) || 'subject'
  } catch {
    return last || 'subject'
  }
}

/**
 * The session unchanged when it has a namespace or no byte-range source; otherwise the same session
 * seen as a container of its one file, extracted whole up to `maxBytes`.
 */
export async function singleFileAsContainer(
  session: AssetSession,
  maxBytes: bigint,
): Promise<AssetSession> {
  const descriptor = await session.descriptor()
  const has = (contract: string) =>
    descriptor.dataSources.some(item => item.contract === contract && item.major === 1)
  if (descriptor.interpretation === 'none' || has(NAMESPACE) || !has(BYTE_RANGE)) return session
  const name = fileNameOf(descriptor.subjectUri)
  const entry: NamespaceEntry = Object.freeze({
    id: ENTRY_ID,
    path: name,
    name,
    kind: 'file',
    revision: descriptor.revision,
  })
  const namespace: NamespaceEntrySource = Object.freeze({
    async list(prefix: string) {
      const items = name.toLowerCase().startsWith(prefix.toLowerCase()) ? [entry] : []
      return Object.freeze({ items: Object.freeze(items) })
    },
    async lookup(path: string) {
      return path.toLowerCase() === name.toLowerCase() ? entry : undefined
    },
    // the preview reads the file through container.extract; nothing opens it as a nested subject
    async openEntry(): Promise<never> {
      throw new TypeError('a single-file map is read through container.extract')
    },
  })
  const extract = async (signal?: AbortSignal): Promise<Uint8Array> => {
    const lease = await session.dataSource(BYTE_RANGE, 1)
    try {
      const source = lease.value as ByteRangeSource
      const size = await source.size()
      if (size > maxBytes || size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ModkitError({
          code: 'x3.host/map-preview-subject-too-large',
          message: `the map file (${size} bytes) exceeds the preview input budget`,
          context: { size: String(size), maxBytes: String(maxBytes) },
        })
      }
      return await source.read(0n, Number(size), signal)
    } finally {
      await lease.release()
    }
  }
  const extended = Object.freeze({
    ...descriptor,
    dataSources: Object.freeze([
      ...descriptor.dataSources,
      Object.freeze({ contract: NAMESPACE, major: 1 }),
    ]),
    operations: Object.freeze([
      ...descriptor.operations,
      Object.freeze({
        id: 'container.extract',
        handlerId: EXTRACT_HANDLER,
        mutatesSource: false,
        state: 'available',
      }),
    ]),
  }) as unknown as AnyDescriptor
  const operations = (): OperationSession => {
    const inner = session.operations()
    return Object.freeze({
      async invoke(handlerId, input, options) {
        if (handlerId !== EXTRACT_HANDLER) return inner.invoke(handlerId, input, options)
        const entryId = (input as { readonly entryId?: unknown } | null)?.entryId
        if (entryId !== ENTRY_ID)
          throw new RangeError(`the map file has no entry ${String(entryId)}`)
        return {
          state: 'ok',
          output: { kind: 'bytes', value: await extract(options?.signal) },
          diagnostics: [],
        }
      },
      dispose: () => inner.dispose(),
    } satisfies OperationSession)
  }
  return Object.freeze({
    get revision() {
      return session.revision
    },
    state: () => session.state(),
    descriptor: async () => extended,
    async dataSource(contract: string, major: number) {
      if (contract === NAMESPACE && major === 1)
        return { value: namespace, release: async (): Promise<void> => undefined }
      return session.dataSource(contract as never, major as never)
    },
    operations,
    events: (signal?: AbortSignal) => session.events(signal),
    dispose: () => session.dispose(),
  }) as unknown as AssetSession
}
