#!/usr/bin/env node
/**
 * Thin `modkit` CLI — the application root of canon §11 (BRIEF-12 §3.1): argv, stdout
 * and exit codes. Loading is @modkitx-x3/host/node, inventory/validation is
 * @modkitx-x3/host + @modkitx-x3/sdk. No spec registry is built in: every contract is
 * reported as inspectable-unknown here (hosts/testkit supply registries).
 *
 * `modkit open` (S7) is the product open path of the CLI: the given extension roots are loaded
 * as *linked* artifacts (never trusted in-process unless `--trust` says so for all of them), the
 * subject is opened through the one host pipeline for the CLI's worker realm — portable variants
 * run worker-brokered in worker threads of this process — and what was selected, under which
 * boundary, with which descriptor, is printed. Nothing is discovered: no roots, no open.
 *
 * Exit codes: 0 = valid/opened; 1 = validation errors/unresolved; 2 = usage/IO failure.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { isQualifiedId } from '@modkitx-x3/core'
import { type OpenIntent, type ProviderOffer, type ProviderRequest } from '@modkitx-x3/sdk'
import {
  createSubjectCommandRuntime,
  explainProviderResolution,
  inventoryHasErrors,
  renderProviderResolutionExplanation,
  type ExtensionInput,
  type Inventory,
  type OpenSubjectResult,
} from '@modkitx-x3/host'
import { loadExtensionDirectory, openFileArtifactSource } from '@modkitx-x3/host/node'
import {
  createModkitCliComposition,
  createModkitCliSubjectServices,
  createModkitCliTopology,
} from './profile.js'
import { parseRunArguments, runCommand } from './commands.js'

export {
  createModkitCliComposition,
  createModkitCliSubjectServices,
  createModkitCliTopology,
} from './profile.js'

const USAGE =
  'usage: modkit validate <dir> [--json] | modkit explain <fixture.json> [--json] | modkit host-profile [--json] | modkit create codec <dir> --id <qualified-id> | modkit open <file> --ext <dir> [--ext <dir>...] [--intent inspect|full] [--trust] [--json] | modkit commands [--json] | modkit run <command> <file> --ext <dir> [--ext <dir>...] [--entry <path>] [--target <id>] [--out <file>] [--trust] [--format text|json]\n'

type CliOpenIntent = Exclude<OpenIntent, 'probe'>
const OPEN_INTENTS: readonly CliOpenIntent[] = ['inspect', 'full']

/** JSON with bigints as decimal strings (budgets, sizes) — the same shape everywhere in the CLI. */
const jsonText = (value: unknown): string =>
  `${JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? String(item) : item), 2)}\n`

interface OpenArguments {
  readonly file: string
  readonly roots: readonly string[]
  readonly intent: CliOpenIntent
  readonly trust: boolean
  readonly json: boolean
}

function parseOpenArguments(target: string, rest: readonly string[]): OpenArguments | undefined {
  const roots: string[] = []
  let intent: CliOpenIntent = 'full'
  let trust = false
  let json = false
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === '--ext') {
      const value = rest[index + 1]
      if (value === undefined || value.startsWith('--')) return undefined
      roots.push(value)
      index += 1
    } else if (argument === '--intent') {
      const value = rest[index + 1]
      const known = OPEN_INTENTS.find(item => item === value)
      if (known === undefined) return undefined
      intent = known
      index += 1
    } else if (argument === '--trust') trust = true
    else if (argument === '--json') json = true
    else return undefined
  }
  if (roots.length === 0) return undefined
  return { file: target, roots, intent, trust, json }
}

function renderOpen(result: OpenSubjectResult, file: string, json: boolean): string {
  if (json) {
    return jsonText(
      result.state === 'opened'
        ? {
            state: result.state,
            path: file,
            selected: result.selected,
            descriptor: result.descriptor,
            candidates: result.candidates,
            diagnostics: result.diagnostics,
          }
        : {
            state: result.state,
            path: file,
            reason: result.reason,
            fallback: result.fallback,
            candidates: result.candidates,
            diagnostics: result.diagnostics,
          },
    )
  }
  const lines: string[] = []
  const candidateLine = (candidate: OpenSubjectResult['candidates'][number]) =>
    `  ${candidate.contributionId}/${candidate.variantId}: ${candidate.state}` +
    (candidate.confidence === undefined ? '' : ` (${Math.round(candidate.confidence * 100)}%)`) +
    candidate.diagnostics.map(item => ` — ${item.code}: ${item.message}`).join('')
  if (result.state === 'unresolved') {
    lines.push(`UNRESOLVED ${file} (${result.reason}; fallback ${result.fallback.preferred})`)
    for (const candidate of result.candidates) lines.push(candidateLine(candidate))
  } else {
    const boundary = result.diagnostics.some(item => item.code === 'x3.host/worker-shared-process')
      ? 'worker-brokered'
      : result.diagnostics.some(item => item.code === 'x3.host/full-process-authority')
        ? 'trusted-in-process'
        : 'boundary unknown'
    lines.push(
      `OPENED ${file}: ${result.selected.contributionId}/${result.selected.variantId} ` +
        `(${Math.round(result.selected.confidence * 100)}%) · ${boundary}`,
    )
    const descriptor = result.descriptor as {
      readonly identity?: { readonly formatId?: string; readonly formatLabel?: string }
      readonly traits?: readonly { readonly id: string; readonly state: string }[]
      readonly operations?: readonly { readonly id: string; readonly state: string }[]
      readonly dataSources?: readonly { readonly contract: string; readonly major: number }[]
    }
    if (descriptor.identity?.formatId !== undefined) {
      lines.push(
        `  format: ${descriptor.identity.formatId} — ${descriptor.identity.formatLabel ?? ''}`,
      )
    }
    lines.push(`  traits: ${(descriptor.traits ?? []).map(t => `${t.id}(${t.state})`).join(', ')}`)
    lines.push(
      `  operations: ${(descriptor.operations ?? []).map(o => `${o.id}(${o.state})`).join(', ')}`,
    )
    lines.push(
      `  data sources: ${(descriptor.dataSources ?? []).map(d => `${d.contract}@${d.major}`).join(', ')}`,
    )
    for (const candidate of result.candidates) lines.push(candidateLine(candidate))
  }
  for (const item of result.diagnostics)
    lines.push(`  ${item.severity} ${item.code} ${item.message}`)
  return `${lines.join('\n')}\n`
}

