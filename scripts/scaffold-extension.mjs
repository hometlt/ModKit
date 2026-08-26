#!/usr/bin/env node
// Extension scaffold (plan block 12 item 19; exit gate: «extension scaffold компилируется против
// реального open(input, intent, budget) ABI»).
//
// The golden-path budget in @modkitx-x3/testkit has been asserted since block A-4 — five steps,
// five files, four concepts — but against hand-written numbers, because there was no scaffold to
// measure. This is the scaffold, and `scripts/test/scaffold.test.ts` measures *its output* and then
// opens a real subject with it. A budget checked against a constant is a budget checked against
// nothing.
//
// The four concepts (GOLDEN_PATH_CONCEPTS) are deliberately all a newcomer meets:
//
//   Subject       the thing being opened — bytes plus identity
//   Contribution  the manifest that says "this codec exists and claims these bytes"
//   Contract      the data source the codec publishes, here common.view/text-data-source
//   Operation     what a caller can ask for, here view.inspect
//
// Nothing else is introduced. No traits, no writers, no companions, no execution profiles beyond
// the two every codec needs — each of those is a fifth concept, and the budget exists to stop the
// scaffold from teaching all of them at once.
//
// Usage:
//   node scripts/scaffold-extension.mjs --out <directory> [--id <name>] [--publisher <id>]

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const argValue = flag => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

const outDir = argValue('--out')
if (outDir === undefined) {
  process.stderr.write('scaffold-extension: --out <directory> is required\n')
  process.exit(1)
}
const id = argValue('--id') ?? 'my-format'
const publisher = argValue('--publisher') ?? 'org.example'
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
  process.stderr.write(`scaffold-extension: --id must be kebab-case, got «${id}»\n`)
  process.exit(1)
}

const contributionId = `${publisher}/${id}`
const magic = 'X3DEMO'

/**
 * The files a first green run needs, and no more.
 *
 * Five, matching the golden-path budget: a package manifest, a contribution, a codec, a fixture to
 * open, and a README whose example is compiled by `pnpm docs:conformance`. Dropping the README
 * would buy one file of budget and lose the only documentation the scaffold ships.
 */
