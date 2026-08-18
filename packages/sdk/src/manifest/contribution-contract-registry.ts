/** Open registry for contribution-contract schemas and their later A-2 offer projections. */

import {
  diagnostic,
  contractId,
  compareUtf8,
  isQualifiedId,
  isSegment,
  ModkitError,
  OPERATION_DOMAINS,
  parseSemver,
  parseVersionRange,
  versionRangeTargetsMajor,
  SHARED_OPERATION_IDS,
  type ContractId,
  type Diagnostic,
} from '@modkitx-x3/core'
import {
  codecContributionSpecV1Schema,
  editorContributionSpecV1Schema,
  serviceProviderContributionSpecV1Schema,
  contractDefinitionSpecV1Schema,
  traitDefinitionSpecV1Schema,
  viewerContributionSpecV1Schema,
} from '../schemas/contribution-specs.js'
import type { ConformanceProfileId } from '../asset-capabilities/data-sources.js'
import type { JsonSchema } from './contribution-spec-types.js'
import type { PermissionClass } from './contribution-types.js'
import type {
  CodecContributionSpecV1Wire,
  ServiceProviderContributionSpecV1Wire,
  ViewerContributionSpecV1Wire,
} from './contribution-spec-types.js'
import {
  createSpecSchemaRegistry,
  type SpecSchemaEntry,
  type SpecSchemaRegistry,
} from './spec-registry.js'
import type {
  SpecInventoryProjector,
  SpecSemanticValidator,
  SpecModuleAbiDeclaration,
} from './spec-registry.js'
import type { InventoryFact } from './spec-registry.js'
import type { JsonValue } from '../asset-capabilities/types.js'
import { isStandardTraitId } from '../asset-capabilities/standard-traits.js'
import type {
  ContractDefinitionSpecV1Wire,
  DataSourceSurfaceV1Wire,
  TraitDefinitionSpecV1Wire,
} from '../definitions.js'
import type { EditorContributionSpecV1Wire } from '../editing.js'
import type { ContractRequirementWire } from '../resolution/types.js'
import { snapshotJsonWireObject } from './validate.js'

export const CODEC_CONTRIBUTION_CONTRACT: ContractId = contractId('org.modkitx/codec-contribution')
export const SERVICE_PROVIDER_CONTRIBUTION_CONTRACT: ContractId = contractId(
  'org.modkitx/service-provider-contribution',
)
export const VIEWER_CONTRIBUTION_CONTRACT: ContractId = contractId(
  'org.modkitx/viewer-contribution',
)
export const EDITOR_CONTRIBUTION_CONTRACT: ContractId = contractId(
  'org.modkitx/editor-contribution',
)
export const TRAIT_DEFINITION_CONTRIBUTION_CONTRACT: ContractId = contractId(
  'org.modkitx/trait-definition',
)
export const CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT: ContractId = contractId(
  'org.modkitx/contract-definition',
)

export const TRAIT_DEFINITION_FACT: ContractId = contractId(
  'org.modkitx.inventory/trait-definition',
)
export const CONTRACT_DEFINITION_FACT: ContractId = contractId(
  'org.modkitx.inventory/contract-definition',
)
export const EDITOR_CONTRIBUTION_FACT: ContractId = contractId(
  'org.modkitx.inventory/editor-contribution',
)

export type ContributionModuleAbiDeclaration = SpecModuleAbiDeclaration

interface ContributionContractRegistrationBase {
  readonly contract: {
    readonly id: ContractId
    readonly major: number
  }
  readonly schema: JsonSchema
  /** CSP-safe validator emitted by the contract owner's build tooling for non-platform schemas. */
  readonly validator?: SpecSchemaEntry['validator']
  /** Pure host-owned projection to open inventory facts; it never executes extension code. */
  readonly project: SpecInventoryProjector
  readonly validateSemantics: SpecSemanticValidator
  readonly conformanceProfile: ConformanceProfileId
}

export interface DataOnlyContributionContractRegistration extends ContributionContractRegistrationBase {
  readonly mode: 'data-only'
}

export interface ExecutableContributionContractRegistration extends ContributionContractRegistrationBase {
  readonly mode: 'executable'
  readonly moduleAbi: ContributionModuleAbiDeclaration
}

