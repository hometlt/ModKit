import { canonicalJsonStringify, type Diagnostic } from '@modkit/core'
import type {
  AssetEditPlan,
  AssetInput,
  AssetRevision,
  AssetSourceRef,
  CommitGuarantee,
  FidelityClaim,
  ResolvedAssetInputBinding,
  SourceEdit,
} from '@modkit/sdk'

type EditWithoutTarget<T> = T extends SourceEdit ? Omit<T, 'targetId' | 'source'> : never

export interface EditPlanFromInputOptions {
  readonly planId: string
  readonly edits: readonly (EditWithoutTarget<SourceEdit> & {
    readonly targetId?: string
    readonly source?: AssetSourceRef
  })[]
  readonly fidelity: FidelityClaim
  readonly guarantee?: CommitGuarantee
  readonly diagnostics?: readonly Diagnostic[]
}

// ---------------------------------------------------------------------------------------------
// ADR-HOST-002 — editing helpers

/**
 * The subject's 13D revision vector, derived from the opened input with the host's own rule
 * (subject-open: canonical `{topology, bindingId, source, revision}`), so a plan built here and
 * the host's expectation agree byte for byte. Single-source subjects only.
 */
export function assetRevisionFromInput(input: AssetInput): AssetRevision {
  if (input.originKind !== 'single' || input.revisions.topology !== 'single') {
    throw new TypeError('assetRevisionFromInput: single-source subjects only')
  }
  const [binding] = input.bindings
  if (binding === undefined) throw new TypeError('assetRevisionFromInput: no binding')
  const revision = binding.revision
  return Object.freeze<AssetRevision>({
    bindings: Object.freeze({ [binding.bindingId]: revision }),
    compositionFingerprint: canonicalJsonStringify({
      topology: 'single',
      bindingId: binding.bindingId,
      source: { id: binding.source.id, uri: binding.source.uri },
      revision,
    }),
  })
}

/** Path A: the plan a mutating codec operation returns as `{ kind: 'edit-plan', plan }`. */
export function editPlanFromInput(
  input: AssetInput,
  { planId, edits, fidelity, guarantee = 'atomic', diagnostics = [] }: EditPlanFromInputOptions,
): AssetEditPlan {
  const revision = assetRevisionFromInput(input)
  const [binding] = (input as Extract<AssetInput, { originKind: 'single' }>).bindings as readonly [
    ResolvedAssetInputBinding,
    ...ResolvedAssetInputBinding[],
  ]
  const target = Object.freeze({
    targetId: binding.bindingId,
    subjectUri: binding.source.uri,
    ownerSource: Object.freeze({ ...binding.source }),
    semanticPath: Object.freeze([]),
    expectedRevision: revision,
  })
  return Object.freeze<AssetEditPlan>({
    planId,
    targets: Object.freeze([target]),
    edits: Object.freeze(
      edits.map(edit =>
        Object.freeze({
          ...edit,
          targetId: edit.targetId ?? binding.bindingId,
          source: edit.source ?? target.ownerSource,
        }),
      ),
    ),
    semantics: Object.freeze({ mutationMode: 'mutate', minimumGuarantee: guarantee }),
    fidelity,
    diagnostics: Object.freeze([...diagnostics]),
  })
}

/** Path A for one explicitly selected owned binding of a physical subject. All bundle members
 * remain revision guards, including companions; only the selected owner receives edits.
 * Capture this plan before asynchronous conversion or prospective byte computation. */
export function editPlanFromBinding(
  input: AssetInput,
  bindingId: string,
  options: EditPlanFromInputOptions,
): AssetEditPlan {
  return editPlanFromBindings(input, [bindingId], options)
}

/** Path A over several owned bindings of one physical subject, as one atomic plan: a string key
 * renamed in every locale's file. Each edit names its owner by `targetId` (it may omit it only when
 * one owner is selected); every bundle member stays a revision guard. */
export function editPlanFromBindings(
  input: AssetInput,
  bindingIds: readonly string[],
  { planId, edits, fidelity, guarantee = 'atomic', diagnostics = [] }: EditPlanFromInputOptions,
): AssetEditPlan {
  if (input.originKind !== 'single' && input.originKind !== 'bundle')
    throw new TypeError('editPlanFromBinding requires a physical subject')
  const primary = input.bindings.find(binding => binding.bindingId === input.primaryBindingId)
  const owners = bindingIds.map(bindingId =>
    input.bindings.find(binding => binding.bindingId === bindingId),
  )
  if (
    primary === undefined ||
    owners.length === 0 ||
    new Set(bindingIds).size !== bindingIds.length ||
    owners.some(owner => owner === undefined || owner.ownership !== 'owned')
  )
    throw new TypeError('editPlanFromBinding requires an exact owned binding')
  const selected = owners as ResolvedAssetInputBinding[]
  const ids = new Set<string>(),
    sourceIds = new Set<string>(),
    uris = new Set<string>()
  const targets = input.bindings.map(binding => {
    if (
      ids.has(binding.bindingId) ||
      sourceIds.has(binding.source.id) ||
      uris.has(binding.source.uri)
    )
      throw new TypeError('editPlanFromBinding refuses aliased bindings')
    ids.add(binding.bindingId)
    sourceIds.add(binding.source.id)
    uris.add(binding.source.uri)
    return Object.freeze({
      targetId: binding.bindingId,
      subjectUri: primary.source.uri,
      ownerSource: Object.freeze({ ...binding.source }),
      semanticPath: Object.freeze([]),
      expectedRevision: Object.freeze({
        bindings: Object.freeze({ [binding.bindingId]: binding.revision }),
        compositionFingerprint: canonicalJsonStringify({
          topology: 'single',
          bindingId: binding.bindingId,
          source: { id: binding.source.id, uri: binding.source.uri },
          revision: binding.revision,
        }),
      }),
    })
  })
  const prepared = edits.map(edit => {
    const owner =
      edit.targetId === undefined
        ? selected.length === 1
          ? selected[0]
          : undefined
        : selected.find(binding => binding.bindingId === edit.targetId)
    if (
      owner === undefined ||
      (edit.source !== undefined &&
        canonicalJsonStringify(edit.source) !== canonicalJsonStringify(owner.source))
    )
      throw new TypeError('editPlanFromBinding edit belongs to a different owner')
    return Object.freeze({
      ...edit,
      targetId: owner.bindingId,
      source: Object.freeze({ ...owner.source }),
    })
  })
  return Object.freeze({
    planId,
    targets: Object.freeze(targets),
    edits: Object.freeze(prepared),
    semantics: Object.freeze({ mutationMode: 'mutate', minimumGuarantee: guarantee }),
    fidelity,
    diagnostics: Object.freeze([...diagnostics]),
  })
}

/** A byte-range `replace` edit (`length: 0` inserts) with an inline payload. */
export function replaceBytes(
  offset: number | bigint,
  length: number | bigint,
  bytes: Uint8Array,
  label?: string,
): Omit<Extract<SourceEdit, { operation: 'replace' }>, 'targetId' | 'source'> {
  return Object.freeze<Omit<Extract<SourceEdit, { operation: 'replace' }>, 'targetId' | 'source'>>({
    operation: 'replace',
    range: Object.freeze({ kind: 'bytes', offset: BigInt(offset), length: BigInt(length) }),
    payload: Object.freeze({ kind: 'inline', bytes }),
    ...(label === undefined ? {} : { label }),
  })
}
