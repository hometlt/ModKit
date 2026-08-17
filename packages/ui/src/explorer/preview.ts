/**
 * Codec-driven preview resolver.
 *
 * Bytes in, mounted viewer out. The explorer knows nothing about codecs and the codecs know nothing
 * about the explorer; this is the seam between them.
 *
 * Resolution is trait-driven, not extension-driven: the file name only picks the codec, and what
 * the codec then *publishes* decides which stages appear. A codec that grows a new data source gets
 * a new tab here without this file changing.
 */
import type { ViewerModule } from '@modkitx-x3/sdk'

import type { ExplorerEntry, PreviewHandle, PreviewResolver } from './index.js'
import { element, setPart, setState } from '../viewer/index.js'

/** What a host registers for one format. */
export interface PreviewFormat {
  /** Lowercase extensions without the dot. */
  readonly extensions: readonly string[]
  /** The codec's `createCodec` factory. */
  readonly createCodec: (options: unknown) => unknown
  /** Optional syntax/provider factory the codec resolves through its contract port. */
  readonly createProvider?: (options: unknown) => unknown
  /** Contract id the provider satisfies. Required when `createProvider` is present. */
  readonly providerContract?: string
}

/** A stage the host is willing to show, keyed by the data source it needs. */
export interface PreviewStage {
  readonly label: string
  readonly contract: string
  readonly module: ViewerModule
  /** Only offered when the descriptor carries this trait. */
  readonly trait?: string
}

export interface CodecPreviewOptions {
  readonly formats: readonly PreviewFormat[]
  readonly stages: readonly PreviewStage[]
  readonly maximumBytes?: number
}

interface CodecSession {
  descriptor(): Promise<Record<string, unknown>>
  dataSource(contract: string, major: number): Promise<{ value: unknown }>
  dispose(): Promise<void>
}

const budget = (maximumBytes: number) =>
  Object.freeze({ maxBytes: maximumBytes, deadlineMs: 30_000 })

/** Traits and data sources sit at the top level of the descriptor, each as `{ id }` / `{ contract }`. */
const traitsOf = (descriptor: Record<string, unknown>): readonly string[] => {
  const traits = descriptor['traits']
  if (!Array.isArray(traits)) return []
  return traits.map(item => String((item as { id?: unknown }).id ?? ''))
}

const publishedContracts = (descriptor: Record<string, unknown>): readonly string[] => {
  const sources = descriptor['dataSources']
  if (!Array.isArray(sources)) return []
  return sources.map(item => String((item as { contract?: unknown }).contract ?? ''))
}

export function createCodecPreview(options: CodecPreviewOptions): PreviewResolver {
  const maximumBytes = options.maximumBytes ?? 64 * 1024 * 1024
  const byExtension = new Map<string, PreviewFormat>()
  for (const format of options.formats) {
    for (const extension of format.extensions) byExtension.set(extension.toLowerCase(), format)
  }

  return {
    supported: [...byExtension.keys()],

    async open(container, entry, bytes, signal): Promise<PreviewHandle | undefined> {
      const extension = entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase()
      const format = byExtension.get(extension)
      if (format === undefined) return undefined

      const session = await openCodec(format, entry, bytes, maximumBytes)
      const descriptor = await session.descriptor()
      const traits = new Set(traitsOf(descriptor))
      const published = new Set(publishedContracts(descriptor))

      const usable = options.stages.filter(
        stage =>
          published.has(stage.contract) && (stage.trait === undefined || traits.has(stage.trait)),
      )
      if (usable.length === 0) {
        await session.dispose()
        return undefined
      }

      const tabs = element(container, 'div', { part: 'explorer.tabs', role: 'tablist' })
      const host = element(container, 'div', { part: 'explorer.stage' })

      let active: { unmount(): Promise<void> | void } | undefined
      let activeButton: HTMLElement | undefined

      const show = async (stage: PreviewStage, button: HTMLElement): Promise<void> => {
        await active?.unmount()
        host.replaceChildren()
        if (activeButton !== undefined) {
          activeButton.setAttribute('aria-selected', 'false')
          setState(activeButton, [])
        }
        button.setAttribute('aria-selected', 'true')
        setState(button, ['selected'])
        activeButton = button

        /*
         * A viewer resolves its data through `bindingFor(slot, contract)`, so the slot has to carry
         * a real binding for this stage's contract — passing a bare name leaves `slot.bindings`
         * undefined and the mount fails inside the viewer.
         */
        const slot = {
          slotId: `explorer:${stage.contract}`,
          kind: 'primary',
          contributionId: 'org.modkitx.ui/explorer',
          extensionId: 'org.modkitx.ui',
          priority: 100,
          bindings: [{ bindingId: 'content', contract: stage.contract, major: 1 }],
        }

        active = await stage.module.mount({
          container: host,
          descriptor: descriptor as never,
          slot: slot as never,
          sources: {
            async get(binding: { contract: string; major?: number }) {
              const lease = await session.dataSource(binding.contract, binding.major ?? 1)
              return {
                value: lease.value,
                async release() {
                  // The codec session owns the source; releasing a lease here would be premature.
                },
              }
            },
            async getUnknown(binding: { contract: string; major?: number }) {
              const lease = await session.dataSource(binding.contract, binding.major ?? 1)
              return {
                value: lease.value,
                async release() {
                  // Same ownership rule as `get`.
                },
              }
            },
          } as never,
          operations: undefined as never,
          ...(signal === undefined ? {} : { signal }),
        } as never)
      }

      for (const stage of usable) {
        const button = element(tabs, 'button', {
          part: 'explorer.tab',
          text: stage.label,
        }) as HTMLButtonElement
        button.type = 'button'
        button.setAttribute('role', 'tab')
        button.setAttribute('aria-selected', 'false')
        button.addEventListener('click', () => {
          void show(stage, button)
        })
      }

      const first = usable[0]
      const firstButton = tabs.firstElementChild
      if (first !== undefined && firstButton instanceof HTMLElement) {
        await show(first, firstButton)
      }

      return {
        async unmount() {
          await active?.unmount()
          await session.dispose()
          tabs.remove()
          host.remove()
        },
      }
    },
  }
}

