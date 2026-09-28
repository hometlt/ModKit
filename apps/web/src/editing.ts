/**
 * The PWA's editing arm: what it takes for a browser tab to save a file in place.
 *
 * Three host pieces already exist and are composed here rather than reimplemented:
 * `createBrowserEditingBackend` (File System Access writable streams, with a pre-image rollback),
 * `createSubjectEditing` (13D targets, grant snapshot, commit coordinator, and the four
 * `editorPorts` a `@modkit/ui` editor stage expects) and `createRawWriter` +
 * `createEvidenceRegistry` (literal replacements, byte-identical, proven by construction) plus
 * the opened codec's proof citations materialized from the trusted host inventory.
 *
 * What this module adds is everything the *browser* makes true and the host cannot know:
 *
 *  - **Not every open file can be written.** A file picked with `showOpenFilePicker` or found under
 *    a `showDirectoryPicker` grant carries a handle with `createWritable()`. A file that arrived
 *    through a plain `<input type="file">`, a drop or a same-origin fetch carries no handle at all
 *    and can never be saved from this page. `describeEditability` answers which of the two an entry
 *    is, and the shell drops the editable stages for the second — an editor that could never save
 *    would be exactly the lie this app refused to tell when it had no backend.
 *  - **Reading is granted on pick; writing has to be asked for.** `queryPermission` never prompts
 *    and is safe on load; `requestPermission` needs a user gesture, so it is only ever reached from
 *    a Save click (through `authorization.request`) or from the explicit "Enable editing" control.
 *    A denial drops the editors and says which of "denied" and "never asked" happened.
 *  - **The revision is the file's own `size`/`lastModified`.** That is the token the shell pins its
 *    `ArtifactByteSource` with and the token `revisionOf` hands the backend, so a file that changed
 *    under the tab fails the conditional write at prepare — as a conflict, not as an overwrite.
 *  - **The hex editor speaks a different change shape.** It emits binding-keyed byte runs, not the
 *    `ChangeSet` of `SourceEdit`s that a `Writer` validates. `normalizeChangeSet` translates, and
 *    merges the runs into one contiguous replacement so a multi-run save is one write.
 *  - **Both edit paths are held in this page, so both go through one composition.** Path B is the
 *    shipped editors proposing a change set; Path A (ADR-HOST-002) is a codec's mutating operation
 *    returning an `edit-plan`, which `./edit-panel.ts` drives. `editorFor` hands out both from a
 *    single `createSubjectEditing`, so a tab's stages and its Edit panel share one grant snapshot
 *    and one commit coordinator — and Path A's plan is validated by `planFromOperation` before the
 *    coordinator is asked for anything, which is the check a renderer behind an RPC arm has to ask
 *    the serving side to make and a page holding the host can simply make itself.
 *
 * Nothing here touches the DOM, so all of it is unit-tested in Node against structural fakes.
 */
import { diagnostic, type Diagnostic } from '@modkit/core'
import type {
  AssetEditPlan,
  ChangeSet,
  CommitCoordinator,
  CommitRejection,
  CommitResult,
  EditAuthorizationPort,
  EditSession,
  OperationOutput,
  PermissionGrant,
  SubjectEditTarget,
  ValidationResult,
  Writer,
} from '@modkit/sdk'
import {
  subjectFidelityEvidenceRecords,
  createEvidenceRegistry,
  createRawWriter,
  createSubjectEditing,
  serviceProviderFidelityEvidenceRecord,
  type Inventory,
  type OpenedSubject,
  type SubjectEditing,
  type SubjectEditorPorts,
} from '@modkit/host'
import { createBrowserEditingBackend, type BrowserEditingBackend } from '@modkit/host/browser'
import type { UiLocalizer } from '@modkit/ui/localization'

import {
  isWritableHandle,
  type WebFileAccess,
  type WebFileSnapshot,
  type WebPermissionState,
  type WebWritableFileHandleLike,
} from './files.js'
import { createWebLocalizer } from './localization.js'

