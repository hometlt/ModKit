/**
 * `subject.edit` — basic editing for every application through one handler.
 *
 * The handler is the subject's own standard mutating operation (`edit.field`, `edit.content`,
 * `edit.structure`): a table cell, a CLI invocation and an MCP proposal all invoke the same
 * descriptor-published operation and get the same edit plan. This command adds no format
 * knowledge. It previews that plan, and commits it only through the host-owned editing surface
 * (`CommitCoordinator`) when the opener supplied one — the caller never hands bytes to a writer.
 */

import type { AssetEditPlan, JsonValue } from '@modkit/sdk'
import {
  COMMAND_INPUT_INVALID,
  commandDiagnostic,
  failed,
  ok,
  unavailable,
  type CommandContext,
  type CommandDescriptor,
  type CommandInput,
} from './runtime.js'
import type { CommandRoutingTarget } from './protocol.js'
import { invokeSubjectOperation, withCommandSubject } from './subject-commands.js'

export const SUBJECT_EDIT_COMMAND = 'subject.edit'
/** Standard mutating operations `subject.edit` may route to; anything else is refused. */
export const SUBJECT_EDIT_OPERATION_IDS = Object.freeze([
  'edit.field',
  'edit.content',
  'edit.structure',
] as const)

/** Bounded, byte-free description of a plan: what would change, never the replacement bytes. */
export function summarizeEditPlan(plan: AssetEditPlan): JsonValue {
  const encoder = new TextEncoder()
  return {
    planId: plan.planId,
    fidelity: plan.fidelity as unknown as JsonValue,
    edits: plan.edits.map(edit => {
      const payload = 'payload' in edit ? edit.payload : undefined
      const replacementBytes =
        payload === undefined
          ? null
          : payload.kind === 'inline'
            ? payload.bytes.byteLength
            : payload.kind === 'text'
              ? encoder.encode(payload.text).byteLength
              : String(payload.ref.bytes)
      return {
        operation: edit.operation,
        targetId: edit.targetId,
        label: edit.label ?? null,
        ...('range' in edit && edit.range !== undefined
          ? { offset: String(edit.range.offset), length: String(edit.range.length) }
          : {}),
        ...('newPath' in edit ? { newPath: edit.newPath } : {}),
        replacementBytes,
      }
    }),
    diagnostics: plan.diagnostics.map(commandDiagnostic) as unknown as JsonValue,
  }
}

/** JSON with bigints as decimal strings; receipts carry revisions and byte counts. */
const jsonSafe = (value: unknown): JsonValue =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? String(item) : item,
    ),
  ) as JsonValue