export type ContributionContractRegistration =
  DataOnlyContributionContractRegistration | ExecutableContributionContractRegistration

export interface ContributionContractRegistry {
  get(contract: ContractId, major: number): ContributionContractRegistration | undefined
  list(): readonly ContributionContractRegistration[]
  /** Immutable projection consumed by validation and activation; both read the same entries. */
  validationRegistry(): SpecSchemaRegistry
}

function duplicateFieldDiagnostics(
  values: readonly string[],
  path: readonly (string | number)[],
  label: string,
): Diagnostic[] {
  const first = new Map<string, number>()
  const diagnostics: Diagnostic[] = []
  values.forEach((value, index) => {
    const previous = first.get(value)
    if (previous === undefined) first.set(value, index)
    else {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/duplicate-semantic-id',
          `${label} ${value} duplicates index ${previous}`,
          [...path, index],
        ),
      )
    }
  })
  return diagnostics
}

function requirementRangeDiagnostics(
  requirement: ContractRequirementWire,
  path: readonly (string | number)[],
): Diagnostic[] {
  const parsed = requirement.range === undefined ? undefined : parseVersionRange(requirement.range)
  return requirement.range !== undefined &&
    (parsed === undefined || !versionRangeTargetsMajor(parsed, requirement.major))
    ? [
        diagnostic(
          'error',
          'x3.sdk/invalid-contract-range',
          `contract range ${requirement.range} cannot be evaluated safely`,
          [...path, 'range'],
        ),
      ]
    : []
}

function traitDefinitionRangeDiagnostics(
  id: string,
  range: string | undefined,
  path: readonly (string | number)[],
): Diagnostic[] {
  if (isStandardTraitId(id)) {
    return range === undefined
      ? []
      : [
          diagnostic(
            'error',
            'x3.sdk/standard-trait-versioned',
            `standard trait ${id} does not use an extension definition range`,
            [...path, 'definitionRange'],
          ),
        ]
  }
  if (range === undefined || parseVersionRange(range) === undefined) {
    return [
      diagnostic(
        'error',
        'x3.sdk/custom-trait-definition-unbound',
        `custom trait ${id} must declare a safe definition range`,
        [...path, 'definitionRange'],
      ),
    ]
  }
  return []
}

function traitDefinitionOfferDiagnostics(
  id: string,
  version: string | undefined,
  path: readonly (string | number)[],
): Diagnostic[] {
  if (isStandardTraitId(id)) {
    return version === undefined
      ? []
      : [
          diagnostic(
            'error',
            'x3.sdk/standard-trait-versioned',
            `standard trait ${id} does not use an extension definition version`,
            [...path, 'definitionVersion'],
          ),
        ]
  }
  if (version === undefined || parseSemver(version) === undefined) {
    return [
      diagnostic(
        'error',
        'x3.sdk/custom-trait-definition-unbound',
        `custom trait ${id} must declare one exact safe definition version`,
        [...path, 'definitionVersion'],
      ),
    ]
  }
  return []
}