/** Scheme the shell mints subject source URIs under. One entry id, one source. */
export const WEB_SOURCE_SCHEME = 'file-picker://'

/** The source id/uri for one explorer entry. Encoded, so a nested path stays one opaque id. */
export const sourceUriFor = (entryId: string): string =>
  `${WEB_SOURCE_SCHEME}${encodeURIComponent(entryId)}`

/**
 * The revision token this host pins a file's source with.
 *
 * It has to be the same function on both sides: the shell stamps it on the `ArtifactByteSource`
 * it opens, and the backend recomputes it from the live handle at prepare. Keyed on `size` and
 * `lastModified` because those are the only two things a `FileSystemFileHandle` offers without
 * reading the file, and together they catch every edit a normal tool makes.
 */
export const sourceRevisionToken = (snapshot: WebFileSnapshot): string =>
  `provider-token:${snapshot.size}-${snapshot.lastModified}`

// ---------------------------------------------------------------------------------------------
// editability

/**
 * Why an entry does or does not get the editor stages.
 *
 * `no-handle` is about the file, the other four are about permission. They are kept apart because
 * the user can do something about one of them and nothing about the other.
 */
export type EditabilityState =
  'granted' | 'prompt' | 'denied' | 'no-handle' | 'no-permission-surface'

export interface EditabilityReport {
  readonly state: EditabilityState
  /** Whether the editable stages may be offered for this entry at all. */
  readonly editable: boolean
  /** One sentence for the UI, naming what happened rather than that something did. */
  readonly sentence: string
}

const report = (state: EditabilityState, editable: boolean, sentence: string): EditabilityReport =>
  Object.freeze({ state, editable, sentence })

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Whether this entry can be edited, asked without prompting anybody.
 *
 * Deliberately generous about `prompt`: a file the browser has not been asked about yet *is*
 * editable — the editors appear and the Save click is what raises the prompt. Only an outright
 * `denied`, or a file with no handle at all, drops the stages.
 */
export async function describeEditability(
  access: WebFileAccess | undefined,
  entryId: string,
  name: string = entryId,
  localizer: UiLocalizer = createWebLocalizer('en'),
): Promise<EditabilityReport> {
  const handle = access?.handleOf(entryId)
  if (!isWritableHandle(handle)) {
    return report('no-handle', false, localizer.text('web.editability.noHandle', { name }))
  }
  const grant = access?.writeGrant ?? handle
  let state: WebPermissionState | undefined
  try {
    state = await grant.queryPermission?.({ mode: 'readwrite' })
  } catch (error) {
    return report(
      'no-permission-surface',
      true,
      localizer.text('web.editability.queryFailed', { name, reason: describe(error) }),
    )
  }
  if (state === undefined) {
    return report(
      'no-permission-surface',
      true,
      localizer.text('web.editability.noQuery', { name }),
    )
  }
  if (state === 'denied') {
    return report('denied', false, localizer.text('web.editability.denied', { name }))
  }
  if (state === 'granted') {
    return report('granted', true, localizer.text('web.editability.granted', { name }))
  }
  return report('prompt', true, localizer.text('web.editability.prompt', { name }))
}

export interface WriteAccessRequest {
  readonly state: EditabilityState
  readonly sentence: string
}

/**
 * Ask the browser for write access, from a user gesture.
 *
 * `requestPermission` is only honoured while the page holds transient user activation, which is
 * why every caller is a click handler — never boot, never a tab switch.
 */
