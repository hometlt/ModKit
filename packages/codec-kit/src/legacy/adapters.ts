import { ModkitError, uint64 } from '@modkit/core'
import type { AssetInput, Codec, FidelityClaim, OperationOutput } from '@modkit/sdk'
import {
  createInspectionCodec,
  editPlanFromInput,
  replaceBytes,
  type InspectionCodecDefinition,
  type InspectionContext,
  type InspectionResult,
} from '../index.js'
import type {
  GameArtifactCodec,
  ArtifactContext,
  ArtifactOpenOptions,
} from './assets/artifact-codec.js'
import type { AssetDescriptor } from './assets/descriptor.js'
import type { AssetEditPlan } from './assets/editing.js'
import type { ArtifactOperationSession } from './assets/artifact-session.js'
import type { AssetSource, AssetReadOptions, SourceRange } from './assets/source.js'
import { createMemoryAssetSource, createAssetSourceDescriptor } from './assets/source.js'
import { cancellationTokenFromAbortSignal } from './assets/cancellation.js'
import { validateEditPlan } from './assets/editing.js'
import { adaptDiagnostic, adaptLegacyError } from './diagnostics.js'

export interface ArtifactAdapterOptions<T> {
  readonly id: string
  readonly format: InspectionCodecDefinition['format']
  readonly operations?: InspectionCodecDefinition['operations']
  readonly context?: ArtifactContext
  readonly openOptions?: ArtifactOpenOptions
  /** The selected consumer projects its real descriptor/operation products. No fabricated traits. */
  project(
    document: T,
    descriptor: AssetDescriptor,
    context: InspectionContext,
  ): Promise<InspectionResult>
}

/** A normal MK3 Codec contribution; selection and admission remain owned by the MK3 host. */
export function adaptGameArtifactCodec<T>(
  legacy: GameArtifactCodec<T>,
  options: ArtifactAdapterOptions<T>,
): Codec {
  if (!legacy.sourceKinds.includes('file'))
    throw new TypeError('Use a namespace adapter for a legacy codec without file support')
  const native = createInspectionCodec({
    id: options.id,
    format: options.format,
    ...(options.operations === undefined ? {} : { operations: options.operations }),
    async detect(prefix, uri) {
      try {
        const detected = await legacy.detect(
          createMemoryAssetSource(prefix, { path: uri, id: uri }),
          options.context ?? {},
        )
        return {
          confidence: detected.confidence,
          kind: 'structure',
          note: JSON.stringify({
            legacyEvidence: detected.evidence,
            requiredRanges: detected.requiredRanges,
            diagnostics: detected.diagnostics ?? [],
          }),
        }
      } catch (error) {
        throw adaptLegacyError(error)
      }
    },
    async inspect(bytes, context) {
      const legacyContext: ArtifactContext = {
        ...options.context,
        ...(context.signal === undefined
          ? {}
          : { cancellation: cancellationTokenFromAbortSignal(context.signal) }),
      }
      try {
        const document = await legacy.open(
          createMemoryAssetSource(bytes, {
            path: context.primary.source.uri,
            id: context.primary.source.id,
          }),
          legacyContext,
          options.openOptions,
        )
        const descriptor = await legacy.describe(document, legacyContext)
        const projected = await options.project(document, descriptor, context)
        return {
          ...projected,
          diagnostics: [
            ...descriptor.diagnostics.map(value =>
              adaptDiagnostic(value, { contributionId: options.id }),
            ),
            ...(projected.diagnostics ?? []),
          ],
        }
      } catch (error) {
        throw adaptLegacyError(error)
      }
    },
  })
  return {
    ...native,
    async probe(request, signal) {
      if (request.source.kind !== 'bytes' || request.plan.kind !== 'bytes')
        throw new TypeError('Legacy file adapter requires a byte probe')
      const candidate = request.source,
        plan = request.plan
      let bytesRead = 0
      const descriptor = createAssetSourceDescriptor({
        path: candidate.ref.uri,
        id: candidate.ref.uri,
      })
      const readRange = async (range: SourceRange, readOptions?: AssetReadOptions) => {
        signal?.throwIfAborted()
        if (readOptions?.cancellation?.isCancellationRequested)
          throw new DOMException('Read cancelled', 'AbortError')
        if (
          !Number.isSafeInteger(range.offset) ||
          !Number.isSafeInteger(range.length) ||
          range.offset < 0 ||
          range.length < 0
        )
          throw new RangeError('Invalid detector range')
        if (
          range.length > (readOptions?.maxBytes ?? plan.maxBytes) ||
          bytesRead + range.length > plan.maxBytes
        )
          throw new RangeError('Legacy detector exceeds admitted probe bytes')
        if (
          !plan.ranges.some(allowed => {
            if (allowed.from === 'end' && candidate.size === undefined) return false
            const sourceSize = candidate.size ?? 0n
            const start =
              allowed.from === 'start'
                ? 0n
                : sourceSize > BigInt(allowed.length)
                  ? sourceSize - BigInt(allowed.length)
                  : 0n
            return (
              BigInt(range.offset) >= start &&
              BigInt(range.offset) + BigInt(range.length) <= start + BigInt(allowed.length)
            )
          })
        )
          throw new RangeError('Legacy detector requested a range outside the admitted probe plan')
        bytesRead += range.length
        return candidate.read(BigInt(range.offset), range.length, signal)
      }
      const size = async () => {
        if (candidate.size === undefined) return undefined
        if (candidate.size > BigInt(Number.MAX_SAFE_INTEGER))
          throw new RangeError('Legacy detector cannot exactly represent source size')
        return Number(candidate.size)
      }
      const knownSize = await size()
      const source: AssetSource = {
        descriptor: { ...descriptor, ...(knownSize === undefined ? {} : { size: knownSize }) },
        size,
        readRange,
        read: async readOptions => {
          const length = await size()
          if (length === undefined)
            throw new RangeError('Legacy detector requires a known size for whole-source reads')
          return readRange({ offset: 0, length }, readOptions)
        },
      }
      try {
        const result = await legacy.detect(source, {
          ...options.context,
          ...(signal === undefined
            ? {}
            : { cancellation: cancellationTokenFromAbortSignal(signal) }),
        })
        return {
          codecId: options.id,
          confidence: result.confidence,
          evidence: result.evidence.map(item => ({
            kind: item.kind === 'path' ? ('context' as const) : item.kind,
            weight: result.confidence,
            note: JSON.stringify({ legacyEvidence: item }),
          })),
          requiredRanges: result.requiredRanges.map(range => ({
            byteOffset: uint64(BigInt(range.offset)),
            byteLength: uint64(BigInt(range.length)),
          })),
          ...(result.diagnostics === undefined
            ? {}
            : {
                diagnostics: result.diagnostics.map(value =>
                  adaptDiagnostic(value, { contributionId: options.id }),
                ),
              }),
        }
      } catch (error) {
        throw adaptLegacyError(error)
      }
    },
  }
}