/** Contract-owned cross-field checks that JSON Schema cannot express. */
export const validateCodecContributionSemantics: SpecSemanticValidator = manifest => {
  const spec = manifest.spec as unknown as CodecContributionSpecV1Wire
  // The qualified owner remains intact. Replacing `/` with `.` is not injective
  // (`a.b/c` and `a/b.c` would collide).
  const localCodecPrefix = manifest.id
  const diagnostics = [
    ...duplicateFieldDiagnostics(
      spec.formatRefs.map(format => format.formatId),
      ['spec', 'formatRefs'],
      'format ID',
    ),
    ...duplicateFieldDiagnostics(
      spec.representations.map(representation => representation.id),
      ['spec', 'representations'],
      'representation ID',
    ),
    ...duplicateFieldDiagnostics(
      spec.companions?.map(companion => companion.id) ?? [],
      ['spec', 'companions'],
      'companion rule ID',
    ),
    ...duplicateFieldDiagnostics(
      spec.traitDeclarations?.map(
        declaration => `${declaration.id}\u0000${declaration.representation}`,
      ) ?? [],
      ['spec', 'traitDeclarations'],
      'trait declaration coordinate',
    ),
    ...duplicateFieldDiagnostics(
      spec.operations.map(operation => operation.id),
      ['spec', 'operations'],
      'operation ID',
    ),
    ...duplicateFieldDiagnostics(
      spec.operations.map(operation => operation.handlerId),
      ['spec', 'operations'],
      'operation handler ID',
    ),
  ]
  const expectedProbeKind =
    spec.sourceTopology === 'namespace'
      ? 'namespace'
      : spec.sourceTopology === 'derived'
        ? 'derived'
        : 'bytes'
  if (spec.probe.kind !== expectedProbeKind) {
    diagnostics.push(
      diagnostic(
        'error',
        'x3.sdk/probe-topology-mismatch',
        `topology ${spec.sourceTopology} requires a ${expectedProbeKind} probe policy`,
        ['spec', 'probe', 'kind'],
      ),
    )
  }
  spec.requires?.forEach((requirement, index) => {
    diagnostics.push(...requirementRangeDiagnostics(requirement, ['spec', 'requires', index]))
  })
  spec.traitDeclarations?.forEach((claim, index) => {
    diagnostics.push(
      ...traitDefinitionOfferDiagnostics(claim.id, claim.definitionVersion, [
        'spec',
        'traitDeclarations',
        index,
      ]),
    )
    claim.prerequisites?.forEach((requirement, requirementIndex) => {
      diagnostics.push(
        ...requirementRangeDiagnostics(requirement, [
          'spec',
          'traitDeclarations',
          index,
          'prerequisites',
          requirementIndex,
        ]),
      )
    })
  })
  spec.companions?.forEach((companion, companionIndex) => {
    for (const selector of ['all', 'any', 'none'] as const) {
      companion.expected?.[selector]?.forEach((requirement, requirementIndex) => {
        diagnostics.push(
          ...traitDefinitionRangeDiagnostics(requirement.id, requirement.definitionRange, [
            'spec',
            'companions',
            companionIndex,
            'expected',
            selector,
            requirementIndex,
          ]),
        )
      })
    }
  })
  spec.operations.forEach((operation, index) => {
    if (operation.requiresContract !== undefined) {
      diagnostics.push(
        ...requirementRangeDiagnostics(operation.requiresContract, [
          'spec',
          'operations',
          index,
          'requiresContract',
        ]),
      )
    }
    const shared = (SHARED_OPERATION_IDS as readonly string[]).includes(operation.id)
    const canonicalDomain = OPERATION_DOMAINS.some(domain => {
      const prefix = `${domain}.`
      return operation.id.startsWith(prefix) && isSegment(operation.id.slice(prefix.length))
    })
    const localSuffix = operation.id.startsWith(`${localCodecPrefix}.`)
      ? operation.id.slice(localCodecPrefix.length + 1)
      : undefined
    const codecLocal = localSuffix !== undefined && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(localSuffix)
    if (!shared && !canonicalDomain && !codecLocal) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/invalid-operation-namespace',
          `operation ${operation.id} is not shared, canonical-domain, or local to ${manifest.id}`,
          ['spec', 'operations', index, 'id'],
        ),
      )
    }
  })
  const requiredPermissions = new Set<PermissionClass>(['read-source'])
  spec.operations.forEach(operation => {
    if (operation.mutatesSource) requiredPermissions.add('write-source')
    operation.requiredPermissions?.forEach(permission => requiredPermissions.add(permission))
  })
  manifest.runtimeVariants?.forEach((variant, variantIndex) => {
    const requested = new Set(variant.requestedPermissionClasses)
    for (const permission of requiredPermissions) {
      if (!requested.has(permission)) {
        diagnostics.push(
          diagnostic(
            'error',
            'x3.sdk/variant-permission-underdeclared',
            `runtime variant ${variant.variantId} does not request ${permission}`,
            ['runtimeVariants', variantIndex, 'requestedPermissionClasses'],
          ),
        )
      }
    }
  })
  return diagnostics
}

function isPortableOperationReference(id: string): boolean {
  if ((SHARED_OPERATION_IDS as readonly string[]).includes(id)) return true
  if (
    OPERATION_DOMAINS.some(domain => {
      const prefix = `${domain}.`
      return id.startsWith(prefix) && isSegment(id.slice(prefix.length))
    })
  ) {
    return true
  }
  const separator = id.lastIndexOf('.')
  return (
    separator > 0 && isQualifiedId(id.slice(0, separator)) && isSegment(id.slice(separator + 1))
  )
}

