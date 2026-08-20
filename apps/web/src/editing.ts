/**
 * The PWA's editing arm: what it takes for a browser tab to save a file in place.
 *
 * Three host pieces already exist and are composed here rather than reimplemented:
 * `createBrowserEditingBackend` (File System Access writable streams, with a pre-image rollback),
 * `createSubjectEditing` (13D targets, grant snapshot, commit coordinator, and the four
 * `editorPorts` a `@modkitx-x3/ui` editor stage expects) and `createRawWriter` +
 * `createEvidenceRegistry` (literal replacements, byte-identical, proven by construction — see
 * `WEB_EDIT_EVIDENCE` for the records this application adds to that floor).
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
import { diagnostic, type Diagnostic } from '@modkitx-x3/core'
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
} from '@modkitx-x3/sdk'
import {
  ZIP_VERBATIM_REASSEMBLY_RECORDS,
  createEvidenceRegistry,
  createRawWriter,
  createSubjectEditing,
  type EvidenceRegistry,
  type OpenedSubject,
  type SubjectEditing,
  type SubjectEditorPorts,
} from '@modkitx-x3/host'
import { createBrowserEditingBackend, type BrowserEditingBackend } from '@modkitx-x3/host/browser'

import {
  isWritableHandle,
  type WebFileAccess,
  type WebFileSnapshot,
  type WebPermissionState,
  type WebWritableFileHandleLike,
} from './files.js'

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
): Promise<EditabilityReport> {
  const handle = access?.handleOf(entryId)
  if (!isWritableHandle(handle)) {
    return report(
      'no-handle',
      false,
      `${name} has no writable handle: it arrived through a file input, a drop or a fetch, so this ` +
        'page can show it but can never save it back. Pick it through "Open file…" or a folder to edit it.',
    )
  }
  const grant = access?.writeGrant ?? handle
  let state: WebPermissionState | undefined
  try {
    state = await grant.queryPermission?.({ mode: 'readwrite' })
  } catch (error) {
    return report(
      'no-permission-surface',
      true,
      `${name} has a writable handle, but this browser could not report its write permission ` +
        `(${describe(error)}); the first save is where it is decided.`,
    )
  }
  if (state === undefined) {
    return report(
      'no-permission-surface',
      true,
      `${name} has a writable handle, but this browser exposes no permission query, so whether ` +
        'the write is allowed is decided by the first save.',
    )
  }
  if (state === 'denied') {
    return report(
      'denied',
      false,
      `Write access was denied for ${name}, so its text and hex editors are dropped. This build ` +
        'will not offer a save it already knows the browser refuses.',
    )
  }
  if (state === 'granted') {
    return report('granted', true, `${name} can be saved in place: write access is granted.`)
  }
  return report(
    'prompt',
    true,
    `${name} can be saved in place once you allow write access; the browser asks on the first ` +
      'save, or use "Enable editing" to answer it now.',
  )
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
): Promise<WriteAccessRequest> {
  const grant = access?.writeGrant
  if (access === undefined) {
    return { state: 'no-handle', sentence: 'Open a folder or pick a file before enabling editing.' }
  }
  if (grant === undefined) {
    return {
      state: 'no-handle',
      sentence:
        `${access.label} has no writable handle: files opened through a drop, a plain file input ` +
        'or a fetch cannot be written back. Use "Open file…" or a granted folder instead.',
    }
  }
  const ask = grant.requestPermission
  if (ask === undefined) {
    return {
      state: 'no-permission-surface',
      sentence:
        `${access.label} cannot be asked for write permission in this browser; a save will try ` +
        'directly and report what the browser answers.',
    }
  }
  try {
    const state = await ask.call(grant, { mode: 'readwrite' })
    if (state === 'granted') {
      return {
        state: 'granted',
        sentence: `Write access granted for ${access.label}: the text and hex editors can save.`,
      }
    }
    return {
      state: state === 'denied' ? 'denied' : 'prompt',
      sentence:
        state === 'denied'
          ? `Write access denied for ${access.label}; files opened from now on show no editor.`
          : `Write access was not granted for ${access.label}; nothing was changed.`,
    }
  } catch (error) {
    return {
      state: 'no-permission-surface',
      sentence: `Asking for write access to ${access.label} failed: ${describe(error)}`,
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
        label: 'Edit bytes',
      },
    ],
    provenance: { actor: 'user' },
  }
}

// ---------------------------------------------------------------------------------------------
// refusal wording

/** A commit rejection in words, so a refused save never reads as a generic failure. */
export function describeRejection(reason: CommitRejection): string {
  switch (reason) {
    case 'stale-revision':
      return 'the file changed on disk after this tab read it'
    case 'permission-missing':
      return 'the grant this subject was opened under does not carry write permission'
    case 'write-scope-mismatch':
      return 'the plan names a source outside this subject'
    case 'guarantee-unachievable':
      return 'this backend cannot promise the guarantee the plan asks for'
    case 'fidelity-unproven':
      return 'no evidence proves the writer keeps what the plan claims it keeps'
    case 'confirmation-required':
      return 'a lossy write needs an explicit confirmation this host does not collect'
    case 'payload-unavailable':
      return 'the edited bytes exceed what this host will hand over inline'
    case 'source-read-only':
      return 'the backend behind this source is read-only'
    case 'cancelled':
      return 'the save was cancelled'
    default:
      return 'the plan did not describe this subject at its open revision'
  }
}

