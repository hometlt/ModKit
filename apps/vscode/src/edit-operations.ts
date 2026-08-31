/**
 * This application's forms for codec-owned mutating operations (ADR-HOST-002 Path A).
 *
 * The standard verb classifies the change; the handler id defines the input. That distinction is
 * load-bearing: `edit.field` takes `{ keyword, text }` for PNG and MP3 but `{ text }` for JPEG.
 * This table belongs to the VS Code application and is deliberately not imported from another
 * host. An available handler absent from the table is reported with a reason instead of receiving
 * a control that cannot construct its input.
 */
import type { AssetEditPlan, JsonValue, OperationResult } from '@modkit/sdk'
import type { UiLocalizer } from '@modkit/ui/localization'

import { descriptorOperations } from './view-policy.js'
import { createVscodeLocalizer } from './localization.js'

export interface EditOperationField {
  readonly name: string
  readonly label: string
  readonly kind: 'text' | 'content'
  readonly initial: string
  readonly hint?: string
  readonly required: boolean
}

export interface EditOperationForm {
  readonly id: string
  readonly label: string
  readonly operationId: string
  readonly handlerId: string
  readonly summary: string
  readonly fields: readonly EditOperationField[]
  build(values: ReadonlyMap<string, string>): JsonValue
}

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

/** Standard base64 over UTF-8, identical in the webview and the Node test realm. */
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

const form = (definition: EditOperationForm): EditOperationForm => Object.freeze(definition)

