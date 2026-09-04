/**
 * The six product-critical commands of block 13, work 5: open, inspect, validate, extract, convert,
 * preview.
 *
 * Every one of them is the same three movements — open the subject the host named, read what its
 * descriptor actually publishes, route to the standard operation that does the work — and the
 * middle movement is the one that matters. A command never assumes an operation exists because the
 * format usually has one; it looks in the descriptor the running codec produced, and when the
 * operation is absent it says so with a reason and a safe alternative (§4.2) instead of throwing a
 * generic failure that every application would then have to interpret for itself.
 *
 * Nothing here knows a format. `container.extract`, `asset.validate`, `export.convert`,
 * `view.thumbnail` are standard ids from the SDK's shared vocabulary: a BIG, a CASC and a ZIP all
 * reach `extract` through the same line of code, and a codec that publishes none of them is
 * described as such rather than special-cased.
 */

import type { AssetSession, JsonValue, NamespaceEntrySource } from '@modkit/sdk'
import { SUBJECT_COMMAND_TARGETS } from './subject-command-targets.js'
import {
  commandDiagnostic,
  failed,
  ok,
  unavailable,
  COMMAND_SUBJECT_UNRESOLVED,
  type CommandContext,
  type CommandDescriptor,
  type CommandDiagnostic,
  type CommandResult,
  type CommandSubject,
} from './runtime.js'

const OPEN_COMMAND = SUBJECT_COMMAND_TARGETS.open.commandId
const INSPECT_COMMAND = SUBJECT_COMMAND_TARGETS.inspect.commandId
const VALIDATE_COMMAND = SUBJECT_COMMAND_TARGETS.validate.commandId
const VALIDATE = SUBJECT_COMMAND_TARGETS.validate.operationIds[0]
const EXTRACT_COMMAND = SUBJECT_COMMAND_TARGETS.extract.commandId
const CONTAINER_EXTRACT_OPERATION_ID = SUBJECT_COMMAND_TARGETS.extract.operationIds[0]
const NAMESPACE_ENTRY_SOURCE = SUBJECT_COMMAND_TARGETS.extract.dataSourceContracts[0]
const CONVERT_COMMAND = SUBJECT_COMMAND_TARGETS.convert.commandId
const CONVERT = SUBJECT_COMMAND_TARGETS.convert.operationIds[0]
const RAW_EXPORT = SUBJECT_COMMAND_TARGETS.convert.operationIds[1]
const PREVIEW_COMMAND = SUBJECT_COMMAND_TARGETS.preview.commandId
const THUMBNAIL = SUBJECT_COMMAND_TARGETS.preview.operationIds[0]
const RENDER = SUBJECT_COMMAND_TARGETS.preview.operationIds[1]

/** The descriptor fields these commands read. Structural, so no codec type leaks in here. */
interface DescriptorLike {
  readonly revision?: unknown
  readonly identity?: { readonly formatId?: string; readonly formatLabel?: string }
  readonly traits?: readonly { readonly id: string; readonly state: string }[]
  readonly operations?: readonly {
    readonly id: string
    readonly handlerId: string
    readonly state: string
    readonly reason?: string
    readonly mutatesSource?: boolean
  }[]
  readonly dataSources?: readonly { readonly contract: string; readonly major: number }[]
  readonly metadata?: readonly { readonly id: string; readonly entries: readonly unknown[] }[]
}

/** An available, non-mutating operation by id, or nothing. */
function availableOperation(
  descriptor: DescriptorLike,
  id: string,
): { readonly handlerId: string } | undefined {
  const found = (descriptor.operations ?? []).find(
    item => item.id === id && item.state === 'available' && item.mutatesSource !== true,
  )
  return found === undefined ? undefined : { handlerId: found.handlerId }
}

/** What a subject publishes, named for a refusal message that helps rather than scolds. */
const publishedOperations = (descriptor: DescriptorLike): string =>
  (descriptor.operations ?? []).length === 0
    ? 'it publishes no operations at all'
    : `it publishes ${(descriptor.operations ?? []).map(item => item.id).join(', ')}`

/**
 * Open a subject and hand it to `body`, disposing it however `body` ends.
 *
 * The unresolved case never reaches `body`: "no codec claimed this" is one answer with one shape,
 * and writing it once here is what stops six commands from phrasing it six ways.
 */