export async function requestWriteAccess(
  access: WebFileAccess | undefined,
  localizer: UiLocalizer = createWebLocalizer('en'),
): Promise<WriteAccessRequest> {
  const grant = access?.writeGrant
  if (access === undefined) {
    return { state: 'no-handle', sentence: localizer.text('web.editability.request.noFile') }
  }
  if (grant === undefined) {
    return {
      state: 'no-handle',
      sentence: localizer.text('web.editability.request.noHandle', { name: access.label }),
    }
  }
  const ask = grant.requestPermission
  if (ask === undefined) {
    return {
      state: 'no-permission-surface',
      sentence: localizer.text('web.editability.request.noSurface', { name: access.label }),
    }
  }
  try {
    const state = await ask.call(grant, { mode: 'readwrite' })
    if (state === 'granted') {
      return {
        state: 'granted',
        sentence: localizer.text('web.editability.request.granted', { name: access.label }),
      }
    }
    return {
      state: state === 'denied' ? 'denied' : 'prompt',
      sentence: localizer.text(
        state === 'denied'
          ? 'web.editability.request.denied'
          : 'web.editability.request.notGranted',
        { name: access.label },
      ),
    }
  } catch (error) {
    return {
      state: 'no-permission-surface',
      sentence: localizer.text('web.editability.request.failed', {
        name: access.label,
        reason: describe(error),
      }),
    }
  }
}

// ---------------------------------------------------------------------------------------------
// change-set normalisation

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

interface ByteRun {
  readonly offset: number
  readonly bytes: Uint8Array
}

/** The byte runs a hex editor emits, or `undefined` when the edits are not runs at all. */
function byteRuns(value: unknown): readonly ByteRun[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const runs: ByteRun[] = []
  for (const item of value) {
    if (!isRecord(item)) return undefined
    const range = item['range']
    const payload = item['payload']
    if (!isRecord(range) || !isRecord(payload)) return undefined
    if (range['kind'] !== 'bytes' || typeof range['offset'] !== 'bigint') return undefined
    if (payload['kind'] !== 'inline' || !(payload['bytes'] instanceof Uint8Array)) return undefined
    const offset = Number(range['offset'])
    if (!Number.isSafeInteger(offset) || offset < 0) return undefined
    runs.push({ offset, bytes: payload['bytes'] })
  }
  return runs
}

/**
 * Fold several byte runs into one contiguous replacement over the bytes the tab loaded.
 *
 * Two runs would otherwise become two edits in one plan, and the coordinator hands an atomic
 * backend a whole batch pinned to a single expected revision — so the second write in the batch is
 * refused as a lost conditional write against the revision the first one just created. Merging is
 * also simply the truthful description of the edit: the gap between two changed bytes is the
 * source's own bytes, written back unchanged.
 */
export function mergeByteRuns(runs: readonly ByteRun[], original: Uint8Array): ByteRun | undefined {
  if (runs.length === 0) return undefined
  let start = Number.MAX_SAFE_INTEGER
  let end = 0
  for (const run of runs) {
    start = Math.min(start, run.offset)
    end = Math.max(end, run.offset + run.bytes.byteLength)
  }
  if (start > end || end > original.byteLength) return undefined
  const window = original.slice(start, end)
  for (const run of runs) window.set(run.bytes, run.offset - start)
  return { offset: start, bytes: window }
}

/**
 * A change set a `Writer` can validate.
 *
 * The text editor already builds one (`targets` plus `replace` edits), and it is passed through
 * untouched. The hex editor builds `{ baseRevisions, edits: [{ kind, bindingId, range, payload }] }`
 * instead, which is not a `ChangeSet` at all: the raw writer would read `change.targets` as
 * `undefined` and throw. Rather than let one shipped editor be permanently unable to save, this
 * host translates the shape it is handed. The translation invents nothing — the same offsets, the
 * same bytes, this subject's own target and source.
 */
export function normalizeChangeSet(
  change: unknown,
  targets: readonly SubjectEditTarget[],
  original: Uint8Array,
  localizer: UiLocalizer = createWebLocalizer('en'),
): ChangeSet | undefined {
  if (!isRecord(change)) return undefined
  const declared = change['targets']
  if (Array.isArray(declared) && declared.length > 0) return change as unknown as ChangeSet
  const target = targets[0]
  if (target === undefined) return undefined
  const runs = byteRuns(change['edits'])
  if (runs === undefined) return undefined
  const merged = mergeByteRuns(runs, original)
  if (merged === undefined) return undefined
  return {
    targets,
    edits: [
      {
        operation: 'replace',
        targetId: target.targetId,
        source: target.ownerSource,
        range: {
          kind: 'bytes',
          offset: BigInt(merged.offset),
          length: BigInt(merged.bytes.byteLength),
        },
        payload: { kind: 'inline', bytes: merged.bytes },
        label: localizer.text('web.edit.bytesLabel'),
      },
    ],
    provenance: { actor: 'user' },
  }
}

