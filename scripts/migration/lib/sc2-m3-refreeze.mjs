import { digestManifest } from './legacy-oracle.mjs'

export const SC2_M3_SELECTOR_VERSION = 'sc2-m3-family-v3'
export const SC2_M3_REFREEZE_PIN = 'modkit-core/migration/mk2-copy/sc2-m3-refreeze.json'

export function parseSc2M3RefreezeArgs(args) {
  const allowed = new Set(['--write-pin', '--admit-ready'])
  if (args.some(arg => !allowed.has(arg)) || new Set(args).size !== args.length)
    throw new Error(
      'Use no arguments, --write-pin, or the paired --admit-ready --write-pin admission mode',
    )
  const writePin = args.includes('--write-pin')
  const admitReady = args.includes('--admit-ready')
  if (admitReady && !writePin)
    throw new Error('--admit-ready requires the explicit --write-pin review action')
  return { writePin, admitReady }
}

export function sc2M3FamilyPlanDigest(declaration, scopeName, copies) {
  const scope = { ...declaration.scopes[scopeName] }
  delete scope.refreezePin
  delete scope.acceptancePin
  return digestManifest({
    schemaVersion: declaration.schemaVersion,
    family: declaration.family,
    oracleCommit: declaration.oracleCommit,
    scopeName,
    selectorVersion: SC2_M3_SELECTOR_VERSION,
    scope,
    copies: [...copies].sort((a, b) => a.source.localeCompare(b.source)),
  })
}
