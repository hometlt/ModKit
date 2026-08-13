/**
 * Minimal headless host harness (canon §6.1 testkit row; BRIEF-12 §5 S4): drives the ONE
 * public route — load → inventory → resolve → grant → import → execute — through public
 * package exports only. Internal tests and the external packed-tarball example run the
 * exact same harness, which is what "testkit proves one public route" means.
 */

import { pathToFileURL } from 'node:url'
import { ModkitError, type Diagnostic } from '@modkitx-x3/core'
import {
  createSpecSchemaRegistry,
  type ContributionManifestV1,
  type HostPolicy,
  type PermissionGrant,
  type ProviderOffer,
  type ProviderRequest,
  type ResolutionResult,
  type SpecSchemaEntry,
} from '@modkitx-x3/sdk'
import {
  activateContribution,
  buildInventory,
  buildLockEntry,
  issueActivationTicket,
  resolveProvider,
  serializePolicyLock,
  type Activation,
  type Inventory,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'

/**
 * Envelope → provider offers. The contribution has no release version by design
 * (27 §0.5.1), so the offered contract version is the `${major}.0.0` projection —
 * lab decision L9 (IMPLEMENTATION_NOTES); range requests stay inside the major anyway.
 */
export function offersFromInventory(inventory: Inventory): ProviderOffer[] {
  const offers: ProviderOffer[] = []
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      if (!contribution.activationEligible || contribution.manifest === undefined) continue
      const manifest = contribution.manifest
      const outputs = specOutputs(manifest)
      for (const variant of manifest.runtimeVariants ?? []) {
        offers.push({
          kind: 'primary',
          extensionId: `${extension.manifest.publisher}/${extension.manifest.id}`,
          extensionVersion: extension.manifest.version,
          providerId: manifest.id,
          runtimeVariant: variant.variantId,
          target: variant.target,
          requiredPermissions: variant.requestedPermissionClasses,
          provides: [{ contract: manifest.contract.id, version: `${manifest.contract.major}.0.0` }],
          ...(outputs === undefined ? {} : { outputs }),
        })
      }
    }
  }
  return offers
}

function specOutputs(manifest: ContributionManifestV1): readonly string[] | undefined {
  const spec = manifest.spec
  if (typeof spec === 'object' && spec !== null && 'outputs' in spec) {
    const outputs = (spec as { outputs?: unknown }).outputs
    if (Array.isArray(outputs) && outputs.every(o => typeof o === 'string')) {
      return outputs as string[]
    }
  }
  return undefined
}

export interface MinimalHostOptions {
  readonly extensionDirs: readonly string[]
  readonly specSchemas: readonly SpecSchemaEntry[]
  readonly request: ProviderRequest
  /** MK3/24 §4 grant the session offers; the gate narrows it, never widens. */
  readonly grant: PermissionGrant
  readonly policy?: HostPolicy
  readonly signal?: AbortSignal
}

export interface MinimalHostRun {
  readonly inventory: Inventory
  readonly offers: readonly ProviderOffer[]
  readonly result: ResolutionResult
  readonly lockText: string
  readonly activation: Activation
  readonly diagnostics: readonly Diagnostic[]
}

/** The full public route; throws structured errors on unresolved/denied stages. */
export async function runMinimalHost(options: MinimalHostOptions): Promise<MinimalHostRun> {
  const inputs = []
  for (const dir of options.extensionDirs) {
    inputs.push(await loadExtensionDirectory(dir, options.signal))
  }
  const registry = createSpecSchemaRegistry(options.specSchemas)
  const inventory = await buildInventory(inputs, registry)
  const offers = offersFromInventory(inventory)
  // The machine target carries the granted permission classes (23 §9 stage 4 filters on
  // them; the activation gate re-checks the same grant before importing).
  const request: ProviderRequest = {
    ...options.request,
    target: {
      ...options.request.target,
      grantedPermissions: [
        ...new Set([
          ...(options.request.target.grantedPermissions ?? []),
          ...options.grant.classes,
        ]),
      ],
    },
  }
  const result = resolveProvider(request, offers)
  if (result.state !== 'resolved') {
    throw new ModkitError({
      code: 'x3.testkit/unresolved',
      message: `resolution failed: ${result.reason}`,
      context: { reason: result.reason, rejected: result.rejected as never },
    })
  }
  const lockText = serializePolicyLock([buildLockEntry(options.request, result)])

  const providerId = result.selected.offer.providerId
  let manifest: ContributionManifestV1 | undefined
  let baseDir: string | undefined
  let extensionId: string | undefined
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      if (contribution.manifest?.id === providerId) {
        manifest = contribution.manifest
        baseDir = extension.source
        extensionId = `${extension.manifest.publisher}/${extension.manifest.id}`
      }
    }
  }
  if (!manifest || !baseDir || !extensionId) {
    throw new ModkitError({
      code: 'x3.testkit/selected-not-in-inventory',
      message: `selected provider «${providerId}» not found in inventory`,
    })
  }
  // Activation is admitted only by a ticket the resolver issued for this exact target.
  const ticket = issueActivationTicket(
    result,
    request.target,
    ...(request.operation === undefined ? [] : [request.operation]),
  )
  const activation = await activateContribution({
    ticket,
    manifest,
    extensionId,
    baseUrl: pathToFileURL(`${baseDir}/`),
    grant: options.grant,
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  return {
    inventory,
    offers,
    result,
    lockText,
    activation,
    diagnostics: inventory.diagnostics,
  }
}