/** Drive the codec exactly as a host would: contracts port, budget, then `open`. */
async function openCodec(
  format: PreviewFormat,
  entry: ExplorerEntry,
  bytes: Uint8Array,
  maximumBytes: number,
): Promise<CodecSession> {
  const provider =
    format.createProvider === undefined || format.providerContract === undefined
      ? undefined
      : format.createProvider({ contract: format.providerContract })

  const codec = format.createCodec({
    budgets: budget(maximumBytes),
    diagnostics: {
      report() {
        // Codec diagnostics reach the UI through the descriptor, not this channel.
      },
    },
    contracts: {
      async resolve() {
        if (provider === undefined) throw new Error('no provider is configured for this codec')
        return {
          value: provider,
          async release() {
            // The provider lives as long as the codec that resolved it.
          },
        }
      },
      async resolveUnknown() {
        throw new Error('foreign contract is unavailable')
      },
    },
  }) as {
    open(input: unknown, intent: string, budget: unknown): Promise<CodecSession>
  }

  return codec.open(await inputFor(entry, bytes), 'full', budget(maximumBytes))
}

/**
 * Build the composition input a codec's `open` expects.
 *
 * A codec does not take bytes: it takes a binding topology it can ask for sources. `originKind:
 * 'single'` with one `content` binding is the shape for "one file on disk", which is exactly what
 * the explorer has.
 */
async function inputFor(entry: ExplorerEntry, bytes: Uint8Array): Promise<unknown> {
  const uri = `file:///${encodeURIComponent(entry.name)}`
  /*
   * The descriptor schema constrains revisions to a named scheme (`content-hash.<algo>:<value>`
   * among others), so an invented string fails validation. Hashing the bytes is also the honest
   * answer: it is what makes the revision change when the file changes.
   */
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)
  const revision = `content-hash.sha256:${[...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')}`
  const source = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision,
    size: BigInt(bytes.byteLength),
    async read(offset: bigint, length: number) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }

  const binding = {
    sourceKind: 'candidate',
    bindingId: 'content',
    role: 'content',
    ownership: 'owned',
    source: source.ref,
    revision,
  }

  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision,
      bindings: [{ bindingId: binding.bindingId, revision }],
      compositionFingerprint: `explorer:${uri}`,
    },
    bindingsFor() {
      return []
    },
    async openBinding() {
      return {
        value: source,
        async release() {
          return Promise.resolve()
        },
      }
    },
  }
}

/** Registered for hosts that want the raw bytes when no codec claims the file. */
export function fallbackHexStage(module: ViewerModule): PreviewStage {
  return { label: 'Hex', contract: 'common.view/byte-range-source', module }
}

export { setPart }
