/** Verify user-facing metadata using the generic workspace and repository manifests. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const coreRoot = fileURLToPath(new URL('..', import.meta.url))
const workspaceRoot = path.dirname(coreRoot)

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

const repositoryRoots = () => {
  const roots = [{ id: 'core', root: coreRoot, repository: null }]
  const workspaceFile = path.join(workspaceRoot, 'modkit.workspace.json')
  if (!fs.existsSync(workspaceFile)) return roots
  const workspace = readJson(workspaceFile)
  for (const source of workspace?.sources ?? []) {
    if (typeof source?.uri !== 'string' || /^[a-z][a-z\d+.-]*:/iu.test(source.uri)) continue
    const configured =
      typeof source.environment === 'string' && process.env[source.environment]?.trim()
        ? process.env[source.environment]
        : source.uri
    const root = path.resolve(workspaceRoot, configured)
    const repositoryFile = path.join(root, 'modkit.repository.json')
    if (!fs.existsSync(repositoryFile)) {
      errors.push(`${source.id ?? source.uri}: missing modkit.repository.json at ${root}`)
      continue
    }
    roots.push({ id: source.id ?? source.uri, root, repository: readJson(repositoryFile) })
  }
  return roots
}

const confinedPath = (root, value) => {
  if (typeof value !== 'string' || !value.trim() || value.includes('\\')) return false
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(root, value)
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)
}

const subjectFiles = (root, repository, kind) =>
  (repository?.subjects?.[kind] ?? [])
    .filter(value => typeof value === 'string')
    .map(value => path.resolve(root, value))

let checkedPackages = 0
let checkedRepositories = 0
for (const source of repositoryRoots()) {
  const { root, repository } = source
  checkedRepositories += 1
  const vendors = new Map(
    subjectFiles(root, repository, 'vendors')
      .map(file => readJson(file))
      .filter(value => value?.kind === 'vendor')
      .map(value => [value.id, value]),
  )
  const games = new Map(
    subjectFiles(root, repository, 'games')
      .map(file => readJson(file))
      .filter(value => value?.kind === 'game')
      .map(value => [value.id, value]),
  )
  const packageFiles = repository
    ? (repository.extensions ?? []).map(extension =>
        path.join(root, extension.path, 'package.json'),
      )
    : walk(path.join(root, 'extensions')).filter(file => path.basename(file) === 'package.json')

  const repositoryExtensionIds = new Set(
    (repository?.extensions ?? []).map(extension => extension.id),
  )
  for (const game of games.values()) {
    if (!vendors.has(game.vendorId))
      errors.push(`${source.id}: game ${game.id} references missing vendor ${game.vendorId}`)
    for (const requirement of game.extensionRequirements ?? []) {
      if (!repositoryExtensionIds.has(requirement.id))
        errors.push(`${source.id}: game ${game.id} references missing extension ${requirement.id}`)
    }
  }

  for (const file of packageFiles) {
    if (!fs.existsSync(file)) {
      errors.push(`${source.id}: missing extension package ${file}`)
      continue
    }
    const manifest = readJson(file)
    if (!manifest?.modkit) continue
    checkedPackages += 1
    if (typeof manifest.description !== 'string' || !manifest.description.trim())
      errors.push(`${file}: package description is required`)
    const presentation = manifest.modkit.presentation
    if (!presentation || typeof presentation !== 'object') {
      errors.push(`${file}: modkit.presentation is required`)
    } else {
      const publisher = manifest.modkit.publisher
      if (presentation.vendor?.id !== publisher)
        errors.push(`${file}: presentation.vendor.id must match modkit.publisher`)
      const vendor = vendors.get(publisher)
      if (vendor && presentation.vendor?.displayName !== vendor.displayName)
        errors.push(`${file}: presentation.vendor.displayName must match vendor subject`)
      for (const game of presentation.games ?? []) {
        if (repository && !games.has(game.id))
          errors.push(`${file}: presentation references missing game subject ${game.id}`)
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
} else {
  console.log(
    `extension presentation: clean (${checkedPackages} packages in ${checkedRepositories} repositories)`,
  )
}
