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

import type {
  AssetSession,
  ByteRangeSource,
  JsonValue,
  Lease,
  NamespaceEntry,
  NamespaceEntrySource,
} from '@modkit/sdk'
import type { CandidateWorldSceneSource } from '@modkit/sdk/maps'
import { SUBJECT_COMMAND_TARGETS } from './subject-command-targets.js'
import {
  commandDiagnostic,
  failed,
  ok,
  unavailable,
  COMMAND_SUBJECT_UNRESOLVED,
  COMMAND_INPUT_INVALID,
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
const WORLD_SCENE_SOURCE = SUBJECT_COMMAND_TARGETS.convert.dataSourceContracts[0]
const PREVIEW_COMMAND = SUBJECT_COMMAND_TARGETS.preview.commandId
const THUMBNAIL = SUBJECT_COMMAND_TARGETS.preview.operationIds[0]

/** The descriptor fields these commands read. Structural, so no codec type leaks in here. */
export interface DescriptorLike {
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

/** Explicit selection never falls back to a different export or silently invokes a writer. */
function selectedOperation(
  descriptor: DescriptorLike,
  allowed: readonly string[],
  requested: JsonValue | undefined,
): { readonly id: string; readonly handlerId: string } | undefined {
  const candidates =
    requested === undefined ? allowed : typeof requested === 'string' ? [requested] : []
  for (const id of candidates) {
    if (!allowed.includes(id)) continue
    const operation = availableOperation(descriptor, id)
    if (operation !== undefined) return { id, ...operation }
  }
  return undefined
}

/** The subject's file name without its extension, `export` when its reference names none. */
function subjectStem(ref: string): string {
  const name =
    ref
      .replace(/[?#].*$/u, '')
      .split(/[\\/]/u)
      .at(-1) ?? ''
  const stem = name.replace(/\.[^.]*$/u, '')
  return stem === '' ? 'export' : stem
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
export async function withCommandSubject(
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
export async function invokeSubjectOperation(
  command: string,
  context: CommandContext,
  session: AssetSession,
  handlerId: string,
  input: JsonValue,
  diagnostics: readonly CommandDiagnostic[],
): Promise<
  | {
      readonly state: 'ok'
      readonly output: { kind: string; value?: unknown }
      readonly diagnostics: readonly CommandDiagnostic[]
    }
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
  return {
    state: 'ok',
    output: answer.output as { kind: string; value?: unknown },
    diagnostics: carried,
  }
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
    return withCommandSubject(
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
    return withCommandSubject(
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
    return withCommandSubject(
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
        const answer = await invokeSubjectOperation(
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
async function entryFor(
  session: AssetSession,
  wanted: string,
  signal?: AbortSignal,
): Promise<NamespaceEntry | undefined> {
  const lease = await session.dataSource(NAMESPACE_ENTRY_SOURCE, 1)
  try {
    const namespace = lease.value as NamespaceEntrySource
    // An exact lookup first: cheaper than walking the listing, and the only way into a hashed
    // archive whose listing is incomplete (an MPQ without its file list).
    if (namespace.lookup !== undefined) {
      const entry = await namespace.lookup(wanted, signal)
      if (entry !== undefined) return entry
    }
    // After a lookup miss only the listing under that very name can still answer (an id spelled
    // like its path); walking the whole listing cost ~26 s on Diablo III for nothing.
    const scope = namespace.lookup === undefined ? '' : wanted
    let cursor: string | undefined
    do {
      const page = await namespace.list(
        scope,
        cursor === undefined ? { limit: 512 } : { cursor, limit: 512 },
        signal,
      )
      const found = page.items.find(item => item.path === wanted || item.id === wanted)
      if (found !== undefined) return found
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
    return withCommandSubject(
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
        const found = await entryFor(session, entry, context.signal)
        if (found === undefined) {
          return failed(
            EXTRACT_COMMAND,
            'x3.command/entry-not-found',
            `this container lists no «${entry}»`,
            diagnostics,
          )
        }
        const name = entry.slice(entry.lastIndexOf('/') + 1)
        const streamed = await streamEntry(session, descriptor, found, name, context)
        if (streamed !== undefined) {
          return ok(EXTRACT_COMMAND, { ref: subject.ref, entry, ...streamed }, diagnostics)
        }
        context.progress?.({ step: 'extract', message: `extracting ${entry}` })
        const answer = await invokeSubjectOperation(
          EXTRACT_COMMAND,
          context,
          session,
          operation.handlerId,
          { entryId: found.id },
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

const BYTE_RANGE_SOURCE = 'common.view/byte-range-source'
const STREAM_CHUNK_BYTES = 4n * 1024n * 1024n

/**
 * A member the container can read by range — stored in place, or decoded block by block — goes to a
 * streaming sink in bounded chunks, so its size is not limited by memory or the open budget. Any
 * other member, or a host without such a sink, is extracted whole: `undefined`.
 */
async function streamEntry(
  session: AssetSession,
  descriptor: DescriptorLike,
  entry: NamespaceEntry,
  name: string,
  context: CommandContext,
): Promise<{ readonly byteLength: number; readonly wroteTo: string } | undefined> {
  const sink = context.writeOutputStream
  if (sink === undefined) return undefined
  const stored =
    entry.storedRange !== undefined &&
    (descriptor.dataSources ?? []).some(
      item => item.contract === BYTE_RANGE_SOURCE && item.major === 1,
    )
  if (!stored && entry.rangeAccess !== true) return undefined
  const signal = context.signal
  const leases: Lease<unknown>[] = []
  try {
    let source: ByteRangeSource
    let start = 0n
    let length: bigint
    if (stored && entry.storedRange !== undefined) {
      const lease = await session.dataSource(BYTE_RANGE_SOURCE, 1)
      leases.push(lease)
      source = lease.value as ByteRangeSource
      start = entry.storedRange.offset
      length = entry.storedRange.length
    } else {
      const lease = await session.dataSource(NAMESPACE_ENTRY_SOURCE, 1)
      leases.push(lease)
      const namespace = lease.value as NamespaceEntrySource
      if (namespace.openEntrySource === undefined) return undefined
      const entryLease = await namespace.openEntrySource(entry.id, signal)
      leases.push(entryLease)
      source = entryLease.value
      length = await source.size()
    }
    context.progress?.({ step: 'extract', message: `streaming ${entry.path}` })
    async function* chunks(): AsyncGenerator<Uint8Array> {
      for (let at = 0n; at < length;) {
        const want = Number(length - at < STREAM_CHUNK_BYTES ? length - at : STREAM_CHUNK_BYTES)
        const bytes = await source.read(start + at, want, signal)
        if (bytes.byteLength !== want) {
          throw new RangeError(
            `the container gave ${bytes.byteLength} of ${want} bytes at ${at} of ${entry.path}`,
          )
        }
        yield bytes
        at += BigInt(want)
      }
    }
    const wroteTo = await sink(name, chunks(), signal)
    return { byteLength: Number(length), wroteTo }
  } finally {
    for (const lease of leases.reverse()) await lease.release()
  }
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
    return withCommandSubject(
      CONVERT_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        if (input['operation'] !== undefined && typeof input['operation'] !== 'string')
          return failed(
            CONVERT_COMMAND,
            COMMAND_INPUT_INVALID,
            'operation must be an operation id',
            diagnostics,
          )
        // a map world becomes UVW from the world it publishes, with the receipt of what UVW lacks;
        // an operation the caller names still runs instead
        if (
          input['target'] === 'uvw' &&
          input['operation'] === undefined &&
          descriptor.dataSources?.some(
            offer => offer.contract === WORLD_SCENE_SOURCE && offer.major === 1,
          )
        ) {
          if (context.worldToUvw === undefined)
            return unavailable(
              CONVERT_COMMAND,
              'this application has no UV module to write UVW',
              'convert with the CLI or the desktop application',
              diagnostics,
            )
          context.progress?.({ step: 'convert', message: 'materializing the map world as UVW' })
          const lease = await session.dataSource(WORLD_SCENE_SOURCE, 1)
          try {
            const world = await context.worldToUvw(
              lease.value as unknown as CandidateWorldSceneSource,
              context.signal,
            )
            if (world.state === 'refused')
              return failed(
                CONVERT_COMMAND,
                'x3.host/world-uvw-refused',
                world.refusals.map(refusal => `${refusal.code}: ${refusal.message}`).join('; '),
                diagnostics,
              )
            const wroteTo =
              context.writeOutput === undefined
                ? undefined
                : await context.writeOutput('world.uvw', world.bytes, context.signal)
            return ok(
              CONVERT_COMMAND,
              {
                ref: subject.ref,
                via: WORLD_SCENE_SOURCE,
                outputKind: 'bytes',
                byteLength: world.bytes.byteLength,
                wroteTo: wroteTo ?? null,
                receipt: {
                  artifactDigest: world.artifactDigest,
                  excludedFacetIds: [...world.excludedFacetIds],
                  omittedObjects: world.omittedObjects,
                  lostFields: world.lostFields.map(field => ({ ...field })),
                },
              },
              diagnostics,
            )
          } finally {
            await lease.release()
          }
        }
        // without a world, the codec's raw or model export would be written under a `.uvw` name
        if (input['target'] === 'uvw' && input['operation'] === undefined)
          return unavailable(
            CONVERT_COMMAND,
            'this subject publishes no map world to write as UVW',
            'open the map itself, or a package naming one map; name an operation to run it instead',
            diagnostics,
          )
        // a named target picks the export that makes it: UVM by the model's own export, any other
        // format by an installed native encoder or the codec's own convert; the first published
        // export only without one (`--target m3` of a UVM wrote the UVM under that name)
        const target = typeof input['target'] === 'string' ? input['target'] : undefined
        const operation =
          (input['operation'] === undefined && target !== undefined
            ? selectedOperation(
                descriptor,
                target === 'uvm'
                  ? ['model.export-uvm']
                  : ['model.export-native', 'map.export-native', 'export.convert'],
                undefined,
              )
            : undefined) ??
          selectedOperation(
            descriptor,
            SUBJECT_COMMAND_TARGETS.convert.operationIds,
            input['operation'],
          )
        if (operation === undefined) {
          return unavailable(
            CONVERT_COMMAND,
            `the requested export is unavailable — ${publishedOperations(descriptor)}`,
            'run subject.inspect to see which data sources it does publish; a universal projection is ' +
              'the route for formats with no native export',
            diagnostics,
          )
        }
        context.progress?.({ step: 'convert', message: 'running the codec’s export' })
        const native =
          operation.id === 'model.export-native' || operation.id === 'map.export-native'
        const request: JsonValue =
          input['operationInput'] === undefined
            ? target !== undefined
              ? native
                ? { schemaVersion: 1, formatId: target }
                : { target }
              : {}
            : input['operationInput']
        const answer = await invokeSubjectOperation(
          CONVERT_COMMAND,
          context,
          session,
          operation.handlerId,
          request,
          diagnostics,
        )
        if (answer.state === 'failed') return answer.result
        const output = answer.output as {
          readonly kind: string
          readonly value?: unknown
          readonly extension?: unknown
          readonly mediaType?: unknown
        }
        const bytes = output.kind === 'bytes' ? (output.value as Uint8Array) : undefined
        // the producer's own extension names the file after the subject (`world.map`)
        const extension =
          bytes !== undefined && typeof output.extension === 'string' ? output.extension : undefined
        const mediaType =
          bytes !== undefined && typeof output.mediaType === 'string' ? output.mediaType : undefined
        const wroteTo =
          bytes === undefined || context.writeOutput === undefined
            ? undefined
            : await context.writeOutput(
                extension === undefined
                  ? (target ?? 'export')
                  : `${subjectStem(subject.ref)}.${extension}`,
                bytes,
                context.signal,
              )
        return ok(
          CONVERT_COMMAND,
          {
            ref: subject.ref,
            via: operation.id,
            outputKind: output.kind,
            ...(bytes === undefined ? {} : { byteLength: bytes.byteLength }),
            ...(extension === undefined ? {} : { extension }),
            ...(mediaType === undefined ? {} : { mediaType }),
            ...(wroteTo === undefined ? { wroteTo: null } : { wroteTo }),
          },
          answer.diagnostics,
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
    return withCommandSubject(
      PREVIEW_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        if (input['operation'] !== undefined && typeof input['operation'] !== 'string')
          return failed(
            PREVIEW_COMMAND,
            COMMAND_INPUT_INVALID,
            'operation must be an operation id',
            diagnostics,
          )
        const operation = selectedOperation(
          descriptor,
          SUBJECT_COMMAND_TARGETS.preview.operationIds,
          input['operation'],
        )
        if (operation === undefined) {
          /*
           * Not a failure: most formats in this lab are previewed by a *viewer* reading a data
           * source, not by an operation that renders bytes. Saying which data sources are published
           * is the alternative that actually gets the caller somewhere.
           */
          return unavailable(
            PREVIEW_COMMAND,
            `the requested preview is unavailable — ${publishedOperations(descriptor)}`,
            `mount a viewer over one of its data sources instead: ${
              (descriptor.dataSources ?? []).map(item => item.contract).join(', ') ||
              'it publishes none'
            }`,
            diagnostics,
          )
        }
        context.progress?.({ step: 'preview', message: 'rendering the preview' })
        const answer = await invokeSubjectOperation(
          PREVIEW_COMMAND,
          context,
          session,
          operation.handlerId,
          input['operationInput'] === undefined ? {} : input['operationInput'],
          diagnostics,
        )
        if (answer.state === 'failed') return answer.result
        const bytes =
          answer.output.kind === 'bytes' ? (answer.output.value as Uint8Array) : undefined
        const wroteTo =
          bytes === undefined || context.writeOutput === undefined
            ? undefined
            : await context.writeOutput('preview.png', bytes, context.signal)
        return ok(
          PREVIEW_COMMAND,
          {
            ref: subject.ref,
            via: operation.id,
            outputKind: answer.output.kind,
            ...(bytes === undefined ? {} : { byteLength: bytes.byteLength }),
            ...(wroteTo === undefined ? {} : { wroteTo }),
          },
          answer.diagnostics,
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
