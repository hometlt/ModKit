#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import {
  scanAlgorithms,
  checkAlgorithmDebt,
  checkBaselineRatchet,
  ratchetAlgorithmSnapshot,
  sc2RuntimeSurfaceRoots,
  SC2_ALGORITHM_PRODUCTION_TSCONFIG,
  validateCopiedUnwiredAllowanceIds,
} from './lib/algorithms.mjs'
import { prepareCopy, checkCopies } from './lib/mk2-copy.mjs'

try {
  const args = process.argv.slice(2)
  if (
    args.some(arg => !['--write-baseline', '--ratchet'].includes(arg)) ||
    new Set(args).size !== args.length ||
    args.length > 1
  )
    throw new Error(
      'Use no flags, --write-baseline (initial only), or --ratchet (remove debt only)',
    )
  const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url))
  const baselinePath = path.join(workspaceRoot, 'modkit-core/migration/algorithms-baseline.json')
  const declaration = JSON.parse(
    await readFile(path.join(workspaceRoot, 'modkit-core/migration/mk2-copy/sc2.json'), 'utf8'),
  )
  const divergences = JSON.parse(
    await readFile(
      path.join(workspaceRoot, 'modkit-core/migration/mk2-divergence/sc2.json'),
      'utf8',
    ),
  )
  const prepare = scope =>
    prepareCopy({
      declaration,
      divergences,
      scope,
      workspaceRoot,
      repoRoot: path.join(workspaceRoot, 'references/modkitmk2'),
    })
  const canonical = await prepare('m1-libs')
  const family = await prepare('family')
  await checkCopies(canonical)
  await checkCopies(family)
  if (!canonical.provenance.files?.length || !family.provenance.files?.length)
    throw new Error('Canonical copy provenance is required before algorithms scan')
  const copiedUnwiredFiles = validateCopiedUnwiredAllowanceIds(
    family.provenance.files.filter(row => row.algorithmDisposition),
    [
      'modkit-extensions-blizzard/starcraft2/src/lib/mk2/codecs/sc2-map/src/image/png.ts:crc32#0',
      'modkit-extensions-blizzard/starcraft2/src/lib/mk2/packages/scripts-processing/src/trigger-store/store.ts:XMLReader.parseXML#0',
    ],
  )
  const runtimeSurfaceRoots = await sc2RuntimeSurfaceRoots({ workspaceRoot })
  const current = await scanAlgorithms({
    workspaceRoot,
    canonicalFiles: canonical.provenance.files,
    copiedUnwiredFiles,
    productionTsconfig: SC2_ALGORITHM_PRODUCTION_TSCONFIG,
    runtimeSurfaceRoots,
  })
  if (args.includes('--write-baseline')) {
    await writeFile(
      baselinePath,
      `${JSON.stringify(ratchetAlgorithmSnapshot(current), null, 2)}\n`,
      { flag: 'wx' },
    )
    console.log(
      JSON.stringify({
        baselineCreated: true,
        repositories: current.scanned.length,
        implementations: current.implementations.length,
      }),
    )
  } else {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
    const result = checkAlgorithmDebt(current, baseline)
    const gitOptions = {
      cwd: path.join(workspaceRoot, 'modkit-core'),
      encoding: 'utf8',
      windowsHide: true,
    }
    if (
      execFileSync(
        'git',
        ['ls-tree', '--name-only', 'HEAD', '--', 'migration/algorithms-baseline.json'],
        gitOptions,
      ).trim()
    ) {
      const previous = JSON.parse(
        execFileSync('git', ['show', 'HEAD:migration/algorithms-baseline.json'], gitOptions),
      )
      result.failures.push(...checkBaselineRatchet(baseline, previous))
    }
    if (result.failures.length) {
      for (const failure of result.failures) console.error(failure)
      process.exitCode = 1
    } else if (result.retired.length && !args.includes('--ratchet')) {
      console.error(
        'Retired algorithm debt must be removed with --ratchet before accepting the new baseline',
      )
      process.exitCode = 1
    } else if (args.includes('--ratchet'))
      await writeFile(
        baselinePath,
        `${JSON.stringify(ratchetAlgorithmSnapshot(current), null, 2)}\n`,
      )
    console.log(JSON.stringify({ repositories: current.scanned.length, ...result }))
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