export const validateViewerContributionSemantics: SpecSemanticValidator = manifest => {
  const spec = manifest.spec as unknown as ViewerContributionSpecV1Wire
  const diagnostics = [
    ...duplicateFieldDiagnostics(
      spec.requiresTraits?.map(requirement => requirement.id) ?? [],
      ['spec', 'requiresTraits'],
      'trait requirement',
    ),
    ...duplicateFieldDiagnostics(
      spec.requiresOperations ?? [],
      ['spec', 'requiresOperations'],
      'operation requirement',
    ),
  ]
  spec.requiresOperations?.forEach((id, index) => {
    if (!isPortableOperationReference(id)) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/invalid-operation-namespace',
          `viewer operation requirement ${id} is not shared, canonical-domain, or qualified-local`,
          ['spec', 'requiresOperations', index],
        ),
      )
    }
  })
  spec.requiresTraits?.forEach((requirement, index) => {
    diagnostics.push(
      ...traitDefinitionRangeDiagnostics(requirement.id, requirement.definitionRange, [
        'spec',
        'requiresTraits',
        index,
      ]),
    )
  })
  return diagnostics
}

const EDITING_OPERATION_IDS = Object.freeze([
  'edit.content',
  'edit.structure',
  'edit.field',
  'edit.undo-redo',
  'source.save',
  'source.save-as',
])

export const validateEditorContributionSemantics: SpecSemanticValidator = manifest => {
  const spec = manifest.spec as unknown as EditorContributionSpecV1Wire
  const diagnostics: Diagnostic[] = [
    ...duplicateFieldDiagnostics(
      spec.requiresOperations,
      ['spec', 'requiresOperations'],
      'operation',
    ),
    ...duplicateFieldDiagnostics(
      spec.consumesDataSources.map(source => `${source.contract}@${source.major}`),
      ['spec', 'consumesDataSources'],
      'data-source requirement',
    ),
  ]
  spec.requiresOperations.forEach((id, index) => {
    if (!(EDITING_OPERATION_IDS as readonly string[]).includes(id)) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/invalid-editor-operation',
          `editor operation ${id} is not one of the shared editing operations`,
          ['spec', 'requiresOperations', index],
        ),
      )
    }
  })
  if (!spec.requiresOperations.some(id => id.startsWith('edit.'))) {
    diagnostics.push(
      diagnostic(
        'error',
        'x3.sdk/editor-edit-operation-missing',
        'an editor contribution requires an explicit edit operation',
        ['spec', 'requiresOperations'],
      ),
    )
  }
  if (
    spec.requiresTransactions &&
    !spec.requiresOperations.some(id => id === 'source.save' || id === 'source.save-as')
  ) {
    diagnostics.push(
      diagnostic(
        'error',
        'x3.sdk/editor-save-operation-missing',
        'a transactional editor requires source.save or source.save-as',
        ['spec', 'requiresOperations'],
      ),
    )
  }
  if (spec.requiresTransactions && spec.writer.mutationMode !== 'mutate') {
    diagnostics.push(
      diagnostic(
        'error',
        'x3.sdk/editor-writer-mode-mismatch',
        'a transactional editor requires a mutating writer',
        ['spec', 'writer', 'mutationMode'],
      ),
    )
  }
  return diagnostics
}

export const validateTraitDefinitionSemantics: SpecSemanticValidator = manifest => {
  const spec = manifest.spec as unknown as TraitDefinitionSpecV1Wire
  const diagnostics: Diagnostic[] = []
  if (parseSemver(spec.version) === undefined) {
    diagnostics.push(
      diagnostic(
        'error',
        'x3.sdk/invalid-definition-version',
        `trait definition version ${spec.version} cannot be evaluated safely`,
        ['spec', 'version'],
      ),
    )
  }
  const seen = new Map<string, number>()
  spec.imports?.forEach((dependency, index) => {
    if (dependency.id === spec.id) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/self-definition-import',
          `trait definition ${spec.id} cannot import itself`,
          ['spec', 'imports', index, 'id'],
        ),
      )
    }
    const previous = seen.get(dependency.id)
    if (previous === undefined) seen.set(dependency.id, index)
    else {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/duplicate-definition-import',
          `trait import ${dependency.id} duplicates index ${previous}`,
          ['spec', 'imports', index, 'id'],
        ),
      )
    }
    if (parseVersionRange(dependency.range) === undefined) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/invalid-definition-range',
          `trait import range ${dependency.range} cannot be evaluated safely`,
          ['spec', 'imports', index, 'range'],
        ),
      )
    }
  })
  return diagnostics
}

