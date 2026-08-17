/**
 * Contract-selected `spec` validation (canon Done-criterion 2; MK3/27 §0.3/§6): the
 * `contract` field selects a strict schema for `spec`. An unknown contract keeps the
 * envelope inspectable — data preserved, diagnostic emitted — but never activatable.
 */

import {
  diagnostic,
  contractId,
  compareUtf8,
  hasErrors,
  isQualifiedId,
  ModkitError,
  parseVersionRange,
  versionRangeTargetsMajor,
  type ExtensionId,
  type ContractId,
  type Diagnostic,
} from '@modkitx-x3/core'
import { contributionManifestSchema } from '../schemas/contribution-manifest.js'
import {
  snapshotJsonWireData,
  snapshotJsonWireObject,
  validateWithSchema,
  type PrecompiledSchemaValidator,
} from './validate.js'
import type { ContributionManifestV1 } from './contribution-types.js'
import type { ContributionManifestV1Wire } from './contribution-types.js'
import { contributionId, type JsonValue } from '../asset-capabilities/types.js'
import { hostFacilityDiagnostics } from '../host-profile.js'

export interface SpecModuleAbiDeclaration {
  readonly export: string
  readonly abiVersion: number
}

export interface ContributionProjectionContext {
  readonly ownerExtensionId: ExtensionId
  readonly extensionVersion: string
  readonly inventoryRecordId: string
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly artifactRoot: string
  /** Artifact-relative path of the validated contribution manifest. */
  readonly manifestPath: string
}

/** Open data-only fact projected by a host-trusted contribution-contract registration. */
export interface InventoryFact {
  readonly contract: { readonly id: ContractId; readonly major: number }
  readonly value: JsonValue
  /** Artifact-bound provenance needed to resolve relative schemas without trusting the author. */
  readonly provenance: ContributionProjectionContext
}

export type SpecSemanticValidator = (
  manifest: ContributionManifestV1,
) => readonly Diagnostic[] | Promise<readonly Diagnostic[]>

export type SpecInventoryProjector = (
  manifest: ContributionManifestV1,
  context: ContributionProjectionContext,
) => readonly InventoryFact[]

interface SpecRegistrationBase {
  readonly project: SpecInventoryProjector
  readonly conformanceProfile: string
}

/** Static definitions have inventory effects but no runtime module or activation variant. */
export interface SpecDataOnlyRegistration extends SpecRegistrationBase {
  readonly mode: 'data-only'
}

/** Executable contributions additionally bind a module ABI and require runtime variants. */
export interface SpecExecutableRegistration extends SpecRegistrationBase {
  readonly mode: 'executable'
  readonly moduleAbi: SpecModuleAbiDeclaration
}

export type SpecInventoryRegistration = SpecDataOnlyRegistration | SpecExecutableRegistration

export interface SpecSchemaEntry {
  readonly contract: ContractId
  readonly major: number
  readonly schema: object
  /** Required for open schemas that are not part of the platform's generated validator set. */
  readonly validator?: PrecompiledSchemaValidator
  /** Optional contract-owned semantics run before a full inventory registration exists. */
  readonly validateSemantics?: SpecSemanticValidator
  /** Omitted for schema-only registrations that remain inspectable but not inventory-ready. */
  readonly registration?: SpecInventoryRegistration
}

export interface SpecSchemaRegistry {
  /** Authoritative entry lookup; validation and activation read the same immutable record. */
  getEntry(contract: ContractId, major: number): SpecSchemaEntry | undefined
  /** Compatibility schema-only view for callers that do not decide activation. */
  get(contract: ContractId, major: number): object | undefined
  list(): readonly SpecSchemaEntry[]
}

function invalidRegistration(message: string, context: Record<string, unknown>): never {
  throw new ModkitError({
    code: 'x3.sdk/invalid-spec-registration',
    message,
    context,
  })
}

function safeContextValue(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  return typeof value
}

function validatedCoordinate(contractValue: unknown, majorValue: unknown) {
  if (typeof contractValue !== 'string' || !isQualifiedId(contractValue)) {
    return invalidRegistration('spec registration contract must be a qualified id', {
      contract: typeof contractValue === 'string' ? contractValue : typeof contractValue,
    })
  }
  if (!Number.isSafeInteger(majorValue) || (majorValue as number) < 0) {
    return invalidRegistration('spec registration major must be a safe non-negative integer', {
      contract: contractValue,
      major: safeContextValue(majorValue),
    })
  }
  return Object.freeze({ contract: contractId(contractValue), major: majorValue as number })
}

