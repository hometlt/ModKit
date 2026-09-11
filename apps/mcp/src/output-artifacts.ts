import { createHash, randomUUID } from 'node:crypto'

/** Transport-owned memory only; never an installation store or filesystem output grant. */
export const OUTPUT_ARTIFACT_POLICY = Object.freeze({
  maxArtifactBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxArtifacts: 16,
  chunkBytes: 64 * 1024,
})
export class OutputArtifactError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
function fail(code: string, message: string): never {
  throw new OutputArtifactError(`x3.mcp/${code}`, message)
}
export interface OutputArtifactDescriptor {
  readonly id: string
  readonly uri: string
  readonly byteLength: number
  readonly sha256: string
  readonly owner: string
  readonly sourceRevision: string
  readonly operationId: string
  readonly chunkBytes: number
  readonly firstChunkUri: string | null
  readonly inputArtifact?: { readonly id: string; readonly sha256: string; readonly field: string }
}
interface Retained {
  readonly descriptor: OutputArtifactDescriptor
  readonly bytes: Uint8Array
}
interface Reservation {
  readonly id: string
  readonly owner: string
}
const chunkUri = (id: string, offset: number) => `modkit://output/${id}/chunks/${offset}`

export class OutputArtifacts {
  private readonly retained = new Map<string, Retained>()
  private readonly pending = new Map<string, Reservation>()
  private readonly inputs = new Map<string, number>()
  private bytes = 0
  private inputBytes = 0
  private closed = false

  constructor(private readonly enabled: boolean) {}

  /** Reserve worst-case byte/count quota before the operation's first await. */
  reserve(owner: string): Reservation {
    if (!this.enabled || this.closed)
      fail('output-artifacts-disabled', 'This host did not enable retained output resources.')
    if (
      this.retained.size + this.pending.size >= OUTPUT_ARTIFACT_POLICY.maxArtifacts ||
      this.bytes +
        this.inputBytes +
        (this.pending.size + 1) * OUTPUT_ARTIFACT_POLICY.maxArtifactBytes >
        OUTPUT_ARTIFACT_POLICY.maxTotalBytes
    )
      fail(
        'output-artifact-budget',
        'Retained output budget exhausted; release outputs or close their subject.',
      )
    const reservation = Object.freeze({ id: randomUUID(), owner })
    this.pending.set(reservation.id, reservation)
    return reservation
  }

  cancel(reservation: Reservation): void {
    this.pending.delete(reservation.id)
  }

  commit(
    reservation: Reservation,
    value: Uint8Array,
    provenance: {
      readonly sourceRevision: string
      readonly operationId: string
      readonly inputArtifact?: OutputArtifactDescriptor['inputArtifact']
    },
  ): OutputArtifactDescriptor {
    if (this.pending.get(reservation.id) !== reservation)
      fail('output-artifact-expired', 'The output reservation was closed or cancelled.')
    if (value.byteLength > OUTPUT_ARTIFACT_POLICY.maxArtifactBytes)
      fail(
        'output-artifact-too-large',
        'The complete operation output exceeds the retained artifact limit.',
      )
    // Capture before hashing or publishing; later mutations of an operation result cannot alter it.
    const bytes = Uint8Array.from(value)
    const id = randomUUID()
    const descriptor = Object.freeze({
      id,
      uri: `modkit://output/${id}`,
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      owner: reservation.owner,
      sourceRevision: provenance.sourceRevision,
      operationId: provenance.operationId,
      ...(provenance.inputArtifact === undefined
        ? {}
        : { inputArtifact: Object.freeze({ ...provenance.inputArtifact }) }),
      chunkBytes: OUTPUT_ARTIFACT_POLICY.chunkBytes,
      firstChunkUri: bytes.byteLength === 0 ? null : chunkUri(id, 0),
    })
    this.pending.delete(reservation.id)
    this.retained.set(id, { descriptor, bytes })
    this.bytes += bytes.byteLength
    return descriptor
  }

