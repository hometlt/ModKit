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
 * `@modkit/host`, beside `supportedExtensionHints`, which reads the inventory for exactly the
 * same kind of hint — see the report accompanying this branch.)
 */
import { compareUtf8 } from '@modkit/core'
import type { Inventory } from '@modkit/host'

/** The host's own reason a contribution is inert because the user switched it off. */
export const CONTRIBUTION_DISABLED_CODE = 'x3.host/contribution-disabled'

/** One contribution as a settings surface lists it: identity, kind, owner and switch position. */
export interface ContributionRow {
  /** Qualified contribution id. Absent when the envelope did not parse — then there is no switch. */
  readonly id?: string
  readonly displayName: string
  /** The contract it implements (`modkit/codec-contribution`) and that contract's major. */
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
  /**
   * File extensions this codec routes on, lower case and without a dot.
   *
   * Read straight from the contribution's own `spec.match.extensions`, so the per-codec «open by
   * default» setting operates on what the codec actually claims rather than on a list maintained
   * beside it.
   */
  readonly fileExtensions: readonly string[]
  /**
   * File names the codec declares as anchors of a source (`spec.anchorDocuments`).
   *
   * They carry no extension — `MapInfo`, `DocumentInfo` — so VS Code would hand them to the text
   * editor and the subject opener, where the anchor rule lives, would never see them.
   */
  readonly anchorFileNames: readonly string[]
}

/** `spec.match.extensions` of a codec contribution, normalised; empty for anything else. */
function fileExtensionsOf(manifest: unknown): readonly string[] {
  const spec = (
    manifest as { readonly spec?: { readonly match?: { readonly extensions?: unknown } } }
  )?.spec
  if (!Array.isArray(spec?.match?.extensions)) return Object.freeze([])
  return Object.freeze(
    [
      ...new Set(
        spec.match.extensions.flatMap(value =>
          typeof value === 'string' && value.length > 0
            ? [value.replace(/^\./u, '').toLowerCase()]
            : [],
        ),
      ),
    ].sort(),
  )
}

/** `spec.anchorDocuments` of a codec contribution, as bare file names; empty for anything else. */
function anchorFileNamesOf(manifest: unknown): readonly string[] {
  const spec = (manifest as { readonly spec?: { readonly anchorDocuments?: unknown } })?.spec
  if (!Array.isArray(spec?.anchorDocuments)) return Object.freeze([])
  return Object.freeze(
    [
      ...new Set(
        spec.anchorDocuments.flatMap(value => {
          if (typeof value !== 'string' || value.length === 0) return []
          // An association keys on a file name; a nested anchor path has none to offer.
          const name = value.split('/').filter(Boolean).at(-1)
          return name === undefined || name.length === 0 ? [] : [name]
        }),
      ),
    ].sort(),
  )
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
        fileExtensions:
          manifest?.contract.id === 'modkit/codec-contribution'
            ? fileExtensionsOf(manifest)
            : Object.freeze([]),
        anchorFileNames:
          manifest?.contract.id === 'modkit/codec-contribution'
            ? anchorFileNamesOf(manifest)
            : Object.freeze([]),
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
