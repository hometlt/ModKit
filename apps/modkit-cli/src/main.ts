#!/usr/bin/env node
/**
 * Thin `modkit` CLI — the application root of canon §11 (BRIEF-12 §3.1): argv, file I/O
 * wiring, stdout and exit codes. Every schema/normalization/expansion decision is an
 * @modkitx-x3/sdk call. No spec registry is built in: every contract is reported as
 * inspectable-unknown here (hosts/testkit supply registries).
 *
 * Exit codes: 0 = valid; 1 = validation errors; 2 = usage/IO failure.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { hasErrors, type Diagnostic } from '@modkitx-x3/core'
import {
  createSpecSchemaRegistry,
  expandContributionManifests,
  normalizeExtensionManifest,
  validateContributionManifest,
} from '@modkitx-x3/sdk'

function listFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(relative(root, path).split(sep).join('/'))
    }
  }
  walk(root)
  return out
}

function readJsonIfExists(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

interface ValidateReport {
  readonly ok: boolean
  readonly container?: string
  readonly extension?: { publisher: string; id: string; version: string }
  readonly contributions: { path: string; specState: string; id?: string }[]
  readonly diagnostics: Diagnostic[]
}

async function validateDirectory(dir: string): Promise<ValidateReport> {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`not a directory: ${dir}`)
  }
  const diagnostics: Diagnostic[] = []
  const packageJson = readJsonIfExists(join(dir, 'package.json'))
  const standalone = readJsonIfExists(join(dir, 'modkit.extension.json'))
  const normalized = await normalizeExtensionManifest({
    ...(packageJson === undefined ? {} : { packageJson }),
    ...(standalone === undefined ? {} : { standalone }),
  })
  diagnostics.push(...normalized.diagnostics)

  const contributions: ValidateReport['contributions'] = []
  if (normalized.manifest) {
    const expansion = expandContributionManifests(
      normalized.manifest.contributionManifests,
      listFiles(dir),
    )
    diagnostics.push(...expansion.diagnostics)
    const registry = createSpecSchemaRegistry([])
    for (const entry of expansion.entries) {
      const raw = readJsonIfExists(join(dir, entry.path))
      const result = await validateContributionManifest(raw, registry)
      diagnostics.push(
        ...result.diagnostics.map(d => ({ ...d, path: [entry.path, ...(d.path ?? [])] })),
      )
      contributions.push({
        path: entry.path,
        specState: result.specState,
        ...(result.manifest === undefined ? {} : { id: result.manifest.id }),
      })
    }
  }

  return {
    ok: !hasErrors(diagnostics),
    ...(normalized.container === undefined ? {} : { container: normalized.container }),
    ...(normalized.manifest === undefined
      ? {}
      : {
          extension: {
            publisher: normalized.manifest.publisher,
            id: normalized.manifest.id,
            version: normalized.manifest.version,
          },
        }),
    contributions,
    diagnostics,
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, target, ...rest] = argv
  const json = rest.includes('--json') || target === '--json'
  if (command !== 'validate' || target === undefined || target.startsWith('--')) {
    process.stderr.write('usage: modkit validate <dir> [--json]\n')
    return 2
  }
  let report: ValidateReport
  try {
    report = await validateDirectory(resolve(target))
  } catch (error) {
    process.stderr.write(`modkit validate: ${(error as Error).message}\n`)
    return 2
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    const ext = report.extension
    process.stdout.write(
      `${report.ok ? 'VALID' : 'INVALID'}${ext ? ` ${ext.publisher}/${ext.id}@${ext.version}` : ''} (${report.contributions.length} contribution(s))\n`,
    )
    for (const c of report.contributions) {
      process.stdout.write(`  ${c.path}: ${c.specState}${c.id ? ` [${c.id}]` : ''}\n`)
    }
    for (const d of report.diagnostics) {
      process.stdout.write(
        `  ${d.severity} ${d.code} ${d.message}${d.path ? ` @ ${d.path.join('/')}` : ''}\n`,
      )
    }
  }
  return report.ok ? 0 : 1
}

process.exitCode = await main(process.argv.slice(2))
