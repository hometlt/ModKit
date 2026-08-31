#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import {
  assertIdentityMigrationReportWritable,
  identityMigrationReport,
  renderIdentityJson,
  writeIdentityMigrationReport,
} from './lib/identity-migration.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const defaultRoot = resolve(dirname(scriptPath), '..', '..')

function parseArguments(argv) {
  const options = {
    root: defaultRoot,
    write: false,
    documentKind: undefined,
    forceHistorical: false,
    json: undefined,
    paths: [],
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--root') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--root requires a path')
      options.root = resolve(value)
      index += 1
    } else if (argument === '--write') {
      options.write = true
    } else if (argument === '--audit') {
      options.write = false
    } else if (argument === '--force-historical') {
      options.forceHistorical = true
    } else if (argument === '--document-kind') {
      const value = argv[index + 1]
      if (!['settings', 'extension-lock', 'policy-lock', 'catalog'].includes(value)) {
        throw new Error('--document-kind must be settings, extension-lock, policy-lock or catalog')
      }
      options.documentKind = value
      index += 1
    } else if (argument === '--json') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--json requires a path')
      options.json = resolve(value)
      index += 1
    } else if (argument.startsWith('--')) {
      throw new Error(`unknown argument: ${argument}`)
    } else {
      options.paths.push(resolve(options.root, argument))
    }
  }
  return options
}

function printTextReport(report) {
  const summary = report.summary
  process.stdout.write(
    `identity migration ${report.mode}: ` +
      `${summary.changed} changed, ${summary.wouldChange} would-change, ` +
      `${summary.unchanged} unchanged, ${summary.skipped} skipped, ` +
      `${summary.blocked} blocked, ${summary.errors} errors\n`,
  )
  for (const file of report.files) {
    if (
      file.status === 'unchanged' ||
      (file.status === 'skipped' && file.changes.length === 0 && file.collisions.length === 0)
    ) {
      continue
    }
    process.stdout.write(`  ${file.path}: ${file.status}`)
    if (file.documentKind !== undefined) process.stdout.write(` (${file.documentKind})`)
    if (file.reason !== undefined) process.stdout.write(` - ${file.reason}`)
    process.stdout.write('\n')
    for (const change of file.changes) {
      process.stdout.write(`    ${change.path}: ${change.from} -> ${change.to}\n`)
    }
    for (const collision of file.collisions) {
      process.stdout.write(
        `    collision ${collision.path}: ${collision.sources.join(', ')} -> ${collision.target}\n`,
      )
    }
    for (const skipped of file.skippedReferences) {
      process.stdout.write(`    skipped ${skipped.path}: ${skipped.reason}\n`)
    }
  }
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  const report = identityMigrationReport(options.paths, options)
  if (options.json !== undefined) {
    mkdirSync(dirname(options.json), { recursive: true })
    writeIdentityMigrationReport(options.json, report)
  } else {
    printTextReport(report)
  }
  assertIdentityMigrationReportWritable(report)
  if (options.json !== undefined) process.stdout.write(renderIdentityJson(report))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  try {
    await run()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
