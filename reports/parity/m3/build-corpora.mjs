// Builds the M3 parity corpora (one directory per adapter operation) from pinned MK2 Git blobs.
// Reproduce from modkit-core, after `pnpm build:models` in modkit-extensions-blizzard:
//   node reports/parity/m3/build-corpora.mjs [slice...]
//   node reports/parity/m3/run.mjs --config <absolute>/reports/parity/m3/<slice>/config.json
//   node scripts/migration/apply-port-evidence.mjs --receipt modkit-core/reports/parity/m3/<slice>/receipt.json --check
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stable } from '../../../scripts/migration/lib/port-state.mjs'
import { caseBytes, pinnedSource, structuresPath } from '../../../../modkit-extensions-blizzard/models/test/parity/case-input.mjs'
import { sha256 } from '../../../scripts/migration/lib/legacy-oracle.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtures = 'extensions/blizzard/starcraft-2/codecs/m3/test/fixtures'
const feature = hash => `legacy/codec-manifest/modkit/m3/feature/${hash}`
export const shared = '../../../../../modkit-extensions-blizzard/models/test/parity'
const fixturesModule = new URL('../../../../modkit-extensions-blizzard/models/test/fixtures', import.meta.url).href

/** The five pinned binary models and the pinned M3A carrier, each hash-verified on read. */
export async function pinnedInputs() {
  const rows = [
    { id: 'model-basic', pinnedPath: `${fixtures}/model.m3`, hint: 'model.m3' },
    ...['Harbinger', 'aiur_cliffrocks_00', 'analysisterminal', 'portrait'].map(name => ({
      id: name, pinnedPath: `${fixtures}/corpus/${name}.m3`, hint: `${name}.m3`,
    })),
    { id: 'cybros-cover', pinnedPath: `${fixtures}/cybros-cover.m3a.b64`, pinnedEncoding: 'base64', hint: 'cybros-cover.m3a' },
  ]
  const source = await pinnedSource()
  for (const row of rows) {
    let bytes = (await source.read(row.pinnedPath)).bytes
    if (row.pinnedEncoding === 'base64') bytes = Buffer.from(bytes.toString('utf8').replace(/[ \t\r\n]/gu, ''), 'base64')
    row.sha256 = sha256(bytes)
    await caseBytes(input(row))
  }
  if (rows[0].sha256 !== 'a9a126d0a2b7b54bc6ac70948a40bf34bd26260f063af498cc94ff3d9a528cda') throw new Error('model.m3 pin changed')
  if (rows[5].sha256 !== '07a632fb165b98e60b0e6803451e92c7d94ec527cae8252ca6ed2a3a0661b9e5') throw new Error('m3a pin changed')
  return rows
}
export const input = ({ id: _id, ...row }) => row

// 3.3 s is avoided: it wraps one ULP below a concurrent key, where MK3's common sampler deliberately compensates roundoff.
const sampleTimes = [0, 0.1, 0.25, 0.5, 1, 1.75, 3.1]

const slices = {
  async materials(pins) {
    const cases = pins.filter(row => !row.hint.endsWith('.m3a')).map(row => ({ id: row.id, input: input(row) }))
    return {
      operation: 'material.project',
      corpus: {
        kind: 'real',
        description: 'Complete MK2 RenderMaterial objects and ordered mesh material indices for the five pinned M3 models.',
        cases,
        proofs: [{ requirement: feature('a1c083966b255d42'), kind: 'feature', caseIds: cases.map(item => item.id) }],
      },
    }
  },
  async animations(pins) {
    const cases = pins.map(row => ({ id: row.id, input: { ...input(row), sampleTimes } }))
    return {
      operation: 'animation.project',
      corpus: {
        kind: 'real',
        description: 'Complete RenderSequence objects and sampled channel values at fixed times for five pinned M3 models and the pinned M3A.',
        cases,
        proofs: [{ requirement: feature('556e38aab03a4849'), kind: 'feature', caseIds: cases.map(item => item.id) }],
      },
    }
  },
  async metadata(pins) {
    const { createMetadataBuilderFixture, metadataFixtureProfiles } = await import(`${fixturesModule}/metadata-builders.mjs`)
    const base = await caseBytes(input(pins[0]))
    const xml = (await (await pinnedSource()).read(structuresPath)).bytes.toString('utf8')
    const cases = pins.filter(row => !row.hint.endsWith('.m3a')).map(row => ({ id: row.id, input: input(row) }))
    for (const [profile, requireNonemptyBuilders] of Object.entries(metadataFixtureProfiles)) {
      const { bytes } = await createMetadataBuilderFixture(base, xml, profile)
      const id = `authored-metadata-${profile}`
      cases.push({ id, input: { hint: `${id}.m3`, bytesBase64: Buffer.from(bytes).toString('base64'), sha256: sha256(bytes), requireNonemptyBuilders } })
    }
    return {
      operation: 'metadata.project',
      corpus: {
        kind: 'mixed',
        description: 'Every native M3Model metadata getter (20 builder families + textureFilenames) for the five pinned M3 models and authored section graphs (effects, physics, constraints, solvers) derived from model.m3.',
        cases,
        proofs: [{ requirement: feature('4a8b314c6bed3147'), kind: 'feature', caseIds: cases.map(item => item.id) }],
      },
    }
  },
}

const selected = process.argv.slice(2)
const pins = await pinnedInputs()
for (const [name, build] of Object.entries(slices)) {
  if (selected.length > 0 && !selected.includes(name)) continue
  const { operation, corpus, legacy, migrated } = await build(pins)
  const { proofs, ...rest } = corpus
  const directory = path.join(here, name)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'corpus.json'), stable({
    schemaVersion: 1,
    codec: 'm3',
    ...rest,
    proofs: proofs.map(proof => ({ ...proof, adapterOperation: operation })),
  }, 0))
  await writeFile(path.join(directory, 'config.json'), stable({
    schemaVersion: 1,
    legacy: legacy ?? `${shared}/legacy.mjs`,
    migrated: migrated ?? `${shared}/native.mjs`,
    corpus: 'corpus.json',
    operation,
    receipt: 'receipt.json',
  }))
  console.log(`${name}: ${corpus.cases.length} cases, ${proofs.length} proofs`)
}
