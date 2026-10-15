/** A7 authority comes from the tested installation's own loader and shipped roots, never live dist. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function readInstalledA7Inventory(installedRoot) {
  const root = join(installedRoot, 'dist-app', 'extensions')
  const modulePath = name =>
    pathToFileURL(join(root, 'node_modules', '@modkit', 'host', 'dist', name)).href
  const { loadExtensionDirectory } = await import(modulePath('node/index.js'))
  const { buildInventory, createHostContributionContractRegistry } = await import(
    modulePath('index.js')
  )
  const entries = readdirSync(root, { withFileTypes: true }).filter(
    entry => entry.name !== 'node_modules',
  )
  assert.ok(entries.length > 0, 'installed A7 roots are empty')
  assert.ok(
    entries.every(entry => entry.isDirectory() && !entry.isSymbolicLink()),
    'unexpected installed extension entry',
  )
  const inputs = await Promise.all(
    entries.map(entry => loadExtensionDirectory(join(root, entry.name))),
  )
  const inventory = await buildInventory(inputs, createHostContributionContractRegistry())
  assert.equal(inventory.extensions.length, inputs.length, 'malformed installed root')
  assert.deepEqual(
    inventory.diagnostics.filter(item => item.severity === 'error').map(item => item.code),
    [],
    'invalid installed inventory',
  )
  const roots = inventory.extensions
    .map(extension => `${extension.manifest.publisher}/${extension.manifest.id}`)
    .sort()
  const contributions = inventory.extensions
    .flatMap(extension =>
      extension.contributions.map(contribution => {
        assert.ok(
          contribution.manifest && contribution.inventoryEligible,
          'unknown or invalid installed contribution',
        )
        return `${extension.manifest.publisher}/${extension.manifest.id}#${contribution.manifest.id}`
      }),
    )
    .sort()
  assert.equal(new Set(roots).size, roots.length, 'duplicate installed roots')
  assert.equal(
    new Set(contributions).size,
    contributions.length,
    'duplicate installed contributions',
  )
  const artifacts = entries
    .map((entry, index) => ({
      path: `dist-app/extensions/${entry.name}`,
      digest: inputs[index].artifact.artifactDigest,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const authority = {
    path: 'dist-app/extensions',
    artifacts,
    sha256: `sha256:${createHash('sha256').update(JSON.stringify(artifacts)).digest('hex')}`,
  }
  return { roots, contributions, authority }
}

export function assertInstalledA7(a7, inventory) {
  for (const [field, identities] of [
    ['expectedRoots', inventory.roots],
    ['loadedRoots', inventory.roots],
    ['expectedContributions', inventory.contributions],
    ['loadedContributions', inventory.contributions],
  ]) {
    assert.ok(Array.isArray(a7?.[field]), `A7 receipt has no ${field} array`)
    assert.deepEqual(
      [...a7[field]].sort(),
      identities,
      `A7 ${field} differs from installed inventory`,
    )
  }
  for (const field of [
    'missingRoots',
    'unexpectedRoots',
    'missingContributions',
    'unexpectedContributions',
    'loadErrors',
  ])
    assert.deepEqual(a7?.[field], [], `A7 ${field} is not empty`)
  assert.equal(a7.verdict, 'pass', 'A7 verdict')
}