async function withSubject(
  command: string,
  context: CommandContext,
  ref: string,
  body: (
    subject: CommandSubject,
    session: AssetSession,
    descriptor: DescriptorLike,
    diagnostics: readonly CommandDiagnostic[],
  ) => Promise<CommandResult>,
): Promise<CommandResult> {
  context.progress?.({ step: 'open', message: `opening ${ref}` })
  const subject = await context.openSubject(ref, context.signal)
  const diagnostics = subject.snapshot.diagnostics.map(item => ({
    code: item.code,
    message: item.message,
    ...(item.severity === undefined ? {} : { severity: item.severity }),
  }))
  try {
    if (subject.snapshot.state !== 'opened' || subject.session === undefined) {
      return failed(
        command,
        COMMAND_SUBJECT_UNRESOLVED,
        subject.snapshot.state === 'opened'
          ? 'the subject opened without a session'
          : `no contribution claimed this subject: ${subject.snapshot.reason}`,
        diagnostics,
      )
    }
    const descriptor = (await subject.session.descriptor()) as unknown as DescriptorLike
    return await body(subject, subject.session, descriptor, diagnostics)
  } finally {
    await subject.dispose()
  }
}

/** Invoke one operation and normalise its answer into the command vocabulary. */
async function invoke(
  command: string,
  context: CommandContext,
  session: AssetSession,
  handlerId: string,
  input: JsonValue,
  diagnostics: readonly CommandDiagnostic[],
): Promise<
  | { readonly state: 'ok'; readonly output: { kind: string; value?: unknown } }
  | { readonly state: 'failed'; readonly result: CommandResult }
> {
  const answer = await session
    .operations()
    .invoke(handlerId, input, context.signal === undefined ? {} : { signal: context.signal })
  const carried = [...diagnostics, ...answer.diagnostics.map(commandDiagnostic)]
  if (answer.state !== 'ok') {
    return {
      state: 'failed',
      result: failed(
        command,
        `x3.command/operation-${answer.reason}`,
        `the subject refused ${handlerId}: ${answer.reason}`,
        carried,
      ),
    }
  }
  return { state: 'ok', output: answer.output as { kind: string; value?: unknown } }
}

// ---------------------------------------------------------------------------------------------
// open

