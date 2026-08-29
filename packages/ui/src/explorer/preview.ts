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
import type {
  EditorModule,
  KnowledgeCatalog,
  OperationSession,
  PresentationPlan,
  ViewerModule,
} from '@modkitx-x3/sdk'

import type { ExplorerEntry, PreviewHandle, PreviewResolver } from './index.js'
import { builtinByteRangeSource, builtinTextSource, looksTextual } from './builtin.js'
import { setPart } from '../viewer/index.js'

/** A stage the host is willing to show, keyed by a data source, an operation, or both. */
export interface PreviewStage {
  /** Stable presentation slot id. Defaults to `contract` for legacy callers. */
  readonly id?: string
  readonly label: string
  readonly contract?: string
  /** Exact available operation required by an operation-backed stage such as `view.template`. */
  readonly operation?: string
  /**
   * The module to mount. An `editable` stage carries an `EditorModule` (four more mount arguments
   * than a viewer) — the union is here so a host can name one in TypeScript at all. It used to be
   * `ViewerModule` alone, which meant every first-party host that wired an editor did it through a
   * cast, and a generated untyped catalog was the only way to declare one honestly.
   */
  readonly module: ViewerModule | EditorModule
  /** Only offered when the descriptor carries this trait. */
  readonly trait?: string
  /**
   * Extra contracts to bind when the descriptor publishes them, beside `contract`.
   *
   * Required and optional sources are different things, and this is the optional half: a stage is
   * *selected* by `contract` alone, so listing a facet here never makes the stage ineligible, and a
   * viewer reads what turned up through `bindingFor` exactly as it reads its primary source. This
   * is what lets one generic viewer consume the optional model facets without a format branch and
   * without a codec that publishes none of them losing its stage.
   */
  readonly optionalContracts?: readonly string[]
  /**
   * This surface belongs to the embedding application rather than the generated contribution
   * catalog. A resolved host plan cannot name such a surface, so it remains available beside the
   * planned global stages when its own trait/contract gates pass.
   */
  readonly appLocal?: boolean
  /**
   * This module is an `EditorModule`, not a viewer: it also needs the four host-owned ports. The
   * host supplies them through `editorPorts`, and a stage marked editable is skipped when it does
   * not — a read-only host must not mount an editor that can never save.
   */
  readonly editable?: boolean
}

export interface CodecPreviewOptions {
  readonly stages: readonly PreviewStage[]
  /** Optional host-owned read-only help catalog shared by every mounted stage. */
  readonly knowledge?: KnowledgeCatalog
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
   * Ports for editable stages: propose/plan/prepare/authorize/commit.
   *
   * Absent means this host is read-only, and every `editable` stage is dropped rather than shown
   * without a save path. **Returning `undefined` for one entry means the same thing for that
   * entry alone**, which is what a browser needs: editability there is a property of the file (a
   * subject opened from a writable handle can be saved; the same codec's output from a drop or a
   * fetch cannot), not of the build. Without it a host had to build two previewers and choose
   * between them per open.
   *
   * Called once per opened subject, before any stage mounts, so one set of ports serves every view
   * the user switches between rather than a fresh set per mount.
   */
  editorPorts?(
    entry: ExplorerEntry,
    bytes: Uint8Array,
  ): undefined | Promise<EditorPorts | undefined> | EditorPorts
}

/** What an `editable` stage's `EditorModule` is mounted with, beside the viewer arguments. */
export interface EditorPorts {
  /** The `EditSession`: `propose`/`plan`. Named as `EditorModule.mount` names it. */
  readonly edit: unknown
  /** The `CommitCoordinator`: `prepare`/`commit`/`undo`/`redo`. */
  readonly commit: unknown
  readonly payloads: unknown
  readonly authorization: unknown
}