/** One admitted MK3 operation invokes the existing session; the caller translates its real output. */
export async function invokeLegacyOperation(
  session: ArtifactOperationSession,
  handlerId: string,
  input: Parameters<ArtifactOperationSession['invoke']>[1],
  output: (value: unknown) => OperationOutput,
): Promise<OperationOutput> {
  try {
    return output(await session.invoke(handlerId, input))
  } catch (error) {
    throw adaptLegacyError(error)
  }
}

/** M1 minimum: single-source byte replacement. Other edits require a later explicit projection. */
export function adaptEditPlan(
  plan: AssetEditPlan,
  input: AssetInput,
  options: { planId: string; sourceId: string; fidelity: FidelityClaim },
) {
  const errors = validateEditPlan(plan).filter(item => item.severity === 'error')
  if (errors.length)
    throw new ModkitError({
      code: 'codec-kit/invalid-legacy-edit-plan',
      message: 'Legacy edit plan failed structural validation',
      context: { diagnostics: errors },
    })
  const edits = plan.edits.map(edit => {
    if (
      edit.sourceId !== options.sourceId ||
      edit.operation !== 'replace' ||
      edit.range === undefined
    )
      throw new ModkitError({
        code: 'codec-kit/unsupported-legacy-edit',
        message: 'M1 edit adapter requires an explicit range replacement on the selected source',
      })
    return replaceBytes(
      edit.range.offset,
      edit.range.length,
      edit.bytes ?? new TextEncoder().encode(edit.text),
      edit.label,
    )
  })
  return editPlanFromInput(input, {
    planId: options.planId,
    edits,
    fidelity: options.fidelity,
    diagnostics: plan.diagnostics.map(value => adaptDiagnostic(value)),
  })
}
