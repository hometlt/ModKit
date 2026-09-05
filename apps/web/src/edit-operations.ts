/** Thin PWA adapter over the shared schema-driven edit-form contract. */
import type { AnyDescriptor, MetadataEntry } from '@modkit/sdk'

export {
  base64OfUtf8,
  declaredMutatingOperations,
  editOffer,
  fidelityNote,
  invokeRefusalMessage,
  isRejected,
  offersEditPanel,
  type EditOffer,
  type EditOfferOptions,
  type EditOperationField,
  type EditOperationForm,
  type UnsupportedEditOperation,
} from '@modkit/ui/field-editor'

/** Descriptor metadata lookup retained as a small app-facing convenience. */
export function metadataEntries(
  descriptor: AnyDescriptor,
  groupId: string,
): readonly MetadataEntry[] {
  if (!('metadata' in descriptor)) return []
  return descriptor.metadata.find(group => group.id === groupId)?.entries ?? []
}
