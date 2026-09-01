/**
 * Copy the canonical A8/A6 format-smoke authority into the Electron app inputs.
 *
 * The source is owned by the VS Code acceptance generator because it is already the cross-host
 * inventory-derived authority. Electron consumes the exact bytes; this script exists only to keep
 * the Electron build input byte-identical and reviewable.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const defaultAppRoot = resolve(here, '..')
const defaultRepoRoot = resolve(defaultAppRoot, '..', '..')

export const electronFormatSmokeSource = repoRoot =>
  join(repoRoot, 'apps', 'vscode', 'generated', 'format-smoke.v1.json')

export const electronFormatSmokeTarget = appRoot => join(appRoot, 'format-smoke.v1.json')

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

function assertAuthorityShape(bytes, label) {
  const text = bytes.toString('utf8')
  const document = JSON.parse(text)
  if (document.kind !== 'x3.ga-recovery/format-family-smoke' || document.schemaVersion !== 1) {
    throw new TypeError(`${label} is not the format-smoke v1 authority`)
  }
  const cases = Array.isArray(document.cases) ? document.cases : []
  const namedExclusions = Array.isArray(document.namedExclusions) ? document.namedExclusions : []
  const included = cases.filter(item => item?.corpus?.kind !== 'named-exclusion')
  const exclusions = cases.filter(item => item?.corpus?.kind === 'named-exclusion')
  const pwaReadRandomRefusals = cases.filter(
    item =>
      item?.runtime?.pwa?.kind === 'host-facility-refusal' &&
      item.runtime.pwa.code === 'x3.host/facility-unavailable' &&
      item.runtime.pwa.facility === 'filesystem.read-random',
  )
  if (
    cases.length !== 14 ||
    included.length !== 13 ||
    exclusions.length !== 1 ||
    exclusions[0]?.id !== 'document-odt' ||
    namedExclusions.length !== 1 ||
    namedExclusions[0]?.id !== 'document-odt' ||
    pwaReadRandomRefusals.length !== 4
  ) {
    throw new TypeError(
      `${label} must contain 13 included cases, one document-odt exclusion and four read-random refusals`,
    )
  }
  return { document, sha256: sha256(bytes), bytes: bytes.byteLength }
}

export function syncElectronFormatSmoke({
  repoRoot = defaultRepoRoot,
  appRoot = defaultAppRoot,
  check = false,
} = {}) {
  const source = electronFormatSmokeSource(repoRoot)
  const target = electronFormatSmokeTarget(appRoot)
  const sourceBytes = readFileSync(source)
  const sourceReceipt = assertAuthorityShape(sourceBytes, source)
  if (check) {
    if (!existsSync(target)) throw new Error(`missing ${target}`)
    const targetBytes = readFileSync(target)
    const targetReceipt = assertAuthorityShape(targetBytes, target)
    if (!sourceBytes.equals(targetBytes)) {
      throw new Error(
        `Electron format-smoke authority is stale: source=${sourceReceipt.sha256} target=${targetReceipt.sha256}`,
      )
    }
    return targetReceipt
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, sourceBytes)
  return sourceReceipt
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  const receipt = syncElectronFormatSmoke({ check })
  console.log(
    JSON.stringify({
      status: check ? 'checked' : 'copied',
      sha256: receipt.sha256,
      bytes: receipt.bytes,
      target: 'apps/electron/format-smoke.v1.json',
    }),
  )
}
