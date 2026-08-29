import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const REPOSITORIES = Object.freeze({
  blizzard: Object.freeze({
    environment: 'MODKIT_BLIZZARD_ROOT',
    publisher: 'org.modkitx.blizzard',
    sibling: 'modkit-blizzard',
  }),
  warzone: Object.freeze({
    environment: 'MODKIT_WARZONE_ROOT',
    publisher: 'org.modkitx.opensource',
    sibling: 'modkit-warzone',
  }),
})

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

export function externalRepositoryRoot(workspaceRoot, repository, environment = process.env) {
  const descriptor = REPOSITORIES[repository]
  if (descriptor === undefined)
    throw new Error(`unknown external extension repository: ${repository}`)
  const configured = environment[descriptor.environment]
  const candidate =
    configured === undefined || configured.trim() === ''
      ? join(dirname(resolve(workspaceRoot)), descriptor.sibling)
      : isAbsolute(configured)
        ? resolve(configured)
        : resolve(workspaceRoot, configured)
  return candidate
}

export function resolveExternalExtensionDirectory(
  workspaceRoot,
  descriptor,
  environment = process.env,
) {
  const repositoryRoot = externalRepositoryRoot(workspaceRoot, descriptor.repository, environment)
  const root = resolve(repositoryRoot, ...(descriptor.path ?? []))
  if (!existsSync(root)) {
    const repository = REPOSITORIES[descriptor.repository]
    throw new Error(
      `external extension directory is missing: ${root}; clone ${repository.sibling} beside ` +
        `modkitX3 or set ${repository.environment}`,
    )
  }
  const packagePath = join(root, 'package.json')
  if (!existsSync(packagePath) || readJson(packagePath).modkit === undefined) {
    throw new Error(`external extension directory has no package.json#modkit: ${root}`)
  }
  return root
}

export function externalRepositoryEnvironment(repository) {
  const descriptor = REPOSITORIES[repository]
  if (descriptor === undefined)
    throw new Error(`unknown external extension repository: ${repository}`)
  return descriptor.environment
}

export function externalRepositoryDescriptor(repository) {
  const descriptor = REPOSITORIES[repository]
  if (descriptor === undefined)
    throw new Error(`unknown external extension repository: ${repository}`)
  return descriptor
}

/** Resolve the historical `extensions/<publisher>/<name>` tuple without mounting game repos. */
export function productExtensionDirectory(workspaceRoot, parts, environment = process.env) {
  if (parts[0] === 'blizzard') {
    return resolve(
      externalRepositoryRoot(workspaceRoot, 'blizzard', environment),
      ...parts.slice(1),
    )
  }
  if (parts[0] === 'opensource' && parts[1] === 'warzone-2100') {
    return resolve(externalRepositoryRoot(workspaceRoot, 'warzone', environment), ...parts.slice(2))
  }
  return resolve(workspaceRoot, 'extensions', ...parts)
}
