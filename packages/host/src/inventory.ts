/**
 * In-memory inventory (canon §6.1 host row; BRIEF-12 §5 S1; R6 §8 pipeline stage 2).
 * Data-only: inputs are pre-read documents — building the inventory never touches a
 * filesystem, never globs categories, and never executes contribution code. Discovery is
 * strictly the explicit `contributionManifests` list of each authored manifest.
 * Deterministic: output order and diagnostics are independent of input/listing order.
 */

import {
  canonicalJsonStringify,
  compareUtf8,
  diagnostic,
  hasErrors,
  isQualifiedId,
  type Diagnostic,
} from '@modkitx-x3/core'
import {
  expandContributionManifests,
  normalizeExtensionManifest,
  validateContributionManifest,
  type AuthoredContainerKind,
  type AuthoredContainers,
  type ContributionManifestV1,
  type ExtensionManifest,
  type ContributionContractRegistry,
  type ContributionProjectionContext,
  type InventoryFact,
  type SpecState,
} from '@modkitx-x3/sdk'

export interface ArtifactAttestationInput {
  /** Stable content-addressed inventory identity assigned by the trusted loader. */
  readonly inventoryRecordId: string
  /** SHA-256 (or an equivalently collision-resistant, explicitly named digest). */
  readonly artifactDigest: string
  /** Loader-owned root used to resolve the selected entrypoint. */
  readonly artifactRoot: URL
  /** Recompute/verify immediately before import; false means the artifact changed. */
  readonly verifyArtifactDigest: (expected: string) => boolean | Promise<boolean>
}

export interface ExtensionInput {
  /** Diagnostic label for the artifact (directory, archive id, …) — not an identity. */
  readonly source: string
  readonly containers: AuthoredContainers
  /** Relative forward-slash file listing of the artifact. */
  readonly files: readonly string[]
  /** Pre-read parsed JSON documents by relative path (contribution manifests). */
  readonly documents: ReadonlyMap<string, unknown>
  /** Digests of the exact contribution-manifest bytes read by the loader. */
  readonly documentDigests: ReadonlyMap<string, string>
  readonly artifact: ArtifactAttestationInput
}

export interface InventoryRecord {
  readonly inventoryRecordId: string
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly artifactRoot: string
}

export interface InventoryContribution {
  readonly path: string
  /** Present whenever the envelope parsed — unknown contracts stay inspectable. */
  readonly manifest?: ContributionManifestV1
  readonly specState: SpecState
  /** Full schema + semantic + registration gate; data-only records remain discoverable. */
  readonly inventoryEligible: boolean
  /** Never true for unknown/invalid contracts: inspectable, not activatable. */
  readonly activationEligible: boolean
  /** Host-trusted, inert projections. New fact contracts require no host switch statement. */
  readonly facts: readonly InventoryFact[]
  /** Present only for inventory-eligible records with loader attestation. */
  readonly record?: InventoryRecord
  readonly diagnostics: readonly Diagnostic[]
}

export interface InventoryExtension {
  readonly source: string
  readonly container: AuthoredContainerKind
  readonly manifest: ExtensionManifest
  readonly contributions: readonly InventoryContribution[]
}

