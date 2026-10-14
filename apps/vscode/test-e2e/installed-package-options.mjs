/** Optional external catalog selection; identity is evidence, not signature verification. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function installedPackageOptions(args) {
  const index = args.indexOf('--extension-packages')
  if (index < 0) return { settings: {}, catalog: null }
  const value = args[index + 1]
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
    throw new TypeError('--extension-packages requires a directory')
  }
  const directory = resolve(value)
  const bytes = readFileSync(join(directory, 'catalog.v1.json'))
  JSON.parse(bytes.toString('utf8'))
  return {
    settings: { 'modkit.extensionPackages': directory },
    catalog: {
      file: 'catalog.v1.json',
      sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    },
  }
}