function validatedConformanceProfile(value: unknown, contract: ContractId, major: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalidRegistration('spec registration conformance profile must be non-blank', {
      contract,
      major,
      conformanceProfile: typeof value === 'string' ? value : typeof value,
    })
  }
  return value
}

function validatedModuleAbi(
  value: unknown,
  contract: ContractId,
  major: number,
): SpecModuleAbiDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidRegistration('executable spec registration requires a module ABI object', {
      contract,
      major,
    })
  }
  const candidate = value as { readonly export?: unknown; readonly abiVersion?: unknown }
  const exportName = candidate.export
  const abiVersion = candidate.abiVersion
  if (typeof exportName !== 'string' || exportName.trim().length === 0) {
    return invalidRegistration('module ABI export must be a non-blank string', {
      contract,
      major,
      export: typeof exportName === 'string' ? exportName : typeof exportName,
    })
  }
  if (!Number.isSafeInteger(abiVersion) || (abiVersion as number) < 0) {
    return invalidRegistration('module ABI version must be a safe non-negative integer', {
      contract,
      major,
      abiVersion: safeContextValue(abiVersion),
    })
  }
  return Object.freeze({ export: exportName, abiVersion: abiVersion as number })
}

export function createSpecSchemaRegistry(entries: readonly SpecSchemaEntry[]): SpecSchemaRegistry {
  const map = new Map<string, SpecSchemaEntry>()
  for (const authoredEntry of entries) {
    if (
      typeof authoredEntry !== 'object' ||
      authoredEntry === null ||
      Array.isArray(authoredEntry)
    ) {
      invalidRegistration('spec schema registration must be an object', {})
    }
    const coordinate = validatedCoordinate(authoredEntry.contract, authoredEntry.major)
    const schema = authoredEntry.schema
    const validator = authoredEntry.validator
    const validateSemantics = authoredEntry.validateSemantics
    const authoredRegistration = authoredEntry.registration as unknown
    let registration: SpecInventoryRegistration | undefined
    if (authoredRegistration !== undefined) {
      if (
        typeof authoredRegistration !== 'object' ||
        authoredRegistration === null ||
        Array.isArray(authoredRegistration)
      ) {
        invalidRegistration('spec inventory registration must be an object', coordinate)
      }
      const candidate = authoredRegistration as SpecInventoryRegistration
      const mode = candidate.mode
      const project = candidate.project
      const conformanceProfileValue = candidate.conformanceProfile
      if (mode !== 'data-only' && mode !== 'executable') {
        invalidRegistration('spec inventory registration mode is invalid', {
          ...coordinate,
          mode: safeContextValue(mode),
        })
      }
      if (typeof project !== 'function') {
        invalidRegistration('spec inventory projector must be a function', coordinate)
      }
      const conformanceProfile = validatedConformanceProfile(
        conformanceProfileValue,
        coordinate.contract,
        coordinate.major,
      )
      registration =
        mode === 'executable'
          ? Object.freeze({
              mode: 'executable',
              project,
              conformanceProfile,
              moduleAbi: validatedModuleAbi(
                candidate.moduleAbi,
                coordinate.contract,
                coordinate.major,
              ),
            })
          : Object.freeze({
              mode: 'data-only',
              project,
              conformanceProfile,
            })
    }
    const entry: SpecSchemaEntry = Object.freeze({
      contract: coordinate.contract,
      major: coordinate.major,
      schema: snapshotJsonWireObject(schema),
      ...(validator === undefined
        ? {}
        : typeof validator === 'function'
          ? { validator }
          : invalidRegistration('precompiled schema validator must be a function', coordinate)),
      ...(validateSemantics === undefined
        ? {}
        : typeof validateSemantics === 'function'
          ? { validateSemantics }
          : invalidRegistration('spec semantic validator must be a function', coordinate)),
      ...(registration === undefined ? {} : { registration }),
    })
    const key = `${entry.contract}@${entry.major}`
    if (map.has(key)) {
      throw new ModkitError({
        code: 'x3.sdk/duplicate-spec-schema',
        message: `duplicate spec schema registration: ${key}`,
        context: { contract: entry.contract, major: entry.major },
      })
    }
    map.set(key, entry)
  }
  const list = Object.freeze(
    [...map.values()].sort(
      (left, right) => compareUtf8(left.contract, right.contract) || left.major - right.major,
    ),
  )
  return {
    getEntry: (contract, major) => map.get(`${contract}@${major}`),
    get: (contract, major) => map.get(`${contract}@${major}`)?.schema,
    list: () => list,
  }
}