export interface Inventory {
  /** Sorted by publisher/id (UTF-8 byte order); independent of input order. */
  readonly extensions: readonly InventoryExtension[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface PrivateInventoryRecord {
  readonly publicRecord: InventoryRecord
  readonly manifest: ContributionManifestV1
  readonly verifyArtifactDigest: ArtifactAttestationInput['verifyArtifactDigest']
  readonly artifactRoot: URL
}

const privateRecords = new WeakMap<InventoryContribution, PrivateInventoryRecord>()

function deepFreezeJson<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreezeJson(child)
  return Object.freeze(value)
}

/** Internal trust lookup used by offer projection and activation; structural copies do not pass. */
export function inventoryRecordFor(
  contribution: InventoryContribution,
): PrivateInventoryRecord | undefined {
  return privateRecords.get(contribution)
}

function coordinate(manifest: ExtensionManifest): string {
  return `${manifest.publisher}/${manifest.id}`
}

export async function buildInventory(
  inputs: readonly ExtensionInput[],
  registry: ContributionContractRegistry,
): Promise<Inventory> {
  const diagnostics: Diagnostic[] = []
  const extensions: InventoryExtension[] = []

  for (const input of inputs) {
    const normalized = await normalizeExtensionManifest(input.containers)
    diagnostics.push(
      ...normalized.diagnostics.map(d => ({ ...d, path: [input.source, ...(d.path ?? [])] })),
    )
    if (!normalized.manifest || !normalized.container) continue

    const expansion = expandContributionManifests(
      normalized.manifest.contributionManifests,
      input.files,
    )
    diagnostics.push(
      ...expansion.diagnostics.map(d => ({ ...d, path: [input.source, ...(d.path ?? [])] })),
    )

    const contributions: InventoryContribution[] = []
    for (const entry of expansion.entries) {
      const document = input.documents.get(entry.path)
      if (document === undefined) {
        diagnostics.push(
          diagnostic(
            'error',
            'x3.host/unreadable-contribution',
            `declared contribution «${entry.path}» was not provided by the loader`,
            [input.source, entry.path],
          ),
        )
        continue
      }
      const validationRegistry = registry.validationRegistry()
      const result = await validateContributionManifest(document, validationRegistry)
      const ownedManifest =
        result.manifest === undefined
          ? undefined
          : deepFreezeJson(
              JSON.parse(canonicalJsonStringify(result.manifest)) as ContributionManifestV1,
            )
      const manifestDigest = input.documentDigests.get(entry.path)
      const localDiagnostics = [...result.diagnostics]
      let inventoryEligible = result.inventoryEligible
      let activationEligible = result.activationEligible
      let facts: readonly InventoryFact[] = []
      let record: InventoryRecord | undefined
      if (ownedManifest !== undefined && result.inventoryEligible) {
        if (manifestDigest === undefined || manifestDigest.trim().length === 0) {
          localDiagnostics.push(
            diagnostic(
              'error',
              'x3.host/missing-manifest-digest',
              'the trusted loader did not attest the contribution manifest bytes',
              [input.source, entry.path],
            ),
          )
          inventoryEligible = false
          activationEligible = false
        } else {
          const context: ContributionProjectionContext = Object.freeze({
            ownerExtensionId: coordinate(normalized.manifest),
            extensionVersion: normalized.manifest.version,
            inventoryRecordId: `${input.artifact.inventoryRecordId}:${entry.path}`,
            manifestDigest,
            artifactDigest: input.artifact.artifactDigest,
            artifactRoot: input.artifact.artifactRoot.href,
            manifestPath: entry.path,
          })
          const registration = registry.get(ownedManifest.contract.id, ownedManifest.contract.major)
          try {
            const projected = registration?.project(ownedManifest, context)
            if (!Array.isArray(projected)) throw new TypeError('projector must return an array')
            facts = Object.freeze(
              projected.map((fact, index) => validateProjectedFact(fact, context, index)),
            )
            record = Object.freeze({
              inventoryRecordId: context.inventoryRecordId,
              manifestDigest,
              artifactDigest: context.artifactDigest,
              artifactRoot: context.artifactRoot,
            })
          } catch (error) {
            localDiagnostics.push(
              diagnostic(
                'error',
                'x3.host/inventory-projection-failed',
                'the host-trusted contribution projector returned malformed data or threw',
                [input.source, entry.path],
                { error: error instanceof Error ? error.message : String(error) },
              ),
            )
            inventoryEligible = false
            activationEligible = false
            facts = []
            record = undefined
          }
        }
      }
      const contribution: InventoryContribution = Object.freeze({
        path: entry.path,
        ...(ownedManifest === undefined ? {} : { manifest: ownedManifest }),
        specState: result.specState,
        inventoryEligible,
        activationEligible,
        facts,
        ...(record === undefined ? {} : { record }),
        diagnostics: Object.freeze(localDiagnostics),
      })
      if (record !== undefined && ownedManifest !== undefined) {
        privateRecords.set(contribution, {
          publicRecord: record,
          manifest: ownedManifest,
          verifyArtifactDigest: input.artifact.verifyArtifactDigest,
          artifactRoot: new URL(input.artifact.artifactRoot.href),
        })
      }
      contributions.push(contribution)
    }

    extensions.push({
      source: input.source,
      container: normalized.container,
      manifest: normalized.manifest,
      contributions,
    })
  }

  extensions.sort((a, b) => compareUtf8(coordinate(a.manifest), coordinate(b.manifest)))

  const seenExtensions = new Map<string, string>()
  for (const extension of extensions) {
    const coord = coordinate(extension.manifest)
    const prior = seenExtensions.get(coord)
    if (prior !== undefined) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.host/duplicate-extension-coordinate',
          `extension coordinate «${coord}» provided by both «${prior}» and «${extension.source}»`,
          [extension.source],
        ),
      )
    } else {
      seenExtensions.set(coord, extension.source)
    }
  }

  const seenContributions = new Map<string, string>()
  for (const extension of extensions) {
    for (const contribution of extension.contributions) {
      const id = contribution.manifest?.id
      if (id === undefined) continue
      const where = `${coordinate(extension.manifest)}:${contribution.path}`
      const prior = seenContributions.get(id)
      if (prior !== undefined) {
        diagnostics.push(
          diagnostic(
            'error',
            'x3.host/duplicate-contribution-id',
            `contribution id «${id}» declared by both «${prior}» and «${where}»`,
            [id],
          ),
        )
      } else {
        seenContributions.set(id, where)
      }
    }
  }

  // Deterministic diagnostic order: stable sort by (code, joined path, message).
  const key = (d: Diagnostic) => `${d.code}\u001f${(d.path ?? []).join('/')}\u001f${d.message}`
  diagnostics.sort((a, b) => compareUtf8(key(a), key(b)))

  return { extensions, diagnostics }
}

function validateProjectedFact(
  value: InventoryFact,
  context: ContributionProjectionContext,
  index: number,
): InventoryFact {
  if (
    typeof value !== 'object' ||
    value === null ||
    !isQualifiedId(value.contract?.id) ||
    !Number.isSafeInteger(value.contract?.major) ||
    value.contract.major < 0 ||
    canonicalJsonStringify(value.provenance) !== canonicalJsonStringify(context)
  ) {
    throw new TypeError(`invalid inventory fact at index ${index}`)
  }
  const ownedValue = deepFreezeJson(
    JSON.parse(canonicalJsonStringify(value.value)) as InventoryFact['value'],
  )
  return Object.freeze({
    contract: Object.freeze({ id: value.contract.id, major: value.contract.major }),
    value: ownedValue,
    provenance: Object.freeze({ ...context }),
  })
}

export function inventoryHasErrors(inventory: Inventory): boolean {
  return (
    hasErrors(inventory.diagnostics) ||
    inventory.extensions.some(extension =>
      extension.contributions.some(contribution => hasErrors(contribution.diagnostics)),
    )
  )
}
