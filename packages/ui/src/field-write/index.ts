/**
 * Inline, schema-driven field writing shared by the tree, the table and the metadata panel.
 *
 * There is exactly one write path in MK3 and this module does not add a second one. A data source
 * that wants a value edited publishes `editable.write` naming an operation the codec already
 * declares; this module resolves that operation on the descriptor, mounts the control the field's
 * `FieldType` calls for, and invokes the operation with a `FieldWriteRequest`. The codec owns
 * validation and the host owns permission — neither is re-implemented here.
 *
 * Refusal is never silent. A field that cannot be written renders as a read-only value carrying the
 * reason, and a rejected invocation prints what the host said rather than reverting the display and
 * leaving the reader to guess.
 */
import type {
  AnyDescriptor,
  AssetEditPlan,
  CommitCoordinator,
  EditAuthorizationPort,
  FieldEditable,
  FieldType,
  FieldWriteRequest,
  JsonValue,
  OperationSession,
  SubjectCandidateProvider,
  SubjectEditTargetResult,
} from '@modkit/sdk'
import {
  invokeRefusalMessage,
  isRejected,
  mountFieldEditor,
  type EditOperationField,
  type FieldEditorRegistry,
} from '../field-editor/index.js'
import { element, setViewerText } from '../viewer/index.js'

/** Why a value is shown but cannot be edited. `undefined` means it can. */
export type FieldWriteRefusal = string | undefined

export interface FieldWriteTarget {
  /** Data-source scope the codec keys its writes by: a metadata group id, `tree` or `table`. */
  readonly groupId: string
  readonly key: string
  readonly path?: readonly string[]
}

export interface FieldWriteRoute {
  readonly operations: OperationSession
  /** Where an operation's edit plan goes. Absent means this surface cannot finish a write. */
  readonly commit?: CommitCoordinator
  readonly authorization?: EditAuthorizationPort
}

/** Stable, bounded text for the host-selected destination of one semantic field. */
export function fieldEditTargetText(target: SubjectEditTargetResult): string {
  if (target.state === 'resolved') return target.destination.label
  if (target.state === 'selection-required') {
    const choices = target.candidates.map(item => `${item.rootId} → ${item.path}`).join('; ')
    return choices.length === 0 ? target.reason : `${target.reason}: ${choices}`
  }
  return target.reason
}

/** Draw the same destination state in cards, tables and trees without format-specific routing. */
export function mountFieldEditTarget(
  container: HTMLElement,
  target: SubjectEditTargetResult | undefined,
): HTMLElement | undefined {
  if (target === undefined) return undefined
  const node = element(container, 'small', { part: 'field.target' })
  node.dataset['editTargetState'] = target.state
  node.setAttribute('role', 'status')
  setViewerText(node, fieldEditTargetText(target), 2048)
  return node
}

export interface InlineFieldOptions {
  readonly label: string
  readonly type: FieldType
  readonly value: JsonValue
  readonly unit?: string
  readonly editable?: FieldEditable
  readonly target: FieldWriteTarget
  readonly descriptor: AnyDescriptor
  readonly operations: OperationSession
  readonly commit?: CommitCoordinator
  readonly authorization?: EditAuthorizationPort
  readonly signal: AbortSignal
  readonly fieldEditors?: FieldEditorRegistry
  readonly candidates?: SubjectCandidateProvider
  /** Called with the committed value after the codec accepted a write. */
  readonly onWritten?: (value: JsonValue) => void | Promise<void>
}

/**
 * Decide whether this field is writable right now, and say why when it is not.
 *
 * Three separate facts have to line up, and conflating them produces the failure this project keeps
 * hitting: a control that looks editable, accepts a value and drops it. The declaration must exist,
 * it must name an operation, and that operation must be available on *this* descriptor.
 */
export function fieldWriteRefusal(
  descriptor: AnyDescriptor,
  editable: FieldEditable | undefined,
  route?: Pick<FieldWriteRoute, 'commit' | 'authorization'>,
): FieldWriteRefusal {
  /*
   * The commit route is checked first and separately from the codec's declaration, because the two
   * failures are not the same failure. A codec that offers no write is telling the reader something
   * about the format; a surface mounted without a commit route is telling them something about this
   * host. Conflating them would report "this cannot be edited" for a file that can.
   */
  if (route !== undefined && (route.commit === undefined || route.authorization === undefined)) {
    return 'this surface was mounted without a route to save a change'
  }
  if (editable === undefined) return 'this codec does not offer this value for editing'
  if (editable.readonlyReason !== undefined) return editable.readonlyReason
  const write = editable.write
  if (write === undefined) return 'this codec does not offer this value for editing'
  if (!('operation' in write)) {
    return 'this value is written through a writer service this surface does not hold'
  }
  const operation = descriptor.operations.find(candidate => candidate.id === write.operation)
  if (operation === undefined) return `the codec declares no operation «${String(write.operation)}»`
  if (operation.state !== 'available') {
    return `the operation «${String(write.operation)}» is ${operation.state} for this file`
  }
  return undefined
}

/**
 * The edit plan an operation answered with, if it answered with one.
 *
 * Operation results carry their product in `output`; a mutating operation's is `edit-plan`. Anything
 * else here means the codec did something other than plan a write, and the caller must not treat it
 * as a saved change.
 */
