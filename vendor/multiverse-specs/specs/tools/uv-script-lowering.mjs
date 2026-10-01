import { uvbIdentityDigest } from './uvb-binary.mjs'

const encoder = new TextEncoder()
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')

/** Exact UTF-8 source/artifact digest; no newline or Unicode normalization is implicit. */
export async function textArtifactDigest(text) {
  if (typeof text !== 'string') throw new TypeError('text artifact must be a string')
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new TypeError('Web Crypto SHA-256 is required for lowering receipts')
  return `sha256:${hex(new Uint8Array(await subtle.digest('SHA-256', encoder.encode(text))))}`
}

/** One canonical receipt construction path for native → Luau → UVB script adapters. */
export async function createScriptLoweringReceipt({ adapter, source, projection, uvbBytes }) {
  if (!adapter || !/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*\/[a-z0-9][a-z0-9-]*$/u.test(adapter.id)
      || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(adapter.version))
    throw new TypeError('invalid lowering adapter identity')
  if (!source || !/^(?![A-Za-z]:)(?!.*\\)(?!.*:\/\/).+$/u.test(source.name)
      || !['galaxy', 'js', 'lua', 'other'].includes(source.language)
      || typeof source.text !== 'string')
    throw new TypeError('invalid logical source')
  if (!projection || typeof projection.luau !== 'string'
      || !Number.isSafeInteger(projection.totalUnits) || projection.totalUnits < 1
      || !Number.isSafeInteger(projection.loweredUnits) || projection.loweredUnits < 0
      || !Array.isArray(projection.refusals)
      || projection.loweredUnits + projection.refusals.length !== projection.totalUnits)
    throw new TypeError('lowering coverage does not account for every source unit')
  if ((projection.refusals.length === 0) !== (uvbBytes instanceof Uint8Array))
    throw new TypeError('only a complete projection may produce executable UVB')
  const sourceDigest = await textArtifactDigest(source.text)
  const luauDigest = await textArtifactDigest(projection.luau)
  const refusals = await Promise.all(projection.refusals.map(async item => {
    if (!/^[a-z][a-z0-9-]*$/u.test(item.rule) || !item.unit || !item.reason
        || typeof item.fragment !== 'string' || !source.text.includes(item.fragment))
      throw new TypeError('refusal must preserve its actual native source fragment')
    return { rule: item.rule, unit: item.unit, reason: item.reason,
      originDigest: await textArtifactDigest(item.fragment) }
  }))
  const stages = [{ from: 'native', to: 'luau', inputDigest: sourceDigest, outputDigest: luauDigest }]
  const outputs = [{ family: 'luau', digest: luauDigest }]
  if (uvbBytes) {
    const digest = await uvbIdentityDigest(uvbBytes)
    stages.push({ from: 'luau', to: 'uvb', inputDigest: luauDigest, outputDigest: digest })
    outputs.push({ family: 'uvb', digest })
  }
  return { kind: 'uv.receipt/lowering', schemaVersion: 1, adapter,
    source: { name: source.name, language: source.language, digest: sourceDigest },
    stages, coverage: [{ category: 'functions', totalUnits: projection.totalUnits,
      loweredUnits: projection.loweredUnits, refusedUnits: refusals.length }],
    refusals, outputs, verdict: refusals.length ? 'refused' : 'lowered' }
}