export const validateContractDefinitionSemantics: SpecSemanticValidator = manifest => {
  const spec = manifest.spec as unknown as ContractDefinitionSpecV1Wire
  if (!Number.isSafeInteger(spec.major) || spec.major < 0) {
    return [
      diagnostic(
        'error',
        'x3.sdk/invalid-contract-major',
        `contract definition major ${spec.major} is not a safe non-negative integer`,
        ['spec', 'major'],
      ),
    ]
  }
  if (spec.surface !== undefined) {
    return dataSourceSurfaceDiagnostics(spec.surface, ['spec', 'surface'])
  }
  return []
}

/**
 * Surface rules the JSON schema cannot express (NXT-103): `releaseVia` must name a declared
 * `value` method, and a `lease` must not lease itself through a wrapper it cannot release.
 * Cross-definition facts (does the leased surface exist?) are checked where surfaces meet — the
 * host surface registry — not here.
 */
function dataSourceSurfaceDiagnostics(
  surface: DataSourceSurfaceV1Wire,
  path: readonly (string | number)[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (surface.releaseVia !== undefined) {
    const target = surface.methods[surface.releaseVia]
    if (target === undefined) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/surface-release-via-unknown',
          `releaseVia «${surface.releaseVia}» does not name a declared method`,
          [...path, 'releaseVia'],
        ),
      )
    } else if (target.kind !== 'value') {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/surface-release-via-kind',
          `releaseVia «${surface.releaseVia}» must name a value method, found ${target.kind}`,
          [...path, 'releaseVia'],
        ),
      )
    }
  }
  for (const field of surface.fields ?? []) {
    if (Object.hasOwn(surface.methods, field)) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/surface-field-is-method',
          `«${field}» cannot be both a field and a method`,
          [...path, 'fields'],
        ),
      )
    }
  }
  return diagnostics
}

export const validateServiceProviderContributionSemantics: SpecSemanticValidator = manifest => {
  const spec = manifest.spec as unknown as ServiceProviderContributionSpecV1Wire
  const diagnostics = [
    ...duplicateFieldDiagnostics(
      spec.provides.map(offer => offer.offerId),
      ['spec', 'provides'],
      'offer ID',
    ),
    ...duplicateFieldDiagnostics(
      spec.outputs?.map(output => `${output.id}\u0000${output.representation}`) ?? [],
      ['spec', 'outputs'],
      'trait declaration coordinate',
    ),
  ]
  spec.requires?.forEach((requirement, index) => {
    diagnostics.push(...requirementRangeDiagnostics(requirement, ['spec', 'requires', index]))
  })
  spec.outputs?.forEach((claim, index) => {
    diagnostics.push(
      ...traitDefinitionOfferDiagnostics(claim.id, claim.definitionVersion, [
        'spec',
        'outputs',
        index,
      ]),
    )
    claim.prerequisites?.forEach((requirement, requirementIndex) => {
      diagnostics.push(
        ...requirementRangeDiagnostics(requirement, [
          'spec',
          'outputs',
          index,
          'prerequisites',
          requirementIndex,
        ]),
      )
    })
  })
  if (spec.replacement !== undefined) {
    diagnostics.push(
      ...requirementRangeDiagnostics(spec.replacement.target, ['spec', 'replacement', 'target']),
    )
  }
  const variants = new Set((manifest.runtimeVariants ?? []).map(variant => variant.variantId))
  spec.provides.forEach((offer, index) => {
    const version = parseSemver(offer.version)
    if (version === undefined || version.major !== offer.major) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/offer-major-mismatch',
          `offer ${offer.offerId} version ${offer.version} does not match major ${offer.major}`,
          ['spec', 'provides', index, 'version'],
        ),
      )
    }
  })
  spec.applicableVariants?.forEach((variantId, index) => {
    if (!variants.has(variantId)) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/unknown-applicable-variant',
          `applicable variant ${variantId} is not declared by the envelope`,
          ['spec', 'applicableVariants', index],
        ),
      )
    }
  })
  return diagnostics
}