function editPlanOf(result: unknown): AssetEditPlan | undefined {
  const output = (result as { output?: { kind?: string; plan?: AssetEditPlan } }).output
  return output?.kind === 'edit-plan' ? output.plan : undefined
}

/**
 * Invoke one mutating operation and carry its edit plan through authorize → prepare → commit.
 *
 * Answers `undefined` once the change is on disk, or the reason it is not. Table row actions and
 * inline fields share it, so there is one write path whatever control started the write.
 */
export async function commitOperationWrite(
  route: FieldWriteRoute & { readonly descriptor: AnyDescriptor },
  operationId: string,
  input: JsonValue,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const operation = route.descriptor.operations.find(candidate => candidate.id === operationId)
  if (operation === undefined) return `the codec declares no operation «${operationId}»`
  if (operation.state !== 'available') {
    return `the operation «${operationId}» is ${operation.state} for this file`
  }
  const coordinator = route.commit
  const authorization = route.authorization
  if (coordinator === undefined || authorization === undefined) {
    return 'no route to save this change'
  }
  const options = signal === undefined ? {} : { signal }
  const result = await route.operations.invoke(operation.handlerId, input, options)
  if (isRejected(result)) return invokeRefusalMessage(result)
  const plan = editPlanOf(result)
  if (plan === undefined) return 'the codec returned no edit plan for this write'
  const grant = await authorization.request(plan, options)
  if (grant === undefined) return 'not authorised to write this file'
  const prepared = await coordinator.prepare(plan, { grant: grant.grant, ...options })
  if (prepared.state !== 'ready') {
    return prepared.state === 'conflict'
      ? 'the file changed after this view opened it'
      : `refused: ${prepared.reason ?? prepared.state}`
  }
  const receipt = await coordinator.commit(prepared.prepared, { grant: grant.grant, ...options })
  return receipt.state === 'committed' ? undefined : `not saved: ${receipt.state}`
}

/** The control the field editor needs, synthesised from one data-source value. */
function controlField(options: InlineFieldOptions): EditOperationField {
  const initialText =
    options.value === null || options.value === undefined ? '' : String(options.value)
  return Object.freeze({
    key: options.target.key,
    label: options.label,
    type: options.type,
    inputPath: ['value'],
    name: options.target.key,
    kind: 'text' as const,
    initial: options.value,
    initialText,
    ...(options.editable?.editor === undefined ? {} : { editorId: options.editable.editor }),
  }) as EditOperationField
}

export interface InlineFieldMount {
  readonly root: HTMLElement
  /** Resolves once the write settled: `true` when the codec accepted it. */
  commit(): Promise<boolean>
  unmount(): Promise<void>
}

/**
 * Mount an editable control for one value, or a read-only rendering with the reason it is one.
 * The caller decides where it lives — a tree row, a table cell, a metadata line.
 */
export async function mountInlineField(
  container: HTMLElement,
  options: InlineFieldOptions,
): Promise<InlineFieldMount> {
  const root = element(container, 'span', { part: 'field' })
  const refusal = fieldWriteRefusal(options.descriptor, options.editable, {
    ...(options.commit === undefined ? {} : { commit: options.commit }),
    ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
  })
  if (refusal !== undefined) {
    const text = element(root, 'span', { part: 'field.control' })
    setViewerText(text, options.value ?? '', 4096)
    text.title = refusal
    root.dataset['readonly'] = 'true'
    return {
      root,
      async commit() {
        return false
      },
      async unmount() {
        root.remove()
      },
    }
  }

  const host = element(root, 'span', { part: 'field.control' })
  const status = element(root, 'span', { part: 'field.status' })
  const control = await mountFieldEditor(
    host,
    controlField(options),
    options.signal,
    options.fieldEditors,
    options.editable?.editor,
    options.candidates,
  )

  // `fieldWriteRefusal` already proved both are present; this narrows for the type checker.
  const write = options.editable?.write
  const operationId = write !== undefined && 'operation' in write ? write.operation : undefined
  const operation = options.descriptor.operations.find(
    candidate => candidate.id === operationId,
  )

  /**
   * Run one field write all the way to a committed change.
   *
   * The operation answers with an *edit plan*, not a finished write — that is the whole point of the
   * plan/prepare/commit sequence, and stopping at the plan is how a surface ends up reporting
   * success while the file on disk never changes. Every stage that can refuse is reported where the
   * reader is looking, in its own words, rather than collapsed into a single failure.
   */
  const commit = async (): Promise<boolean> => {
    if (operation === undefined) {
      setViewerText(status, 'no route to save this change', 512)
      return false
    }
    const problem = control.validate()
    if (problem !== undefined) {
      setViewerText(status, problem, 512)
      return false
    }
    const value = control.read()
    const request: FieldWriteRequest = {
      groupId: options.target.groupId,
      key: options.target.key,
      ...(options.target.path === undefined ? {} : { path: options.target.path }),
      value,
    }
    setViewerText(status, '…', 8)
    const refusal = await commitOperationWrite(
      options,
      operation.id,
      request as unknown as JsonValue,
      options.signal,
    )
    if (refusal !== undefined) {
      setViewerText(status, refusal, 512)
      return false
    }
    setViewerText(status, '', 1)
    await options.onWritten?.(value)
    return true
  }

  return {
    root,
    commit,
    async unmount() {
      await control.unmount?.()
      root.remove()
    },
  }
}
