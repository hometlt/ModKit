#!/usr/bin/env node
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
  sc2RuntimeSurfaceRoots,
  SC2_ALGORITHM_PRODUCTION_TSCONFIG,
  loadArchiveM4AlgorithmAllowances,
  validateCanonicalOwnerIds,
  validateCopiedUnwiredAllowanceIds,
} from './lib/algorithms.mjs'
import { prepareCopy, checkCopies } from './lib/mk2-copy.mjs'

const FAMILY_COPIED_UNWIRED_IDS = Object.freeze([
  'modkit-extensions-blizzard/starcraft2/src/lib/mk2/codecs/sc2-map/src/image/png.ts:crc32#0',
  'modkit-extensions-blizzard/starcraft2/src/lib/mk2/packages/scripts-processing/src/trigger-store/store.ts:XMLReader.parseXML#0',
])
const ARCHIVE_M4_COPIED_UNWIRED_IDS = Object.freeze([
  'modkit-extensions-blizzard/starcraft2/src/lib/mk2/extensions/common/archives/codecs/zip/src/writer.ts:crc32#0',
  'modkit-extensions-blizzard/starcraft2/src/lib/mk2/extensions/epic-games/unreal-engine/codecs/unreal-pak/src/index.ts:sha1Matches#0',
  'modkit-extensions-blizzard/starcraft2/src/lib/mk2/extensions/microsoft/halo-wars/codecs/halo-era/src/index.ts:inflateCompressedStream#0',
  'modkit-extensions-blizzard/starcraft2/src/lib/mk2/extensions/opensource/spring/codecs/spring-rapid/src/crc32.ts:crc32#0',
  'modkit-extensions-blizzard/starcraft2/src/lib/mk2/extensions/realitypump/earth2160/codecs/wd/src/index.ts:inflateWdPayload#0',
  'modkit-extensions-blizzard/starcraft2/src/lib/mk2/packages/archives-processing/src/lib/compression/index.ts:inflate#0',
  'modkit-extensions-blizzard/starcraft2/src/lib/mk2/packages/archives-processing/src/lib/crypto/index.ts:md5#0',
])
const CANONICAL_OWNER_IDS = Object.freeze([
  'modkit-core/packages/codec-kit/src/compression/bounded.ts:decompressBounded#0',
  'modkit-core/packages/codec-kit/src/compression/adler32.ts:createAdler32#0',
  'modkit-core/packages/codec-kit/src/compression/adler32.ts:adler32#0',
  'modkit-extensions-blizzard/starcraft2/src/support/structured-inspection.js:parseXmlElements#0',
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
  const familyCopiedUnwired = validateCopiedUnwiredAllowanceIds(
    family.provenance.files.filter(row => row.algorithmDisposition),
    FAMILY_COPIED_UNWIRED_IDS,
  )
  const archiveCopiedUnwired = await loadArchiveM4AlgorithmAllowances({
    workspaceRoot,
    expectedIds: ARCHIVE_M4_COPIED_UNWIRED_IDS,
  })
  const copiedUnwiredFiles = validateCopiedUnwiredAllowanceIds(
    [...familyCopiedUnwired, ...archiveCopiedUnwired],
    [...FAMILY_COPIED_UNWIRED_IDS, ...ARCHIVE_M4_COPIED_UNWIRED_IDS],
  )
  const ownerManifest = JSON.parse(
    await readFile(path.join(workspaceRoot, 'modkit-core/migration/algorithm-owners.json'), 'utf8'),
  )
  if (ownerManifest.schemaVersion !== 1 || !Array.isArray(ownerManifest.owners))
    throw new Error('Invalid canonical algorithm owner manifest')
  const canonicalOwnedAlgorithms = validateCanonicalOwnerIds(
    ownerManifest.owners,
    CANONICAL_OWNER_IDS,
  )
  const runtimeSurfaceRoots = await sc2RuntimeSurfaceRoots({ workspaceRoot })
  const current = await scanAlgorithms({
    workspaceRoot,
    canonicalFiles: canonical.provenance.files,
    canonicalOwnedAlgorithms,
    copiedUnwiredFiles,
    productionTsconfig: SC2_ALGORITHM_PRODUCTION_TSCONFIG,
    runtimeSurfaceRoots,
  })
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
    console.log(JSON.stringify({ repositories: current.scanned.length, mpqHash, ...result }))
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
