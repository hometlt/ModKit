/**
 * The application's rule for offering a codec's *mutating* operations (ADR-HOST-002 Path A).
 *
 * A mutating operation does not write. It returns `{ kind: 'edit-plan', plan }`, and the plan is
 * committed by main through the S14 editing arm. Two facts decide whether this app may offer one
 * at all, and both are checked here rather than at the click:
 *
 *  1. the tab holds an editing arm — main's answer to "will I write this file". Without one the
 *     open grant lacks `write-source`, the host gate refuses the invoke, and drawing the control
 *     would be drawing a refusal;
 *  2. this app can honestly construct the operation's input. The input shape belongs to the codec,
 *     not to the descriptor, so a form exists per *handler* the app actually knows. A mutating
 *     operation with no form is reported as unsupported in words — never as a control that
 *     collects nothing and invokes with `null`.
 *
 * Everything in this file is data and pure functions: no DOM, no ports, no session. `./edit-panel.ts`
 * draws it and `./editor-ports.ts` commits what it produces, so the rules stay testable in Node.
 */
import type { AssetEditPlan, JsonValue, OperationResult } from '@modkit/sdk'
import { DEFAULT_UI_LOCALIZER, type UiLocalizer } from '@modkit/ui/localization'

import { descriptorOperations } from './view-policy.js'

// ---------------------------------------------------------------------------------------------
// forms

/** One value the app collects from the user before it can build an operation input. */
export interface EditOperationField {
  readonly name: string
  readonly label: string
  /** `text` is taken as written; `content` is UTF-8 encoded and base64'd for a bytes parameter. */
  readonly kind: 'text' | 'content'
  /*
   * Both kinds are collected through a single-line control, whose value sanitisation strips
   * newlines — so a default containing one declares something the control cannot hold, and the
   * user silently gets different bytes than the table promised. Keep defaults single-line until
   * there is a multi-line control to collect them with.
   */
  /** Prefilled so the control is usable without knowing the format's vocabulary by heart. */
  readonly initial: string
  /** Shown beside the field; says what the codec will accept, in the codec's own words. */
  readonly hint?: string
  /** An empty value is refused before the invoke when this is true. */
  readonly required: boolean
}

/** One offered action: a verb of the descriptor, a handler of the codec, and its input shape. */
export interface EditOperationForm {
  /** Unique within a subject: several forms may share one handler (add / remove / rename). */
  readonly id: string
  readonly label: string
  /** The standard verb the descriptor declares (`edit.field`, `edit.structure`, `edit.content`). */
  readonly operationId: string
  /** The codec handler the descriptor names for that verb; this is what `invoke` is given. */
  readonly handlerId: string
  /** What committing this will do, in one sentence, for the panel to show before the click. */
  readonly summary: string
  readonly fields: readonly EditOperationField[]
  /** Build the codec's input, or throw with the reason the value cannot be used. */
  build(values: ReadonlyMap<string, string>): JsonValue
}

/** A mutating operation the descriptor declares and this application will not draw a form for. */
export interface UnsupportedEditOperation {
  readonly operationId: string
  readonly handlerId: string
  readonly reason: string
}

export interface EditOffer {
  readonly forms: readonly EditOperationForm[]
  readonly unsupported: readonly UnsupportedEditOperation[]
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/' as const

/**
 * Base64 without `btoa`.
 *
 * The renderer has `btoa` and Node has its own; neither is a promise this module wants to make,
 * because the unit tests run in Node and the panel runs in a browser realm. Twelve lines of table
 * lookup behave identically in both.
 */
export function base64OfUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const first = bytes[at] ?? 0
    const second = bytes[at + 1]
    const third = bytes[at + 2]
    const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)
    out += BASE64[(triple >> 18) & 63] ?? ''
    out += BASE64[(triple >> 12) & 63] ?? ''
    out += second === undefined ? '=' : (BASE64[(triple >> 6) & 63] ?? '')
    out += third === undefined ? '=' : (BASE64[triple & 63] ?? '')
  }
  return out
}

class RequiredFieldError extends TypeError {
  constructor(readonly fieldName: string) {
    super(fieldName)
  }
}

const required = (values: ReadonlyMap<string, string>, name: string): string => {
  const value = values.get(name) ?? ''
  if (value === '') throw new RequiredFieldError(name)
  return value
}

const field = (
  name: string,
  label: string,
  initial: string,
  options: { readonly kind?: EditOperationField['kind']; readonly hint?: string } = {},
): EditOperationField =>
  Object.freeze({
    name,
    label,
    kind: options.kind ?? 'text',
    initial,
    required: true,
    ...(options.hint === undefined ? {} : { hint: options.hint }),
  })