export type SpecState = 'validated' | 'unknown-contract' | 'invalid'

export interface ContributionValidationResult {
  /** Present whenever the envelope itself is well-formed — even for unknown contracts. */
  readonly manifest?: ContributionManifestV1
  readonly specState: SpecState
  /** True for a full data-only or executable registration after all validation gates. */
  readonly inventoryEligible: boolean
  /** True only for an executable registration with at least one valid runtime variant. */
  readonly activationEligible: boolean
  readonly diagnostics: readonly Diagnostic[]
}

function duplicateVariantDiagnostics(manifest: ContributionManifestV1): Diagnostic[] {
  const first = new Map<string, number>()
  const diagnostics: Diagnostic[] = []
  ;(manifest.runtimeVariants ?? []).forEach((variant, index) => {
    const previous = first.get(variant.variantId)
    if (previous === undefined) first.set(variant.variantId, index)
    else {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/duplicate-runtime-variant',
          `runtime variant ${variant.variantId} duplicates index ${previous}`,
          ['runtimeVariants', index, 'variantId'],
        ),
      )
    }
  })
  return diagnostics
}

function envelopeRangeDiagnostics(manifest: ContributionManifestV1): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  manifest.dependsOn?.forEach((requirement, index) => {
    const parsed =
      requirement.range === undefined ? undefined : parseVersionRange(requirement.range)
    if (
      requirement.range !== undefined &&
      (parsed === undefined || !versionRangeTargetsMajor(parsed, requirement.major))
    ) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/invalid-contract-range',
          `contract range ${requirement.range} cannot be evaluated safely`,
          ['dependsOn', index, 'range'],
        ),
      )
    }
  })
  return diagnostics
}

function runtimeFacilityDiagnostics(manifest: ContributionManifestV1): Diagnostic[] {
  return (manifest.runtimeVariants ?? []).flatMap((variant, index) =>
    hostFacilityDiagnostics(variant.target.requiredHostCapabilities, [
      'runtimeVariants',
      index,
      'target',
      'requiredHostCapabilities',
    ]),
  )
}

async function runSemanticValidator(
  validator: SpecSemanticValidator | undefined,
  manifest: ContributionManifestV1,
): Promise<Diagnostic[]> {
  if (validator === undefined) return []
  try {
    const result: unknown = await validator(manifest)
    if (
      !Array.isArray(result) ||
      !result.every(
        item =>
          typeof item === 'object' &&
          item !== null &&
          !Array.isArray(item) &&
          typeof (item as { code?: unknown }).code === 'string' &&
          isQualifiedId((item as { code: string }).code) &&
          ['error', 'warning', 'information', 'hint'].includes(
            String((item as { severity?: unknown }).severity),
          ) &&
          typeof (item as { message?: unknown }).message === 'string' &&
          ((item as { path?: unknown }).path === undefined ||
            (Array.isArray((item as { path?: unknown }).path) &&
              ((item as { path: unknown[] }).path as unknown[]).every(
                part => typeof part === 'string' || Number.isSafeInteger(part),
              ))),
      )
    ) {
      throw new TypeError('semantic validator returned malformed diagnostics')
    }
    return [...(result as Diagnostic[])]
  } catch (error) {
    return [
      diagnostic(
        'error',
        'x3.sdk/semantic-validator-failed',
        'the host-owned contribution semantic validator threw',
        ['spec'],
        { error: error instanceof Error ? error.message : String(error) },
      ),
    ]
  }
}

function normalizeContributionManifest(wire: ContributionManifestV1Wire): ContributionManifestV1 {
  const { contract, dependsOn, id, ...rest } = wire
  return Object.freeze({
    ...rest,
    id: contributionId(id),
    contract: Object.freeze({
      ...contract,
      id: contractId(contract.id),
    }),
    ...(dependsOn === undefined
      ? {}
      : {
          dependsOn: Object.freeze(
            dependsOn.map(requirement =>
              Object.freeze({
                ...requirement,
                contract: contractId(requirement.contract),
              }),
            ),
          ),
        }),
  })
}

