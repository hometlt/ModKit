/**
 * This application's rule for offering a codec's *mutating* operations (ADR-HOST-002 Path A).
 *
 * A mutating operation does not write. It returns `{ kind: 'edit-plan', plan }`, and the plan is
 * committed through the editing arm in `./editing.ts`. Two facts decide whether the PWA may offer
 * one at all, and both are checked here rather than at the click:
 *
 *  1. the tab holds an editing surface — this page's answer to "will I write this file". In a
 *     browser that is a property of the *file*: a handle from `showOpenFilePicker` or a granted
 *     folder carries `createWritable()`, a drop, a plain file input or a same-origin fetch does
 *     not. Without one the subject was opened without `write-source`, the host gate refuses the
 *     invoke, and drawing the control would be drawing a refusal;
 *  2. this app can honestly construct the operation's input. The input shape belongs to the codec,
 *     not to the descriptor, so a form exists per *handler* this app actually knows. A mutating
 *     operation with no form is reported as unsupported in words — never as a control that collects
 *     nothing and invokes with `null`.
 *
 * The table below is *this app's* policy and deliberately not shared with the Electron host, for
 * the same reason `./views.ts` is not shared: which inputs a host can honestly construct is a
 * property of the host, exactly like which stages it will mount. The shapes agree because the
 * codecs are the same; the list is each app's own to grow or shrink.
 *
 * Everything in this file is data and pure functions: no DOM, no ports, no session. `./edit-panel.ts`
 * draws it and `./editing.ts` commits what it produces, so the rules stay testable in Node.
 */
import type {
  AnyDescriptor,
  AssetEditPlan,
  AssetOperationDescriptor,
  JsonValue,
  MetadataEntry,
  OperationResult,
} from '@modkit/sdk'

// ---------------------------------------------------------------------------------------------
// reading the descriptor

/**
 * The metadata entries of one published group, or nothing when the codec published no such group.
 *
 * Only the resolved arm of `AnyDescriptor` carries metadata; an unresolved subject has no codec and
 * therefore no mutating operation to prefill a form for.
 */
export function metadataEntries(
  descriptor: AnyDescriptor,
  groupId: string,
): readonly MetadataEntry[] {
  if (!('metadata' in descriptor)) return []
  return descriptor.metadata.find(group => group.id === groupId)?.entries ?? []
}

/** A metadata value as a string a text input can hold; anything structural is left out. */
const scalarText = (value: MetadataEntry['value']): string | undefined => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

// ---------------------------------------------------------------------------------------------
// forms