const firstMessage = (diagnostics: readonly Diagnostic[]): string | undefined =>
  diagnostics[0]?.message

// ---------------------------------------------------------------------------------------------
// fidelity evidence policy

/**
 * Which fidelity claims this application is willing to commit, and what proves each
 * (ADR-HOST-002 §6). A claim with no record is `fidelity-unproven` and nothing is written — the
 * right default, and the reason this list is explicit rather than a blanket "trust the codec".
 *
 * The registry's own record covers every `{byte-identical, preservesUnknownData: true}` plan: the
 * host raw writer's (Path B, the text and hex editors) and the metadata edits of the PNG, JPEG and
 * MP3 codecs, which splice one byte range and leave every other byte where it was.
 *
 * A ZIP edit is a different fact. The codec re-assembles the whole archive, so it claims
 * `semantic`, and what proves the re-assembly is verbatim is a corpus run rather than a
 * construction argument: `packages/host/test/archive-edits.test.ts` compares every kept entry's
 * local header, compressed data and central-directory record byte for byte against an independent
 * ZIP reader, and checks a kept deflated entry still inflates. Two records, because the codec
 * downgrades its own claim honestly for an archive whose layout the central directory does not
 * account for, and "keeps every unknown byte" and "does not" are two different claims.
 *
 * This is *this app's* policy, held here rather than shared with the Electron host: a browser tab
 * and a desktop application are two different places to decide what may be written, even when they
 * happen to accept the same proofs today.
 */
/*
 * This app's acceptance decision, over facts the host publishes: the records themselves live in
 * `ZIP_VERBATIM_REASSEMBLY_RECORDS` (one place, so two apps cannot drift about what was proven),
 * and taking them is still this application's own choice — nothing is registered by default.
 */
export const WEB_EDIT_EVIDENCE: EvidenceRegistry = ZIP_VERBATIM_REASSEMBLY_RECORDS.reduce(
  (registry, record) => registry.with(record),
  createEvidenceRegistry(),
)

// ---------------------------------------------------------------------------------------------
// the arm

