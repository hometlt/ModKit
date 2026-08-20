/**
 * The inventory, flattened into the rows a settings surface draws.
 *
 * Every contribution is listed, including the ones the host refused to activate. That is the whole
 * point of `disabledContributions` keeping the record: a page that showed only what activated could
 * never offer the switch that turns a disabled codec back on.
 *
 * Pure over an `Inventory`, so the webview's list, the output channel and the tests all read the
 * same description, and none of them needs a `vscode` module to produce it.
 *
 * (The Electron app carries the same twenty lines. Both would rather import one function from
 * `@modkitx-x3/host`, beside `supportedExtensionHints`, which reads the inventory for exactly the
 * same kind of hint — see the report accompanying this branch.)
 */
import { compareUtf8 } from '@modkitx-x3/core'
import type { Inventory } from '@modkitx-x3/host'

/** The host's own reason a contribution is inert because the user switched it off. */
export const CONTRIBUTION_DISABLED_CODE = 'x3.host/contribution-disabled'

/** One contribution as a settings surface lists it: identity, kind, owner and switch position. */
export interface ContributionRow {
  /** Qualified contribution id. Absent when the envelope did not parse — then there is no switch. */
  readonly id?: string
  readonly displayName: string
  /** The contract it implements (`org.modkitx/codec-contribution`) and that contract's major. */
  readonly contract?: string
  readonly contractMajor?: number
  /** `publisher/id` of the extension that ships it. */
  readonly extension: string
  readonly origin: string
  readonly activationEligible: boolean
  /** True when the host refused activation because this contribution is switched off. */
  readonly disabled: boolean
  /** Manifest path inside the extension — the only identity an unparsed record has. */
  readonly path: string
}

/** Flatten the inventory, sorted by owner then id, so the list is stable across launches. */
export function describeInventoryContributions(inventory: Inventory): readonly ContributionRow[] {
  const rows = inventory.extensions.flatMap(extension => {
    const owner = `${extension.manifest.publisher}/${extension.manifest.id}`
    return extension.contributions.map((contribution): ContributionRow => {
      const manifest = contribution.manifest
      return {
        ...(manifest === undefined ? {} : { id: manifest.id }),
        displayName: manifest?.displayName ?? contribution.path,
        ...(manifest === undefined
          ? {}
          : { contract: manifest.contract.id, contractMajor: manifest.contract.major }),
        extension: owner,
        origin: extension.origin,
        activationEligible: contribution.activationEligible,
        disabled: contribution.diagnostics.some(item => item.code === CONTRIBUTION_DISABLED_CODE),
        path: contribution.path,
      }
    })
  })
  return Object.freeze(
    rows.sort((left, right) => {
      const owner = compareUtf8(left.extension, right.extension)
      return owner === 0 ? compareUtf8(left.id ?? left.path, right.id ?? right.path) : owner
    }),
  )
}
