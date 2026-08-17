import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

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

/** Discover text-data modules from contribution facts; directory names never carry authority. */
export function discoverTextDataEntrypoints(repoRoot, requestedFormatIds) {
  const wanted = new Set(requestedFormatIds)
  const found = new Map()
  const root = join(repoRoot, 'extensions', 'common')
  for (const manifestPath of contributionFiles(root)) {
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
