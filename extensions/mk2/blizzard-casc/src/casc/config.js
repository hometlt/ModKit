import { decodeUtf8, joinPath } from './binary.js'
function parseInfoFields(header) {
  return header.split('|').map(field => field.split('!')[0].trim())
}
export function parseBuildInfo(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
  if (lines.length === 0) throw new Error('CASC .build.info is empty')
  const names = parseInfoFields(lines[0])
  return lines.slice(1).map(line => {
    const values = line.split('|')
    const fields = new Map()
    for (let i = 0; i < names.length; i++) fields.set(names[i], values[i] ?? '')
    return {
      branch: fields.get('Branch') ?? '',
      active: fields.get('Active') === '1',
      buildKey: fields.get('Build Key') ?? '',
      cdnKey: fields.get('CDN Key') ?? '',
      installKey: fields.get('Install Key') ?? '',
      version: fields.get('Version') ?? '',
      product: fields.get('Product') ?? '',
      fields,
    }
  })
}
export function getActiveBuild(records) {
  const active = records.find(record => record.active)
  if (!active) throw new Error('CASC .build.info has no active record')
  if (!active.buildKey) throw new Error('CASC active record has no Build Key')
  return active
}
/**
 * Detect the product-specific CASC data directory without relying on the install
 * folder name. Heroes of the Storm is the notable outlier: its active build uses
 * `HeroesData`, while SC2 uses `SC2Data` and most other Blizzard installs use
 * `Data`.
 */
export async function detectCascDataDirectory(source, installRoot = '') {
  let preferred = []
  try {
    const build = getActiveBuild(
      parseBuildInfo(await readTextFile(source, joinPath(installRoot, '.build.info'))),
    )
    const identity = [
      build.product,
      build.fields.get('Build UID') ?? '',
      build.fields.get('Build Product') ?? '',
      build.fields.get('CDN Path') ?? '',
    ]
      .join('\n')
      .toLowerCase()
    if (
      build.product.toLowerCase() === 'hero' ||
      /(^|[\n/._-])hero(?:es)?([\n/._-]|$)/.test(identity)
    ) {
      preferred = ['HeroesData']
    } else if (/(^|[\n/._-])s2([\n/._-]|$)|starcraft\s*2/.test(identity)) {
      preferred = ['SC2Data']
    } else if (identity.trim()) {
      preferred = ['Data']
    }
  } catch {
    // A malformed or unavailable .build.info is reported later by the normal
    // open path. Directory probing still gives generic CASC folders a chance.
  }
  const candidates = [...new Set([...preferred, 'HeroesData', 'SC2Data', 'Data'])]
  for (const candidate of candidates) {
    if (await source.exists(joinPath(installRoot, candidate))) return candidate
  }
  return preferred[0] ?? 'SC2Data'
}
export function parseConfig(text) {
  const values = new Map()
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const uncommented = rawLine.split('#')[0].trim()
    if (!uncommented) continue
    const eq = uncommented.indexOf('=')
    if (eq === -1) throw new Error(`CASC config line has no assignment: ${rawLine}`)
    const key = uncommented.slice(0, eq).trim()
    const value = uncommented.slice(eq + 1).trim()
    if (values.has(key)) throw new Error(`CASC config has duplicate key '${key}'`)
    values.set(key, value)
  }
  return {
    values,
    get: name => values.get(name),
    getKeyPair(name) {
      const value = values.get(name)
      if (!value) return undefined
      const parts = value.split(/\s+/)
      if (parts.length === 1) return { contentKey: parts[0], encodingKey: parts[0] }
      return { contentKey: parts[0], encodingKey: parts[1] }
    },
    getSizePair(name) {
      const value = values.get(`${name}-size`)
      if (!value) return undefined
      const parts = value.split(/\s+/).map(v => Number.parseInt(v, 10))
      return { size: parts[0] ?? 0, storedSize: parts[1] ?? parts[0] ?? 0 }
    },
  }
}
export function configPath(dataRoot, key) {
  return joinPath(dataRoot, 'config', key.slice(0, 2), key.slice(2, 4), key)
}
export async function readTextFile(source, path) {
  return decodeUtf8(await source.get(path))
}
export async function readActiveBuildConfig(source, installRoot = '', dataDir = 'SC2Data') {
  const buildInfo = parseBuildInfo(await readTextFile(source, joinPath(installRoot, '.build.info')))
  const build = getActiveBuild(buildInfo)
  const dataRoot = joinPath(installRoot, dataDir)
  const config = parseConfig(await readTextFile(source, configPath(dataRoot, build.buildKey)))
  return { build, config, dataRoot }
}
