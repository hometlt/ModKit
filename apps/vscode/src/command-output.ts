/** Naming and reading what a shared command produced, for the VS Code host. */

import { basename } from 'node:path'

import { parseContainerUriText } from './container-uri.js'

/** A map world exported as UVW, within the CLI's limits (П24): 4096² terrain cells, 256 MiB. */
export const WORLD_UVW_LIMITS = Object.freeze({
  maxPageItems: 4096,
  maxTerrainItems: 4096 * 4096,
  maxFacetItems: 4096 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
})

/**
 * The file name a command's output is offered under.
 *
 * `subject.extract` names the member it read, so the member keeps its name. A conversion names its
 * target (`uvm`, `world.uvw`): the output takes the subject's name with the target's extension, as
 * an export from the viewer does.
 */
export function commandOutputLeaf(
  command: string,
  subject: string | undefined,
  name: string,
): string {
  if (command === 'subject.extract') return basename(name.replaceAll('\\', '/')) || 'extracted'
  const extension = name.slice(name.lastIndexOf('.') + 1) || 'bin'
  const path =
    subject === undefined ? undefined : (parseContainerUriText(subject)?.entry ?? subject)
  const leaf = path === undefined ? '' : basename(path.replaceAll('\\', '/'))
  const stem = leaf.includes('.') ? leaf.slice(0, leaf.lastIndexOf('.')) : leaf
  return `${stem || 'export'}.${extension}`
}

export interface WorldUvwReceipt {
  readonly artifactDigest: string
  readonly excludedFacetIds: readonly string[]
  readonly omittedObjects: number
  readonly lostFields: readonly { readonly path: string; readonly count: number }[]
}

/** The receipt of a world exported as UVW (`subject.convert --target uvw`), if the data is one. */
export function worldUvwReceiptOf(data: unknown): WorldUvwReceipt | undefined {
  const receipt = (data as { readonly receipt?: unknown } | null | undefined)?.receipt as
    Partial<Record<keyof WorldUvwReceipt, unknown>> | undefined
  if (
    typeof receipt?.artifactDigest !== 'string' ||
    !Array.isArray(receipt.excludedFacetIds) ||
    typeof receipt.omittedObjects !== 'number' ||
    !Array.isArray(receipt.lostFields)
  ) {
    return undefined
  }
  return {
    artifactDigest: receipt.artifactDigest,
    excludedFacetIds: receipt.excludedFacetIds.filter(item => typeof item === 'string'),
    omittedObjects: receipt.omittedObjects,
    lostFields: receipt.lostFields.filter(
      (item): item is { path: string; count: number } =>
        typeof (item as { path?: unknown })?.path === 'string' &&
        typeof (item as { count?: unknown })?.count === 'number',
    ),
  }
}