export interface PreviewSession {
  /** Host-resolved immutable stage plan. Hosts without presentation resolution may omit it. */
  readonly presentation?: PresentationPlan
  descriptor(): Promise<Record<string, unknown>>
  dataSource(contract: string, major: number): Promise<{ value: unknown }>
  /**
   * The subject's operations, when this host can invoke them.
   *
   * Optional because a fallback session has none. When present it is leased once per opened
   * subject and handed to every viewer mounted from it, which is what an operation toolbar, a
   * transport bar or a container stage reading an entry needs — before this, viewers were mounted
   * with no operations at all and a host had to smuggle a session in beside the previewer.
   */
  operations?(): Promise<OperationSession>
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

const publishedOperations = (descriptor: Record<string, unknown>): readonly string[] => {
  const operations = descriptor['operations']
  if (!Array.isArray(operations)) return []
  return operations
    .filter(item => (item as { state?: unknown }).state === 'available')
    .map(item => String((item as { id?: unknown }).id ?? ''))
}

const stageId = (stage: PreviewStage): string => {
  const id = stage.id ?? stage.contract ?? stage.operation
  if (id === undefined) throw new TypeError('preview stage must declare id, contract or operation')
  return id
}

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
      /*
       * One lease per opened subject, shared by every stage. A viewer that cannot invoke is a
       * viewer that cannot offer a toolbar, a transport bar or an entry's bytes; a host that
       * cannot invoke says so by not implementing the method, and the viewers see `undefined`
       * exactly as they did before.
       */
      const operations = await session.operations?.().catch(() => undefined)
      /*
       * Asked once, per entry, before the stage list is filtered. Per entry because in a browser
       * editability is a property of the file — a subject opened from a writable handle can be
       * saved, the same codec's output from a drop or a fetch cannot — and a host that could only
       * answer per build had to construct two previewers and pick between them at every open.
       */
      const ports = await options.editorPorts?.(entry, bytes)
      const traits = new Set(traitsOf(descriptor))
      const published = new Set(publishedContracts(descriptor))
      const availableOperations = new Set(publishedOperations(descriptor))

      const candidates = resolved ? options.stages : fallbackStages(options.fallback)
      const hasPresentationPlan = session.presentation !== undefined
      const plannedSlots = new Map(
        (session.presentation?.slots ?? []).map(slot => [slot.slotId as string, slot]),
      )
      /*
       * The host plan chooses the default and supplies authoritative bindings for its slots. The
       * picker still offers explicitly marked app-local surfaces (editors and metadata): those
       * have no global viewer contribution and therefore cannot appear in the generated plan.
       * Unplanned global surfaces stay excluded because the resolver may have rejected them on a
       * resource bound that this mounting layer cannot reproduce.
       */
      const usable = candidates.filter(
        stage =>
          (!hasPresentationPlan || plannedSlots.has(stageId(stage)) || stage.appLocal === true) &&
          (stage.contract === undefined || published.has(stage.contract)) &&
          (stage.operation === undefined ||
            (operations !== undefined && availableOperations.has(stage.operation))) &&
          (stage.trait === undefined || traits.has(stage.trait)) &&
          // An editable stage without ports could never save; offering it would be a lie.
          (stage.editable !== true || ports !== undefined),
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
        const slot =
          plannedSlots.get(stageId(stage)) ??
          ({
            slotId: `explorer:${stageId(stage)}`,
            kind: 'primary',
            contributionId: 'org.modkitx.ui/explorer',
            extensionId: 'org.modkitx.ui',
            priority: 100,
            bindings: [
              ...(stage.contract === undefined
                ? []
                : [{ bindingId: 'content', contract: stage.contract, major: 1 }]),
              // optional sources: bound when this descriptor actually publishes them, absent when it
              // does not, so the viewer's own `bindingFor` lookup is the whole availability check
              ...(stage.optionalContracts ?? [])
                .filter(contract => published.has(contract) && contract !== stage.contract)
                .map(contract => ({ bindingId: `facet:${contract}`, contract, major: 1 })),
            ],
          } as const)

        /*
         * An editable stage is an `EditorModule`: besides the viewer arguments it needs the four
         * host-owned ports, and it calls `edit.propose()` during mount. Passing them only for
         * `editable` stages keeps a plain viewer from ever seeing a write path.
         */
        const stagePorts = stage.editable === true ? ports : undefined

        const mounted = await stage.module.mount({
          container,
          descriptor: descriptor as never,
          slot: slot as never,
          ...(stagePorts === undefined
            ? {}
            : {
                edit: stagePorts.edit as never,
                commit: stagePorts.commit as never,
                payloads: stagePorts.payloads as never,
                authorization: stagePorts.authorization as never,
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
          operations: operations as never,
          ...(options.knowledge === undefined ? {} : { knowledge: options.knowledge }),
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
  return { id: 'hex', label: 'Hex', contract: 'common.view/byte-range-source', module }
}

export { setPart }

/** Stage list for a file no codec claimed: whatever fallback viewers the host supplied. */
function fallbackStages(fallback: CodecPreviewOptions['fallback']): readonly PreviewStage[] {
  const stages: PreviewStage[] = []
  // ids, because `stageId` falls back to the contract and a picker then offers a file no codec
  // claimed a view named `common.view/text-data-source`
  if (fallback?.text !== undefined) {
    stages.push({
      id: 'text',
      label: 'Text',
      contract: 'common.view/text-data-source',
      module: fallback.text,
    })
  }
  if (fallback?.hex !== undefined) {
    stages.push({
      id: 'hex',
      label: 'Hex',
      contract: 'common.view/byte-range-source',
      module: fallback.hex,
    })
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
