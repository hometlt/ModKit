/** Schema + semantic ingress for portable descriptor-v2 JSON. */

import {
  canonicalJsonStringify,
  diagnostic,
  hasErrors,
  isQualifiedId,
  operationId,
  parseSemver,
  traitId,
  uint64,
  type Diagnostic,
  type SourceSpan,
  type SourceSpanWire,
} from '@modkit/core'
import { subjectDescriptorV2Schema } from '../schemas/subject-descriptor.js'
import { snapshotJsonWireData, validateWithSchema } from '../manifest/validate.js'
import { parseSubjectRef, serializeSubjectRef } from '../subjects/refs.js'
import {
  revisionId,
  contributionId,
  type AnyDescriptor,
  type AnyDescriptorWire,
  type AssetDiagnostic,
  type AssetDiagnosticWire,
  type AssetOriginDescriptor,
  type AssetOriginDescriptorWire,
  type AssetSourceRef,
  type AssetOperationDescriptor,
  type CompanionDescriptor,
  type CompanionDescriptorWire,
  type DetectionResult,
  type DetectionResultWire,
  type SourceBindingDescriptor,
  type SourceBindingDescriptorWire,
  type TraitInstance,
} from './types.js'
import { dataSourceRefFromWire } from './data-sources.js'
import { isStandardTraitId } from './standard-traits.js'

export interface SubjectDescriptorValidationResult {
  readonly descriptor?: AnyDescriptor
  readonly diagnostics: readonly Diagnostic[]
}

function normalizeSourceSpan(span: SourceSpanWire): SourceSpan {
  if (typeof span.byteOffset === 'string' && typeof span.byteLength === 'string') {
    return Object.freeze({
      ...span,
      byteOffset: uint64(span.byteOffset),
      byteLength: uint64(span.byteLength),
    }) as SourceSpan
  }
  return span as SourceSpan
}

function normalizeDiagnostic(item: AssetDiagnosticWire): AssetDiagnostic {
  return Object.freeze({
    ...item,
    ...(item.range === undefined ? {} : { range: normalizeSourceSpan(item.range) }),
  }) as AssetDiagnostic
}

function normalizeDetection(item: DetectionResultWire): DetectionResult {
  const { diagnostics, ...facts } = item
  return Object.freeze({
    ...facts,
    requiredRanges: Object.freeze(item.requiredRanges.map(normalizeSourceSpan)),
    ...(diagnostics === undefined
      ? {}
      : { diagnostics: Object.freeze(diagnostics.map(normalizeDiagnostic)) }),
  }) as DetectionResult
}

function freezeSource(source: AssetSourceRef): AssetSourceRef {
  return Object.freeze({
    ...source,
    ...(source.parentIds === undefined
      ? {}
      : {
          parentIds: Object.freeze([...source.parentIds]) as readonly [string, ...string[]],
        }),
  }) as AssetSourceRef
}

function normalizeBinding(item: SourceBindingDescriptorWire): SourceBindingDescriptor {
  return Object.freeze({
    ...item,
    source: freezeSource(item.source),
    revision: revisionId(item.revision),
  })
}

function normalizeCompanion(item: CompanionDescriptorWire): CompanionDescriptor {
  if (item.state === 'resolved') {
    return Object.freeze({
      ...item,
      bindingIds: Object.freeze([...item.bindingIds]) as readonly [string, ...string[]],
    }) as CompanionDescriptor
  }
  if (item.state === 'ambiguous') {
    return Object.freeze({
      ...item,
      candidates: Object.freeze(
        item.candidates.map(candidate =>
          Object.freeze({
            source: freezeSource(candidate.source),
            revision: revisionId(candidate.revision),
          }),
        ),
      ),
      diagnosticIds: Object.freeze([...item.diagnosticIds]) as readonly [string, ...string[]],
    }) as unknown as CompanionDescriptor
  }
  return Object.freeze({
    ...item,
    ...(item.diagnosticIds === undefined
      ? {}
      : { diagnosticIds: Object.freeze([...item.diagnosticIds]) }),
  }) as CompanionDescriptor
}

