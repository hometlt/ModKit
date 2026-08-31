/**
 * The Electron application's view policy — data only, no DOM, no viewer imports.
 *
 * Two tables and the rules that read them:
 *
 *  - `STAGE_ORDER` fixes the order every stage appears in the tab's view picker. It is the app's
 *    ranking, deliberately the descending contribution priority the main process's presentation
 *    resolver already sorts by, so the stage the host plan makes active is normally the first one
 *    this order offers and no second mount is needed to agree with it.
 *  - `PANEL_POLICY` names the descriptor-driven surfaces the inspector dock mounts beside the
 *    stage. They are not stages: they consume the descriptor (and, for the transport bar, one data
 *    source plus the operation session), so they belong to the host's chrome, not to the tab.
 *
 * Both are *selection* policy: which independently authored viewer backs which slot. Nothing here
 * discovers a viewer, and adding a contribution manifest never adds a slot by itself.
 *
 * Kept free of `@modkit/ui` and of the DOM so the rules are unit-testable in Node; the module
 * bindings live in `./stages.ts` and `./inspector.ts`.
 */
import { CONTAINER_EXTRACT_OPERATION_ID } from '@modkit/core'

/** Slot ids in the order the picker offers them. Anything not listed here is not offered. */
export const STAGE_ORDER: readonly string[] = Object.freeze([
  'code',
  'video',
  'image',
  'image-edit',
  'audio',
  'world',
  'model',
  'vector',
  'archive',
  'template',
  'card',
  'calculations',
  'table',
  'tree',
  'relations',
  'text',
  'virtual-text',
  'hex',
])

/**
 * Stages the application composes itself, because `@modkit/ui` ships the component but no
 * viewer contribution the generated catalog could name (`createImageEditor`), or ships a
 * contribution whose kind is not `stage` (`modkit.ui/namespace-tree` is a `tree`).
 */
export interface AppStagePolicy {
  readonly id: string
  readonly label: string
  readonly contract: string
}

export const APP_STAGE_POLICY: readonly AppStagePolicy[] = Object.freeze([
  Object.freeze({
    id: 'archive',
    label: 'Archive',
    contract: 'common.view/namespace-entry-source',
  }),
  Object.freeze({
    id: 'image-edit',
    label: 'Image (edit)',
    contract: 'common.view/raster-image-source',
  }),
])

/** Inspector surfaces. `contract` present means the panel also needs that data source published. */
export interface PanelPolicy {
  readonly id: string
  readonly label: string
  readonly contract?: string
  /**
   * `editing` means the panel is offered only for a subject this host will write — the tab holds
   * an S14 editing arm *and* the subject declares a mutating operation this app can drive. The
   * descriptor alone cannot decide it: a codec declares its operations as available whatever grant
   * the subject was opened under, so the answer comes from the shell and is passed in.
   */
  readonly requires?: 'editing'
}

export const PANEL_POLICY: readonly PanelPolicy[] = Object.freeze([
  Object.freeze({ id: 'operations', label: 'Operations' }),
  Object.freeze({ id: 'edit', label: 'Edit', requires: 'editing' as const }),
  Object.freeze({
    id: 'transport',
    label: 'Transport',
    contract: 'common.view/transport-source',
  }),
  Object.freeze({ id: 'metadata', label: 'Metadata' }),
  Object.freeze({ id: 'properties', label: 'Properties' }),
  Object.freeze({ id: 'diagnostics', label: 'Diagnostics' }),
])

/** The minimum a policy rule needs to know about a stage; `PreviewStage` is a superset. */
export interface StageFacts {
  readonly id?: string
  readonly label: string
  readonly contract?: string
  readonly operation?: string
  readonly trait?: string
}

const stageId = (stage: StageFacts): string =>
  stage.id ?? stage.contract ?? stage.operation ?? 'invalid-stage'

/**
 * Merge the generated catalog with the application's own stages and put the result in policy
 * order. A stage whose id is not in `STAGE_ORDER` is a policy gap, not a runtime surprise: it
 * throws here rather than silently dropping out of every picker.
 */
export function orderStages<Stage extends StageFacts>(stages: readonly Stage[]): readonly Stage[] {
  for (const stage of stages) {
    if (!STAGE_ORDER.includes(stageId(stage))) {
      throw new TypeError(`stage ${stageId(stage)} is not ranked in STAGE_ORDER`)
    }
  }
  const seen = new Set<string>()
  for (const stage of stages) {
    if (seen.has(stageId(stage))) throw new TypeError(`duplicate stage id: ${stageId(stage)}`)
    seen.add(stageId(stage))
  }
  return Object.freeze(
    [...stages].sort(
      (left, right) => STAGE_ORDER.indexOf(stageId(left)) - STAGE_ORDER.indexOf(stageId(right)),
    ),
  )
}

/** A stage plus the two facts the read-only rule needs: its module and whether it edits. */
export interface StageBinding extends StageFacts {
  readonly module: unknown
  readonly editable?: boolean
}

