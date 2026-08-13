// Seeded violations for the legacy-gate regression suite. This tree is never scanned by
// the real gate (it only walks <root>/packages and <root>/apps).
export interface CapabilityInstance {
  id: string
}
export const ids = 'CAPABILITY_IDS'
export const manifest = {
  capabilities: ['read', 'inspect'],
}
export const schemaFragment = '{ "capability": "detect" }'
export const authoredForm = 'extension.json'
export const legacyCodecRoot = './codecs'
export type Plugin = { kind: 'AssetPlugin' }
