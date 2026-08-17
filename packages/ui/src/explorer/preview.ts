/**
 * Host-session-driven preview resolver.
 *
 * Bytes in, mounted viewer out. The explorer knows nothing about codecs: a host opens the subject
 * and returns a lazy session, while this module only mounts viewers over its published sources.
 *
 * Resolution is trait-driven, not extension-driven: what the host session *publishes* decides
 * which stages appear. A codec that grows a new data source gets a new tab here without this file
 * changing.
 */
import type { PresentationPlan, ViewerModule } from '@modkitx-x3/sdk'

import type { ExplorerEntry, PreviewHandle, PreviewResolver } from './index.js'
import { builtinByteRangeSource, builtinTextSource, looksTextual } from './builtin.js'
import { setPart } from '../viewer/index.js'

/** A stage the host is willing to show, keyed by the data source it needs. */
export interface PreviewStage {
  /** Stable presentation slot id. Defaults to `contract` for legacy callers. */
  readonly id?: string
  readonly label: string
  readonly contract: string
  readonly module: ViewerModule
  /** Only offered when the descriptor carries this trait. */
  readonly trait?: string
  /**
   * This module is an `EditorModule`, not a viewer: it also needs the four host-owned ports. The
   * host supplies them through `editorPorts`, and a stage marked editable is skipped when it does
   * not — a read-only host must not mount an editor that can never save.
   */
  readonly editable?: boolean
}

export interface CodecPreviewOptions {
  readonly stages: readonly PreviewStage[]
  /**
   * Extensions exposed by an external host-owned opener. These are registration hints only; the
   * opener still detects from inventory and bytes, and may reject a matching suffix.
   */
  readonly supported?: readonly string[]
  /**
   * Host/session boundary for Electron, VS Code, or a worker broker. The previewer only mounts
   * viewers over the returned lazy session. Returning `undefined`, or omitting the opener in a
   * fallback-only host, selects the explicit text/hex fallback.
   */
  readonly openSession?: (
    entry: ExplorerEntry,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ) => Promise<PreviewSession | undefined>
  /**
   * Viewers for the built-in fallback, used when no codec claims the file. Without these a file
   * with no codec shows nothing; with them it always shows at least its bytes.
   */
  readonly fallback?: {
    readonly text?: ViewerModule
    readonly hex?: ViewerModule
  }
  /**
   * Ports for editable stages: propose/plan/prepare/authorize/commit. Absent means this host is
   * read-only, and every `editable` stage is dropped rather than shown without a save path.
   */
  editorPorts?(
    entry: ExplorerEntry,
    bytes: Uint8Array,
  ): {
    readonly session: unknown
    readonly commit: unknown
    readonly payloads: unknown
    readonly authorization: unknown
  }
}

export interface PreviewSession {
  /** Host-resolved immutable stage plan. Hosts without presentation resolution may omit it. */
  readonly presentation?: PresentationPlan
  descriptor(): Promise<Record<string, unknown>>
  dataSource(contract: string, major: number): Promise<{ value: unknown }>
  dispose(): Promise<void>
}

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

const stageId = (stage: PreviewStage): string => stage.id ?? stage.contract

