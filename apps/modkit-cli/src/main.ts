#!/usr/bin/env node
/**
 * Thin `modkit` CLI — the application root of canon §11 (BRIEF-12 §3.1): argv, stdout
 * and exit codes. Loading is @modkitx-x3/host/node, inventory/validation is
 * @modkitx-x3/host + @modkitx-x3/sdk. No spec registry is built in: every contract is
 * reported as inspectable-unknown here (hosts/testkit supply registries).
 *
 * Exit codes: 0 = valid; 1 = validation errors; 2 = usage/IO failure.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { isQualifiedId } from '@modkitx-x3/core'
import {
  createContributionContractRegistry,
  type ProviderOffer,
  type ProviderRequest,
} from '@modkitx-x3/sdk'
import {
  buildInventory,
  explainProviderResolution,
  inventoryHasErrors,
  renderProviderResolutionExplanation,
  type Inventory,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'

function render(inventory: Inventory, json: boolean): string {
  const extension = inventory.extensions[0]
  const contributions = extension?.contributions ?? []
  const ok = !inventoryHasErrors(inventory)
  if (json) {
    return `${JSON.stringify(
      {
        ok,
        ...(extension === undefined
          ? {}
          : {
              container: extension.container,
              extension: {
                publisher: extension.manifest.publisher,
                id: extension.manifest.id,
                version: extension.manifest.version,
              },
            }),
        contributions: contributions.map(c => ({
          path: c.path,
          specState: c.specState,
          ...(c.manifest === undefined ? {} : { id: c.manifest.id }),
        })),
        diagnostics: [
          ...inventory.diagnostics,
          ...contributions.flatMap(c =>
            c.diagnostics.map(d => ({ ...d, path: [c.path, ...(d.path ?? [])] })),
          ),
        ],
      },
      null,
      2,
    )}\n`
  }
  const lines: string[] = []
  const header = extension
    ? ` ${extension.manifest.publisher}/${extension.manifest.id}@${extension.manifest.version}`
    : ''
  lines.push(`${ok ? 'VALID' : 'INVALID'}${header} (${contributions.length} contribution(s))`)
  for (const c of contributions) {
    lines.push(`  ${c.path}: ${c.specState}${c.manifest ? ` [${c.manifest.id}]` : ''}`)
  }
  for (const d of [...inventory.diagnostics, ...contributions.flatMap(c => c.diagnostics)]) {
    lines.push(`  ${d.severity} ${d.code} ${d.message}${d.path ? ` @ ${d.path.join('/')}` : ''}`)
  }
  return `${lines.join('\n')}\n`
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, target, ...rest] = argv
  const json = rest.includes('--json') || target === '--json'
  if (command === 'create' && target === 'codec') {
    const directory = rest.find(item => !item.startsWith('--'))
    const idIndex = rest.indexOf('--id')
    const id = idIndex < 0 ? undefined : rest[idIndex + 1]
    if (directory === undefined || id === undefined || !isQualifiedId(id)) {
      process.stderr.write('usage: modkit create codec <dir> --id <qualified-id>\n')
      return 2
    }
    try {
      const created = await scaffoldCodec(resolve(directory), id)
      process.stdout.write(`CREATED ${created.length} files in ${resolve(directory)}\n`)
      return 0
    } catch (error) {
      process.stderr.write(`modkit create codec: ${(error as Error).message}\n`)
      return 2
    }
  }
  if (command === 'explain' && target !== undefined && !target.startsWith('--')) {
    try {
      const input = JSON.parse(await readFile(resolve(target), 'utf8')) as {
        request: ProviderRequest
        offers: ProviderOffer[]
      }
      const explanation = explainProviderResolution(input.request, input.offers)
      process.stdout.write(renderProviderResolutionExplanation(explanation, json))
      return explanation.result.state === 'resolved' ? 0 : 1
    } catch (error) {
      process.stderr.write(`modkit explain: ${(error as Error).message}\n`)
      return 2
    }
  }
  if (command !== 'validate' || target === undefined || target.startsWith('--')) {
    process.stderr.write(
      'usage: modkit validate <dir> [--json] | modkit explain <fixture.json> [--json] | modkit create codec <dir> --id <qualified-id>\n',
    )
    return 2
  }
  let inventory: Inventory
  try {
    const input = await loadExtensionDirectory(resolve(target))
    inventory = await buildInventory([input], createContributionContractRegistry([]))
  } catch (error) {
    process.stderr.write(`modkit validate: ${(error as Error).message}\n`)
    return 2
  }
  process.stdout.write(render(inventory, json))
  return inventoryHasErrors(inventory) ? 1 : 0
}

async function scaffoldCodec(root: string, contributionId: string): Promise<readonly string[]> {
  await mkdir(root)
  await Promise.all([
    mkdir(resolve(root, 'contributions')),
    mkdir(resolve(root, 'src')),
    mkdir(resolve(root, 'test')),
    mkdir(resolve(root, 'fixtures')),
  ])
  const [publisher, name] = contributionId.split('/') as [string, string]
  const files: Record<string, string> = {
    'package.json': `${JSON.stringify(
      {
        name: `@${publisher.replace(/\./g, '-')}/modkit-${name}`,
        version: '0.1.0',
        license: 'MIT',
        type: 'module',
        scripts: {
          test: 'vitest run',
          typecheck: 'tsc --noEmit',
        },
        dependencies: { '@modkitx-x3/sdk': '^0.1.0' },
        devDependencies: { typescript: '^5.9.0', vitest: '^2.1.0' },
        modkit: {
          schemaVersion: 1,
          publisher,
          id: name,
          contributionManifests: ['./contributions/*.json'],
        },
      },
      null,
      2,
    )}\n`,
    'contributions/codec.json': `${JSON.stringify(
      {
        schemaVersion: 1,
        contract: { id: 'org.modkitx/codec-contribution', major: 1 },
        id: contributionId,
        displayName: basename(root),
        runtimeVariants: [
          {
            variantId: 'portable',
            entrypoint: './dist/index.js',
            target: { environments: ['node-worker'] },
            executionProfile: 'worker-brokered',
            requestedPermissionClasses: ['read-source'],
          },
        ],
        spec: {
          formatRefs: [{ formatId: name, label: basename(root) }],
          roles: ['semantic'],
          artifactStages: ['authored'],
          openIntents: ['probe', 'inspect'],
          match: {},
          sourceTopology: 'single',
          probe: { kind: 'bytes', ranges: [], maxBytes: 0 },
          representations: [
            {
              id: 'source',
              contract: `${publisher}/${name}-representation`,
              major: 1,
              stage: 'authored',
              lossy: false,
            },
          ],
          publishesDataSources: [{ contract: 'common.view/byte-range-source', major: 1 }],
          operations: [],
          implementationTier: { claimed: 1 },
          budgets: {
            maxInputBytes: '1048576',
            maxDepth: 4,
            maxNodes: 10000,
            maxScalarBytes: 1048576,
            maxDiagnostics: 100,
          },
        },
      },
      null,
      2,
    )}\n`,
    'src/index.ts': `import { defineCodec } from '@modkitx-x3/sdk/authoring'\n\n// Four concepts: Subject, Contribution, Contract, Operation. Add detail only when needed.\nexport const codec = defineCodec({\n  id: '${contributionId}',\n  displayName: '${basename(root).replace(/'/g, "\\'")}',\n  format: { formatId: '${name}', label: '${basename(root).replace(/'/g, "\\'")}' },\n  roles: ['semantic'], topology: 'single', stages: ['authored'], intents: ['probe', 'inspect'],\n  match: {},\n  probe: { kind: 'bytes', ranges: [], maxBytes: 0, run: async () => ({ codecId: '${contributionId}', confidence: 0, evidence: [], requiredRanges: [] }) },\n  open: async () => { throw new Error('implement open') },\n  operations: [], representations: [],\n  publishesDataSources: [{ contract: 'common.view/byte-range-source', major: 1 }],\n  budgets: { maxInputBytes: 1048576n, maxDepth: 4, maxNodes: 10000, maxScalarBytes: 1048576, maxDiagnostics: 100 },\n  implementationTier: { claimed: 1 },\n  profile: 'source-reader',\n  targets: [{ variantId: 'portable', environments: ['node-worker'], entrypoint: './dist/index.js' }],\n})\n`,
    'test/smoke.test.ts': `import { describe, expect, it } from 'vitest'\nimport { assertAuthoringPackable } from '@modkitx-x3/sdk/authoring'\nimport { codec } from '../src/index.js'\n\ndescribe('authoring target smoke', () => {\n  it('covers every declared environment', () => {\n    expect(() => assertAuthoringPackable(codec, [{ variantId: 'portable', environment: 'node-worker', state: 'passed' }])).not.toThrow()\n  })\n})\n`,
    'fixtures/sample.bin': '',
    'golden-path.json': `${JSON.stringify(
      {
        stepsToFirstGreen: 5,
        filesTouched: 5,
        conceptsRequired: ['Subject', 'Contribution', 'Contract', 'Operation'],
        timeToBadgeMs: null,
      },
      null,
      2,
    )}\n`,
  }
  await Promise.all(
    Object.entries(files).map(async ([path, contents]) => {
      await writeFile(resolve(root, path), contents, { flag: 'wx' })
    }),
  )
  return Object.freeze(Object.keys(files).sort())
}

process.exitCode = await main(process.argv.slice(2))
