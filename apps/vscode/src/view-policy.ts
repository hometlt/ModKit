/**
 * The VS Code application's view policy — data and rules only, no DOM and no viewer imports.
 *
 * The same two ideas the Electron host's `view-policy.ts` states, in the same shape, because a
 * third stage-policy shape would be a third thing to keep true:
 *
 *  - `STAGE_ORDER` fixes the order every stage appears in a tab's view picker. It is preference:
 *    `createCodecPreview` mounts the first applicable stage, so the richest rendering of a subject
 *    comes up first and hex stays near the end as the thing that always works.
 *  - `applicableStages` is the predicate `createCodecPreview` applies, evaluated ahead of the mount
 *    so the host can log and test what a subject offers. One rule is added to Electron's, and it is
 *    the PWA's: an `editable` stage is offered only when the host supplied editor ports for *that*
 *    subject. In this host the ports come from the subject RPC's editing arm, and the arm is absent
 *    for a subject the extension host cannot write — a container, a bundle, a file outside the
 *    granted roots. An editor that could never save would be a lie.
 *
 * Descriptors arrive over the RPC as plain JSON, so every reader here takes
 * `Record<string, unknown>` rather than `AnyDescriptor`; that is also what keeps this module
 * runnable in Node with no `vscode`, no DOM and no `@modkit/ui`.
 */

/** Slot ids in the order the picker offers them. Anything not listed here is not offered. */
export const STAGE_ORDER: readonly string[] = Object.freeze([
  'image',
  'vector',
  'world',
  'map-layers',
  'model',
  'audio',
  'video',
  'playback',
  'archive',
  'template',
  'localization',
  'card',
  'calculations',
  'table',
  'tree',
  'relations',
  'text',
  'virtual-text',
  'text-editor',
  'edit',
  'metadata',
  'hex',
  'hex-editor',
])

/**
 * Stages that render the subject itself; one of these outranks the card as the first view.
 *
 * `archive` belongs here for the same reason the picture does: a container's own view is its entry
 * list, and a person who opened one came for the entries. Without it an archive opened on its card
 * — a page of facts about a file whose contents were one click away, and the regression that made
 * MK2's archive browser look lost.
 */
export const MEDIA_STAGE_IDS: readonly string[] = Object.freeze([
  'image',
  'vector',
  'world',
  'model',
  'audio',
  'video',
  'playback',
  'archive',
])

/** The stage ids that only ever appear when this host can write the subject behind the tab. */
export const EDITABLE_STAGE_IDS: readonly string[] = Object.freeze([
  'text-editor',
  'edit',
  'hex-editor',
])

/** The minimum a policy rule needs to know about a stage; `PreviewStage` is a superset. */
export interface StageFacts {
  readonly id?: string
  readonly label: string
  readonly contract?: string
  readonly operation?: string
  readonly trait?: string
  readonly editable?: boolean
}

export const stageIdOf = (stage: StageFacts): string =>
  stage.id ?? stage.contract ?? stage.operation ?? 'invalid-stage'

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

export interface DescriptorOperation {
  readonly id: string
  readonly handlerId: string
  readonly mutatesSource: boolean
  readonly state: string
}

/** Operation facts a webview policy may inspect without trusting the RPC object's shape. */
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
 * Put the catalog in policy order.
 *
 * A stage whose id is not in `STAGE_ORDER` is a policy gap, not a runtime surprise: it throws here
 * rather than silently dropping out of every picker in the product.
 */
export function orderStages<Stage extends StageFacts>(stages: readonly Stage[]): readonly Stage[] {
  const seen = new Set<string>()
  for (const stage of stages) {
    const id = stageIdOf(stage)
    if (!STAGE_ORDER.includes(id)) throw new TypeError(`stage ${id} is not ranked in STAGE_ORDER`)
    if (seen.has(id)) throw new TypeError(`duplicate stage id: ${id}`)
    seen.add(id)
  }
  return Object.freeze(
    [...stages].sort(
      (left, right) => STAGE_ORDER.indexOf(stageIdOf(left)) - STAGE_ORDER.indexOf(stageIdOf(right)),
    ),
  )
}

/**
 * The stages this descriptor can actually show: published contract, trait when the stage names
 * one, and — for an editable stage — editor ports for this subject.
 */
export function applicableStages<Stage extends StageFacts>(
  stages: readonly Stage[],
  descriptor: Record<string, unknown>,
  options: { readonly editorPorts?: boolean } = {},
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
        (stage.trait === undefined || traits.has(stage.trait)) &&
        (stage.editable !== true || options.editorPorts === true),
    ),
  )
}

/**
 * Which view to show first.
 *
 * The extension host resolves the common model/world plan before the snapshot crosses the RPC.
 * Other subjects still use the first stage in policy order until the wider document catalog is
 * migrated. In either case this consumer only honours a slot that survived applicability.
 */
export function preferredStage(
  applicable: readonly string[],
  planActive: string | undefined,
): string | undefined {
  /*
   * A media subject opens on its render view, not on its card.
   *
   * The card is a good second view of a texture or a model — it is not the first one: what a person
   * opened a `.dds` for is the picture, with the facts beside it in the sidebar. The card stays in
   * the picker, and remains the plan's choice for subjects that have no render of their own.
   */
  const media = applicable.find(id => MEDIA_STAGE_IDS.includes(id))
  // A map package or model may also publish a thumbnail or archive entries. The subject's
  // render area wins over those defaults; explicit inspector/hex choices remain available.
  if (planActive === undefined || ['card', 'archive', 'image'].includes(planActive)) {
    const scene = ['world', 'model'].find(id => applicable.includes(id))
    if (scene !== undefined) return scene
  }
  if (planActive === 'card' && media !== undefined) return media
  if (planActive !== undefined && applicable.includes(planActive)) return planActive
  return applicable[0]
}

/** One line per opened file: what the tests assert on and what the output channel prints. */
export function openedLine(name: string, views: readonly string[], editable: boolean): string {
  return `opened ${name} -> views [${views.join(', ')}] editable=${String(editable)}`
}