/** One value the app collects from the user before it can build an operation input. */
export interface EditOperationField {
  readonly name: string
  readonly label: string
  /**
   * `text` is taken as written; `content` is UTF-8 encoded and base64'd for a bytes parameter.
   *
   * Both are collected by a single-line control, so neither carries a newline — which is why no
   * `content` default ends in one. A form that offered a multi-line payload would need a control
   * that can hold it, and this app does not have one yet.
   */
  readonly kind: 'text' | 'content'
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
 * The page has `btoa` and Node has its own; neither is a promise this module wants to make, because
 * the unit tests run in Node and the panel runs in a browser realm. Twelve lines of table lookup
 * behave identically in both.
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

const required = (values: ReadonlyMap<string, string>, name: string, label: string): string => {
  const value = values.get(name) ?? ''
  if (value === '') throw new TypeError(`${label} is required`)
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

/** What the descriptor already says about one field: its current value, and a sharper hint. */
interface FieldPrefill {
  readonly value: string
  readonly hint?: string
}

/**
 * A form as this module stores it: the static shape, plus what the descriptor can fill in.
 *
 * `prefill` is the whole reason this table is not a copy of the Electron one. The PNG and MP3
 * codecs publish the values `edit.field` writes (`png-text`, `id3`), so a form for those two can
 * open on what the file *says* rather than on a placeholder — which is the difference between
 * "change the description" and "guess a keyword and hope".
 */
interface EditFormTemplate extends EditOperationForm {
  prefill?(descriptor: AnyDescriptor): ReadonlyMap<string, FieldPrefill>
}

const template = (definition: EditFormTemplate): EditFormTemplate => Object.freeze(definition)

const NO_PREFILL: ReadonlyMap<string, FieldPrefill> = new Map()

/** The template resolved against one subject: the same form, opened on this file's own values. */
function resolveForm(item: EditFormTemplate, descriptor: AnyDescriptor): EditOperationForm {
  const prefilled = item.prefill?.(descriptor) ?? NO_PREFILL
  if (prefilled.size === 0) {
    return Object.freeze({
      id: item.id,
      label: item.label,
      operationId: item.operationId,
      handlerId: item.handlerId,
      summary: item.summary,
      fields: item.fields,
      build: item.build,
    })
  }
  return Object.freeze({
    id: item.id,
    label: item.label,
    operationId: item.operationId,
    handlerId: item.handlerId,
    summary: item.summary,
    fields: Object.freeze(
      item.fields.map(entry => {
        const known = prefilled.get(entry.name)
        if (known === undefined) return entry
        const hint = known.hint ?? entry.hint
        return Object.freeze({
          ...entry,
          initial: known.value,
          ...(hint === undefined ? {} : { hint }),
        })
      }),
    ),
    build: item.build,
  })
}

/** ID3v2 text information frames share one shape; `TXXX` does not, so it is not one of them. */
const ID3_TEXT_FRAME = /^T[A-Z0-9]{3}$/u

/**
 * The forms this application ships, keyed by the codec handler they build input for.
 *
 * Keyed by handler and not by verb on purpose: `edit.field` on a PNG is `{ keyword, text }` for a
 * `tEXt` chunk, on a JPEG it is `{ text }` for the COM segment, and on an MP3 it is
 * `{ keyword, text }` for an ID3v2 frame. The verb says what class of change it is; only the
 * handler says what to send. A codec whose handler is not listed here reaches the panel as
 * "not available in this host yet", which is the honest answer and not a broken control.
 */
const FORMS_BY_HANDLER: ReadonlyMap<string, readonly EditFormTemplate[]> = new Map<
  string,
  readonly EditFormTemplate[]
>([
  [
    'set-text',
    Object.freeze([
      template({
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
        prefill: descriptor => {
          const entries = metadataEntries(descriptor, 'png-text')
          const first = entries[0]
          const value = first === undefined ? undefined : scalarText(first.value)
          if (first === undefined || value === undefined) return NO_PREFILL
          return new Map<string, FieldPrefill>([
            [
              'keyword',
              {
                value: first.key,
                hint: `this file already carries: ${entries.map(entry => entry.key).join(', ')}`,
              },
            ],
            ['text', { value }],
          ])
        },
        build: (values): JsonValue => ({
          keyword: required(values, 'keyword', 'Keyword'),
          text: values.get('text') ?? '',
        }),
      }),
    ]),
  ],
  [
    'set-text-frame',
    Object.freeze([
      template({
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
        prefill: descriptor => {
          // The `id3` group carries the tag's own `version`/`bytes` beside the frames; only the
          // four-character text frame ids are values `set-text-frame` can be handed back.
          const frames = metadataEntries(descriptor, 'id3').filter(entry =>
            ID3_TEXT_FRAME.test(entry.key),
          )
          const first = frames[0]
          const value = first === undefined ? undefined : scalarText(first.value)
          if (first === undefined || value === undefined) return NO_PREFILL
          return new Map<string, FieldPrefill>([
            [
              'keyword',
              {
                value: first.key,
                hint: `this tag already carries: ${frames.map(entry => entry.key).join(', ')}`,
              },
            ],
            ['text', { value }],
          ])
        },
        build: (values): JsonValue => ({
          keyword: required(values, 'keyword', 'Frame'),
          text: values.get('text') ?? '',
        }),
      }),
    ]),
  ],
  [
    'set-comment',
    Object.freeze([
      template({
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
      template({
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
        build: (values): JsonValue => ({ marker: required(values, 'marker', 'Marker') }),
      }),
    ]),
  ],
  [
    'edit-structure',
    Object.freeze([
      template({
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
            hint: 'one line of text; this host sends it as UTF-8 bytes',
          }),
        ]),
        build: (values): JsonValue => ({
          add: [
            {
              path: required(values, 'path', 'Entry path'),
              bytes: base64OfUtf8(values.get('content') ?? ''),
            },
          ],
        }),
      }),
      template({
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
        build: (values): JsonValue => ({ remove: [required(values, 'path', 'Entry path')] }),
      }),
      template({
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
          rename: [{ from: required(values, 'from', 'From'), to: required(values, 'to', 'To') }],
        }),
      }),
    ]),
  ],
  [
    'edit-content',
    Object.freeze([
      template({
        id: 'zip-replace-entry',
        label: "Replace an entry's contents",
        operationId: 'edit.content',
        handlerId: 'edit-content',
        summary: "Replaces one file entry's payload (stored, fresh CRC); nothing else moves.",
        fields: Object.freeze([
          field('path', 'Entry path', 'readme.txt'),
          field('content', 'Contents', 'replaced from the Modkit inspector', {
            kind: 'content',
            hint: 'one line of text; this host sends it as UTF-8 bytes',
          }),
        ]),
        build: (values): JsonValue => ({
          path: required(values, 'path', 'Entry path'),
          bytes: base64OfUtf8(values.get('content') ?? ''),
        }),
      }),
    ]),
  ],
])