  manifest(id: string): OutputArtifactDescriptor {
    const item = this.retained.get(id)
    if (item === undefined)
      fail(
        'output-artifact-unknown',
        'Output artifact is unknown, released or its subject was closed.',
      )
    return item.descriptor
  }

  chunk(
    id: string,
    offset: number,
  ): { readonly bytes: Uint8Array; readonly nextUri: string | null; readonly sha256: string } {
    const descriptor = this.manifest(id)
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset % OUTPUT_ARTIFACT_POLICY.chunkBytes !== 0 ||
      offset >= descriptor.byteLength
    )
      fail('output-artifact-range', 'Output chunk offset is outside the advertised aligned range.')
    const item = this.retained.get(id)
    if (item === undefined) fail('output-artifact-unknown', 'Output artifact is unavailable.')
    const end = Math.min(offset + OUTPUT_ARTIFACT_POLICY.chunkBytes, descriptor.byteLength)
    const bytes = item.bytes.slice(offset, end)
    return {
      bytes,
      nextUri: end === descriptor.byteLength ? null : chunkUri(id, end),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }

  /** Only the same still-open subject may reuse its retained output in an operation input. */
  input(
    owner: string,
    id: string,
    field: string,
    input: unknown,
  ): {
    readonly value: Readonly<Record<string, unknown>>
    readonly provenance: { readonly id: string; readonly sha256: string; readonly field: string }
    release(): void
  } {
    const descriptor = this.manifest(id)
    if (descriptor.owner !== owner)
      fail('output-artifact-owner', 'The input artifact belongs to another subject handle.')
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(field) ||
      ['__proto__', 'prototype', 'constructor'].includes(field)
    )
      fail('output-artifact-field', 'The artifact input field is invalid or reserved.')
    if (
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.hasOwn(input, field)
    )
      fail(
        'output-artifact-field',
        'Artifact substitution requires an object with the target field absent.',
      )
    const item = this.retained.get(id)
    if (item === undefined) fail('output-artifact-unknown', 'Output artifact is unavailable.')
    // Charge a worst-case UTF-16 hex string (four bytes per input byte) before allocating it.
    const charge = item.bytes.byteLength * 4
    if (
      this.inputs.size >= OUTPUT_ARTIFACT_POLICY.maxArtifacts ||
      this.bytes +
        this.inputBytes +
        this.pending.size * OUTPUT_ARTIFACT_POLICY.maxArtifactBytes +
        charge >
        OUTPUT_ARTIFACT_POLICY.maxTotalBytes
    )
      fail(
        'output-artifact-budget',
        'Artifact input transport exceeds the remaining total output-memory budget.',
      )
    const ticket = randomUUID()
    this.inputs.set(ticket, charge)
    this.inputBytes += charge
    const release = () => {
      const held = this.inputs.get(ticket)
      if (held !== undefined) {
        this.inputs.delete(ticket)
        this.inputBytes -= held
      }
    }
    try {
      return {
        value: {
          ...input,
          [field]: Buffer.from(
            item.bytes.buffer,
            item.bytes.byteOffset,
            item.bytes.byteLength,
          ).toString('hex'),
        },
        provenance: Object.freeze({ id, sha256: descriptor.sha256, field }),
        release,
      }
    } catch (error) {
      release()
      throw error
    }
  }

  release(id: string): void {
    const descriptor = this.manifest(id)
    this.retained.delete(id)
    this.bytes -= descriptor.byteLength
  }

  closeOwner(owner: string): void {
    for (const [id, item] of this.retained)
      if (item.descriptor.owner === owner) {
        this.retained.delete(id)
        this.bytes -= item.bytes.byteLength
      }
    for (const [id, item] of this.pending) if (item.owner === owner) this.pending.delete(id)
  }

  dispose(): void {
    this.closed = true
    this.retained.clear()
    this.pending.clear()
    this.bytes = 0
    this.inputs.clear()
    this.inputBytes = 0
  }
}