function operationOwnerId(wire: AnyDescriptorWire): string {
  return wire.interpretation === 'none' ? 'modkit/host' : wire.identity.codecId
}

function normalizeOrigin(origin: AssetOriginDescriptorWire): AssetOriginDescriptor {
  switch (origin.kind) {
    case 'single':
      return Object.freeze({ kind: 'single', binding: normalizeBinding(origin.binding) })
    case 'bundle':
      return Object.freeze({
        kind: 'bundle',
        bindings: Object.freeze(origin.bindings.map(normalizeBinding)),
        ...(origin.primary === undefined ? {} : { primary: origin.primary }),
      })
    case 'namespace':
      return Object.freeze({
        kind: 'namespace',
        root: freezeSource(origin.root),
        revision: revisionId(origin.revision),
      })
    case 'derived':
      return Object.freeze({
        kind: 'derived',
        inputs: Object.freeze(
          origin.inputs.map(input =>
            Object.freeze({ ...input, revision: revisionId(input.revision) }),
          ),
        ),
        ...(origin.recipe === undefined
          ? {}
          : {
              recipe: Object.freeze({
                ...origin.recipe,
                contributionId: contributionId(origin.recipe.contributionId),
                operation: operationId(origin.recipe.operation, {
                  contributionId: origin.recipe.contributionId,
                }),
              }),
            }),
        ...(origin.materialization === undefined
          ? {}
          : {
              materialization: Object.freeze({
                ...origin.materialization,
                source: freezeSource(origin.materialization.source),
                revision: revisionId(origin.materialization.revision),
              }),
            }),
      }) as AssetOriginDescriptor
  }
}