const editCommand: CommandDescriptor = Object.freeze({
  id: SUBJECT_EDIT_COMMAND,
  title: 'Edit',
  summary:
    'Preview, or with commit=true apply, one standard edit operation (set field, add/remove entry, rename) of a subject.',
  needsSubject: true,
  mutatesSource: true,
  async run(context: CommandContext, input: CommandInput) {
    const operationId = input['operation']
    const operationInput = input['operationInput']
    const commit = input['commit'] ?? false
    if (
      typeof operationId !== 'string' ||
      !(SUBJECT_EDIT_OPERATION_IDS as readonly string[]).includes(operationId) ||
      operationInput === undefined ||
      typeof commit !== 'boolean'
    ) {
      return failed(
        SUBJECT_EDIT_COMMAND,
        COMMAND_INPUT_INVALID,
        `operation must be one of ${SUBJECT_EDIT_OPERATION_IDS.join(', ')}, operationInput is required and commit must be boolean`,
      )
    }
    return withCommandSubject(
      SUBJECT_EDIT_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const operation = (descriptor.operations ?? []).find(item => item.id === operationId)
        if (operation?.state !== 'available' || operation.mutatesSource !== true) {
          return unavailable(
            SUBJECT_EDIT_COMMAND,
            operation === undefined
              ? `the subject publishes no ${operationId}`
              : `${operationId} is not an available mutating operation here${operation.reason === undefined ? '' : `: ${operation.reason}`}`,
            'run subject.inspect to see which edit operations this subject publishes',
            diagnostics,
          )
        }
        context.progress?.({ step: 'plan', message: `planning ${operationId}` })
        const answer = await invokeSubjectOperation(
          SUBJECT_EDIT_COMMAND,
          context,
          session,
          operation.handlerId,
          operationInput,
          diagnostics,
        )
        if (answer.state === 'failed') return answer.result
        if (answer.output.kind !== 'edit-plan') {
          return failed(
            SUBJECT_EDIT_COMMAND,
            'x3.command/not-an-edit-plan',
            `${operationId} answered with ${answer.output.kind}, not an edit plan`,
            answer.diagnostics,
          )
        }
        const output = answer.output as unknown as { kind: 'edit-plan'; plan: AssetEditPlan }
        if (!commit) {
          return ok(
            SUBJECT_EDIT_COMMAND,
            {
              ref: subject.ref,
              operation: operationId,
              committed: false,
              plan: summarizeEditPlan(output.plan),
            },
            answer.diagnostics,
          )
        }
        const editing = subject.editing
        if (editing === undefined) {
          return unavailable(
            SUBJECT_EDIT_COMMAND,
            'this host opened the subject without an editing surface (it is outside the writable roots, or the host is read-only)',
            'run with commit=false to preview, or open the subject in a host configured with writable roots',
            answer.diagnostics,
          )
        }
        const signal = context.signal
        const plan = await editing.stagePlan(
          editing.planFromOperation(answer.output as never),
          signal,
        )
        let committed = false
        try {
          context.progress?.({
            step: 'prepare',
            message: 'validating revisions, permissions and fidelity',
          })
          const prepared = await editing.coordinator.prepare(plan, {
            grant: editing.grantSnapshot,
            ...(signal === undefined ? {} : { signal }),
          })
          if (prepared.state === 'conflict') {
            return failed(
              SUBJECT_EDIT_COMMAND,
              'x3.command/edit-stale-revision',
              `the source changed after the plan was made: ${prepared.conflicts.map(item => item.targetId).join(', ')}`,
              answer.diagnostics,
            )
          }
          if (prepared.state !== 'ready') {
            return failed(
              SUBJECT_EDIT_COMMAND,
              `x3.command/edit-${prepared.reason}`,
              `the host refused the edit plan: ${prepared.reason}`,
              [...answer.diagnostics, ...prepared.diagnostics.map(commandDiagnostic)],
            )
          }
          context.progress?.({ step: 'commit', message: 'committing' })
          const result = await editing.coordinator.commit(prepared.prepared, {
            grant: editing.grantSnapshot,
            ...(signal === undefined ? {} : { signal }),
          })
          if (result.state === 'not-applied') {
            return failed(
              SUBJECT_EDIT_COMMAND,
              `x3.command/edit-${result.reason}`,
              `the edit was not applied: ${result.reason}`,
              [...answer.diagnostics, ...result.diagnostics.map(commandDiagnostic)],
            )
          }
          committed = true
          return ok(
            SUBJECT_EDIT_COMMAND,
            {
              ref: subject.ref,
              operation: operationId,
              committed: result.state === 'committed',
              state: result.state,
              plan: summarizeEditPlan(plan),
              receipt: jsonSafe(result.receipt),
            },
            answer.diagnostics,
          )
        } finally {
          // A committed plan's payloads belong to the undo history; everything else is released.
          if (!committed) await editing.releasePlan(plan)
        }
      },
    )
  },
})

export const SUBJECT_EDIT_COMMANDS: readonly CommandDescriptor[] = Object.freeze([editCommand])

export const SUBJECT_EDIT_COMMAND_TARGETS: readonly CommandRoutingTarget[] = Object.freeze([
  Object.freeze({
    commandId: SUBJECT_EDIT_COMMAND,
    operationIds: Object.freeze([...SUBJECT_EDIT_OPERATION_IDS]),
    dataSourceContracts: Object.freeze([]),
    hostCallers: Object.freeze(['cli', 'mcp', 'electron', 'pwa', 'server', 'vscode']),
  }),
])
