import type { JsonValue } from '@modkit/sdk'
import { DEFAULT_UVM_CONTAINER_BUDGET, readUvmContainer } from '@modkit/uv/model/container'
import { openUvmDocument, type UvmDocumentOptions } from './document.js'
import {
  attachUvmAnimationBundle,
  type UvmAnimationAttachmentOptions,
  type UvmAnimationAttachmentRequest,
} from './animation-attachment.js'

/** Prepare a host commit candidate from an explicit UVM source; performs no resource or file IO. */
export async function prepareUvmAnimationAttachmentRequest(
  bytes: Uint8Array,
  bundleBytes: Uint8Array,
  input: JsonValue,
  options: UvmDocumentOptions & UvmAnimationAttachmentOptions = {},
): Promise<Uint8Array> {
  const budget = options.budget ?? DEFAULT_UVM_CONTAINER_BUDGET
  const document = openUvmDocument(bytes, { ...options, maxHistoryEntries: 0 })
  try {
    const expectedRevision = document.status().revision
    const bundle = readUvmContainer(bundleBytes, budget, options.signal)
    // The composer snapshots and validates the complete JSON request before its first await.
    const result = await attachUvmAnimationBundle(
      document,
      expectedRevision,
      bundle,
      input as unknown as UvmAnimationAttachmentRequest,
      options,
    )
    return document.serialize(result.status.revision)
  } finally {
    document.dispose()
  }
}
