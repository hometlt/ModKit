#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { repositoryRoots } from './repositories.mjs'
import { sha256File, validateOwnerParityDocuments } from './receipt.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const reportPath = resolve(repoRoot, 'reports/parity/latest.json')
const receiptPath = resolve(repoRoot, 'reports/parity/owner-aggregation.receipt.json')
const allowedCoreChanges = new Set([
  'reports/parity/latest.json',
  'reports/parity/owner-aggregation.receipt.json',
])

function fail(message) {
  console.error(`parity:owner:check: ${message}`)
  process.exit(1)
}

function git(root, arguments_, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...arguments_], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${arguments_.join(' ')} failed for ${root}: ${result.stderr.trim()}`)
  }
  return result
}

function changedPaths(root, commit) {
  const diff = git(root, ['diff', '--name-only', commit, '--']).stdout
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']).stdout
  return [...new Set(`${diff}\n${untracked}`.split(/\r?\n/u).filter(Boolean))]
}

try {
  if (!existsSync(reportPath) || !existsSync(receiptPath)) {
    throw new Error('report or owner aggregation receipt is missing; run pnpm parity')
  }
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  if (receipt.report?.sha256 !== sha256File(reportPath)) {
    throw new Error('owner parity report digest contradicts the receipt')
  }
  for (const input of [
    receipt.runner,
    receipt.oracleLoader,
    receipt.canonicalAdapter,
    receipt.corpus,
  ]) {
    const path = resolve(repoRoot, input.path)
    if (!existsSync(path) || input.sha256 !== sha256File(path)) {
      throw new Error(`owner parity input ${input.path} contradicts its receipt digest`)
    }
  }
  const summary = validateOwnerParityDocuments({ receipt, report })
  const roots = repositoryRoots(repoRoot)
  for (const binding of receipt.repositories) {
    const root = roots[binding.id]
    if (root === undefined) throw new Error(`unknown owner repository id ${binding.id}`)
    const head = git(root, ['rev-parse', 'HEAD']).stdout.trim()
    if (binding.id === 'core') {
      const ancestor = git(root, ['merge-base', '--is-ancestor', binding.commit, head], {
        allowFailure: true,
      })
      if (ancestor.status !== 0) throw new Error('the bound Core commit is not an ancestor of HEAD')
      const unexpected = changedPaths(root, binding.commit).filter(
        path => !allowedCoreChanges.has(path.replaceAll('\\', '/')),
      )
      if (unexpected.length > 0) {
        throw new Error(`Core changed after parity execution: ${unexpected.join(', ')}`)
      }
    } else {
      if (head !== binding.commit) {
        throw new Error(`${binding.repository} HEAD ${head} differs from receipt ${binding.commit}`)
      }
      const dirty = git(root, ['status', '--porcelain']).stdout.trim()
      if (dirty !== '') throw new Error(`${binding.repository} has uncommitted changes`)
    }
  }
  console.log(
    `parity:owner:check: ${summary.rows} result(s), ${summary.repositories} repository binding(s), report and inputs verified`,
  )
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
