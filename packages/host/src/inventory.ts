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
  /**
   * Per-file digests (posix path relative to `artifactRoot` → `sha256:…`) taken in the same walk
   * as `artifactDigest`. Optional for sources that cannot enumerate files; a worker backend then
   * falls back to hashing only the entrypoint at activation.
   */
  readonly fileDigests?: Readonly<Record<string, string>>
}

/** Host-owned installation provenance. Extension-authored manifests cannot set this policy. */
export type ExtensionOrigin = 'bundled' | 'installed' | 'linked'

export interface ExtensionExecutionPolicy {
  /** How this host obtained the extension; informational unless paired with an explicit grant. */
  readonly origin: ExtensionOrigin
  /**
   * Explicit host decision to admit this exact artifact to the unsandboxed process boundary.
   * Missing/false always denies `trusted-in-process`; it is never inferred from publisher text.
   */
  readonly allowTrustedInProcess: boolean
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
  /** Missing means a linked/restricted artifact. This value is supplied by the host loader. */
  readonly execution?: ExtensionExecutionPolicy
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
  readonly origin: ExtensionOrigin
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
  readonly fileDigests?: Readonly<Record<string, string>>
  readonly artifactRoot: URL
  readonly execution: ExtensionExecutionPolicy
}

/** The host's diagnostic code for an extension disabled by user settings. */
export const EXTENSION_DISABLED_CODE = 'x3.host/extension-disabled'

/** The host's diagnostic code for a contribution disabled by user settings. */
export const CONTRIBUTION_DISABLED_CODE = 'x3.host/contribution-disabled'

/**
 * The private record travels on the contribution object itself under a well-known symbol —
 * non-enumerable, non-writable, frozen — rather than in a module-local WeakMap: the published
 * entries of this package (`.`, `./node`, `./browser`, …) are bundled separately, so an inventory
 * built by one entry must still be honoured by another (S1b did the same for the execution
 * backend registry). Structural copies (spread, JSON, `Object.assign`) never carry a
 * non-enumerable symbol property, so a look-alike still has no record.
 */
const INVENTORY_RECORD = Symbol.for('x3.host/inventory-record')

interface RecordCarrier {
  readonly [INVENTORY_RECORD]?: PrivateInventoryRecord
}

function deepFreezeJson<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreezeJson(child)
  return Object.freeze(value)
}

/** Internal trust lookup used by offer projection and activation; structural copies do not pass. */
export function inventoryRecordFor(
  contribution: InventoryContribution,
): PrivateInventoryRecord | undefined {
  const record = (contribution as RecordCarrier)[INVENTORY_RECORD]
  return record !== undefined &&
    Object.isFrozen(record) &&
    record.publicRecord === contribution.record
    ? record
    : undefined
}

function coordinate(manifest: ExtensionManifest): string {
  return `${manifest.publisher}/${manifest.id}`
}

const RESTRICTED_LINKED_EXECUTION: ExtensionExecutionPolicy = Object.freeze({
  origin: 'linked',
  allowTrustedInProcess: false,
})

function snapshotExecutionPolicy(value: ExtensionInput['execution']): {
  readonly policy: ExtensionExecutionPolicy
  readonly valid: boolean
} {
  if (value === undefined) return { policy: RESTRICTED_LINKED_EXECUTION, valid: true }
  const origin = value.origin
  const allowTrustedInProcess = value.allowTrustedInProcess
  const allowedOrigin = origin === 'bundled' || origin === 'installed' || origin === 'linked'
  if (!allowedOrigin || typeof allowTrustedInProcess !== 'boolean') {
    return { policy: RESTRICTED_LINKED_EXECUTION, valid: false }
  }
  return {
    policy: Object.freeze({
      origin,
      allowTrustedInProcess,
    }),
    valid: true,
  }
}

