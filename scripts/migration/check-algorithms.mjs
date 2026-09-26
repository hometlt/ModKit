#!/usr/bin/env node
/**
 * One owner per shared algorithm (AGENTS.md §4.1): a function named like a shared algorithm (CRC-32,
 * inflate, boundsOf, invertAffine, palette, WAV header, …) may be defined only in
 * `@modkit/codec-kit` (`packages/codec-kit/src`). Anywhere else it is either debt the baseline
 * already lists — which may only shrink — or a failure.
 *
 * Until 2026-09-26 this gate derived its canonical files from the MK2 copy declarations; the MK2
 * copies were removed (blizzard 8a145fdf) and the gate stopped before scanning (ENOENT). The owner is
 * now the codec-kit source tree itself, with no hash pinning of MK2 copies.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import {
  scanAlgorithms,
  checkAlgorithmDebt,
  checkBaselineRatchet,
  checkMpqHashCanonicalization,
  ratchetAlgorithmSnapshot,
} from './lib/algorithms.mjs'

/** The one place shared algorithms live. */
export const ALGORITHM_OWNER_ROOT = 'modkit-core/packages/codec-kit/src/'
/** Quarantined MK2 oracles in ea/other (AGENTS.md §8): not compiled, not executed, not scanned. */
const QUARANTINE = /\/src\/lib\/mk2\//u

/**
 * Debt the previous gate already allowed, now under a new path (the SC2 module layout; the same
 * implementation hash where it moved as is). The two MK2-copy entries were allowed as
 * copied-unwired family copies (`src/lib/mk2/codecs/sc2-map/src/image/png.ts:crc32#0`,
 * `…/scripts-processing/src/trigger-store/store.ts:XMLReader.parseXML#0`) before they moved into
 * their modules. Once the baseline carries the new ids this map changes nothing.
 */
const RELOCATED_DEBT = new Map([
  [
    'modkit-extensions-blizzard/models/src/m3/runtime/geometry.js:boundsOf#0',
    'modkit-extensions-blizzard/models/src/m3/geometry.node.js:boundsOf#0',
  ],
  [
    'modkit-extensions-blizzard/starcraft2/modules/layout/shared/xml.js:parseXmlDocument#0',
    'modkit-extensions-blizzard/starcraft2/src/sc2-layout/xml.js:parseXmlDocument#0',
  ],
  [
    'modkit-extensions-blizzard/starcraft2/modules/triggers/shared/xml-document.js:parseXmlDocument#0',
    'modkit-extensions-blizzard/starcraft2/src/sc2-layout/xml.js:parseXmlDocument#0',
  ],
  [
    'modkit-extensions-blizzard/starcraft2/shared/inspection/structured-text.js:parseXmlElements#0',
    'modkit-extensions-blizzard/starcraft2/src/support/structured-inspection.js:parseXmlElements#0',
  ],
  [
    'modkit-extensions-blizzard/starcraft2/modules/map/shared/image/png.ts:crc32#0',
    'modkit-extensions-blizzard/starcraft2/src/lib/mk2/codecs/sc2-map/src/image/png.ts:crc32#0',
  ],
  [
    'modkit-extensions-blizzard/starcraft2/modules/triggers/shared/trigger-document/trigger-store.ts:XMLReader.parseXML#0',
    'modkit-extensions-blizzard/starcraft2/src/lib/mk2/packages/scripts-processing/src/trigger-store/store.ts:XMLReader.parseXML#0',
  ],
])

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
  const scanned = await scanAlgorithms({ workspaceRoot })
  const current = {
    ...scanned,
    implementations: scanned.implementations
      .filter(row => !QUARANTINE.test(row.path))
      .map(row =>
        row.path.startsWith(ALGORITHM_OWNER_ROOT)
          ? { ...row, disposition: 'canonical-owned', reason: 'codec-kit owns shared algorithms' }
          : row,
      ),
  }
  const mpqHash = await checkMpqHashCanonicalization({ current, workspaceRoot })
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
        mpqHash,
      }),
    )
  } else {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
    // a relocated allowance counts as the debt it already was, under its new id
    const known = new Set(baseline.implementations.map(row => row.id))
    const allowed = {
      ...baseline,
      implementations: [
        ...baseline.implementations,
        ...current.implementations
          .filter(row => RELOCATED_DEBT.has(row.id) && !known.has(row.id))
          .map(row => ({ ...row, disposition: 'existing-debt' })),
      ],
    }
    const result = checkAlgorithmDebt(current, allowed)
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
      result.failures.push(
        ...checkBaselineRatchet(baseline, previous).filter(
          failure => ![...RELOCATED_DEBT.keys()].some(id => failure.endsWith(`: ${id}`)),
        ),
      )
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
    console.log(
      JSON.stringify({
        repositories: current.scanned.length,
        failures: result.failures.length,
        debt: result.debt,
        canonical: result.canonical,
        retired: result.retired.length,
      }),
    )
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
