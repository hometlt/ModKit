/**
 * The byte arithmetic every editing backend performs (S13): turning an `EditPayload` into bytes
 * and applying a `replace` edit to a source's bytes. It lives outside the backends because the
 * Node backend (files) and the browser backend (File System Access handles) must splice
 * identically — a range that is out of bounds must be refused the same way on both, or the same
 * plan would land differently depending on which host committed it.
 *
 * Nothing here touches a filesystem: it takes bytes and returns bytes.
 */

import { ModkitError, throwIfAborted } from '@modkitx-x3/core'
import type { AssetRevision, EditPayload, PayloadStore, SourceEdit } from '@modkitx-x3/sdk'

const STAGED_CHUNK = 1024 * 1024

export type ReplaceEdit = Extract<SourceEdit, { operation: 'replace' }>
export type ByteRange = Extract<NonNullable<ReplaceEdit['range']>, { kind: 'bytes' }>

export function editingError(
  code: string,
  message: string,
  context?: Record<string, unknown>,
): ModkitError {
  return new ModkitError({ code, message, ...(context === undefined ? {} : { context }) })
}

/** An edit payload as bytes; a staged payload is pulled through the store, bounded. */
export async function payloadBytes(
  payload: EditPayload,
  payloads: PayloadStore,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (payload.kind === 'text') return new TextEncoder().encode(payload.text)
  if (payload.kind === 'inline') return payload.bytes
  if (payload.ref.bytes > BigInt(maxBytes)) {
    throw editingError('x3.host/edit-payload-too-large', `staged payload exceeds ${maxBytes} bytes`)
  }
  const lease = await payloads.open(payload.ref, signal)
  try {
    const chunks: Uint8Array[] = []
    let total = 0
    let cursor: string | undefined
    for (;;) {
      throwIfAborted(signal)
      const chunk = await lease.value.read(
        { ...(cursor === undefined ? {} : { cursor }), maxBytes: STAGED_CHUNK },
        signal,
      )
      chunks.push(chunk.bytes)
      total += chunk.bytes.byteLength
      if (total > maxBytes) {
        throw editingError(
          'x3.host/edit-payload-too-large',
          `staged payload exceeds ${maxBytes} bytes`,
        )
      }
      if (chunk.complete) break
      cursor = chunk.nextCursor
    }
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.byteLength
    }
    return out
  } finally {
    await lease.release()
  }
}

/** Replace a byte range; the range must lie inside the source or the edit is refused. */
export function spliceBytes(
  original: Uint8Array,
  range: ByteRange,
  replacement: Uint8Array,
): Uint8Array {
  const start = Number(range.offset)
  const length = Number(range.length)
  if (
    range.offset < 0n ||
    range.length < 0n ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start + length > original.byteLength
  ) {
    throw editingError('x3.host/edit-range-invalid', 'byte range lies outside the source')
  }
  const out = new Uint8Array(original.byteLength - length + replacement.byteLength)
  out.set(original.subarray(0, start), 0)
  out.set(replacement, start)
  out.set(original.subarray(start + length), start + replacement.byteLength)
  return out
}

/** Replace a UTF-16 range of the decoded text; invalid UTF-8 refuses the edit rather than guessing. */
export function spliceUtf16(
  original: Uint8Array,
  offset: number,
  length: number,
  text: string,
): Uint8Array {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(original)
  if (offset < 0 || length < 0 || offset + length > decoded.length) {
    throw editingError('x3.host/edit-range-invalid', 'UTF-16 range lies outside the source')
  }
  return new TextEncoder().encode(decoded.slice(0, offset) + text + decoded.slice(offset + length))
}

/**
 * The bytes a `replace` edit produces from the source's current bytes: a byte range, a UTF-16
 * range, or the whole source.
 */
export async function replacedBytes(
  edit: ReplaceEdit,
  original: Uint8Array,
  payloads: PayloadStore,
  maxPayloadBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const replacement = await payloadBytes(edit.payload, payloads, maxPayloadBytes, signal)
  if (edit.range === undefined) return replacement
  if (edit.range.kind === 'bytes') return spliceBytes(original, edit.range, replacement)
  return spliceUtf16(
    original,
    edit.range.offset,
    edit.range.length,
    new TextDecoder('utf-8', { fatal: true }).decode(replacement),
  )
}

/**
 * Apply a batch one edit at a time, threading each write's revision into the next.
 *
 * The coordinator computes every request's `expectedRevision` *before* the batch runs, from the
 * revisions it knew then. Two edits against one source therefore arrive carrying the same expected
 * revision — and a backend that checks the live revision per write refuses the second one as
 * `edit-conditional-write-lost`, because the first write moved it. Every multi-edit plan on a
 * sequential backend failed that way.
 *
 * The guard that matters is still enforced: the *first* write to a source honours the caller's
 * expected revision, which is what catches a file that changed under the editor. Later writes in
 * the same batch expect what this batch just produced, because inside one transaction that is the
 * truth about the file.
 */
export async function applySequentialBatch(
  requests: readonly { readonly edit: SourceEdit; readonly expectedRevision: AssetRevision }[],
  apply: (
    edit: SourceEdit,
    expectedRevision: AssetRevision,
  ) => Promise<{ readonly after: AssetRevision; readonly before?: AssetRevision }>,
): Promise<{ targetId: string; after: AssetRevision; before?: AssetRevision }[]> {
  const produced = new Map<string, AssetRevision>()
  const results: { targetId: string; after: AssetRevision; before?: AssetRevision }[] = []
  for (const request of requests) {
    const sourceId = request.edit.source.id
    const expected = produced.get(sourceId) ?? request.expectedRevision
    const result = await apply(request.edit, expected)
    produced.set(sourceId, result.after)
    results.push({ targetId: request.edit.targetId, ...result })
  }
  return results
}
