import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

function contributionFiles(root) {
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (
        entry.isFile() &&
        entry.name.endsWith('.json') &&
        dirname(absolute).endsWith('contributions')
      )
        files.push(absolute)
    }
  }
  visit(root)
  return files.sort()
}

function formatIds(manifest, kind) {
  if (kind === 'codec') return (manifest.spec?.formatRefs ?? []).map(ref => ref?.formatId)
  return (manifest.spec?.provides ?? [])
    .map(offer => /^common\.text-data\/([a-z0-9-]+)-syntax$/u.exec(offer?.contract)?.[1])
    .filter(Boolean)
}

/** Emit a portable ESM specifier from a generated module to a discovered entrypoint. */
export function relativeEntrypointSpecifier(generatedFile, entrypoint) {
  const relativePath = relative(dirname(resolve(generatedFile)), resolve(entrypoint))
  if (isAbsolute(relativePath)) {
    throw new Error('generated module and entrypoint must share a portable filesystem root')
  }
  const path = relativePath.replaceAll('\\', '/')
  return path.startsWith('.') ? path : `./${path}`
}

/** Discover text-data modules from contribution facts; directory names never carry authority. */
export function discoverTextDataEntrypoints(repoRoot, requestedFormatIds) {
  const wanted = new Set(requestedFormatIds)
  const found = new Map()
  const roots = [
    join(repoRoot, 'packages', 'host', 'native-text'),
    join(repoRoot, 'extensions'),
  ].filter(existsSync)
  for (const manifestPath of roots.flatMap(contributionFiles)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const contract = manifest?.contract?.id
    const kind =
      contract === 'org.modkitx/codec-contribution'
        ? 'codec'
        : contract === 'org.modkitx/service-provider-contribution'
          ? 'provider'
          : undefined
    if (kind === undefined) continue
    for (const id of formatIds(manifest, kind)) {
      if (!wanted.has(id)) continue
      const key = `${kind}:${id}`
      const declared = manifest?.runtimeVariants?.[0]?.entrypoint
      const extensionRoot = dirname(dirname(manifestPath))
      const absolute = typeof declared === 'string' ? resolve(extensionRoot, declared) : undefined
      const candidate = {
        id,
        kind,
        manifest: manifestPath,
        ...(typeof declared === 'string' ? { declared } : {}),
        ...(absolute !== undefined && existsSync(absolute)
          ? { absolute }
          : {
              reason:
                absolute === undefined
                  ? 'manifest declares no entrypoint'
                  : `declared entrypoint is missing: ${declared}`,
            }),
      }
      if (found.has(key)) {
        found.set(key, { id, kind, reason: `multiple contribution manifests claim ${key}` })
      } else {
        found.set(key, candidate)
      }
    }
  }
  const results = []
  for (const id of requestedFormatIds) {
    for (const kind of ['codec', 'provider']) {
      results.push(found.get(`${kind}:${id}`) ?? { id, kind, reason: 'no contribution manifest' })
    }
  }
  return Object.freeze(results.map(Object.freeze))
}