/** Every form id this build ships, so a test can assert the table rather than a screenshot. */
export const EDIT_FORM_IDS: readonly string[] = Object.freeze(
  [...FORMS_BY_HANDLER.values()].flatMap(forms => forms.map(item => item.id)),
)

// ---------------------------------------------------------------------------------------------
// the offer rule

export interface EditOfferOptions {
  /**
   * Whether this tab holds an editing surface for the subject. `false` means this page will not
   * write the file — no writable handle, or write permission the browser already refused — so
   * nothing mutating is offered, not even as a disabled control: a disabled control the user cannot
   * enable explains nothing that the read-only sentence in the host rail does not.
   */
  readonly editable: boolean
}

/**
 * What this application offers for one subject, and what it declines to offer with a reason.
 *
 * Only `state: 'available'` mutating operations are considered: a codec that disabled its own
 * operation (an encrypted or ZIP64 archive) has already said the edit cannot happen, and the
 * descriptor carries its reason for the panels that show operation state.
 */
export function editOffer(descriptor: AnyDescriptor, options: EditOfferOptions): EditOffer {
  if (!options.editable) return Object.freeze({ forms: [], unsupported: [] })
  const forms: EditOperationForm[] = []
  const unsupported: UnsupportedEditOperation[] = []
  for (const operation of descriptor.operations) {
    if (!operation.mutatesSource || operation.state !== 'available') continue
    const known = FORMS_BY_HANDLER.get(operation.handlerId)?.filter(
      item => item.operationId === operation.id,
    )
    if (known === undefined || known.length === 0) {
      unsupported.push({
        operationId: operation.id,
        handlerId: operation.handlerId,
        reason: `this host cannot construct the input for «${operation.handlerId}» yet`,
      })
      continue
    }
    for (const item of known) forms.push(resolveForm(item, descriptor))
  }
  return Object.freeze({ forms: Object.freeze(forms), unsupported: Object.freeze(unsupported) })
}

/**
 * Whether the Edit panel may be drawn for this subject.
 *
 * Forms, not "anything to say": a panel whose only content is "nothing here can change this file"
 * is a panel that has to be closed rather than read. What it declined to offer is stated by the
 * inspector's own heading instead, which is where a reader is already looking for "what can this
 * host do with the open file".
 */
export function offersEditPanel(descriptor: AnyDescriptor, options: EditOfferOptions): boolean {
  return editOffer(descriptor, options).forms.length > 0
}

/** Every mutating operation the descriptor declares, whatever its state — for an honest count. */
export function declaredMutatingOperations(
  descriptor: AnyDescriptor,
): readonly AssetOperationDescriptor[] {
  return descriptor.operations.filter(operation => operation.mutatesSource)
}

// ---------------------------------------------------------------------------------------------
// results

/**
 * Why the host refused an invoke, in the host's own vocabulary plus plain words.
 *
 * `permission-missing` is the one a user meets: the subject was opened without `write-source`
 * because this page holds no writable handle for the file. Saying "failed" there would hide the
 * only fact that matters.
 */
const INVOKE_REASONS: Readonly<Record<string, string>> = Object.freeze({
  'not-declared': 'this codec does not declare that operation',
  disabled: 'the codec disabled this operation for this file',
  'dependency-required': 'the operation needs a dependency this host has not resolved',
  'permission-missing': 'this subject was opened without permission to write the file',
  'input-not-serializable': 'the values could not be sent to the codec',
  'handler-unregistered': 'the codec registered no handler for that operation',
  cancelled: 'the operation was cancelled',
  'stale-revision': 'the file changed after this tab opened it',
})

export function invokeRefusalMessage(result: {
  readonly reason: string
  readonly diagnostics?: readonly { readonly message: string }[]
}): string {
  const plain = INVOKE_REASONS[result.reason]
  const detail = result.diagnostics?.[0]?.message
  const head = plain === undefined ? result.reason : `${plain} (${result.reason})`
  return detail === undefined ? `refused: ${head}` : `refused: ${head} — ${detail}`
}

/**
 * What the plan said it would not keep, appended to the outcome.
 *
 * A codec that re-assembles a container states honestly when the result cannot account for every
 * byte of the original. The coordinator commits it — the claim is `semantic`, not `lossy`, so it
 * asks for no confirmation — which means the only place the user can learn it is the panel.
 */
export function fidelityNote(plan: AssetEditPlan): string {
  if (plan.fidelity.preservesUnknownData) return ''
  const notes = plan.fidelity.notes ?? []
  return notes.length === 0
    ? ' (this rewrite does not keep bytes the format does not account for)'
    : ` (${notes.join('; ')})`
}

/** Narrowing helper shared by the panel and its tests. */
export const isRejected = (
  result: OperationResult,
): result is Extract<OperationResult, { state: 'rejected' }> => result.state === 'rejected'
