import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  configuredSourceDescriptorSync,
  resolveConfiguredRepositoryRootSync,
  resolveLegacyExtensionDirectorySync,
} from '@modkitx/extension-manager/node'

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

export function externalRepositoryRoot(workspaceRoot, repository, environment = process.env) {
  return resolveConfiguredRepositoryRootSync(workspaceRoot, repository, environment)
}

export function resolveExternalExtensionDirectory(
  workspaceRoot,
  descriptor,
  environment = process.env,
) {
  const repositoryRoot = externalRepositoryRoot(workspaceRoot, descriptor.repository, environment)
  const root = resolve(repositoryRoot, ...(descriptor.path ?? []))
  if (!existsSync(root)) {
    const repository = externalRepositoryDescriptor(
      descriptor.repository,
      workspaceRoot,
      environment,
    )
    throw new Error(
      `external extension directory is missing: ${root}; configure source ` +
        `«${descriptor.repository}» in modkit.workspace.json` +
        (repository.environment === undefined ? '' : ` or set ${repository.environment}`),
    )
  }
  const packagePath = join(root, 'package.json')
  if (!existsSync(packagePath) || readJson(packagePath).modkit === undefined) {
    throw new Error(`external extension directory has no package.json#modkit: ${root}`)
  }
  return root
}

export function externalRepositoryEnvironment(repository, workspaceRoot = process.cwd()) {
  return configuredSourceDescriptorSync(workspaceRoot, repository).environment
}

export function externalRepositoryDescriptor(
  repository,
  workspaceRoot = process.cwd(),
  environment = process.env,
) {
  return configuredSourceDescriptorSync(workspaceRoot, repository, environment)
}

/** Resolve the historical `extensions/<publisher>/<name>` tuple without mounting game repos. */
export function productExtensionDirectory(workspaceRoot, parts, environment = process.env) {
  return resolveLegacyExtensionDirectorySync(workspaceRoot, parts, environment)
}
