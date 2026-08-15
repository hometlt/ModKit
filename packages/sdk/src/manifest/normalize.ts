/**
 * Two authored containers → one `ExtensionManifest` (canon §5.13; MK3/27 §0.2;
 * Q76 owner decision 2026-08-13). Data-only: no filesystem access, no execution.
 */

import {
  diagnostic,
  hasErrors,
  parseSemver,
  parseVersionRange,
  type Diagnostic,
} from '@modkitx-x3/core'
import { extensionManifestSchema, modkitBlockSchema } from '../schemas/extension-manifest.js'
import { snapshotJsonWireData, snapshotJsonWireObject, validateWithSchema } from './validate.js'
import { validateContributionPattern } from './patterns.js'
import type { AuthoredContainerKind, ExtensionManifest } from './types.js'

export interface AuthoredContainers {
  /** Parsed content of `package.json`, when the artifact has one. */
  readonly packageJson?: unknown
  /** Parsed content of `modkit.extension.json`, when present. */
  readonly standalone?: unknown
}

export interface NormalizationResult {
  readonly manifest?: ExtensionManifest
  readonly container?: AuthoredContainerKind
  readonly diagnostics: readonly Diagnostic[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function patternDiagnostics(manifest: ExtensionManifest): Diagnostic[] {
  return manifest.contributionManifests.flatMap(validateContributionPattern)
}

/**
 * Semantic range check on top of the structural schema pattern: the resolver's own
 * parser is the authority on what a range means, so a manifest that the pattern lets
 * through but the parser cannot read is still an error (Q75 `dependsOn.range`).
 */
function rangeDiagnostics(manifest: ExtensionManifest): Diagnostic[] {
  const out: Diagnostic[] = []
  manifest.dependsOn?.forEach((requirement, index) => {
    if (requirement.range === undefined) return
    if (parseVersionRange(requirement.range) === undefined) {
      out.push(
        diagnostic(
          'error',
          'x3.sdk/invalid-version-range',
          `«${requirement.range}» is not a range this resolver can evaluate (MK3/23 §4 subset)`,
          ['dependsOn', index, 'range'],
        ),
      )
    }
  })
  return out
}

function exactVersionDiagnostics(manifest: ExtensionManifest): Diagnostic[] {
  return parseSemver(manifest.version) === undefined
    ? [
        diagnostic(
          'error',
          'x3.sdk/invalid-extension-version',
          'extension version must be an exactly evaluable SemVer with safe numeric components',
          ['version'],
        ),
      ]
    : []
}

export async function normalizeExtensionManifest(
  input: AuthoredContainers,
): Promise<NormalizationResult> {
  let packageInput: unknown
  let standaloneInput: unknown
  try {
    const descriptors = Object.getOwnPropertyDescriptors(input)
    for (const key of Object.keys(descriptors)) {
      if (key !== 'packageJson' && key !== 'standalone') {
        throw new TypeError(`unknown authored-container field: ${key}`)
      }
      const descriptor = descriptors[key]
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError(`authored-container field ${key} must be inert data`)
      }
    }
    const packageValue = descriptors['packageJson']?.value
    const standaloneValue = descriptors['standalone']?.value
    packageInput = packageValue === undefined ? undefined : snapshotJsonWireData(packageValue)
    standaloneInput =
      standaloneValue === undefined ? undefined : snapshotJsonWireData(standaloneValue)
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'x3.sdk/non-json-authored-container',
          `authored container must be inert JSON data: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      ],
    }
  }

  const packageJson = isRecord(packageInput) ? packageInput : undefined
  const block =
    packageJson !== undefined && isRecord(packageJson['modkit']) ? packageJson['modkit'] : undefined
  const hasBlock = block !== undefined
  const hasStandalone = standaloneInput !== undefined

  if (hasBlock && hasStandalone) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'x3.sdk/two-authored-containers',
          'both package.json#modkit and modkit.extension.json exist — exactly one authored container per artifact (packaging error)',
        ),
      ],
    }
  }
  if (!hasBlock && !hasStandalone) {
    return {
      diagnostics: [
        diagnostic(
          'error',
          'x3.sdk/no-authored-container',
          'neither package.json#modkit nor modkit.extension.json found',
        ),
      ],
    }
  }

  if (hasStandalone) {
    const diagnostics = await validateWithSchema(extensionManifestSchema, standaloneInput)
    if (hasErrors(diagnostics)) return { container: 'standalone', diagnostics }
    const manifest = standaloneInput as ExtensionManifest
    const all = [
      ...diagnostics,
      ...exactVersionDiagnostics(manifest),
      ...patternDiagnostics(manifest),
      ...rangeDiagnostics(manifest),
    ]
    return hasErrors(all)
      ? { container: 'standalone', diagnostics: all }
      : { container: 'standalone', manifest, diagnostics: all }
  }

  // package.json#modkit route
  const diagnostics: Diagnostic[] = []
  const blockRecord = block as Record<string, unknown>
  for (const field of ['version', 'license'] as const) {
    if (field in blockRecord) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/npm-field-duplicated-in-block',
          `«${field}» belongs to the top-level package.json only (Q76 packaging error)`,
          ['modkit', field],
        ),
      )
    }
  }
  diagnostics.push(...(await validateWithSchema(modkitBlockSchema, blockRecord)))

  const version = (packageJson as Record<string, unknown>)['version']
  if (typeof version !== 'string' || parseSemver(version) === undefined) {
    diagnostics.push(
      diagnostic(
        'error',
        'x3.sdk/invalid-npm-version',
        'package.json must carry a valid SemVer `version` (inherited into the normalized manifest)',
        ['version'],
      ),
    )
  }
  const license = (packageJson as Record<string, unknown>)['license']
  if (typeof license !== 'string' || license.length === 0) {
    diagnostics.push(
      diagnostic(
        'error',
        'x3.sdk/invalid-npm-license',
        'package.json must carry a non-empty `license` (inherited into the normalized manifest)',
        ['license'],
      ),
    )
  }
  if (hasErrors(diagnostics)) return { container: 'package-json', diagnostics }

  const manifest = snapshotJsonWireObject({
    schemaVersion: 1,
    publisher: blockRecord['publisher'] as string,
    id: blockRecord['id'] as string,
    version: version as string,
    license: license as string,
    contributionManifests: blockRecord['contributionManifests'] as readonly string[],
    ...(blockRecord['dependsOn'] === undefined
      ? {}
      : {
          dependsOn: blockRecord['dependsOn'] as NonNullable<ExtensionManifest['dependsOn']>,
        }),
  }) as ExtensionManifest
  const all = [
    ...diagnostics,
    ...(await validateWithSchema(extensionManifestSchema, manifest)),
    ...exactVersionDiagnostics(manifest),
    ...patternDiagnostics(manifest),
    ...rangeDiagnostics(manifest),
  ]
  return hasErrors(all)
    ? { container: 'package-json', diagnostics: all }
    : { container: 'package-json', manifest, diagnostics: all }
}
