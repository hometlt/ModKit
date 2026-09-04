import { digestManifest } from './legacy-oracle.mjs'

export const SC2_M3_SELECTOR_VERSION = 'sc2-m3-family-v3'

export function sc2M3FamilyPlanDigest(declaration, scopeName, copies) {
  const scope = { ...declaration.scopes[scopeName] }
  delete scope.status
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
