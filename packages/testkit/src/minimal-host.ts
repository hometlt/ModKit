/**
 * Minimal headless host harness (canon §6.1 testkit row; BRIEF-12 §5 S4): drives the ONE
 * public route — load → inventory → resolve → grant → import → execute — through public
 * package exports only. Internal tests and the external packed-tarball example run the
 * exact same harness, which is what "testkit proves one public route" means.
 */

import { ModkitError, type Diagnostic } from '@modkitx-x3/core'
import {
  type ContributionContractRegistration,
  type HostPolicy,
  type PermissionGrant,
  type ProviderOffer,
  type ProviderRequest,
  type ResolutionResult,
} from '@modkitx-x3/sdk'
import {
  activateContribution,
  buildInventory,
  buildLockEntry,
  createHostContributionContractRegistry,
  offersFromInventory,
  resolveForActivation,
  serializePolicyLock,
  type Activation,
  type ExtensionExecutionPolicy,
  type Inventory,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'

export interface MinimalHostOptions {
  readonly extensionDirs: readonly string[]
  /** Explicit host decision; omitted means linked/restricted and cannot run in-process. */
  readonly extensionExecution?: ExtensionExecutionPolicy
  readonly contributionContracts?: readonly ContributionContractRegistration[]
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
    const loaded = await loadExtensionDirectory(dir, options.signal)
    inputs.push(
      options.extensionExecution === undefined
        ? loaded
        : { ...loaded, execution: options.extensionExecution },
    )
  }
  const registry = createHostContributionContractRegistry(options.contributionContracts)
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
  // Resolution and ticket issuing are one host-owned step: there is no public way to
  // hand a fabricated result to an issuer (R9).
  const { result, ticket } = resolveForActivation(
    request,
    offers,
    ...(request.operation === undefined ? [] : [request.operation]),
  )
  if (result.state !== 'resolved') {
    throw new ModkitError({
      code: 'x3.testkit/unresolved',
      message: `resolution failed: ${result.reason}`,
      context: { reason: result.reason, rejected: result.rejected as never },
    })
  }
  const lockText = serializePolicyLock([buildLockEntry(request, result)])

  const providerId = result.selected.offer.providerId
  let selectedInInventory = false
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      if (contribution.manifest?.id === providerId) {
        selectedInInventory = true
      }
    }
  }
  if (!selectedInInventory) {
    throw new ModkitError({
      code: 'x3.testkit/selected-not-in-inventory',
      message: `selected provider «${providerId}» not found in inventory`,
    })
  }
  if (!ticket) {
    throw new ModkitError({
      code: 'x3.testkit/no-activation-ticket',
      message: `resolution produced no activation ticket for «${providerId}»`,
    })
  }
  const activation = await activateContribution({
    ticket,
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
