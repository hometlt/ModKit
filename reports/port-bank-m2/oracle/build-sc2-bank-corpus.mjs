import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const discovery = JSON.parse(await readFile(path.join(here, 'discovery.json'), 'utf8'))
const outputDirectory = path.join(here, 'corpus')
const contribution = 'modkit-extensions-blizzard/starcraft2/contributions/codec-sc2-bank.json'

const operationMap = Object.freeze({
  'view.inspect': { targetOperation: 'view.inspect', handlerId: 'inspect' },
  'asset.validate': { targetOperation: 'asset.validate', handlerId: 'validate' },
  'export.raw': { targetOperation: 'export.raw', handlerId: 'export-raw' },
  'edit.content': { targetOperation: 'edit.content', handlerId: 'patch-value' },
  'source.save-as': { targetOperation: 'source.save-as', handlerId: 'save-as' },
  'save.sign': { targetOperation: 'blizzard/sc2-bank.sign', handlerId: 'sign' },
  'blizzard/sc2-bank.verify': { targetOperation: 'blizzard/sc2-bank.verify', handlerId: 'verify' },
})
const requirement = Object.freeze({
  'view.inspect': 'legacy/codec-manifest/modkit/sc2-bank/operation/view.inspect',
  'asset.validate': 'legacy/codec-manifest/modkit/sc2-bank/operation/asset.validate',
  'export.raw': 'legacy/codec-manifest/modkit/sc2-bank/operation/export.raw',
  'edit.content': 'legacy/codec-manifest/modkit/sc2-bank/operation/edit.content',
  'source.save-as': 'legacy/codec-manifest/modkit/sc2-bank/operation/source.save-as',
  'save.sign': 'legacy/codec-manifest/modkit/sc2-bank/operation/save.sign',
})
const signatureInfo = Object.freeze({ bankName: 'endofdreamsbank2', authorId: '2-S2-1-2355723', playerId: '2-S2-1-98765' })

function realFiles() {
  const root = discovery.realCorpus.sourceDirectory
  return discovery.realCorpus.files.map(([name, byteLength, sha256]) => ({
    path: path.join(root, name), byteLength, sha256,
  }))
}

function realCases(operation) {
  return realFiles().map(file => ({
    id: `real:${path.basename(file.path)}`,
    input: {
      file: file.path,
      expectedByteLength: file.byteLength,
      expectedSha256: file.sha256,
      ...(operation === 'edit.content' ? { patchMode: 'first-value-noop' } : {}),
      ...(operation === 'save.sign' || operation === 'blizzard/sc2-bank.verify' ? { signatureInfo } : {}),
    },
  }))
}

function syntheticCases(operation) {
  const typedAndNodes = `<Bank version="1"><Section name="S"><Key name="I"><Value int="-7"/></Key><Key name="F"><Value fixed="1.25"/></Key><Key name="Flag"><Value flag="true"/></Key><Key name="Point"><Value point="1.5,-2"/></Key><Key name="Text"><Value string="Mëngsk &amp; Co"/></Key><Key name="Nodes"><Unit id="Marine"/><Item text="ignored-for-signature"/></Key></Section></Bank>`
  const invalidTyped = `<Bank><Section name="S"><Key name="Bad"><Value int="1.0"/></Key><Key name="Bad"><Value point="1,nope"/></Key><Key name="Mystery"><Value custom="x"/></Key></Section></Bank>`
  const malformed = `<Bank><Section name="broken"><Key name="K"><Value int="1"/></Key></Section>`
  const out = [
    { id: 'pinned:endofdreams', input: { pinnedFixture: true, path: '/Accounts/123/2-S2-1-98765/Banks/2-S2-1-2355723/endofdreamsbank2.SC2Bank', ...(operation === 'edit.content' ? { patch: { section: 'Ranks', key: 'Rank', type: 'string', value: 'Legend' } } : {}), ...(operation === 'save.sign' || operation === 'blizzard/sc2-bank.verify' ? { signatureInfo } : {}) } },
    { id: 'synthetic:typed-custom-encoding', input: { xml: typedAndNodes, path: '/synthetic/typed-custom.SC2Bank', ...(operation === 'edit.content' ? { patch: { section: 'S', key: 'I', type: 'int', value: '-8' } } : {}), ...(operation === 'save.sign' || operation === 'blizzard/sc2-bank.verify' ? { signatureInfo } : {}) } },
  ]
  if (operation === 'asset.validate') out.push({ id: 'synthetic:invalid-typed', input: { xml: invalidTyped, path: '/synthetic/invalid.SC2Bank' } })
  if (operation === 'edit.content') {
    out.push({ id: 'synthetic:patch-unknown-key', input: { xml: typedAndNodes, patch: { section: 'S', key: 'missing', type: 'int', value: '1' } } })
  }
  return out
}