export async function validateContributionManifest(
  value: unknown,
  registry: SpecSchemaRegistry,
): Promise<ContributionValidationResult> {
  let candidate: unknown
  try {
    candidate = snapshotJsonWireData(value)
  } catch (error) {
    return {
      specState: 'invalid',
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [
        diagnostic(
          'error',
          'x3.sdk/non-json-wire-value',
          'contribution manifest must be inert JSON data',
          [],
          { error: error instanceof Error ? error.message : String(error) },
        ),
      ],
    }
  }
  const envelopeDiagnostics = await validateWithSchema(contributionManifestSchema, candidate)
  if (hasErrors(envelopeDiagnostics)) {
    return {
      specState: 'invalid',
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: envelopeDiagnostics,
    }
  }
  const manifest = normalizeContributionManifest(candidate as ContributionManifestV1Wire)
  const manifestDiagnostics = [
    ...duplicateVariantDiagnostics(manifest),
    ...envelopeRangeDiagnostics(manifest),
    ...runtimeFacilityDiagnostics(manifest),
  ]
  if (hasErrors(manifestDiagnostics)) {
    return {
      manifest,
      specState: 'invalid',
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [...envelopeDiagnostics, ...manifestDiagnostics],
    }
  }
  const registration = registry.getEntry(manifest.contract.id, manifest.contract.major)
  if (registration === undefined) {
    return {
      manifest,
      specState: 'unknown-contract',
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [
        ...envelopeDiagnostics,
        ...manifestDiagnostics,
        diagnostic(
          'warning',
          'x3.sdk/unknown-contract',
          `contract «${manifest.contract.id}» major ${manifest.contract.major} has no registered spec schema — contribution stays inspectable data and is not activatable`,
          ['contract'],
        ),
      ],
    }
  }
  const specDiagnostics = (
    await validateWithSchema(
      registration.schema,
      manifest.spec,
      'x3.sdk/invalid-spec',
      registration.validator,
    )
  ).map(d => ({ ...d, path: ['spec', ...(d.path ?? [])] }))
  if (hasErrors(specDiagnostics)) {
    return {
      manifest,
      specState: 'invalid',
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [...envelopeDiagnostics, ...manifestDiagnostics, ...specDiagnostics],
    }
  }
  const semanticDiagnostics = [
    ...manifestDiagnostics,
    ...(await runSemanticValidator(registration.validateSemantics, manifest)),
  ]
  if (hasErrors(semanticDiagnostics)) {
    return {
      manifest,
      specState: 'invalid',
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [...envelopeDiagnostics, ...specDiagnostics, ...semanticDiagnostics],
    }
  }
  if (registration.registration === undefined) {
    return {
      manifest,
      specState: 'validated',
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [
        ...envelopeDiagnostics,
        ...specDiagnostics,
        diagnostic(
          'warning',
          'x3.sdk/schema-only-contract',
          `contract «${manifest.contract.id}» major ${manifest.contract.major} has a schema but no executable registration quartet`,
          ['contract'],
        ),
      ],
    }
  }
  if (
    registration.registration.mode === 'executable' &&
    (manifest.runtimeVariants?.length ?? 0) === 0
  ) {
    const missingVariant = diagnostic(
      'error',
      'x3.sdk/executable-without-runtime-variant',
      'an executable contribution requires at least one runtime variant',
      ['runtimeVariants'],
    )
    return {
      manifest,
      specState: 'invalid',
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [
        ...envelopeDiagnostics,
        ...specDiagnostics,
        ...semanticDiagnostics,
        missingVariant,
      ],
    }
  }
  if (
    registration.registration.mode === 'data-only' &&
    (manifest.runtimeVariants?.length ?? 0) > 0
  ) {
    const unexpectedVariant = diagnostic(
      'error',
      'x3.sdk/data-only-with-runtime-variant',
      'a data-only contribution cannot declare runtime variants',
      ['runtimeVariants'],
    )
    return {
      manifest,
      specState: 'invalid',
      inventoryEligible: false,
      activationEligible: false,
      diagnostics: [
        ...envelopeDiagnostics,
        ...specDiagnostics,
        ...semanticDiagnostics,
        unexpectedVariant,
      ],
    }
  }
  return {
    manifest,
    specState: 'validated',
    inventoryEligible: true,
    activationEligible: registration.registration.mode === 'executable',
    diagnostics: [...envelopeDiagnostics, ...specDiagnostics, ...semanticDiagnostics],
  }
}