function key(contract: ContractId, major: number): string {
  return `${contract}@${major}`
}

function invalidOpenRegistration(message: string, context: Record<string, unknown>): never {
  throw new ModkitError({
    code: 'x3.sdk/invalid-contribution-contract-registration',
    message,
    context,
  })
}

function safeRegistrationContextValue(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  return typeof value
}

function validatedRegistrationCoordinate(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidOpenRegistration('contribution contract coordinate must be an object', {})
  }
  const candidate = value as { readonly id?: unknown; readonly major?: unknown }
  const id = candidate.id
  const major = candidate.major
  if (typeof id !== 'string' || !isQualifiedId(id)) {
    return invalidOpenRegistration('contribution contract id must be a qualified id', {
      contract: typeof id === 'string' ? id : typeof id,
    })
  }
  if (!Number.isSafeInteger(major) || (major as number) < 0) {
    return invalidOpenRegistration(
      'contribution contract major must be a safe non-negative integer',
      { contract: id, major: safeRegistrationContextValue(major) },
    )
  }
  return Object.freeze({ id: contractId(id), major: major as number })
}

function validatedRegistrationProfile(value: unknown, contract: ContractId, major: number) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalidOpenRegistration('contribution conformance profile must be non-blank', {
      contract,
      major,
      conformanceProfile: typeof value === 'string' ? value : typeof value,
    })
  }
  return value as ConformanceProfileId
}

function validatedRegistrationModuleAbi(
  value: unknown,
  contract: ContractId,
  major: number,
): ContributionModuleAbiDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidOpenRegistration('executable contribution registration requires module ABI', {
      contract,
      major,
    })
  }
  const candidate = value as { readonly export?: unknown; readonly abiVersion?: unknown }
  const exportName = candidate.export
  const abiVersion = candidate.abiVersion
  if (typeof exportName !== 'string' || exportName.trim().length === 0) {
    return invalidOpenRegistration('module ABI export must be a non-blank string', {
      contract,
      major,
      export: typeof exportName === 'string' ? exportName : typeof exportName,
    })
  }
  if (!Number.isSafeInteger(abiVersion) || (abiVersion as number) < 0) {
    return invalidOpenRegistration('module ABI version must be a safe non-negative integer', {
      contract,
      major,
      abiVersion: safeRegistrationContextValue(abiVersion),
    })
  }
  return Object.freeze({ export: exportName, abiVersion: abiVersion as number })
}

