import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkCopies, prepareCopy, safeRelative } from './migration/lib/mk2-copy.mjs'
import { MK2_PIN } from './migration/lib/legacy-oracle.mjs'

const scriptRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const provenancePath = 'modkit-core/packages/codec-kit/MK2-PORT-PROVENANCE.json'
const copiedPrefix = 'modkit-core/packages/codec-kit/src/'
const legacyPrefix = `${copiedPrefix}legacy/`

/** The caller supplies reconstructed records and an independently trusted source/path map. */
export async function verifiedLegacyPaths(prepared, root, canonicalSources) {
  if (resolve(prepared.workspaceRoot, 'modkit-core') !== resolve(root))
    throw new Error('Canonical copy workspace does not match the vocabulary scan root')
  if (prepared.provenancePath !== provenancePath)
    throw new Error('Unexpected canonical copy provenance destination')
  if (prepared.provenance.oracleCommit !== MK2_PIN || prepared.provenance.scope !== 'm1-libs')
    throw new Error('Unexpected canonical copy pin or scope')
  for (const record of prepared.records) {
    safeRelative(record.destination)
    if (
      !record.destination.startsWith(copiedPrefix) ||
      canonicalSources.get(record.destination) !== record.mk2Path
    )
      throw new Error(`Unapproved canonical copy destination: ${record.destination}`)
  }
  // Rechecks actual bytes and the complete provenance document, never trusting its file list.
  await checkCopies(prepared)
  return new Set(
    prepared.records
      .filter(record => record.destination.startsWith(legacyPrefix))
      .map(record =>
        relative(root, resolve(prepared.workspaceRoot, record.destination)).split(sep).join('/'),
      ),
  )
}

export async function legacyCopyExclusions(root) {
  // A plain fixture tree has no copy boundary. A claimed boundary must be verified, including
  // when --root points elsewhere; fixture-local declarations never become the authority.
  if (
    resolve(root) !== scriptRoot &&
    !existsSync(join(root, 'packages/codec-kit/MK2-PORT-PROVENANCE.json'))
  )
    return new Set()
  const declaration = JSON.parse(
    await readFile(join(scriptRoot, 'migration/mk2-copy/sc2.json'), 'utf8'),
  )
  const divergences = JSON.parse(
    await readFile(join(scriptRoot, 'migration/mk2-divergence/sc2.json'), 'utf8'),
  )
  const selected = declaration.scopes?.['m1-libs']
  if (declaration.oracleCommit !== MK2_PIN || selected?.requiredSources?.length !== 37)
    throw new Error('Legacy vocabulary boundary requires the pinned 37-file M1 closure')
  const required = new Set(selected.requiredSources)
  const canonicalSources = new Map(
    declaration.copies
      .filter(row => required.has(row.source))
      .map(row => [row.destination, row.source]),
  )
  const prepared = await prepareCopy({
    declaration,
    divergences,
    scope: 'm1-libs',
    workspaceRoot: resolve(root, '..'),
    repoRoot: resolve(scriptRoot, '../references/modkitmk2'),
  })
  if (prepared.records.length !== 37 || canonicalSources.size !== 37)
    throw new Error('Legacy vocabulary boundary requires exactly 37 canonical records')
  return verifiedLegacyPaths(prepared, root, canonicalSources)
}