const openCommand: CommandDescriptor = {
  id: OPEN_COMMAND,
  title: 'Open',
  summary: 'Open a subject and report which contribution claimed it, and under which boundary.',
  needsSubject: true,
  mutatesSource: false,
  async run(context, input) {
    return withSubject(
      OPEN_COMMAND,
      context,
      String(input.subject),
      async (subject, _session, descriptor, diagnostics) => {
        const snapshot = subject.snapshot
        if (snapshot.state !== 'opened')
          return failed(OPEN_COMMAND, COMMAND_SUBJECT_UNRESOLVED, 'unreachable', diagnostics)
        return ok(
          OPEN_COMMAND,
          {
            ref: subject.ref,
            state: 'opened',
            selected: {
              contributionId: snapshot.selected.contributionId,
              variantId: snapshot.selected.variantId,
              confidence: snapshot.selected.confidence,
            },
            formatId: descriptor.identity?.formatId ?? null,
            formatLabel: descriptor.identity?.formatLabel ?? null,
            candidates: snapshot.candidates.length,
            operations: (descriptor.operations ?? []).map(item => item.id),
          } as JsonValue,
          diagnostics,
        )
      },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// inspect

const inspectCommand: CommandDescriptor = {
  id: INSPECT_COMMAND,
  title: 'Inspect',
  summary: 'Report the full descriptor of a subject: identity, traits, operations, data sources.',
  needsSubject: true,
  mutatesSource: false,
  async run(context, input) {
    return withSubject(
      INSPECT_COMMAND,
      context,
      String(input.subject),
      async (subject, _session, descriptor, diagnostics) => {
        context.progress?.({ step: 'describe', message: 'reading the descriptor' })
        return ok(
          INSPECT_COMMAND,
          {
            ref: subject.ref,
            identity: {
              formatId: descriptor.identity?.formatId ?? null,
              formatLabel: descriptor.identity?.formatLabel ?? null,
            },
            traits: (descriptor.traits ?? []).map(item => ({ id: item.id, state: item.state })),
            operations: (descriptor.operations ?? []).map(item => ({
              id: item.id,
              state: item.state,
              ...(item.reason === undefined ? {} : { reason: item.reason }),
            })),
            dataSources: (descriptor.dataSources ?? []).map(
              item => `${item.contract}@${item.major}`,
            ),
            metadataGroups: (descriptor.metadata ?? []).map(group => ({
              id: group.id,
              entries: group.entries.length,
            })),
          } as JsonValue,
          diagnostics,
        )
      },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// validate

const validateCommand: CommandDescriptor = {
  id: VALIDATE_COMMAND,
  title: 'Validate',
  summary: 'Run the subject’s own validation, when the codec publishes one.',
  needsSubject: true,
  mutatesSource: false,
  operationId: VALIDATE,
  async run(context, input) {
    return withSubject(
      VALIDATE_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const operation = availableOperation(descriptor, VALIDATE)
        if (operation === undefined) {
          return unavailable(
            VALIDATE_COMMAND,
            `this subject publishes no available «${VALIDATE}» — ${publishedOperations(descriptor)}`,
            'run subject.inspect: it reports every trait and diagnostic the codec did produce, which ' +
              'is what validation would have been reading',
            diagnostics,
          )
        }
        context.progress?.({ step: 'validate', message: 'running the codec’s validation' })
        const answer = await invoke(
          VALIDATE_COMMAND,
          context,
          session,
          operation.handlerId,
          {},
          diagnostics,
        )
        if (answer.state === 'failed') return answer.result
        return ok(
          VALIDATE_COMMAND,
          {
            ref: subject.ref,
            outputKind: answer.output.kind,
            report: (answer.output.value ?? null) as JsonValue,
          },
          diagnostics,
        )
      },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// extract

/** Translate an entry path to the container's own opaque id, paging the namespace once. */
async function entryIdFor(
  session: AssetSession,
  wanted: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const lease = await session.dataSource(NAMESPACE_ENTRY_SOURCE, 1)
  try {
    const namespace = lease.value as NamespaceEntrySource
    let cursor: string | undefined
    do {
      const page = await namespace.list(
        '',
        cursor === undefined ? { limit: 512 } : { cursor, limit: 512 },
        signal,
      )
      const found = page.items.find(item => item.path === wanted || item.id === wanted)
      if (found !== undefined) return found.id
      cursor = page.nextCursor
    } while (cursor !== undefined)
    return undefined
  } finally {
    await lease.release()
  }
}

const extractCommand: CommandDescriptor = {
  id: EXTRACT_COMMAND,
  title: 'Extract',
  summary: 'Read one member out of a container, through the container’s own bounded extraction.',
  needsSubject: true,
  mutatesSource: false,
  operationId: CONTAINER_EXTRACT_OPERATION_ID,
  async run(context, input) {
    const entry = typeof input['entry'] === 'string' ? input['entry'] : ''
    if (entry === '') {
      return failed(EXTRACT_COMMAND, 'x3.command/input-invalid', 'subject.extract needs an «entry»')
    }
    return withSubject(
      EXTRACT_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const operation = availableOperation(descriptor, CONTAINER_EXTRACT_OPERATION_ID)
        const listing = (descriptor.dataSources ?? []).some(
          item => item.contract === NAMESPACE_ENTRY_SOURCE,
        )
        if (operation === undefined || !listing) {
          return unavailable(
            EXTRACT_COMMAND,
            `this subject is not a container this host can read into — ${publishedOperations(descriptor)}`,
            'run subject.inspect to see what it does publish; extraction needs both ' +
              `«${CONTAINER_EXTRACT_OPERATION_ID}» and «${NAMESPACE_ENTRY_SOURCE}»`,
            diagnostics,
          )
        }
        context.progress?.({ step: 'locate', message: `locating ${entry}` })
        const entryId = await entryIdFor(session, entry, context.signal)
        if (entryId === undefined) {
          return failed(
            EXTRACT_COMMAND,
            'x3.command/entry-not-found',
            `this container lists no «${entry}»`,
            diagnostics,
          )
        }
        context.progress?.({ step: 'extract', message: `extracting ${entry}` })
        const answer = await invoke(
          EXTRACT_COMMAND,
          context,
          session,
          operation.handlerId,
          { entryId },
          diagnostics,
        )
        if (answer.state === 'failed') return answer.result
        if (answer.output.kind !== 'bytes') {
          return failed(
            EXTRACT_COMMAND,
            'x3.command/unexpected-output',
            `the container answered ${answer.output.kind}, not bytes`,
            diagnostics,
          )
        }
        const bytes = answer.output.value as Uint8Array
        const name = entry.slice(entry.lastIndexOf('/') + 1)
        /*
         * Writing is a host facility, so the command reports the bytes it produced and writes only
         * when the host handed it somewhere to write. A headless run that cannot write still gets the
         * length and the digest, which is what a batch pipeline actually asserts on.
         */
        const wroteTo =
          context.writeOutput === undefined
            ? undefined
            : await context.writeOutput(name, bytes, context.signal)
        return ok(
          EXTRACT_COMMAND,
          {
            ref: subject.ref,
            entry,
            byteLength: bytes.byteLength,
            ...(wroteTo === undefined ? { wroteTo: null } : { wroteTo }),
          },
          diagnostics,
        )
      },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// convert

const convertCommand: CommandDescriptor = {
  id: CONVERT_COMMAND,
  title: 'Convert',
  summary: 'Export a subject through the codec’s own conversion, when it publishes one.',
  needsSubject: true,
  mutatesSource: false,
  operationId: CONVERT,
  async run(context, input) {
    return withSubject(
      CONVERT_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const operation =
          availableOperation(descriptor, CONVERT) ?? availableOperation(descriptor, RAW_EXPORT)
        if (operation === undefined) {
          return unavailable(
            CONVERT_COMMAND,
            `this subject publishes neither «${CONVERT}» nor «${RAW_EXPORT}» — ${publishedOperations(descriptor)}`,
            'run subject.inspect to see which data sources it does publish; a universal projection is ' +
              'the route for formats with no native export',
            diagnostics,
          )
        }
        context.progress?.({ step: 'convert', message: 'running the codec’s export' })
        const request: JsonValue =
          typeof input['target'] === 'string' ? { target: input['target'] } : {}
        const answer = await invoke(
          CONVERT_COMMAND,
          context,
          session,
          operation.handlerId,
          request,
          diagnostics,
        )
        if (answer.state === 'failed') return answer.result
        const bytes =
          answer.output.kind === 'bytes' ? (answer.output.value as Uint8Array) : undefined
        const wroteTo =
          bytes === undefined || context.writeOutput === undefined
            ? undefined
            : await context.writeOutput(
                `${(input['target'] as string | undefined) ?? 'export'}`,
                bytes,
                context.signal,
              )
        return ok(
          CONVERT_COMMAND,
          {
            ref: subject.ref,
            outputKind: answer.output.kind,
            ...(bytes === undefined ? {} : { byteLength: bytes.byteLength }),
            ...(wroteTo === undefined ? { wroteTo: null } : { wroteTo }),
          },
          diagnostics,
        )
      },
    )
  },
}

// ---------------------------------------------------------------------------------------------
// preview

const previewCommand: CommandDescriptor = {
  id: PREVIEW_COMMAND,
  title: 'Preview',
  summary: 'Produce the subject’s own preview — a thumbnail if it has one, a render otherwise.',
  needsSubject: true,
  mutatesSource: false,
  operationId: THUMBNAIL,
  async run(context, input) {
    return withSubject(
      PREVIEW_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const thumbnail = availableOperation(descriptor, THUMBNAIL)
        const operation = thumbnail ?? availableOperation(descriptor, RENDER)
        if (operation === undefined) {
          /*
           * Not a failure: most formats in this lab are previewed by a *viewer* reading a data
           * source, not by an operation that renders bytes. Saying which data sources are published
           * is the alternative that actually gets the caller somewhere.
           */
          return unavailable(
            PREVIEW_COMMAND,
            `this subject publishes no «${THUMBNAIL}» or «${RENDER}» — ${publishedOperations(descriptor)}`,
            `mount a viewer over one of its data sources instead: ${
              (descriptor.dataSources ?? []).map(item => item.contract).join(', ') ||
              'it publishes none'
            }`,
            diagnostics,
          )
        }
        context.progress?.({ step: 'preview', message: 'rendering the preview' })
        const answer = await invoke(
          PREVIEW_COMMAND,
          context,
          session,
          operation.handlerId,
          {},
          diagnostics,
        )
        if (answer.state === 'failed') return answer.result
        const bytes =
          answer.output.kind === 'bytes' ? (answer.output.value as Uint8Array) : undefined
        return ok(
          PREVIEW_COMMAND,
          {
            ref: subject.ref,
            via: thumbnail === undefined ? RENDER : THUMBNAIL,
            outputKind: answer.output.kind,
            ...(bytes === undefined ? {} : { byteLength: bytes.byteLength }),
          },
          diagnostics,
        )
      },
    )
  },
}

/** The six commands of block 13 work 5, in one list every application registers from. */
export const SUBJECT_COMMANDS: readonly CommandDescriptor[] = Object.freeze([
  openCommand,
  inspectCommand,
  validateCommand,
  extractCommand,
  convertCommand,
  previewCommand,
])