export async function validateSubjectDescriptorV2(
  value: unknown,
): Promise<SubjectDescriptorValidationResult> {
  let snapshot: unknown
  try {
    snapshot = snapshotJsonWireData(value)
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'x3.sdk/non-json-subject-descriptor',
          'subject descriptor must be inert JSON data',
          [],
          { error: error instanceof Error ? error.message : String(error) },
        ),
      ],
    }
  }
  const schemaDiagnostics = await validateWithSchema(subjectDescriptorV2Schema, snapshot)
  if (hasErrors(schemaDiagnostics)) return { diagnostics: schemaDiagnostics }

  const wire = snapshot as AnyDescriptorWire
  const semanticDiagnostics: Diagnostic[] = []
  const validateSubjectUri = (uri: string, path: readonly (string | number)[]) => {
    try {
      if (serializeSubjectRef(parseSubjectRef(uri)) !== uri) {
        throw new TypeError('subject reference is not in canonical form')
      }
    } catch (error) {
      semanticDiagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/invalid-subject-reference',
          `subject reference ${uri} is not a canonical restorable identity`,
          path,
          { error: error instanceof Error ? error.message : String(error) },
        ),
      )
    }
  }
  validateSubjectUri(wire.subjectUri, ['subjectUri'])
  if (wire.origin.kind === 'derived') {
    wire.origin.inputs.forEach((input, index) =>
      validateSubjectUri(input.subjectUri, ['origin', 'inputs', index, 'subjectUri']),
    )
  }
  const validateDiagnosticCode = (
    item: AssetDiagnosticWire,
    path: readonly (string | number)[],
  ) => {
    if (!isQualifiedId(item.code)) {
      semanticDiagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/invalid-persistent-diagnostic-code',
          `persistent diagnostic code ${item.code} is not a qualified id`,
          [...path, 'code'],
        ),
      )
    }
  }
  wire.diagnostics.forEach((item, index) => validateDiagnosticCode(item, ['diagnostics', index]))
  if (wire.interpretation === 'none') {
    wire.candidates.forEach((candidate, candidateIndex) =>
      candidate.diagnostics?.forEach((item, diagnosticIndex) =>
        validateDiagnosticCode(item, [
          'candidates',
          candidateIndex,
          'diagnostics',
          diagnosticIndex,
        ]),
      ),
    )
  }
  if (wire.interpretation === 'codec' && parseSemver(wire.identity.codecVersion) === undefined) {
    semanticDiagnostics.push(
      diagnostic(
        'error',
        'x3.sdk/invalid-codec-version',
        `codec version ${wire.identity.codecVersion} cannot be evaluated safely`,
        ['identity', 'codecVersion'],
      ),
    )
  }
  const knownDiagnostics = new Set<string>()
  wire.diagnostics.forEach((item, index) => {
    if (knownDiagnostics.has(item.id)) {
      semanticDiagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/duplicate-descriptor-diagnostic',
          `diagnostic id ${item.id} is declared more than once`,
          ['diagnostics', index, 'id'],
        ),
      )
    }
    knownDiagnostics.add(item.id)
  })
  const traitIds = new Set<string>()
  wire.traits.forEach((trait, index) => {
    if (traitIds.has(trait.id)) {
      semanticDiagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/duplicate-descriptor-trait',
          `trait ${trait.id} is declared more than once`,
          ['traits', index, 'id'],
        ),
      )
    }
    traitIds.add(trait.id)
    if (isStandardTraitId(trait.id)) {
      if (trait.definitionVersion !== undefined) {
        semanticDiagnostics.push(
          diagnostic(
            'error',
            'x3.sdk/standard-trait-versioned',
            `standard trait ${trait.id} cannot bind an extension definition version`,
            ['traits', index, 'definitionVersion'],
          ),
        )
      }
    } else {
      if (
        trait.definitionVersion === undefined ||
        parseSemver(trait.definitionVersion) === undefined
      ) {
        semanticDiagnostics.push(
          diagnostic(
            'error',
            'x3.sdk/custom-trait-definition-unbound',
            `custom trait ${trait.id} must bind an exact installed definition version`,
            ['traits', index, 'definitionVersion'],
          ),
        )
      }
    }
    if (trait.state !== 'available') {
      const diagnosticIds = new Set<string>()
      for (const id of trait.diagnosticIds) {
        if (diagnosticIds.has(id)) {
          semanticDiagnostics.push(
            diagnostic(
              'error',
              'x3.sdk/duplicate-trait-diagnostic',
              `trait diagnostic ${id} is referenced more than once`,
              ['traits', index, 'diagnosticIds'],
            ),
          )
        }
        diagnosticIds.add(id)
        if (!knownDiagnostics.has(id)) {
          semanticDiagnostics.push(
            diagnostic(
              'error',
              'x3.sdk/unknown-trait-diagnostic',
              `trait diagnostic ${id} is not present in descriptor diagnostics`,
              ['traits', index, 'diagnosticIds'],
            ),
          )
        }
      }
    }
  })
  const operationOwner = operationOwnerId(wire)
  const operationIds = new Set<string>()
  const handlerIds = new Set<string>()
  wire.operations.forEach((operation, index) => {
    if (operationIds.has(operation.id)) {
      semanticDiagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/duplicate-descriptor-operation',
          `operation ${operation.id} is declared more than once`,
          ['operations', index, 'id'],
        ),
      )
    }
    operationIds.add(operation.id)
    if (handlerIds.has(operation.handlerId)) {
      semanticDiagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/duplicate-descriptor-handler',
          `handler ${operation.handlerId} is bound to more than one operation`,
          ['operations', index, 'handlerId'],
        ),
      )
    }
    handlerIds.add(operation.handlerId)
    try {
      operationId(operation.id, { contributionId: operationOwner })
    } catch {
      semanticDiagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/invalid-descriptor-operation',
          `operation ${operation.id} is not owned by ${operationOwner}`,
          ['operations', index, 'id'],
        ),
      )
    }
  })
  if (wire.interpretation !== 'none') {
    wire.metadata.forEach((group, groupIndex) =>
      group.entries.forEach((entry, entryIndex) => {
        const write = entry.editable?.write
        if (write !== undefined && 'operation' in write) {
          try {
            operationId(write.operation, { contributionId: operationOwner })
            if (
              !wire.operations.some(
                operation => operation.id === write.operation && operation.mutatesSource,
              )
            ) {
              throw new TypeError('field write must name a published mutating operation')
            }
          } catch {
            semanticDiagnostics.push(
              diagnostic(
                'error',
                'x3.sdk/invalid-field-write-operation',
                `field write ${write.operation} is not a declared owned mutation`,
                ['metadata', groupIndex, 'entries', entryIndex, 'editable', 'write', 'operation'],
              ),
            )
          }
        }
      }),
    )
  }
  if (wire.origin.kind === 'bundle') {
    const bindingIds = new Set<string>()
    wire.origin.bindings.forEach((binding, index) => {
      if (bindingIds.has(binding.id)) {
        semanticDiagnostics.push(
          diagnostic(
            'error',
            'x3.sdk/duplicate-origin-binding',
            `origin binding id ${binding.id} is duplicated`,
            ['origin', 'bindings', index, 'id'],
          ),
        )
      }
      bindingIds.add(binding.id)
    })
    if (wire.origin.primary !== undefined && !bindingIds.has(wire.origin.primary)) {
      semanticDiagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/unknown-origin-primary',
          `origin primary ${wire.origin.primary} does not name a bundle binding`,
          ['origin', 'primary'],
        ),
      )
    }
  }
  if (wire.interpretation === 'codec') {
    const companionIds = new Set<string>()
    const companionBindingIds = new Set<string>()
    const bundleBindings =
      wire.origin.kind === 'bundle'
        ? new Map(wire.origin.bindings.map(binding => [binding.id, binding] as const))
        : new Map<string, never>()
    ;(wire.companions ?? []).forEach((companion, index) => {
      if (companionIds.has(companion.id)) {
        semanticDiagnostics.push(
          diagnostic(
            'error',
            'x3.sdk/duplicate-companion-state',
            `companion requirement ${companion.id} is declared more than once`,
            ['companions', index, 'id'],
          ),
        )
      }
      companionIds.add(companion.id)
      if (companion.state === 'resolved') {
        if (
          (companion.cardinality === 'one' || companion.cardinality === 'zero-or-one') &&
          companion.bindingIds.length !== 1
        ) {
          semanticDiagnostics.push(
            diagnostic(
              'error',
              'x3.sdk/invalid-companion-cardinality',
              `resolved companion ${companion.id} must name exactly one binding for ${companion.cardinality}`,
              ['companions', index, 'bindingIds'],
            ),
          )
        }
        companion.bindingIds.forEach((bindingId, bindingIndex) => {
          const binding = bundleBindings.get(bindingId)
          if (
            binding === undefined ||
            binding.ownership !== 'companion' ||
            binding.role !== companion.role ||
            binding.required !== companion.required ||
            companionBindingIds.has(bindingId)
          ) {
            semanticDiagnostics.push(
              diagnostic(
                'error',
                'x3.sdk/invalid-companion-binding',
                `resolved companion ${companion.id} does not name a distinct matching companion binding`,
                ['companions', index, 'bindingIds', bindingIndex],
              ),
            )
          }
          companionBindingIds.add(bindingId)
        })
      } else {
        for (const id of companion.diagnosticIds ?? []) {
          if (!knownDiagnostics.has(id)) {
            semanticDiagnostics.push(
              diagnostic(
                'error',
                'x3.sdk/unknown-companion-diagnostic',
                `companion diagnostic ${id} is not present in descriptor diagnostics`,
                ['companions', index, 'diagnosticIds'],
              ),
            )
          }
        }
        if (companion.state === 'ambiguous') {
          const candidates = new Set<string>()
          companion.candidates.forEach((candidate, candidateIndex) => {
            const key = canonicalJsonStringify(candidate)
            if (candidates.has(key)) {
              semanticDiagnostics.push(
                diagnostic(
                  'error',
                  'x3.sdk/duplicate-companion-candidate',
                  `ambiguous companion ${companion.id} repeats one candidate`,
                  ['companions', index, 'candidates', candidateIndex],
                ),
              )
            }
            candidates.add(key)
          })
        }
      }
    })
    if (wire.origin.kind === 'bundle') {
      wire.origin.bindings.forEach((binding, index) => {
        if (binding.ownership === 'companion' && !companionBindingIds.has(binding.id)) {
          semanticDiagnostics.push(
            diagnostic(
              'error',
              'x3.sdk/untracked-companion-binding',
              `companion binding ${binding.id} has no resolved requirement state`,
              ['origin', 'bindings', index, 'id'],
            ),
          )
        }
      })
    }
  }
  if (wire.origin.kind === 'derived') {
    const inputIds = new Set<string>()
    wire.origin.inputs.forEach((input, index) => {
      if (inputIds.has(input.bindingId)) {
        semanticDiagnostics.push(
          diagnostic(
            'error',
            'x3.sdk/duplicate-derived-input',
            `derived input binding ${input.bindingId} is duplicated`,
            ['origin', 'inputs', index, 'bindingId'],
          ),
        )
      }
      inputIds.add(input.bindingId)
    })
  }
  if (wire.origin.kind === 'derived' && wire.origin.recipe !== undefined) {
    try {
      contributionId(wire.origin.recipe.contributionId)
      if (
        !isQualifiedId(wire.origin.recipe.extensionId) ||
        parseSemver(wire.origin.recipe.extensionVersion) === undefined
      ) {
        throw new TypeError('invalid extension coordinate')
      }
      operationId(wire.origin.recipe.operation, {
        contributionId: wire.origin.recipe.contributionId,
      })
    } catch {
      semanticDiagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/invalid-derivation-operation',
          `derivation recipe ${wire.origin.recipe.extensionId}@${wire.origin.recipe.extensionVersion}#${wire.origin.recipe.contributionId} cannot own ${wire.origin.recipe.operation}`,
          ['origin', 'recipe'],
        ),
      )
    }
  }
  if (hasErrors(semanticDiagnostics)) {
    return { diagnostics: [...schemaDiagnostics, ...semanticDiagnostics] }
  }

  const base = {
    ...wire,
    revision: revisionId(wire.revision),
    origin: normalizeOrigin(wire.origin),
    constraints: Object.freeze({
      ...wire.constraints,
      ...(wire.constraints.maxDecodedBytes === undefined
        ? {}
        : { maxDecodedBytes: uint64(wire.constraints.maxDecodedBytes) }),
    }),
    diagnostics: Object.freeze(wire.diagnostics.map(normalizeDiagnostic)),
    dataSources: Object.freeze(wire.dataSources.map(dataSourceRefFromWire)),
    traits: Object.freeze(
      wire.traits.map(item => Object.freeze({ ...item, id: traitId(item.id) }) as TraitInstance),
    ),
    operations: Object.freeze(
      wire.operations.map(
        item =>
          Object.freeze({
            ...item,
            id: operationId(item.id, { contributionId: operationOwner }),
          }) as AssetOperationDescriptor,
      ),
    ),
  }
  const descriptor = Object.freeze(
    wire.interpretation === 'none'
      ? { ...base, candidates: Object.freeze(wire.candidates.map(normalizeDetection)) }
      : {
          ...base,
          metadata: Object.freeze(
            wire.metadata.map(group =>
              Object.freeze({
                ...group,
                entries: Object.freeze(
                  group.entries.map(entry =>
                    Object.freeze({
                      ...entry,
                      ...(entry.provenance === undefined
                        ? {}
                        : {
                            provenance: Object.freeze(
                              entry.provenance.map(origin =>
                                Object.freeze({
                                  ...origin,
                                  ...(origin.range === undefined
                                    ? {}
                                    : { range: normalizeSourceSpan(origin.range) }),
                                }),
                              ),
                            ),
                          }),
                      ...(entry.editable === undefined
                        ? {}
                        : {
                            editable: Object.freeze({
                              ...entry.editable,
                              write:
                                'operation' in entry.editable.write
                                  ? Object.freeze({
                                      operation: operationId(entry.editable.write.operation, {
                                        contributionId: operationOwner,
                                      }),
                                    })
                                  : entry.editable.write,
                            }),
                          }),
                    }),
                  ),
                ),
              }),
            ),
          ),
          ...(wire.companions === undefined
            ? {}
            : { companions: Object.freeze(wire.companions.map(normalizeCompanion)) }),
        },
  ) as AnyDescriptor
  return { descriptor, diagnostics: [...schemaDiagnostics, ...semanticDiagnostics] }
}
