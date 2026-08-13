/**
 * Contract-selected `spec` validation (canon Done-criterion 2; MK3/27 §0.3/§6): the
 * `contract` field selects a strict schema for `spec`. An unknown contract keeps the
 * envelope inspectable — data preserved, diagnostic emitted — but never activatable.
 */

import { diagnostic, hasErrors, type ContractId, type Diagnostic } from '@modkitx-x3/core'
import { contributionManifestSchema } from '../schemas/contribution-manifest.js'
import { validateWithSchema } from './validate.js'
import type { ContributionManifestV1 } from './contribution-types.js'

export interface SpecSchemaEntry {
  readonly contract: ContractId
  readonly major: number
  readonly schema: object
}

export interface SpecSchemaRegistry {
  get(contract: ContractId, major: number): object | undefined
}

export function createSpecSchemaRegistry(entries: readonly SpecSchemaEntry[]): SpecSchemaRegistry {
  const map = new Map<string, object>()
  for (const entry of entries) map.set(`${entry.contract}@${entry.major}`, entry.schema)
  return { get: (contract, major) => map.get(`${contract}@${major}`) }
}

export type SpecState = 'validated' | 'unknown-contract' | 'invalid'

export interface ContributionValidationResult {
  /** Present whenever the envelope itself is well-formed — even for unknown contracts. */
  readonly manifest?: ContributionManifestV1
  readonly specState: SpecState
  /** True only when the envelope is valid AND the contract-selected spec validated. */
  readonly activationEligible: boolean
  readonly diagnostics: readonly Diagnostic[]
}

export function validateContributionManifest(
  value: unknown,
  registry: SpecSchemaRegistry,
): ContributionValidationResult {
  const envelopeDiagnostics = validateWithSchema(contributionManifestSchema, value)
  if (hasErrors(envelopeDiagnostics)) {
    return { specState: 'invalid', activationEligible: false, diagnostics: envelopeDiagnostics }
  }
  const manifest = value as ContributionManifestV1
  const specSchema = registry.get(manifest.contract.id, manifest.contract.major)
  if (specSchema === undefined) {
    return {
      manifest,
      specState: 'unknown-contract',
      activationEligible: false,
      diagnostics: [
        ...envelopeDiagnostics,
        diagnostic(
          'warning',
          'x3.sdk/unknown-contract',
          `contract «${manifest.contract.id}» major ${manifest.contract.major} has no registered spec schema — contribution stays inspectable data and is not activatable`,
          ['contract'],
        ),
      ],
    }
  }
  const specDiagnostics = validateWithSchema(specSchema, manifest.spec, 'x3.sdk/invalid-spec').map(
    d => ({ ...d, path: ['spec', ...(d.path ?? [])] }),
  )
  if (hasErrors(specDiagnostics)) {
    return {
      manifest,
      specState: 'invalid',
      activationEligible: false,
      diagnostics: [...envelopeDiagnostics, ...specDiagnostics],
    }
  }
  return {
    manifest,
    specState: 'validated',
    activationEligible: true,
    diagnostics: [...envelopeDiagnostics, ...specDiagnostics],
  }
}
