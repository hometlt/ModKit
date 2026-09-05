/** Thin VS Code adapter over the shared schema-driven edit-form contract. */
import type { AnyDescriptor, AssetEditPlan } from '@modkit/sdk'
import type { UiLocalizer } from '@modkit/ui/localization'
import {
  base64OfUtf8,
  editOffer as sharedEditOffer,
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
  isRejected,
  type EditOffer,
  type EditOperationField,
  type EditOperationForm,
  type UnsupportedEditOperation,
}

export function editOffer(
  descriptor: Record<string, unknown>,
  options: {
    readonly editable: boolean
    readonly localizer?: UiLocalizer
    readonly fieldEditors?: FieldEditorRegistry
  },
): EditOffer {
  return sharedEditOffer(descriptor as unknown as AnyDescriptor, {
    editable: options.editable,
    ...(options.fieldEditors === undefined ? {} : { fieldEditors: options.fieldEditors }),
  })
}

export function offersEditOperations(
  descriptor: Record<string, unknown>,
  options: { readonly editable: boolean },
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

export function editPlanFromOperationOutput(output: unknown): AssetEditPlan {
  const value = output as { readonly kind?: unknown; readonly plan?: unknown } | undefined
  if (value?.kind !== 'edit-plan' || typeof value.plan !== 'object' || value.plan === null) {
    throw new TypeError(
      `the operation returned «${String(value?.kind ?? 'nothing')}», not an edit plan`,
    )
  }
  return value.plan as AssetEditPlan
}