export interface InventoryBuildOptions {
  /**
   * Extension coordinates (`publisher/id`) the user switched off.
   *
   * Just like a disabled contribution, a disabled extension stays fully inventoried. Every
   * contribution it owns becomes ineligible for activation, so cards and settings can still show
   * the extension and restore its previous per-contribution choices when it is enabled again.
   */
  readonly disabledExtensions?: readonly string[]
  /**
   * Contribution ids (`org.example/some-codec`) the user switched off.
   *
   * A disabled contribution stays in the inventory — listed, inspectable, its manifest readable —
   * and loses `activationEligible`, so resolution never selects it. That is what "выключить кодек"
   * has to mean in this architecture: the record keeps existing (a settings page has to show what
   * is disabled, or the user cannot turn it back on), and the *host* is what refuses to run it,
   * not a filter each application reimplements.
   */
  readonly disabledContributions?: readonly string[]
}

export async function buildInventory(
  inputs: readonly ExtensionInput[],
  registry: ContributionContractRegistry,
  options: InventoryBuildOptions = {},
): Promise<Inventory> {
  const disabled = new Set(options.disabledContributions ?? [])
  const disabledExtensions = new Set(options.disabledExtensions ?? [])
  const diagnostics: Diagnostic[] = []
  const extensions: InventoryExtension[] = []

  for (const input of inputs) {
    // Capture this security-sensitive host decision before the first await. A caller cannot
    // mutate an authored/input object while validation is suspended and gain process authority.
    const execution = snapshotExecutionPolicy(input.execution)
    if (!execution.valid) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.host/invalid-extension-execution-policy',
          'the host loader supplied malformed extension execution provenance; activation is disabled',
          [input.source],
        ),
      )
    }
    const normalized = await normalizeExtensionManifest(input.containers)
    diagnostics.push(
      ...normalized.diagnostics.map(d => ({ ...d, path: [input.source, ...(d.path ?? [])] })),
    )
    if (!normalized.manifest || !normalized.container) continue
    const extensionCoordinate = coordinate(normalized.manifest)
    const extensionDisabled = disabledExtensions.has(extensionCoordinate)

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
      let activationEligible = result.activationEligible && execution.valid
      const manifestId = result.manifest?.id
      if (extensionDisabled) {
        activationEligible = false
        localDiagnostics.push(
          diagnostic(
            'information',
            EXTENSION_DISABLED_CODE,
            `extension «${extensionCoordinate}» is disabled by host settings; its contributions stay listed`,
            [input.source, entry.path],
          ),
        )
      }
      // Keep the contribution's own switch visible even while its owning extension is off. When
      // the extension is enabled again, this independent setting must still suppress only this
      // contribution instead of silently resetting the user's prior choice.
      if (manifestId !== undefined && disabled.has(manifestId)) {
        activationEligible = false
        localDiagnostics.push(
          diagnostic(
            'information',
            CONTRIBUTION_DISABLED_CODE,
            `«${manifestId}» is disabled by host settings; it stays listed and can be re-enabled`,
            [input.source, entry.path],
          ),
        )
      }
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
            ownerExtensionId: extensionCoordinate,
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
      const contribution: InventoryContribution = {
        path: entry.path,
        ...(ownedManifest === undefined ? {} : { manifest: ownedManifest }),
        specState: result.specState,
        inventoryEligible,
        activationEligible,
        facts,
        ...(record === undefined ? {} : { record }),
        diagnostics: Object.freeze(localDiagnostics),
      }
      if (record !== undefined && ownedManifest !== undefined) {
        const privateRecord: PrivateInventoryRecord = Object.freeze({
          publicRecord: record,
          manifest: ownedManifest,
          verifyArtifactDigest: input.artifact.verifyArtifactDigest,
          ...(input.artifact.fileDigests === undefined
            ? {}
            : { fileDigests: Object.freeze({ ...input.artifact.fileDigests }) }),
          artifactRoot: new URL(input.artifact.artifactRoot.href),
          execution: execution.policy,
        })
        Object.defineProperty(contribution, INVENTORY_RECORD, {
          value: privateRecord,
          enumerable: false,
          writable: false,
          configurable: false,
        })
      }
      contributions.push(Object.freeze(contribution))
    }

    extensions.push({
      source: input.source,
      origin: execution.policy.origin,
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