// ---------------------------------------------------------------------------------------------
// refusal wording

/** A commit rejection in words, so a refused save never reads as a generic failure. */
export function describeRejection(
  reason: CommitRejection,
  localizer: UiLocalizer = createWebLocalizer('en'),
): string {
  switch (reason) {
    case 'stale-revision':
      return localizer.text('web.edit.rejection.staleRevision')
    case 'permission-missing':
      return localizer.text('web.edit.rejection.permissionMissing')
    case 'write-scope-mismatch':
      return localizer.text('web.edit.rejection.scopeMismatch')
    case 'guarantee-unachievable':
      return localizer.text('web.edit.rejection.guarantee')
    case 'fidelity-unproven':
      return localizer.text('web.edit.rejection.fidelity')
    case 'confirmation-required':
      return localizer.text('web.edit.rejection.confirmation')
    case 'payload-unavailable':
      return localizer.text('web.edit.rejection.payload')
    case 'source-read-only':
      return localizer.text('web.edit.rejection.readOnly')
    case 'cancelled':
      return localizer.text('web.edit.rejection.cancelled')
    default:
      return localizer.text('web.edit.rejection.unknown')
  }
}

const firstMessage = (diagnostics: readonly Diagnostic[]): string | undefined =>
  diagnostics[0]?.message

// ---------------------------------------------------------------------------------------------
// fidelity evidence policy

/**
 * This app accepts the raw writer's structural record plus declarations from the bundled codec
 * that actually opened the subject, and from the container codec it came through when it is a
 * container's member. Provider version and artifact digest come from inventory; installed
 * extensions cannot self-vouch because the host helper's default origin is bundled.
 */
export function webEditEvidence(
  inventory: Inventory,
  opened: Pick<OpenedSubject, 'selected' | 'descriptor' | 'carrier'>,
  selectedWriter?: Writer,
) {
  let registry = subjectFidelityEvidenceRecords(inventory, {
    selected: opened.selected,
    descriptor: opened.descriptor,
    ...(opened.carrier?.descriptor.interpretation === 'codec'
      ? { carrier: { selected: opened.carrier.selected, descriptor: opened.carrier.descriptor } }
      : {}),
  }).reduce((current, record) => current.with(record), createEvidenceRegistry())
  if (selectedWriter !== undefined) {
    const writerRecord = serviceProviderFidelityEvidenceRecord(inventory, {
      writer: selectedWriter,
    })
    if (writerRecord !== undefined) registry = registry.with(writerRecord)
  }
  return registry
}

// ---------------------------------------------------------------------------------------------
// the arm

export interface WebEditingArmOptions {
  /** Host-selected locale; defaults to English for library callers. */
  readonly localizer?: UiLocalizer
  /** Trusted inventory that selected the codec and attested its artifact coordinates. */
  readonly inventory: Inventory
  /** The writable handle behind a source id; `undefined` means "this host cannot write it". */
  handleFor(sourceId: string): WebWritableFileHandleLike | undefined
  /** One sentence about what a save just did, or why it did not. */
  onNotice(message: string): void
  /** Unsaved state for one entry, so its tab can show it. */
  onDirty(entryId: string, dirty: boolean): void
  /**
   * Obtain write permission. Reached from `authorization.request`, which the shipped editors call
   * from their Save click, so the browser still sees the gesture it requires.
   */
  ensureWriteAccess(entryId: string): Promise<WebPermissionState>
  /** Ceiling on one staged payload the backend will materialize. */
  readonly maxPayloadBytes?: number
  /** Ceiling on one inline payload the coordinator will accept (default: the host's 16 MiB). */
  readonly maxInlinePayloadBytes?: number
}

