import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMk2 as load } from '../../modkit-core/scripts/migration/lib/legacy-oracle.mjs'
export { MK2_PIN, createPinnedSource, createCorpusManifest, digestManifest, sha256, stableJson } from '../../modkit-core/scripts/migration/lib/legacy-oracle.mjs'
const here = path.dirname(fileURLToPath(import.meta.url))
export const codingRoot = path.resolve(here, '../..')
export async function loadMk2(entry, options = {}) {
  return load(entry, {
    repoRoot: path.join(codingRoot, 'references/modkitmk2'),
    cacheDir: path.join(here, 'cache'),
    ...options,
    loaderFiles: [fileURLToPath(import.meta.url), ...(options.loaderFiles ?? [])],
  })
}