async function openCommand(arguments_: OpenArguments): Promise<number> {
  const backendDiagnostics: string[] = []
  try {
    const loaded = await Promise.all(
      arguments_.roots.map(root => loadExtensionDirectory(resolve(root))),
    )
    // roots named on the command line are linked artifacts; `--trust` is the explicit in-process decision
    const extensions: readonly ExtensionInput[] = loaded.map(input => ({
      ...input,
      execution: { origin: 'linked', allowTrustedInProcess: arguments_.trust },
    }))
    const services = await createModkitCliSubjectServices(extensions, {
      onDiagnostic: diagnostic =>
        void backendDiagnostics.push(
          `  ${diagnostic.severity} ${diagnostic.code} ${diagnostic.message}`,
        ),
    })
    if (inventoryHasErrors(services.inventory)) {
      process.stdout.write(render(services.inventory, arguments_.json))
      return 1
    }
    const file = resolve(arguments_.file)
    const source = await openFileArtifactSource(file)
    const result = await services.open({
      source,
      path: file,
      intent: arguments_.intent,
      grant: { id: `cli:${randomUUID()}`, classes: ['read-source'] },
      budget: {
        maxInputBytes: BigInt(64 * 1024 * 1024),
        maxDepth: 256,
        maxNodes: 1_000_000,
        maxScalarBytes: 64 * 1024 * 1024,
        maxDiagnostics: 10_000,
        deadlineMs: 30_000,
      },
    })
    try {
      process.stdout.write(renderOpen(result, file, arguments_.json))
      if (!arguments_.json && backendDiagnostics.length > 0) {
        process.stdout.write(`${backendDiagnostics.join('\n')}\n`)
      }
    } finally {
      if (result.state === 'opened') await result.session.dispose()
    }
    return result.state === 'opened' ? 0 : 1
  } catch (error) {
    process.stderr.write(`modkit open: ${(error as Error).message}\n`)
    return 2
  }
}

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
  if (command === 'host-profile') {
    process.stdout.write(`${JSON.stringify(createModkitCliTopology(), null, json ? 2 : 0)}\n`)
    return 0
  }
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
  if (command === 'open') {
    const parsed =
      target === undefined || target.startsWith('--') ? undefined : parseOpenArguments(target, rest)
    if (parsed === undefined) {
      process.stderr.write(USAGE)
      return 2
    }
    return openCommand(parsed)
  }
  /*
   * The shared surface. `modkit commands` prints what this build can do — the same list Electron
   * puts on its IPC channel and VS Code registers into the palette, read from the runtime rather
   * than from a literal in each of them.
   */
  if (command === 'commands') {
    const runtime = createSubjectCommandRuntime()
    const rows = runtime.descriptors.map(item => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      needsSubject: item.needsSubject,
      mutatesSource: item.mutatesSource,
      ...(item.operationId === undefined ? {} : { operationId: item.operationId }),
    }))
    process.stdout.write(
      json
        ? `${JSON.stringify(rows, null, 2)}\n`
        : `${rows.map(row => `${row.id}\t${row.summary}`).join('\n')}\n`,
    )
    return 0
  }
  if (command === 'run') {
    const parsed = parseRunArguments(target, rest[0], rest.slice(1))
    if (parsed === undefined) {
      process.stderr.write(USAGE)
      return 2
    }
    return runCommand(parsed)
  }
  if (command !== 'validate' || target === undefined || target.startsWith('--')) {
    process.stderr.write(USAGE)
    return 2
  }
  let inventory: Inventory
  try {
    const input = await loadExtensionDirectory(resolve(target))
    inventory = (await createModkitCliComposition([input])).inventory
  } catch (error) {
    process.stderr.write(`modkit validate: ${(error as Error).message}\n`)
    return 2
  }
  process.stdout.write(render(inventory, json))
  return inventoryHasErrors(inventory) ? 1 : 0
}

async function scaffoldCodec(root: string, contributionId: string): Promise<readonly string[]> {
  const startedAt = performance.now()
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
  }
  await Promise.all(
    Object.entries(files).map(async ([path, contents]) => {
      await writeFile(resolve(root, path), contents, { flag: 'wx' })
    }),
  )
  const input = await loadExtensionDirectory(root)
  const inventory = (await createModkitCliComposition([input])).inventory
  if (inventoryHasErrors(inventory)) {
    throw new TypeError('generated scaffold did not pass its first validation')
  }
  const metricsPath = 'golden-path.json'
  await writeFile(
    resolve(root, metricsPath),
    `${JSON.stringify(
      {
        stepsToFirstGreen: 5,
        filesTouched: Object.keys(files).length,
        conceptsRequired: ['Subject', 'Contribution', 'Contract', 'Operation'],
        timeToBadgeMs: Math.max(1, Math.ceil(performance.now() - startedAt)),
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  )
  return Object.freeze([...Object.keys(files), metricsPath].sort())
}

process.exitCode = await main(process.argv.slice(2))