const form = (definition: EditOperationForm): EditOperationForm => Object.freeze(definition)

/**
 * The forms this application ships, keyed by the codec handler they build input for.
 *
 * Keyed by handler and not by verb on purpose: `edit.field` on a PNG is `{ keyword, text }` for a
 * `tEXt` chunk, on a JPEG it is `{ text }` for the COM segment, and on an MP3 it is
 * `{ keyword, text }` for an ID3v2 frame. The verb says what class of change it is; only the
 * handler says what to send. A codec whose handler is not listed here reaches the panel as
 * "not available in this host yet", which is the honest answer and not a broken control.
 */
const FORMS_BY_HANDLER: ReadonlyMap<string, readonly EditOperationForm[]> = new Map<
  string,
  readonly EditOperationForm[]
>([
  [
    'set-text',
    Object.freeze([
      form({
        id: 'png-set-text',
        label: 'Set a PNG text field',
        operationId: 'edit.field',
        handlerId: 'set-text',
        summary: 'Sets or replaces one tEXt chunk; every other byte of the file is kept.',
        fields: Object.freeze([
          field('keyword', 'Keyword', 'Description', {
            hint: '1–79 Latin-1 characters, no NUL (Title, Author, Description, …)',
          }),
          field('text', 'Text', 'set from the Modkit inspector', { hint: 'Latin-1, no NUL' }),
        ]),
        build: (values): JsonValue => ({
          keyword: required(values, 'keyword'),
          text: values.get('text') ?? '',
        }),
      }),
    ]),
  ],
  [
    'set-text-frame',
    Object.freeze([
      form({
        id: 'mp3-set-text-frame',
        label: 'Set an ID3v2 text frame',
        operationId: 'edit.field',
        handlerId: 'set-text-frame',
        summary:
          'Sets or replaces one ID3v2 text frame, creating the tag when the file has none; the audio is never moved.',
        fields: Object.freeze([
          field('keyword', 'Frame', 'TIT2', {
            hint: 'a four-character text frame id: TIT2, TPE1, TALB, … (TXXX has another shape)',
          }),
          field('text', 'Text', 'set from the Modkit inspector'),
        ]),
        build: (values): JsonValue => ({
          keyword: required(values, 'keyword'),
          text: values.get('text') ?? '',
        }),
      }),
    ]),
  ],
  [
    'set-comment',
    Object.freeze([
      form({
        id: 'jpeg-set-comment',
        label: 'Set the JPEG comment',
        operationId: 'edit.field',
        handlerId: 'set-comment',
        summary: 'Writes the COM segment after the APP block, replacing it in place if it exists.',
        fields: Object.freeze([field('text', 'Comment', 'set from the Modkit inspector')]),
        build: (values): JsonValue => ({ text: values.get('text') ?? '' }),
      }),
    ]),
  ],
  [
    'remove-segment',
    Object.freeze([
      form({
        id: 'jpeg-remove-segment',
        label: 'Remove a JPEG metadata segment',
        operationId: 'edit.structure',
        handlerId: 'remove-segment',
        summary:
          'Drops one metadata segment. A marker that carries the image is refused by the codec.',
        fields: Object.freeze([
          field('marker', 'Marker', 'APP0', {
            hint: 'a metadata marker name, e.g. APP0, APP1, COM',
          }),
        ]),
        build: (values): JsonValue => ({ marker: required(values, 'marker') }),
      }),
    ]),
  ],
  [
    'edit-structure',
    Object.freeze([
      form({
        id: 'zip-add-entry',
        label: 'Add an entry to the archive',
        operationId: 'edit.structure',
        handlerId: 'edit-structure',
        summary:
          'Adds one stored entry and repacks the archive; every kept entry is copied byte for byte.',
        fields: Object.freeze([
          field('path', 'Entry path', 'added/hello.txt', { hint: 'a path inside the archive' }),
          field('content', 'Contents', 'added from the Modkit inspector', {
            kind: 'content',
            hint: 'text; this host sends it as UTF-8 bytes',
          }),
        ]),
        build: (values): JsonValue => ({
          add: [
            {
              path: required(values, 'path'),
              bytes: base64OfUtf8(values.get('content') ?? ''),
            },
          ],
        }),
      }),
      form({
        id: 'zip-remove-entry',
        label: 'Remove an entry from the archive',
        operationId: 'edit.structure',
        handlerId: 'edit-structure',
        summary: 'Removes one entry and repacks; the other entries keep their exact bytes.',
        fields: Object.freeze([
          field('path', 'Entry path', 'readme.txt', {
            hint: 'the path of an entry the archive already holds',
          }),
        ]),
        build: (values): JsonValue => ({ remove: [required(values, 'path')] }),
      }),
      form({
        id: 'zip-rename-entry',
        label: 'Rename an entry in the archive',
        operationId: 'edit.structure',
        handlerId: 'edit-structure',
        summary: 'Renames one entry without touching its data or its compression.',
        fields: Object.freeze([
          field('from', 'From', 'readme.txt'),
          field('to', 'To', 'docs/readme.txt', {
            hint: 'a file cannot be renamed into a directory marker, or the other way round',
          }),
        ]),
        build: (values): JsonValue => ({
          rename: [{ from: required(values, 'from'), to: required(values, 'to') }],
        }),
      }),
    ]),
  ],
  [
    'edit-content',
    Object.freeze([
      form({
        id: 'zip-replace-entry',
        label: "Replace an entry's contents",
        operationId: 'edit.content',
        handlerId: 'edit-content',
        summary: "Replaces one file entry's payload (stored, fresh CRC); nothing else moves.",
        fields: Object.freeze([
          field('path', 'Entry path', 'readme.txt'),
          field('content', 'Contents', 'replaced from the Modkit inspector', {
            kind: 'content',
            hint: 'text; this host sends it as UTF-8 bytes',
          }),
        ]),
        build: (values): JsonValue => ({
          path: required(values, 'path'),
          bytes: base64OfUtf8(values.get('content') ?? ''),
        }),
      }),
    ]),
  ],
])