const files = {
  'package.json': `${JSON.stringify(
    {
      name: `modkit-extension-x3-${id}`,
      version: '1.0.0',
      license: 'MIT',
      type: 'module',
      description: `Scaffolded MK3 codec for ${id}.`,
      exports: { '.': './src/codec.js', './package.json': './package.json' },
      files: ['contributions', 'src', 'README.md'],
      modkit: {
        schemaVersion: 1,
        publisher,
        id,
        contributionManifests: ['./contributions/*.json'],
      },
      // codec-kit is a real dependency, not optional: src/codec.js imports it. Declaring it is what
      // makes the scaffold resolvable when it is placed in a workspace that publishes it.
      peerDependencies: {
        '@modkitx-x3/codec-kit': 'workspace:*',
        '@modkitx-x3/sdk': 'workspace:*',
      },
      peerDependenciesMeta: { '@modkitx-x3/sdk': { optional: true } },
    },
    null,
    2,
  )}\n`,

  [`contributions/codec-${id}.json`]: `${JSON.stringify(
    {
      schemaVersion: 1,
      contract: { id: 'org.modkitx/codec-contribution', major: 1 },
      id: contributionId,
      displayName: `${id} document`,
      status: 'partial',
      runtimeVariants: [
        {
          variantId: 'trusted-node',
          entrypoint: './src/codec.js',
          target: { environments: ['node'] },
          executionProfile: 'trusted-in-process',
          requestedPermissionClasses: ['read-source'],
        },
        {
          variantId: 'portable',
          entrypoint: './src/codec.js',
          target: { environments: ['browser-worker', 'node-worker'] },
          executionProfile: 'worker-brokered',
          requestedPermissionClasses: ['read-source'],
        },
      ],
      limitations: [
        'Scaffold: reads the header and the line count, and claims nothing else. Delete this line when the codec grows a real claim.',
      ],
      spec: {
        formatRefs: [{ formatId: id, label: `${id} document`, mediaType: 'text/plain' }],
        roles: ['semantic'],
        sourceTopology: 'single',
        artifactStages: ['authored'],
        openIntents: ['probe', 'inspect', 'full'],
        implementationTier: { claimed: 1 },
        match: { extensions: [id] },
        probe: { kind: 'bytes', ranges: [{ from: 'start', length: 64 }], maxBytes: 64 },
        // the ceilings this codec promises to respect; the host holds it to them
        budgets: {
          maxInputBytes: '16777216',
          maxDepth: 8,
          maxNodes: 10000,
          maxScalarBytes: 1048576,
          maxDiagnostics: 100,
        },
        publishesDataSources: [{ contract: 'common.view/text-data-source', major: 1 }],
        representations: [
          {
            id: 'source',
            contract: 'common.view/text-data-source',
            major: 1,
            stage: 'authored',
            lossy: false,
          },
        ],
        operations: [
          {
            id: 'view.inspect',
            handlerId: 'inspect',
            mutatesSource: false,
            requiredPermissions: ['read-source'],
            outputKinds: ['json'],
          },
        ],
      },
    },
    null,
    2,
  )}\n`,

  'src/codec.js': `/**
 * A codec for the «${id}» format.
 *
 * Four concepts and no others: this file is the Contract and Operation halves — it publishes a
 * text data source and answers \`view.inspect\`. The Contribution beside it in contributions/ is
 * what makes the host aware the codec exists, and the Subject is whatever bytes it is opened over.
 */
import { createInspectionCodec } from '@modkitx-x3/codec-kit'

const MAGIC = '${magic}'
const decoder = new TextDecoder()

const definition = Object.freeze({
  id: '${contributionId}',
  format: Object.freeze({ id: '${id}', label: '${id} document', mediaType: 'text/plain' }),

  /**
   * How sure this codec is that the bytes are its own.
   *
   * The header is the evidence; the file name is not. An extension alone never decides — rename a
   * PNG to .${id} and this must stay far below any threshold that opens a subject, or the host
   * would open it here and fail later with a worse message.
   */
  async detect(bytes) {
    const head = decoder.decode(bytes.subarray(0, MAGIC.length))
    return head === MAGIC
      ? { confidence: 0.99, kind: 'magic', note: 'magic-header' }
      : { confidence: 0.01, kind: 'magic', note: 'magic-header-missing' }
  },

  /** What the subject contains. Budget-bounded: a caller's ceiling is a promise, not a hint. */
  async inspect(bytes, context) {
    const text = decoder.decode(bytes)
    if (!text.startsWith(MAGIC)) {
      throw new TypeError('${id}: missing ${magic} header')
    }
    if (text.length > context.budget.maxScalarBytes) {
      throw new RangeError('${id}: document exceeds maxScalarBytes budget')
    }
    const lines = text.split('\\n')
    return {
      summary: { format: '${id}', lines: lines.length },
      metadata: [
        {
          id: '${id}-document',
          label: '${id} document',
          entries: [{ key: 'lines', value: lines.length }],
        },
      ],
      traits: [{ id: 'content.text', parameters: { lines: lines.length } }],
      // \`text: true\` publishes common.view/text-data-source over the subject's own bytes; the
      // codec does not hand over a copy of the string it decoded
      text: true,
    }
  },
})

/** The host checks both: an ABI version it understands, and the factory it will call. */
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
`,

  [`fixtures/example.${id}`]: `${magic}\nfirst line\nsecond line\n`,

  'README.md': `# ${id}

A scaffolded MK3 codec. It reads a \`${magic}\` header and reports the line count.

## The four concepts

| Concept | Where it is here |
| --- | --- |
| Subject | the bytes the host opens, e.g. \`fixtures/example.${id}\` |
| Contribution | \`contributions/codec-${id}.json\` — declares the codec to the host |
| Contract | \`common.view/text-data-source@1\` — what the codec publishes |
| Operation | \`view.inspect\` — what a caller may ask for |

## Example

The host opens a subject with \`open(input, intent, budget)\`. This example is compiled and run by
\`pnpm docs:conformance\`, so it cannot drift from the ABI:

\`\`\`js
import { createCodec } from 'modkit-extension-x3-${id}'

const codec = createCodec(context)
const session = await codec.open(input, 'inspect', budget)
const descriptor = await session.descriptor()
// descriptor.dataSources names common.view/text-data-source@1
await session.dispose()
\`\`\`

## Where to put it

The codec imports \`@modkitx-x3/codec-kit\`, so the extension has to live somewhere that specifier
resolves — inside the Modkit workspace, or in a project that depends on it. Scaffolding into an
unrelated directory produces correct files that cannot load, which is a confusing first five
minutes.

## What it deliberately does not do

It does not write, does not resolve companions and does not claim a file by its extension. Each of
those is a further concept; add one when the format actually needs it.
`,
}

for (const [relative, contents] of Object.entries(files)) {
  const target = path.join(outDir, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents.replace(/\r\n/gu, '\n'), 'utf8')
}

process.stdout.write(
  `scaffold-extension: wrote ${Object.keys(files).length} file(s) for ${contributionId} into ${outDir}\n`,
)