/** Immutable, duplicate-rejecting registry. Host wiring of real toOffers functions lands in A-2. */
export function createContributionContractRegistry(
  entries: readonly ContributionContractRegistration[],
): ContributionContractRegistry {
  const map = new Map<string, ContributionContractRegistration>()
  for (const authoredEntry of entries) {
    if (
      typeof authoredEntry !== 'object' ||
      authoredEntry === null ||
      Array.isArray(authoredEntry)
    ) {
      invalidOpenRegistration('contribution contract registration must be an object', {})
    }
    const coordinate = validatedRegistrationCoordinate(
      (authoredEntry as { readonly contract?: unknown }).contract,
    )
    const mode = authoredEntry.mode
    const conformanceProfileValue = authoredEntry.conformanceProfile
    const project = authoredEntry.project
    const validateSemantics = authoredEntry.validateSemantics
    const validator = authoredEntry.validator
    if (mode !== 'data-only' && mode !== 'executable') {
      invalidOpenRegistration('contribution contract registration mode is invalid', {
        contract: coordinate.id,
        major: coordinate.major,
        mode: safeRegistrationContextValue(mode),
      })
    }
    if (typeof project !== 'function') {
      invalidOpenRegistration('contribution inventory projector must be a function', {
        contract: coordinate.id,
        major: coordinate.major,
      })
    }
    if (typeof validateSemantics !== 'function') {
      invalidOpenRegistration('contribution semantic validator must be a function', {
        contract: coordinate.id,
        major: coordinate.major,
      })
    }
    if (validator !== undefined && typeof validator !== 'function') {
      invalidOpenRegistration('precompiled schema validator must be a function', {
        contract: coordinate.id,
        major: coordinate.major,
      })
    }
    const conformanceProfile = validatedRegistrationProfile(
      conformanceProfileValue,
      coordinate.id,
      coordinate.major,
    )
    const base = {
      contract: coordinate,
      schema: snapshotJsonWireObject(authoredEntry.schema),
      ...(validator === undefined ? {} : { validator }),
      project,
      validateSemantics,
      conformanceProfile,
    }
    const entry: ContributionContractRegistration =
      mode === 'executable'
        ? Object.freeze({
            ...base,
            mode: 'executable',
            moduleAbi: validatedRegistrationModuleAbi(
              authoredEntry.moduleAbi,
              coordinate.id,
              coordinate.major,
            ),
          })
        : Object.freeze({ ...base, mode: 'data-only' })
    const registrationKey = key(entry.contract.id, entry.contract.major)
    if (map.has(registrationKey)) {
      throw new ModkitError({
        code: 'x3.sdk/duplicate-contribution-contract',
        message: `duplicate contribution contract registration: ${registrationKey}`,
        context: { contract: entry.contract.id, major: entry.contract.major },
      })
    }
    map.set(registrationKey, entry)
  }
  const list = Object.freeze(
    [...map.values()].sort(
      (left, right) =>
        compareUtf8(left.contract.id, right.contract.id) ||
        left.contract.major - right.contract.major,
    ),
  )
  const validationRegistry = createSpecSchemaRegistry(
    list.map(entry => ({
      contract: entry.contract.id,
      major: entry.contract.major,
      schema: entry.schema,
      ...(entry.validator === undefined ? {} : { validator: entry.validator }),
      validateSemantics: entry.validateSemantics,
      registration:
        entry.mode === 'executable'
          ? {
              mode: 'executable',
              project: entry.project,
              moduleAbi: entry.moduleAbi,
              conformanceProfile: entry.conformanceProfile,
            }
          : {
              mode: 'data-only',
              project: entry.project,
              conformanceProfile: entry.conformanceProfile,
            },
    })),
  )
  return {
    get: (contract, major) => map.get(key(contract, major)),
    list: () => list,
    validationRegistry: () => validationRegistry,
  }
}

function dataOnlyProjector(factContract: ContractId): SpecInventoryProjector {
  return (manifest, context) =>
    Object.freeze([
      Object.freeze({
        contract: Object.freeze({ id: factContract, major: 1 }),
        value: manifest.spec as JsonValue,
        provenance: Object.freeze({ ...context }),
      }) satisfies InventoryFact,
    ])
}

/** A-1 schema registrations. Full registration quartets are assembled by A-2. */
export const A1_SPEC_SCHEMA_ENTRIES: readonly SpecSchemaEntry[] = [
  {
    contract: CODEC_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: codecContributionSpecV1Schema,
    validateSemantics: validateCodecContributionSemantics,
  },
  {
    contract: SERVICE_PROVIDER_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: serviceProviderContributionSpecV1Schema,
    validateSemantics: validateServiceProviderContributionSemantics,
  },
  {
    contract: VIEWER_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: viewerContributionSpecV1Schema,
    validateSemantics: validateViewerContributionSemantics,
  },
  {
    contract: EDITOR_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: editorContributionSpecV1Schema,
    validateSemantics: validateEditorContributionSemantics,
  },
  {
    contract: TRAIT_DEFINITION_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: traitDefinitionSpecV1Schema,
    validateSemantics: validateTraitDefinitionSemantics,
    registration: {
      mode: 'data-only',
      project: dataOnlyProjector(TRAIT_DEFINITION_FACT),
      conformanceProfile: 'org.modkitx/trait-definition-v1',
    },
  },
  {
    contract: CONTRACT_DEFINITION_CONTRIBUTION_CONTRACT,
    major: 1,
    schema: contractDefinitionSpecV1Schema,
    validateSemantics: validateContractDefinitionSemantics,
    registration: {
      mode: 'data-only',
      project: dataOnlyProjector(CONTRACT_DEFINITION_FACT),
      conformanceProfile: 'org.modkitx/contract-definition-v1',
    },
  },
] as const
