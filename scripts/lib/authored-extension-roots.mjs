import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ignoredDirectoryNames = new Set(['node_modules'])

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export function toPosixPath(path) {
  return path.split(sep).join('/')
}

/**
 * Return whether a directory declares an authored Modkit extension container.
 *
 * An invalid package.json is deliberately treated as a container: validation must report the
 * malformed authored root instead of silently descending through or ignoring it.
 */
export function hasAuthoredExtensionContainer(directory) {
  if (existsSync(join(directory, 'modkit.extension.json'))) return true
  const packagePath = join(directory, 'package.json')
  if (!existsSync(packagePath)) return false
  try {
    const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
    return manifest !== null && typeof manifest === 'object' && 'modkit' in manifest
  } catch {
    return true
  }
}

/**
 * Discover extension roots by their authored manifests at any directory depth.
 *
 * Discovery stops at a declared root so package internals cannot accidentally become sibling
 * extensions. Hidden directories and dependency trees are never authored source roots.
 */
export function discoverAuthoredExtensionRoots(baseDirectory) {
  if (!existsSync(baseDirectory)) return []
  const roots = []
  const walk = directory => {
    if (directory !== baseDirectory && hasAuthoredExtensionContainer(directory)) {
      roots.push(directory)
      return
    }
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((left, right) => compareNames(left.name, right.name))) {
      if (
        !entry.isDirectory() ||
        ignoredDirectoryNames.has(entry.name) ||
        entry.name.startsWith('.')
      )
        continue
      walk(join(directory, entry.name))
    }
  }
  walk(baseDirectory)
  return roots
}

export function authoredExtensionRootsRelativeTo(baseDirectory) {
  return discoverAuthoredExtensionRoots(baseDirectory).map(directory => ({
    directory,
    relativePath: toPosixPath(relative(baseDirectory, directory)),
  }))
}