const FORM_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'png-set-text': 'pngText',
  'mp3-set-text-frame': 'id3Text',
  'jpeg-set-comment': 'jpegComment',
  'jpeg-remove-segment': 'jpegRemove',
  'zip-add-entry': 'archiveAdd',
  'zip-remove-entry': 'archiveRemove',
  'zip-rename-entry': 'archiveRename',
  'zip-replace-entry': 'archiveReplace',
})

const FIELD_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'png-set-text/keyword': 'keyword',
  'png-set-text/text': 'text',
  'mp3-set-text-frame/keyword': 'frame',
  'mp3-set-text-frame/text': 'text',
  'jpeg-set-comment/text': 'comment',
  'jpeg-remove-segment/marker': 'marker',
  'zip-add-entry/path': 'entryPath',
  'zip-add-entry/content': 'contents',
  'zip-remove-entry/path': 'entryPath',
  'zip-rename-entry/from': 'from',
  'zip-rename-entry/to': 'to',
  'zip-replace-entry/path': 'entryPath',
  'zip-replace-entry/content': 'contents',
})

const HINT_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'png-set-text/keyword': 'pngTextKey',
  'png-set-text/text': 'pngTextValue',
  'mp3-set-text-frame/keyword': 'id3FrameId',
  'jpeg-remove-segment/marker': 'metadataMarker',
  'zip-add-entry/path': 'archivePath',
  'zip-add-entry/content': 'archiveContent',
  'zip-remove-entry/path': 'archiveExistingPath',
  'zip-rename-entry/to': 'archiveRenameType',
  'zip-replace-entry/content': 'archiveContent',
})

function localizeForm(form: EditOperationForm, localizer: UiLocalizer): EditOperationForm {
  const formKey = FORM_KEYS[form.id]
  const fields = Object.freeze(
    form.fields.map(item => {
      const fieldKey = FIELD_KEYS[`${form.id}/${item.name}`]
      const hintKey = HINT_KEYS[`${form.id}/${item.name}`]
      return Object.freeze({
        ...item,
        label: fieldKey === undefined ? item.label : localizer.text(`edit.field.${fieldKey}`),
        ...(item.hint === undefined
          ? {}
          : {
              hint: hintKey === undefined ? item.hint : localizer.text(`edit.hint.${hintKey}`),
            }),
      })
    }),
  )
  const labels = new Map(fields.map(item => [item.name, item.label]))
  return Object.freeze({
    ...form,
    label: formKey === undefined ? form.label : localizer.text(`edit.operation.${formKey}`),
    summary: formKey === undefined ? form.summary : localizer.text(`edit.summary.${formKey}`),
    fields,
    build(values: ReadonlyMap<string, string>): JsonValue {
      try {
        return form.build(values)
      } catch (error) {
        if (error instanceof RequiredFieldError) {
          throw new TypeError(
            localizer.text('edit.required', {
              field: labels.get(error.fieldName) ?? error.fieldName,
            }),
          )
        }
        throw error
      }
    },
  })
}

// ---------------------------------------------------------------------------------------------
// the offer rule

export interface EditOfferOptions {
  /**
   * Whether the tab holds an editing arm. `false` means main will not write this subject, so
   * nothing mutating is offered — not even as a disabled control, because a disabled control the
   * user cannot enable explains nothing that the read-only note in the status line does not.
   */
  readonly editable: boolean
  /** Per-host language; omitted for the English-compatible pure-model default. */
  readonly localizer?: UiLocalizer
}