/** Forms keyed by the codec handler whose input they build, never by the standard verb alone. */
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
        build: values => ({
          keyword: required(values, 'keyword', 'Keyword'),
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
          'Sets or replaces one ID3v2 text frame, creating the tag when absent; audio bytes stay in place.',
        fields: Object.freeze([
          field('keyword', 'Frame', 'TIT2', {
            hint: 'a four-character text frame id: TIT2, TPE1, TALB, …',
          }),
          field('text', 'Text', 'set from the Modkit inspector'),
        ]),
        build: values => ({
          keyword: required(values, 'keyword', 'Frame'),
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
        summary: 'Writes the COM segment after the APP block, replacing it when it exists.',
        fields: Object.freeze([field('text', 'Comment', 'set from the Modkit inspector')]),
        build: values => ({ text: values.get('text') ?? '' }),
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
        summary: 'Drops one metadata segment; image-bearing markers are refused by the codec.',
        fields: Object.freeze([
          field('marker', 'Marker', 'APP0', {
            hint: 'a metadata marker name, e.g. APP0, APP1, COM',
          }),
        ]),
        build: values => ({ marker: required(values, 'marker', 'Marker') }),
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
        summary: 'Adds one stored entry and repacks; kept entries retain their bytes.',
        fields: Object.freeze([
          field('path', 'Entry path', 'added/hello.txt', { hint: 'a path inside the archive' }),
          field('content', 'Contents', 'added from the Modkit inspector', {
            kind: 'content',
            hint: 'text sent to the codec as UTF-8 bytes',
          }),
        ]),
        build: values => ({
          add: [
            {
              path: required(values, 'path', 'Entry path'),
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
        summary: 'Removes one entry and repacks; other entries retain their bytes.',
        fields: Object.freeze([field('path', 'Entry path', 'readme.txt')]),
        build: values => ({ remove: [required(values, 'path', 'Entry path')] }),
      }),
      form({
        id: 'zip-rename-entry',
        label: 'Rename an entry in the archive',
        operationId: 'edit.structure',
        handlerId: 'edit-structure',
        summary: 'Renames one entry without touching its payload or compression.',
        fields: Object.freeze([
          field('from', 'From', 'readme.txt'),
          field('to', 'To', 'docs/readme.txt'),
        ]),
        build: values => ({
          rename: [{ from: required(values, 'from', 'From'), to: required(values, 'to', 'To') }],
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
        summary: "Replaces one file entry's payload; nothing else moves.",
        fields: Object.freeze([
          field('path', 'Entry path', 'readme.txt'),
          field('content', 'Contents', 'replaced from the Modkit inspector', {
            kind: 'content',
            hint: 'text sent to the codec as UTF-8 bytes',
          }),
        ]),
        build: values => ({
          path: required(values, 'path', 'Entry path'),
          bytes: base64OfUtf8(values.get('content') ?? ''),
        }),
      }),
    ]),
  ],
])

/** Every form this application ships, exposed so drift is asserted without a screenshot. */
export const EDIT_FORM_IDS: readonly string[] = Object.freeze(
  [...FORMS_BY_HANDLER.values()].flatMap(forms => forms.map(item => item.id)),
)

const FORM_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'png-set-text': 'pngSetText',
  'mp3-set-text-frame': 'mp3SetTextFrame',
  'jpeg-set-comment': 'jpegSetComment',
  'jpeg-remove-segment': 'jpegRemoveSegment',
  'zip-add-entry': 'zipAddEntry',
  'zip-remove-entry': 'zipRemoveEntry',
  'zip-rename-entry': 'zipRenameEntry',
  'zip-replace-entry': 'zipReplaceEntry',
})

const fieldKey = (formId: string, name: string): string => {
  if (name === 'keyword') return formId === 'mp3-set-text-frame' ? 'frame' : 'keyword'
  if (name === 'path') return 'entryPath'
  if (name === 'content') return 'contents'
  if (name === 'text') return formId === 'jpeg-set-comment' ? 'comment' : 'text'
  return name
}

const hintKey = (formId: string, name: string): string | undefined => {
  if (formId === 'png-set-text' && name === 'keyword') return 'pngKeyword'
  if (formId === 'png-set-text' && name === 'text') return 'pngText'
  if (formId === 'mp3-set-text-frame' && name === 'keyword') return 'mp3Frame'
  if (formId === 'jpeg-remove-segment' && name === 'marker') return 'metadataMarker'
  if (formId === 'zip-add-entry' && name === 'path') return 'archivePath'
  if (name === 'content') return 'utf8Contents'
  return undefined
}

const localizeForm = (definition: EditOperationForm, localizer: UiLocalizer): EditOperationForm => {
  const key = FORM_KEYS[definition.id]
  if (key === undefined) return definition
  const fields = Object.freeze(
    definition.fields.map(item => {
      const field = fieldKey(definition.id, item.name)
      const hint = hintKey(definition.id, item.name)
      return Object.freeze({
        ...item,
        label: localizer.text(`vscode.edit.field.${field}`),
        ...(hint === undefined ? {} : { hint: localizer.text(`vscode.edit.hint.${hint}`) }),
      })
    }),
  )
  return Object.freeze({
    ...definition,
    label: localizer.text(`vscode.edit.form.${key}.label`),
    summary: localizer.text(`vscode.edit.form.${key}.summary`),
    fields,
    build(values: ReadonlyMap<string, string>) {
      for (const item of fields) {
        if (item.required && (values.get(item.name) ?? '') === '') {
          throw new TypeError(localizer.text('vscode.edit.required', { field: item.label }))
        }
      }
      return definition.build(values)
    },
  })
}

export function editOffer(
  descriptor: Record<string, unknown>,
  options: { readonly editable: boolean; readonly localizer?: UiLocalizer },
): EditOffer {
  if (!options.editable) return Object.freeze({ forms: [], unsupported: [] })
  const localizer = options.localizer ?? createVscodeLocalizer('en')
  const forms: EditOperationForm[] = []
  const unsupported: UnsupportedEditOperation[] = []
  for (const operation of descriptorOperations(descriptor)) {
    if (!operation.mutatesSource || operation.state !== 'available') continue
    const known = FORMS_BY_HANDLER.get(operation.handlerId)?.filter(
      item => item.operationId === operation.id,
    )
    if (known === undefined || known.length === 0) {
      unsupported.push({
        operationId: operation.id,
        handlerId: operation.handlerId,
        reason: localizer.text('vscode.edit.unsupportedHandler', {
          handler: operation.handlerId,
        }),
      })
      continue
    }
    forms.push(...known.map(item => localizeForm(item, localizer)))
  }
  return Object.freeze({ forms: Object.freeze(forms), unsupported: Object.freeze(unsupported) })
}

export function offersEditOperations(
  descriptor: Record<string, unknown>,
  options: { readonly editable: boolean },
): boolean {
  const offer = editOffer(descriptor, options)
  return offer.forms.length > 0 || offer.unsupported.length > 0
}

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

/** Keep the host's reason and first diagnostic verbatim beside the application explanation. */
export function invokeRefusalMessage(
  result: {
    readonly reason: string
    readonly diagnostics?: readonly { readonly message: string }[]
  },
  localizer: UiLocalizer = createVscodeLocalizer('en'),
): string {
  const reasonKey = INVOKE_REASON_KEYS[result.reason]
  const plain =
    reasonKey === undefined ? undefined : localizer.text(`vscode.edit.refusal.${reasonKey}`)
  const detail = result.diagnostics?.[0]?.message
  const head = plain === undefined ? result.reason : `${plain} (${result.reason})`
  const message = localizer.text('vscode.edit.refused', { reason: head })
  return detail === undefined ? message : `${message} — ${detail}`
}

/** Extract a Path A plan without converting it into a Path B change proposal. */
export function editPlanFromOperationOutput(output: unknown): AssetEditPlan {
  const value = output as { readonly kind?: unknown; readonly plan?: unknown } | undefined
  if (value?.kind !== 'edit-plan' || typeof value.plan !== 'object' || value.plan === null) {
    throw new TypeError(
      `the operation returned «${String(value?.kind ?? 'nothing')}», not an edit plan`,
    )
  }
  return value.plan as AssetEditPlan
}

export const isRejected = (
  result: OperationResult,
): result is Extract<OperationResult, { state: 'rejected' }> => result.state === 'rejected'
