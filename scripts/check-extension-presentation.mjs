/** Verify user-facing metadata and replaceable vendor placeholder icons. */
import fs from 'node:fs'
import path from 'node:path'

const workspace = path.resolve(import.meta.dirname, '..', '..')
const groups = [
  [
    'modkit-core',
    'assets/icons/modkit-placeholder.svg',
    { id: 'modkit', displayName: 'Modkit' },
    'extensions',
  ],
  [
    'modkit-extensions-blizzard',
    'assets/icons/blizzard-starcraft2-placeholder.svg',
    { id: 'blizzard', displayName: 'Blizzard' },
    '.',
  ],
  [
    'modkit-extensions-ea',
    'assets/icons/ea-placeholder.svg',
    { id: 'ea', displayName: 'Electronic Arts' },
    '.',
  ],
  [
    'modkit-extensions-spring',
    'assets/icons/spring-placeholder.svg',
    { id: 'spring', displayName: 'Spring' },
    '.',
  ],
  [
    'modkit-extensions-warzone',
    'assets/icons/warzone-2100-placeholder.svg',
    { id: 'wz2100project', displayName: 'WZ2100Project' },
    '.',
  ],
]

const errors = []
const readJson = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    errors.push(`${file}: invalid JSON`)
    return null
  }
}
const walk = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name === '.claude' || entry.name === 'vendor')
      return []
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(file) : [file]
  })

const confinedPath = (root, value) => {
  if (typeof value !== 'string' || !value.trim() || value.includes('\\')) return false
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(root, value)
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)
}

for (const [group, icon, expectedVendor, scanRoot] of groups) {
  const root = path.join(workspace, group)
  if (!fs.existsSync(path.join(root, icon))) errors.push(`${group}: missing ${icon}`)
  for (const file of walk(path.join(root, scanRoot)).filter(
    file => path.basename(file) === 'package.json',
  )) {
    if (
      file.includes(`${path.sep}test${path.sep}fixtures${path.sep}`) ||
      file.includes(`${path.sep}scripts${path.sep}test${path.sep}fixtures${path.sep}`)
    )
      continue
    const manifest = readJson(file)
    if (!manifest?.modkit) continue
    if (typeof manifest.description !== 'string' || !manifest.description.trim())
      errors.push(`${file}: package description is required`)
    const presentation = manifest.modkit.presentation
    if (!presentation || typeof presentation !== 'object') {
      errors.push(`${file}: modkit.presentation is required`)
    } else {
      if (
        presentation.vendor?.id !== expectedVendor.id ||
        presentation.vendor?.displayName !== expectedVendor.displayName
      ) {
        errors.push(`${file}: presentation.vendor must identify ${expectedVendor.displayName}`)
      }
      for (const field of [
        ...(presentation.icon === undefined ? [] : [presentation.icon]),
        ...(presentation.licenseFiles ?? []),
      ]) {
        const assetPath = typeof field === 'object' && field !== null ? field.path : undefined
        if (!confinedPath(path.dirname(file), assetPath)) {
          errors.push(`${file}: presentation asset path must stay inside the extension root`)
        } else if (!fs.existsSync(path.resolve(path.dirname(file), assetPath))) {
          errors.push(`${file}: presentation asset is missing: ${assetPath}`)
        }
      }
    }
    for (const pattern of manifest.modkit.contributionManifests ?? []) {
      const dir = path.dirname(path.join(path.dirname(file), pattern.replace(/^\.\//, '')))
      if (!fs.existsSync(dir)) continue
      for (const contribution of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
        const contributionFile = path.join(dir, contribution)
        const value = readJson(contributionFile)
        if (value && (typeof value.displayName !== 'string' || !value.displayName.trim()))
          errors.push(`${contributionFile}: displayName is required`)
      }
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else console.log(`extension presentation: clean (${groups.length} groups checked)`)
