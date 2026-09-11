import { createRequire } from 'node:module'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { digestManifest, sha256 } from './legacy-oracle.mjs'

/** Snapshot explicit implementation roots and the installed dependency graph used by an adapter. */
export async function captureRuntimeProof({ roots, packages = [] }) {
  const packageRoots = new Map()
  const omittedOptional = []
  async function visitPackage(name, from, optional = false) {
    const require = createRequire(from)
    let entry
    try {
      try { entry = require.resolve(`${name}/package.json`) }
      catch { entry = require.resolve(name) }
    } catch (error) {
      if (!optional || error.code !== 'MODULE_NOT_FOUND') throw error
      omittedOptional.push({ name, from })
      return
    }
    let directory = path.dirname(await realpath(entry))
    let manifest
    for (;;) {
      try { manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      if (manifest?.name === name) break
      const parent = path.dirname(directory)
      if (parent === directory) throw new Error(`cannot find installed package root: ${name}`)
      directory = parent
    }
    if (packageRoots.has(directory)) return
    packageRoots.set(directory, { name, version: manifest.version, directory })
    const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }
    for (const dependency of Object.keys(dependencies).sort()) {
      const optionalDependency = Object.hasOwn(manifest.optionalDependencies ?? {}, dependency) ||
        manifest.peerDependenciesMeta?.[dependency]?.optional === true
      await visitPackage(dependency, path.join(directory, 'package.json'), optionalDependency)
    }
  }
  for (const item of packages) await visitPackage(item.name, item.from)
  const files = new Map()
  async function collect(file, insidePackage = false) {
    const resolved = await realpath(file)
    const info = await stat(resolved)
    if (info.isDirectory()) {
      for (const entry of (await readdir(resolved, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        if (insidePackage && entry.name === 'node_modules') continue
        if (entry.isSymbolicLink()) throw new Error(`untracked runtime symlink: ${path.join(resolved, entry.name)}`)
        await collect(path.join(resolved, entry.name), insidePackage)
      }
    } else if (info.isFile() && !files.has(resolved)) {
      const bytes = await readFile(resolved)
      files.set(resolved, { path: resolved, byteLength: bytes.byteLength, sha256: sha256(bytes) })
    }
  }
  for (const root of roots) await collect(root)
  for (const directory of packageRoots.keys()) await collect(directory, true)
  const snapshot = {
    schemaVersion: 1,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    packages: [...packageRoots.values()].sort((a, b) => a.directory.localeCompare(b.directory, 'en')),
    omittedOptional,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en')),
  }
  return { ...snapshot, digest: digestManifest(snapshot) }
}

export async function verifyRuntimeProof(expected, selection) {
  const current = await captureRuntimeProof(selection)
  if (current.digest !== expected.digest) throw new Error('migrated runtime changed during parity execution')
}