function malformedCorpus(operation) {
  const malformed = `<Bank><Section name="broken"><Key name="K"><Value int="1"/></Key></Section>`
  return {
    schemaVersion: 1,
    kind: 'synthetic',
    codec: 'sc2-bank',
    operation,
    purpose: 'Explicit asymmetric malformed-XML audit. This corpus is never operation-proof evidence.',
    cases: [{
      id: 'synthetic:malformed',
      input: {
        xml: malformed,
        path: '/synthetic/malformed.SC2Bank',
        ...(operation === 'edit.content' ? { patch: { section: 'broken', key: 'K', type: 'int', value: '1' } } : {}),
        ...(operation === 'save.sign' || operation === 'blizzard/sc2-bank.verify' ? { signatureInfo } : {}),
      },
    }, ...(operation === 'save.sign' ? [{
      id: 'synthetic:sign-without-info',
      input: { xml: `<Bank><Section name="S"><Key name="K"><Value int="1"/></Key></Section></Bank>`, path: '/readonly/no-identity.SC2Bank', signatureInfo: null },
    }] : [])],
    proofs: [],
  }
}

function proof(operation) {
  const item = operationMap[operation]
  const id = requirement[operation]
  if (item === undefined || id === undefined) return []
  return [{
    requirement: id,
    kind: 'operation',
    legacyOperation: operation,
    adapterOperation: operation,
    targetOperation: item.targetOperation,
    handlerId: item.handlerId,
    contribution,
    executed: true,
    // A real current save and the pinned fixture must both succeed; neither is fallback-only.
    caseIds: ['real:CampaignPS.SC2Bank', 'pinned:endofdreams'],
  }]
}

function build(operation) {
  if (!(operation in operationMap)) throw new Error(`Unknown operation: ${operation}`)
  return {
    schemaVersion: 1,
    kind: 'mixed',
    codec: 'sc2-bank',
    operation,
    oracleCommit: discovery.oracleCommit,
    corpusPolicy: {
      real: 'all 38 eligible user-save paths from discovery.json; source bytes remain in place and are checked before every legacy invocation',
      pinnedFixture: discovery.pinnedRealFixture,
      synthetic: ['typed-values', 'custom-nodes', 'UTF-8 encoding', 'unknown patch target'],
      exclusions: [],
    },
    files: realFiles(),
    cases: [...realCases(operation), ...syntheticCases(operation)],
    proofs: proof(operation),
  }
}

const selected = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const requested = selected.length ? selected : Object.keys(operationMap)
if (process.argv.includes('--stdout')) {
  if (requested.length !== 1) throw new Error('--stdout requires exactly one operation')
  process.stdout.write(`${JSON.stringify(build(requested[0]), null, 2)}\n`)
} else {
  await mkdir(outputDirectory, { recursive: true })
  const negativeDirectory = path.join(outputDirectory, 'negative')
  await mkdir(negativeDirectory, { recursive: true })
  for (const operation of requested) {
    const file = path.join(outputDirectory, `${operation.replaceAll('/', '_')}.json`)
    await writeFile(file, `${JSON.stringify(build(operation), null, 2)}\n`)
    process.stdout.write(`${file}\n`)
    if (operation !== 'export.raw') {
      const negative = path.join(negativeDirectory, `${operation.replaceAll('/', '_')}-malformed.json`)
      await writeFile(negative, `${JSON.stringify(malformedCorpus(operation), null, 2)}\n`)
      process.stdout.write(`${negative}\n`)
    }
  }
}