export interface WebEditingArmOptions {
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
  /** The four ports a `@modkitx-x3/ui` editor stage expects. */
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
  const evidence = WEB_EDIT_EVIDENCE
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
        const normalized = normalizeChangeSet(change, targets, request.bytes)
        if (normalized === undefined) {
          return refused(
            'this editor produced a change this host cannot express as a literal replacement',
          )
        }
        // A proposed change is an unsaved change: the tab is dirty from here until a commit.
        options.onDirty(request.entryId, true)
        const result = await base.edit.propose(normalized)
        if (!result.valid) {
          notice(firstMessage(result.diagnostics) ?? 'the writer refused the change')
        }
        return result
      },
      async plan(change) {
        const normalized = normalizeChangeSet(change, targets, request.bytes)
        if (normalized === undefined) {
          throw new TypeError('this host cannot plan the change set this editor produced')
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
        notice(
          `${what} — written to the file this tab opened. Reopen it before editing again: this ` +
            'tab still holds the revision it read.',
        )
      } else if (result.state === 'not-applied') {
        notice(
          `${what} refused — ${describeRejection(result.reason)}` +
            `${firstMessage(result.diagnostics) === undefined ? '' : ` (${firstMessage(result.diagnostics) ?? ''})`}.`,
        )
      } else if (result.state === 'rolled-back') {
        notice(`${what} failed and the file was rolled back to what it held before.`)
      } else {
        notice(`${what} landed only partly; recovery is available in the receipt.`)
      }
      return result
    }

    const commit: CommitCoordinator = {
      async prepare(plan, prepareOptions) {
        const result = await base.commit.prepare(plan, prepareOptions)
        if (result.state === 'conflict') {
          notice(
            'refused — the file changed on disk after this tab read it, so nothing was ' +
              'overwritten. Reopen it and redo the edit.',
          )
        } else if (result.state === 'rejected') {
          notice(`refused before writing — ${describeRejection(result.reason)}.`)
        }
        return result
      },
      async commit(prepared, commitOptions) {
        return announce(await base.commit.commit(prepared, commitOptions), 'Saved')
      },
      async undo(transactionId, undoOptions) {
        return announce(await base.commit.undo(transactionId, undoOptions), 'Undo')
      },
      async redo(transactionId, redoOptions) {
        return announce(await base.commit.redo(transactionId, redoOptions), 'Redo')
      },
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
              ? 'not saved — this browser denied write access to the file.'
              : `not saved — write access was not granted (${state}).`,
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
          message: `${request.name} was not written: this browser did not grant write access`,
          failed: true,
        }
      }
      const prepared = await ports.commit.prepare(plan, { grant: authorized.grant })
      if (prepared.state === 'conflict') {
        return {
          message:
            `refused before writing: ${describeRejection('stale-revision')} ` +
            `(${prepared.conflicts.length} conflict(s))`,
          failed: true,
        }
      }
      if (prepared.state === 'rejected') {
        return {
          message: `refused before writing: ${describeRejection(prepared.reason)} (${prepared.reason})`,
          failed: true,
        }
      }
      const result = await ports.commit.commit(prepared.prepared, { grant: authorized.grant })
      if (result.state === 'committed') {
        return { message: `applied and written to ${request.name}`, failed: false }
      }
      if (result.state === 'not-applied') {
        return {
          message: `not applied: ${describeRejection(result.reason)} (${result.reason})`,
          failed: true,
        }
      }
      if (result.state === 'rolled-back') {
        return {
          message: `not applied: the write failed and ${request.name} was rolled back`,
          failed: true,
        }
      }
      return {
        message: `${request.name} was only partly written; recovery is in the receipt`,
        failed: true,
      }
    }

  const arm: WebEditingArm = {
    backend,

    editorFor(request) {
      let editing: SubjectEditing
      try {
        editing = createSubjectEditing({
          opened: request.opened,
          grant: request.grant,
          // One backend, and only for a source this session really holds a handle for: an unknown
          // source must reach `derive` as "no backend", not as a backend that would refuse later.
          backendFor: sourceId => (options.handleFor(sourceId) === undefined ? undefined : backend),
          evidenceFor: plan => evidence.evidenceFor(plan),
          writer,
          /*
           * No `expectedWriter`. It pins every committed plan's evidence to *one* writer identity,
           * which was right while the raw writer was the only thing that could produce a plan here
           * — and is wrong the moment this app offers a codec's mutating operations, because those
           * plans are the codec's and their evidence names the codec. The pin is not the check it
           * looks like either: `WEB_EDIT_EVIDENCE` already names, record by record, which writer
           * proved which claim, and a claim with no record is still refused as `fidelity-unproven`.
           */
          ...(options.maxInlinePayloadBytes === undefined
            ? {}
            : { maxInlinePayloadBytes: options.maxInlinePayloadBytes }),
        })
      } catch (error) {
        options.onNotice(`${request.name} cannot be edited here: ${describe(error)}`)
        return undefined
      }
      const base = editing.editorPorts
      if (base === undefined) {
        options.onNotice(`${request.name} cannot be edited here: no writer backs this subject.`)
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