export function createCodecPreview(options: CodecPreviewOptions): PreviewResolver {
  const supported = [
    ...new Set(
      (options.supported ?? []).map(extension => extension.replace(/^\./u, '').toLowerCase()),
    ),
  ]

  return {
    supported,

    async open(container, entry, bytes, signal): Promise<PreviewHandle | undefined> {
      const externallyOpened = await options.openSession?.(entry, bytes, signal)
      const resolved = externallyOpened !== undefined
      // No selected host session: fall back to raw bytes rather than showing nothing.
      const session = externallyOpened ?? builtinSession(bytes, options.fallback)

      const descriptor = await session.descriptor()
      const traits = new Set(traitsOf(descriptor))
      const published = new Set(publishedContracts(descriptor))

      const candidates = resolved ? options.stages : fallbackStages(options.fallback)
      const planned =
        session.presentation === undefined
          ? candidates
          : session.presentation.slots.flatMap(slot => {
              if (slot.kind !== 'stage') return []
              const stage = candidates.find(candidate => stageId(candidate) === slot.slotId)
              return stage === undefined ? [] : [stage]
            })
      const usable = planned.filter(
        stage =>
          published.has(stage.contract) &&
          (stage.trait === undefined || traits.has(stage.trait)) &&
          // An editable stage without ports could never save; offering it would be a lie.
          (stage.editable !== true || options.editorPorts !== undefined),
      )
      if (usable.length === 0) {
        await session.dispose()
        return undefined
      }

      let active: { unmount(): Promise<void> | void } | undefined
      const plannedActive = session.presentation?.activeStage
      let activeId =
        plannedActive !== undefined && usable.some(stage => stageId(stage) === plannedActive)
          ? plannedActive
          : usable[0] === undefined
            ? ''
            : stageId(usable[0])

      const show = async (viewId: string): Promise<void> => {
        const stage = usable.find(item => stageId(item) === viewId)
        if (stage === undefined) throw new Error(`unknown view: ${viewId}`)
        await active?.unmount()
        active = undefined
        container.replaceChildren()
        activeId = viewId

        /*
         * A viewer resolves its data through `bindingFor(slot, contract)`, so the slot has to carry
         * a real binding for this stage's contract — passing a bare name leaves `slot.bindings`
         * undefined and the mount fails inside the viewer.
         */
        const slot = {
          slotId: `explorer:${stageId(stage)}`,
          kind: 'primary',
          contributionId: 'org.modkitx.ui/explorer',
          extensionId: 'org.modkitx.ui',
          priority: 100,
          bindings: [{ bindingId: 'content', contract: stage.contract, major: 1 }],
        }

        /*
         * An editable stage is an `EditorModule`: besides the viewer arguments it needs the four
         * host-owned ports, and it calls `edit.propose()` during mount. Passing them only for
         * `editable` stages keeps a plain viewer from ever seeing a write path.
         */
        const ports = stage.editable === true ? options.editorPorts?.(entry, bytes) : undefined

        const mounted = await stage.module.mount({
          container,
          descriptor: descriptor as never,
          slot: slot as never,
          ...(ports === undefined
            ? {}
            : {
                edit: ports.session as never,
                commit: ports.commit as never,
                payloads: ports.payloads as never,
                authorization: ports.authorization as never,
              }),
          sources: {
            async get(binding: { contract: string; major?: number }) {
              const lease = await session.dataSource(binding.contract, binding.major ?? 1)
              return {
                value: lease.value,
                async release() {
                  // The codec session owns the source; releasing here would be premature.
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
        active = mounted
        activeId = viewId
      }

      await show(activeId)

      return {
        views: usable.map(stage => ({ id: stageId(stage), label: stage.label })),
        get activeView() {
          return activeId
        },
        show,
        async unmount() {
          await active?.unmount()
          await session.dispose()
          container.replaceChildren()
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

/** Stage list for a file no codec claimed: whatever fallback viewers the host supplied. */
function fallbackStages(fallback: CodecPreviewOptions['fallback']): readonly PreviewStage[] {
  const stages: PreviewStage[] = []
  if (fallback?.text !== undefined) {
    stages.push({ label: 'Text', contract: 'common.view/text-data-source', module: fallback.text })
  }
  if (fallback?.hex !== undefined) {
    stages.push({ label: 'Hex', contract: 'common.view/byte-range-source', module: fallback.hex })
  }
  return stages
}

/**
 * A session that publishes the built-in sources without involving a codec.
 *
 * It answers the same three questions a codec session does, so nothing downstream needs to know
 * whether structure came from a codec or from this.
 */
function builtinSession(
  bytes: Uint8Array,
  fallback: CodecPreviewOptions['fallback'],
): PreviewSession {
  const textual = fallback?.text !== undefined && looksTextual(bytes)
  const sources: Record<string, unknown> = {}
  if (textual) sources['common.view/text-data-source'] = builtinTextSource(bytes)
  if (fallback?.hex !== undefined) {
    sources['common.view/byte-range-source'] = builtinByteRangeSource(bytes)
  }

  return {
    async descriptor() {
      return {
        subjectUri: 'memory://explorer/builtin',
        revision: `content-hash.sha256:builtin-${bytes.length}`,
        operations: [],
        diagnostics: [],
        // `content.text` only when the bytes really decode: a binary must not claim to be text.
        traits: textual ? [{ id: 'content.text' }] : [],
        dataSources: Object.keys(sources).map(contract => ({ contract })),
      }
    },
    async dataSource(contract: string) {
      const value = sources[contract]
      if (value === undefined) throw new Error(`built-in preview has no ${contract}`)
      return { value }
    },
    async dispose() {
      // Nothing to release: the sources close over an in-memory buffer.
    },
  }
}
