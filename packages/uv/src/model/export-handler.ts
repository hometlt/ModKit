/** Shared read-only model.export-uvm operation adapter; native projection stays with its codec. */
import type { InspectionContext, InspectionResult } from '@modkit/codec-kit'
import type { MaterializationOptions, ModelProjection } from './materializer.js'

export interface UvmExportOptions {
  readonly sourceFormat: string
  readonly sourceUnit: string
  readonly metersPerSourceUnit: number
  /** Codecs whose operation schema permits a user scale override opt in explicitly. */
  readonly allowUnitOverride?: boolean
  readonly animationBudget?: MaterializationOptions['animationBudget']
}

/** Bind the existing materializer to source identity, budgets, units and cancellation. */
export function createUvmExportHandler(
  projection: ModelProjection,
  context: InspectionContext,
  options: UvmExportOptions,
): NonNullable<InspectionResult['handlers']>[string] {
  return async (input, invocation) => {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
      throw new TypeError('model.export-uvm requires { schemaVersion: 1 }')
    const request = input as Record<string, unknown>
    if (
      request['schemaVersion'] !== 1 ||
      Object.keys(request).some(
        key =>
          key !== 'schemaVersion' &&
          !(options.allowUnitOverride === true && key === 'metersPerSourceUnit'),
      )
    )
      throw new TypeError('model.export-uvm has an unsupported schema or option')
    const metersPerSourceUnit =
      options.allowUnitOverride === true
        ? request['metersPerSourceUnit'] === undefined
          ? options.metersPerSourceUnit
          : request['metersPerSourceUnit']
        : options.metersPerSourceUnit
    if (
      typeof metersPerSourceUnit !== 'number' ||
      !Number.isFinite(metersPerSourceUnit) ||
      metersPerSourceUnit <= 0
    )
      throw new TypeError('metersPerSourceUnit must be positive and finite')
    const signal = invocation.signal ?? context.signal
    signal?.throwIfAborted()
    const { materializeUvmCore } = await import('./materializer.js')
    signal?.throwIfAborted()
    const result = materializeUvmCore(
      projection,
      {
        scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
        profile: 'UVM/core@1.0',
        subjectRevision: context.source.revision,
        options: {
          assetId: context.source.ref.id,
          sourceFormat: options.sourceFormat,
          units: { metersPerSourceUnit, sourceUnit: options.sourceUnit },
        },
      },
      {
        materialBudget: {
          maxBytes: context.budget.maxScalarBytes,
          maxNodes: context.budget.maxNodes,
          maxDepth: context.budget.maxDepth,
        },
        ...(options.animationBudget === undefined
          ? {}
          : { animationBudget: options.animationBudget }),
        ...(signal === undefined ? {} : { signal }),
      },
    )
    return { kind: 'bytes', value: result.bytes.slice() }
  }
}
