/** Thin Electron adapter over the shared schema-driven edit-form contract. */
import type { AnyDescriptor, AssetEditPlan } from '@modkit/sdk'
import type { UiLocalizer } from '@modkit/ui/localization'
import {
  base64OfUtf8,
  editOffer as sharedEditOffer,
  fidelityNote,
  invokeRefusalMessage as sharedInvokeRefusalMessage,
  isRejected,
  type EditOffer,
  type EditOperationField,
  type EditOperationForm,
  type FieldEditorRegistry,
  type UnsupportedEditOperation,
} from '@modkit/ui/field-editor'

export {
  base64OfUtf8,
  fidelityNote,
  isRejected,
  type EditOffer,
  type EditOperationField,
  type EditOperationForm,
  type UnsupportedEditOperation,
}

export interface EditOfferOptions {
  readonly editable: boolean
  readonly localizer?: UiLocalizer
  readonly fieldEditors?: FieldEditorRegistry
}

export function editOffer(
  descriptor: Record<string, unknown>,
  options: EditOfferOptions,
): EditOffer {
  return sharedEditOffer(descriptor as unknown as AnyDescriptor, {
    editable: options.editable,
    ...(options.fieldEditors === undefined ? {} : { fieldEditors: options.fieldEditors }),
  })
}

export function offersEditOperations(
  descriptor: Record<string, unknown>,
  options: EditOfferOptions,
): boolean {
  const offer = editOffer(descriptor, options)
  return offer.forms.length > 0 || offer.unsupported.length > 0
}

export function invokeRefusalMessage(
  result: {
    readonly reason: string
    readonly diagnostics?: readonly { readonly message: string }[]
  },
  _localizer?: UiLocalizer,
): string {
  void _localizer
  return sharedInvokeRefusalMessage(result)
}

export function editPlanFromOperationOutput(
  output: unknown,
  localizer?: UiLocalizer,
): AssetEditPlan {
  const value = output as { readonly kind?: unknown; readonly plan?: unknown } | undefined
  if (value?.kind !== 'edit-plan' || typeof value.plan !== 'object' || value.plan === null) {
    throw new TypeError(
      localizer?.text('edit.operationReturnedWrongKind', {
        kind: String(value?.kind ?? localizer.text('edit.returnedNothing')),
      }) ?? `the operation returned «${String(value?.kind ?? 'nothing')}», not an edit plan`,
    )
  }
  return value.plan as AssetEditPlan
}

export function editSelfTestLine(
  name: string,
  formId: string,
  status: string,
  changed: boolean,
): string {
  return `selftest: edit-op ${name} ${formId} status=${JSON.stringify(status)} changed=${String(changed)}`
}

export function isSelfTestEditOutcome(
  previous: string,
  current: string,
  selectedFormLabel: string,
): boolean {
  return selectedFormLabel !== '' && current !== previous && current.includes(selectedFormLabel)
}

export async function awaitSelfTestProbe<T>(
  probe: Promise<T>,
  name: string,
  timeoutMs = 15_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      probe,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`self-test probe timed out: ${name}`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