/**
 * The stage list for a subject this host cannot write.
 *
 * Not "the editable list minus the editors": the generated catalog ships a read-only counterpart
 * per slot — the plain viewer over the same contract — so a read-only subject still shows its text
 * and its bytes. The one case that must drop is a slot whose read-only entry is *the same module*
 * as its editable one: the generator falls back to the editable module when a contribution
 * declares no read-only substitute, and mounting an `EditorModule` with no ports gives a Save
 * control that throws. Identity comparison, not a name list, so a fixed contribution restores the
 * slot with no change here.
 */
export function readOnlyStages<Stage extends StageBinding>(
  editable: readonly Stage[],
  readOnly: readonly Stage[],
): readonly Stage[] {
  const byId = new Map(editable.map(stage => [stageId(stage), stage]))
  return Object.freeze(
    readOnly.filter(stage => {
      const counterpart = byId.get(stageId(stage))
      return counterpart?.editable !== true || counterpart.module !== stage.module
    }),
  )
}

/** Data sources the descriptor publishes, as plain contract names. */
export function publishedContracts(descriptor: Record<string, unknown>): readonly string[] {
  const sources = descriptor['dataSources']
  if (!Array.isArray(sources)) return []
  return sources.map(item => String((item as { contract?: unknown }).contract ?? ''))
}

/** Trait ids the descriptor reports as observed. */
export function descriptorTraits(descriptor: Record<string, unknown>): readonly string[] {
  const traits = descriptor['traits']
  if (!Array.isArray(traits)) return []
  return traits.map(item => String((item as { id?: unknown }).id ?? ''))
}

interface DescriptorOperation {
  readonly id: string
  readonly handlerId: string
  readonly mutatesSource: boolean
  readonly state: string
}

export function descriptorOperations(
  descriptor: Record<string, unknown>,
): readonly DescriptorOperation[] {
  const operations = descriptor['operations']
  if (!Array.isArray(operations)) return []
  return operations.map(item => {
    const value = item as Record<string, unknown>
    return {
      id: String(value['id'] ?? ''),
      handlerId: String(value['handlerId'] ?? ''),
      mutatesSource: value['mutatesSource'] === true,
      state: String(value['state'] ?? ''),
    }
  })
}

/**
 * The same rule `createCodecPreview` applies, evaluated ahead of the mount so the host can log and
 * test what a subject offers: the stage's data source must be published, and its trait — when the
 * stage declares one — observed.
 */
export function applicableStages<Stage extends StageFacts>(
  stages: readonly Stage[],
  descriptor: Record<string, unknown>,
): readonly Stage[] {
  const published = new Set(publishedContracts(descriptor))
  const operations = new Set(
    descriptorOperations(descriptor)
      .filter(operation => operation.state === 'available')
      .map(operation => operation.id),
  )
  const traits = new Set(descriptorTraits(descriptor))
  return Object.freeze(
    stages.filter(
      stage =>
        (stage.contract === undefined || published.has(stage.contract)) &&
        (stage.operation === undefined || operations.has(stage.operation)) &&
        (stage.trait === undefined || traits.has(stage.trait)),
    ),
  )
}

/**
 * Inspector surfaces this subject supports. Descriptor-only panels are always applicable; a panel
 * that `requires: 'editing'` is offered only when the shell says this subject is editable here.
 */
export function applicablePanels(
  descriptor: Record<string, unknown>,
  options: { readonly editing?: boolean } = {},
): readonly PanelPolicy[] {
  const published = new Set(publishedContracts(descriptor))
  return Object.freeze(
    PANEL_POLICY.filter(
      panel =>
        (panel.contract === undefined || published.has(panel.contract)) &&
        (panel.requires !== 'editing' || options.editing === true),
    ),
  )
}

/**
 * Operations that can hand back the bytes of one contained entry.
 *
 * `container.extract` is the platform contract: an opaque namespace `{ entryId }` goes in and
 * extracted bytes come out. Exact matching prevents a codec-local lookalike from becoming a read
 * capability; mutating and unavailable declarations are refused too.
 */
export function entryPreviewOperations(descriptor: Record<string, unknown>): readonly string[] {
  return Object.freeze(
    descriptorOperations(descriptor)
      .filter(
        operation =>
          operation.state === 'available' &&
          !operation.mutatesSource &&
          operation.id === CONTAINER_EXTRACT_OPERATION_ID,
      )
      .map(operation => operation.id),
  )
}

/**
 * Which view to show first.
 *
 * The host resolved a presentation plan against the same catalog, so its `activeStage` is the
 * default whenever it survived applicability; otherwise the first stage in policy order wins.
 */
export function preferredStage(
  applicable: readonly string[],
  planActive: string | undefined,
): string | undefined {
  if (planActive !== undefined && applicable.includes(planActive)) return planActive
  return applicable[0]
}

/** One line per opened file, the shape the self-test prints and the tests assert on. */
export function selfTestLine(name: string, views: readonly string[], mounted: boolean): string {
  return `selftest: ${name} -> views [${views.join(', ')}] mounted=${String(mounted)}`
}

/** The selected codec identity, emitted separately so a live run proves routing as well as UI. */
export function selfTestCodecLine(name: string, descriptor: Record<string, unknown>): string {
  const identity = descriptor['identity']
  const codecId =
    typeof identity === 'object' &&
    identity !== null &&
    'codecId' in identity &&
    typeof identity.codecId === 'string'
      ? identity.codecId
      : 'none'
  return `selftest: ${name} codec=${codecId}`
}