export interface WebSubjectEditRequest {
  readonly entryId: string
  readonly name: string
  readonly opened: OpenedSubject
  /** The grant the subject was opened under; it must carry `write-source`. */
  readonly grant: PermissionGrant
  /** The bytes this tab loaded — the base a hex edit's runs are spliced onto. */
  readonly bytes: Uint8Array
  /** A host-resolved format writer; omitted keeps the format-blind raw writer. */
  readonly writer?: Writer
}

/** What one applied change did, or why it did not, in the words the surfaces show. */
export interface EditApplyStatus {
  readonly message: string
  readonly failed: boolean
}

/**
 * One opened subject's whole editing surface — both paths, over one coordinator.
 *
 * Path B (the shipped text and hex editors) needs `ports`; Path A (a codec's mutating operation)
 * needs `planFromOperation` and `applyPlan`. They are handed out together, from one
 * `createSubjectEditing`, so a tab's stages and its Edit panel share a single grant snapshot and a
 * single commit coordinator rather than two that happen to agree.
 */
export interface WebSubjectEditor {
  /** The four ports a `@modkit/ui` editor stage expects. */
  readonly ports: SubjectEditorPorts
  /**
   * Path A's gate: accept an operation's output as an edit plan *for this subject at its open
   * revision*, or throw with the host's own reason. In-page there is no RPC arm to do this on the
   * far side, so it is done here — before the coordinator is asked for anything.
   */
  planFromOperation(output: OperationOutput): AssetEditPlan
  /**
   * `prepare` then `commit`, through the same coordinator every save in this tab goes through.
   * The panel gains no write authority of its own: it hands over a plan, exactly as an editor does.
   */
  applyPlan(plan: AssetEditPlan): Promise<EditApplyStatus>
}

export interface WebEditingArm {
  /** The 13D backend every subject in this session writes through. */
  readonly backend: BrowserEditingBackend
  /**
   * The editing surface for one opened subject, or `undefined` when this subject cannot be edited
   * — in which case the reason has already gone to `onNotice`.
   */
  editorFor(request: WebSubjectEditRequest): WebSubjectEditor | undefined
  /** Just the editor-stage ports; `editorFor(request)?.ports`, named for what the previewer asks. */
  portsFor(request: WebSubjectEditRequest): SubjectEditorPorts | undefined
  dispose(): Promise<void>
}

/**
 * Compose the editing arm for one browser session.
 *
 * The writer allows a whole-source replacement, which is only safe because this host refuses to
 * open a file larger than it will read entirely (`EXPLORER_MAXIMUM_BYTES` in the shell): a bounded
 * editor that had loaded a prefix and saved "the whole file" would drop the rest, and that is the
 * one hazard `createRawWriter` documents.
 */