/**
 * What this application offers for one subject, and what it declines to offer with a reason.
 *
 * Only `state: 'available'` mutating operations are considered: a codec that disabled its own
 * operation (an encrypted or ZIP64 archive) has already said the edit cannot happen.
 */
export function editOffer(
  descriptor: Record<string, unknown>,
  options: EditOfferOptions,
): EditOffer {
  if (!options.editable) return Object.freeze({ forms: [], unsupported: [] })
  const localizer = options.localizer ?? DEFAULT_UI_LOCALIZER
  const forms: EditOperationForm[] = []
  const unsupported: UnsupportedEditOperation[] = []
  for (const operation of descriptorOperations(descriptor)) {
    if (!operation.mutatesSource || operation.state !== 'available') continue
    const known = FORMS_BY_HANDLER.get(operation.handlerId)?.filter(
      form => form.operationId === operation.id,
    )
    if (known === undefined || known.length === 0) {
      unsupported.push({
        operationId: operation.id,
        handlerId: operation.handlerId,
        reason: localizer.text('edit.unsupportedInput', { handler: operation.handlerId }),
      })
      continue
    }
    forms.push(...known.map(item => localizeForm(item, localizer)))
  }
  return Object.freeze({ forms: Object.freeze(forms), unsupported: Object.freeze(unsupported) })
}

/** Whether the Edit panel has anything to draw for this subject. */
export function offersEditOperations(
  descriptor: Record<string, unknown>,
  options: EditOfferOptions,
): boolean {
  const offer = editOffer(descriptor, options)
  return offer.forms.length > 0 || offer.unsupported.length > 0
}

// ---------------------------------------------------------------------------------------------
// results

/**
 * Why the host refused an invoke, in the host's own vocabulary plus plain words.
 *
 * `permission-missing` is the one a user meets: the subject was opened without `write-source`
 * because main would not write the file. Saying "failed" there would hide the only fact that
 * matters.
 */
const INVOKE_REASON_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'not-declared': 'notDeclared',
  disabled: 'disabled',
  'dependency-required': 'dependencyRequired',
  'permission-missing': 'permissionMissing',
  'input-not-serializable': 'inputNotSerializable',
  'handler-unregistered': 'handlerUnregistered',
  cancelled: 'cancelled',
  'stale-revision': 'staleRevision',
})

export function invokeRefusalMessage(
  result: {
    readonly reason: string
    readonly diagnostics?: readonly { readonly message: string }[]
  },
  localizer: UiLocalizer = DEFAULT_UI_LOCALIZER,
): string {
  const reasonKey = INVOKE_REASON_KEYS[result.reason]
  const plain = reasonKey === undefined ? undefined : localizer.text(`edit.refusal.${reasonKey}`)
  const detail = result.diagnostics?.[0]?.message
  const head =
    plain === undefined
      ? localizer.text('edit.invokeRefused', { reason: result.reason })
      : localizer.text('edit.invokeRefusedCode', { reason: plain, code: result.reason })
  return detail === undefined ? head : localizer.text('edit.invokeRefusedDetail', { head, detail })
}

/**
 * The `edit-plan` an ADR-HOST-002 Path A operation returns.
 *
 * Refuses any other output kind rather than casting: an operation declared as mutating that hands
 * back JSON has not produced anything committable, and the arm would refuse it later with a much
 * worse message. `planFromOperation` on the serving side re-checks the plan against the subject.
 */
export function editPlanFromOperationOutput(
  output: unknown,
  localizer: UiLocalizer = DEFAULT_UI_LOCALIZER,
): AssetEditPlan {
  const value = output as { readonly kind?: unknown; readonly plan?: unknown } | undefined
  if (value?.kind !== 'edit-plan' || typeof value.plan !== 'object' || value.plan === null) {
    throw new TypeError(
      localizer.text('edit.operationReturnedWrongKind', {
        kind: String(value?.kind ?? localizer.text('edit.returnedNothing')),
      }),
    )
  }
  return value.plan as AssetEditPlan
}

/** One line per applied operation, the shape the self-test prints and the tests assert on. */
export function editSelfTestLine(
  name: string,
  formId: string,
  status: string,
  changed: boolean,
): string {
  return `selftest: edit-op ${name} ${formId} status=${JSON.stringify(status)} changed=${String(changed)}`
}

/** Narrowing helper shared by the panel and its tests. */
export const isRejected = (
  result: OperationResult,
): result is Extract<OperationResult, { state: 'rejected' }> => result.state === 'rejected'