export function createWebEditingArm(options: WebEditingArmOptions): WebEditingArm {
  const localizer = options.localizer ?? createWebLocalizer('en')
  const writer = createRawWriter()
  const backend = createBrowserEditingBackend({
    handleFor: options.handleFor,
    // The same token the shell pins its sources with, passed explicitly so the two are visibly
    // one function rather than two that happen to agree today.
    revisionOf: snapshot =>
      sourceRevisionToken({ size: snapshot.size, lastModified: snapshot.lastModified ?? 0 }),
    ...(options.maxPayloadBytes === undefined ? {} : { maxPayloadBytes: options.maxPayloadBytes }),
  })

  /** Wrap the host's ports so every refusal reaches the UI with its own reason attached. */
  const speaking = (
    base: SubjectEditorPorts,
    request: WebSubjectEditRequest,
  ): SubjectEditorPorts => {
    const targets = base.edit.targets
    const notice = (line: string): void => options.onNotice(`${request.name}: ${line}`)

    const refused = (line: string): ValidationResult => {
      notice(line)
      return {
        valid: false,
        diagnostics: [diagnostic('error', 'x3.app.web/edit-change-unsupported', line)],
      }
    }

    const edit: EditSession = {
      revision: base.edit.revision,
      targets,
      state: () => base.edit.state(),
      async propose(change) {
        const normalized = normalizeChangeSet(change, targets, request.bytes, localizer)
        if (normalized === undefined) {
          return refused(localizer.text('web.edit.changeUnsupported'))
        }
        // A proposed change is an unsaved change: the tab is dirty from here until a commit.
        options.onDirty(request.entryId, true)
        const result = await base.edit.propose(normalized)
        if (!result.valid) {
          notice(firstMessage(result.diagnostics) ?? localizer.text('web.edit.writerRefused'))
        }
        return result
      },
      async plan(change) {
        const normalized = normalizeChangeSet(change, targets, request.bytes, localizer)
        if (normalized === undefined) {
          throw new TypeError(localizer.text('web.edit.planUnsupported'))
        }
        return base.edit.plan(normalized)
      },
      dispose: () => base.edit.dispose(),
    }

    const announce = (result: CommitResult, what: string): CommitResult => {
      if (result.state === 'committed') {
        options.onDirty(request.entryId, false)
        /*
         * The tab still holds the revision it read, and the write just moved the file past it, so
         * a second save from the same tab is refused as a conflict. Saying so beats letting the
         * user discover it — re-pinning would need the subject reopened at the receipt's revision,
         * which neither the shipped editors nor `createCodecPreview` can ask for today.
         */
        notice(localizer.text('web.edit.commit.writtenReopen', { what }))
      } else if (result.state === 'not-applied') {
        const diagnosticMessage = firstMessage(result.diagnostics)
        notice(
          localizer.text('web.edit.commit.refused', {
            what,
            reason: describeRejection(result.reason, localizer),
            diagnostic: diagnosticMessage === undefined ? '' : ` (${diagnosticMessage})`,
          }),
        )
      } else if (result.state === 'rolled-back') {
        notice(localizer.text('web.edit.commit.rolledBack', { what }))
      } else {
        notice(localizer.text('web.edit.commit.partial', { what }))
      }
      return result
    }

    const commit: CommitCoordinator = {
      async prepare(plan, prepareOptions) {
        const result = await base.commit.prepare(plan, prepareOptions)
        if (result.state === 'conflict') {
          notice(localizer.text('web.edit.commit.conflict'))
        } else if (result.state === 'rejected') {
          notice(
            localizer.text('web.edit.commit.rejected', {
              reason: describeRejection(result.reason, localizer),
            }),
          )
        }
        return result
      },
      async commit(prepared, commitOptions) {
        return announce(
          await base.commit.commit(prepared, commitOptions),
          localizer.text('web.edit.action.saved'),
        )
      },
      async undo(transactionId, undoOptions) {
        return announce(
          await base.commit.undo(transactionId, undoOptions),
          localizer.text('web.edit.action.undo'),
        )
      },
      async redo(transactionId, redoOptions) {
        return announce(
          await base.commit.redo(transactionId, redoOptions),
          localizer.text('web.edit.action.redo'),
        )
      },
      discardHistory: transactionId => base.commit.discardHistory(transactionId),
    }

    /*
     * The permission gate. An editor calls this from its Save click, so the browser still holds the
     * transient activation `requestPermission` needs — asking on load would be refused by the
     * browser and would be a prompt nobody asked for.
     */
    const authorization: EditAuthorizationPort = {
      async request(plan, requestOptions) {
        const state = await options.ensureWriteAccess(request.entryId)
        if (state !== 'granted') {
          notice(
            state === 'denied'
              ? localizer.text('web.edit.authorization.denied')
              : localizer.text('web.edit.authorization.notGranted', { state }),
          )
          return undefined
        }
        return base.authorization.request(plan, requestOptions)
      },
    }

    return Object.freeze({ edit, commit, payloads: base.payloads, authorization })
  }

  /**
   * Path A over one subject's ports: authorize, prepare, commit — and say which of the three
   * refused, in that layer's own vocabulary. Nothing here writes; the coordinator does.
   */
  const applying =
    (ports: SubjectEditorPorts, request: WebSubjectEditRequest) =>
    async (plan: AssetEditPlan): Promise<EditApplyStatus> => {
      /*
       * The same gate a Save click goes through, for the same reason: `requestPermission` is only
       * honoured while the page holds transient user activation, and the Apply click is the
       * activation. It also hands back the host-issued snapshot `prepare` and `commit` validate —
       * the panel never sees, holds or mints a grant.
       */
      const authorized = await ports.authorization.request(plan)
      if (authorized === undefined) {
        return {
          message: localizer.text('web.edit.apply.noAccess', { name: request.name }),
          failed: true,
        }
      }
      const prepared = await ports.commit.prepare(plan, { grant: authorized.grant })
      if (prepared.state === 'conflict') {
        return {
          message: localizer.text('web.edit.apply.conflict', {
            reason: describeRejection('stale-revision', localizer),
            conflicts: prepared.conflicts.length,
          }),
          failed: true,
        }
      }
      if (prepared.state === 'rejected') {
        return {
          message: localizer.text('web.edit.apply.rejected', {
            reason: describeRejection(prepared.reason, localizer),
            code: prepared.reason,
          }),
          failed: true,
        }
      }
      const result = await ports.commit.commit(prepared.prepared, { grant: authorized.grant })
      if (result.state === 'committed') {
        return {
          message: localizer.text('web.edit.apply.committed', { name: request.name }),
          failed: false,
        }
      }
      if (result.state === 'not-applied') {
        return {
          message: localizer.text('web.edit.apply.notApplied', {
            reason: describeRejection(result.reason, localizer),
            code: result.reason,
          }),
          failed: true,
        }
      }
      if (result.state === 'rolled-back') {
        return {
          message: localizer.text('web.edit.apply.rolledBack', { name: request.name }),
          failed: true,
        }
      }
      return {
        message: localizer.text('web.edit.apply.partial', { name: request.name }),
        failed: true,
      }
    }

  const arm: WebEditingArm = {
    backend,

    editorFor(request) {
      let editing: SubjectEditing
      try {
        const selectedWriter = request.writer ?? writer
        const evidence = webEditEvidence(options.inventory, request.opened, request.writer)
        editing = createSubjectEditing({
          opened: request.opened,
          grant: request.grant,
          // One backend, and only for a source this session really holds a handle for: an unknown
          // source must reach `derive` as "no backend", not as a backend that would refuse later.
          backendFor: sourceId => (options.handleFor(sourceId) === undefined ? undefined : backend),
          evidenceFor: plan => evidence.evidenceFor(plan),
          writer: selectedWriter,
          /*
           * No `expectedWriter`. It pins every committed plan's evidence to *one* writer identity,
           * which was right while the raw writer was the only thing that could produce a plan here
           * — and is wrong the moment this app offers a codec's mutating operations, because those
           * plans are the codec's and their evidence names the codec. The pin is not the check it
           * looks like either: this subject's inventory-derived registry already names, record by
           * record, which writer proved which claim, and an absent record is still refused.
           */
          ...(options.maxInlinePayloadBytes === undefined
            ? {}
            : { maxInlinePayloadBytes: options.maxInlinePayloadBytes }),
        })
      } catch (error) {
        options.onNotice(
          localizer.text('web.edit.cannotEdit', {
            name: request.name,
            reason: describe(error),
          }),
        )
        return undefined
      }
      const base = editing.editorPorts
      if (base === undefined) {
        options.onNotice(localizer.text('web.edit.noWriter', { name: request.name }))
        return undefined
      }
      const ports = speaking(base, request)
      return Object.freeze({
        ports,
        // Bound to the `SubjectEditing` that issued the grant snapshot: the plan is checked against
        // *this* subject at *this* revision, which is the check a renderer over an RPC arm has to
        // ask the serving side for and a page holding the host can simply make.
        planFromOperation: (output: OperationOutput) => editing.planFromOperation(output),
        applyPlan: applying(ports, request),
      })
    },

    portsFor(request) {
      return arm.editorFor(request)?.ports
    },

    async dispose() {
      await backend.dispose()
    },
  }
  return Object.freeze(arm)
}
