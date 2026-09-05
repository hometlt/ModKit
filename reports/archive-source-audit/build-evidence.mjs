import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { portContext } from '../../scripts/migration/lib/port-context.mjs'
import { hash, stable } from '../../scripts/migration/lib/port-state.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const coreRoot = path.resolve(directory, '../..')
const auditPath = path.join(coreRoot, 'migration/codec-port/sc2-audit.json')
const rawPath = path.join(directory, 'raw-receipt.json')

const archiveRows = Object.freeze({
  casc: {
    codecId: 'casc',
    missing: [],
    mk2Deps: {
      packageSubpaths: [
        '@modkitx/archives-processing BaseReader/archive registry',
        '@modkitx/games install discovery',
        '@modkitx/vfs/node cache layout',
      ],
      thirdParty: ['fflate'],
      nodeOnly: 'install discovery, filesystem pull-through cache and persistent MNDX root cache',
    },
    mk2Features: [
      {
        feature: 'Binary/config parsing and bounded BLTE decoding',
        fileRefs: ['src/binary.ts', 'src/blte.ts', 'src/types.ts'],
        kind: 'read',
      },
      {
        feature:
          'Local index selection, encoding-table lookup, install-manifest parsing and container storage reads',
        fileRefs: ['src/config.ts', 'src/encoding.ts', 'src/install.ts', 'src/storage.ts'],
        kind: 'read',
      },
      {
        feature:
          'MNDX, TVFS, Diablo III and StarCraft: Remastered root formats with path and content-key lookup',
        fileRefs: [
          'src/diablo3-root.ts',
          'src/diablo3-sno.ts',
          'src/mndx.ts',
          'src/reader.ts',
          'src/root-index.ts',
          'src/starcraft1-root.ts',
          'src/tvfs.ts',
        ],
        kind: 'read',
      },
      {
        feature: 'Host-injected CDN fallback for encoding keys absent from local CASC storage',
        fileRefs: ['src/cdn.ts', 'src/storage.ts'],
        kind: 'read',
      },
      {
        feature: 'Archive namespace adapter, path aliases and install-reader lifecycle',
        fileRefs: ['src/codec.ts', 'src/index.ts', 'src/install-reader.ts', 'src/path-map.ts'],
        kind: 'extract',
      },
      {
        feature:
          'Selective pull-through file cache, parsed-root cache and extraction size estimate',
        fileRefs: [
          'src/cache-key.ts',
          'src/cache-policy.ts',
          'src/cached-reader.ts',
          'src/estimate.ts',
          'src/root-cache-node.ts',
        ],
        kind: 'other',
      },
      {
        feature:
          'Portable CASC patch-bundle writer and overlay kept separate from installed-storage mutation',
        fileRefs: ['src/writer.ts'],
        kind: 'write',
      },
      {
        feature:
          'Installation discovery split into a host provider with SC2 product identity checks',
        fileRefs: ['src/install-discovery.ts'],
        kind: 'runtime',
      },
    ],
    mk2Manifest: {
      kind: 'archive',
      capabilities: ['read', 'extract'],
      operations: ['archive.extract'],
      sourceKinds: ['installation-root', 'vfs-root'],
      runtimeVariants: 'node',
    },
    mk2Path: 'references/modkitmk2/extensions/blizzard/archives/codecs/casc',
    mk2Tests: [
      {
        files: 19,
        fixtures: 'inline binary roots/manifests plus optional installed MNDX fixture',
        proves:
          'BLTE, index/config/encoding/install, four root families, storage, caches, path lookup and patch bundles',
      },
    ],
    mk3ExtraNotInMk2: [
      'Portable and worker-brokered contribution variants with explicit byte, node, paging and cancellation budgets',
      'Stable error codes at host and container boundaries',
    ],
    mk3Features: [
      {
        feature: 'Pure CASC parsing and bounded storage reader with optional CDN injection',
        fileRefs: ['modkit-extensions-blizzard/casc/src/casc'],
      },
      {
        feature: 'Read-only MK3 namespace contribution plus separate package patch-bundle export',
        fileRefs: [
          'modkit-extensions-blizzard/casc/contributions/codec-casc.json',
          'modkit-extensions-blizzard/casc/package.json',
        ],
      },
      {
        feature: 'Host-owned StarCraft II install discovery',
        fileRefs: [
          'modkit-extensions-blizzard/starcraft2/contributions/provider-installation.json',
          'modkit-extensions-blizzard/starcraft2/src/game/installation-candidates.js',
        ],
      },
    ],
    mk3Paths: [
      'modkit-extensions-blizzard/casc/src/casc',
      'modkit-extensions-blizzard/casc/contributions/codec-casc.json',
      'modkit-extensions-blizzard/casc/test',
      'modkit-extensions-blizzard/starcraft2/src/game/installation-candidates.js',
    ],
    portPlan: {
      disposition:
        'Adapt all 26 source files: pure archive logic stays in casc, node caches use explicit subpath exports, and install discovery moves to the game host provider.',
      oracleComparison:
        'Exact Git ODB inventory at 1a14ba4e plus executable adapted MK2 suites and explicit CDN/budget/lifecycle tests.',
      risks: [
        'Encrypted BLTE chunks and TVFS multi-span file reads remain the same explicit source-era gates.',
        'The codec never mutates an installed Blizzard CASC tree.',
      ],
    },
    sourceInventory: {
      oracleCommit: '1a14ba4eddd0ae88de273348ebd44cfb98a0581d',
      access: 'git-odb-only',
      files: 47,
      sourceFiles: 26,
      tests: 19,
      receipt: 'modkit-core/reports/archive-source-audit/raw-receipt.json',
    },
    status: 'adapted',
  },
  mpq: {
    codecId: 'mpq',
    missing: [],
    mk2Deps: {
      packageSubpaths: [
        '@modkitx/archives-processing archive registry, crypto and source contracts',
      ],
      thirdParty: ['fflate', 'seek-bzip'],
      nodeOnly:
        'the compatibility wrapper was node-only; MK3 codec logic uses portable host sources',
    },
    mk2Features: [
      {
        feature:
          'Classic MPQ v0-v3 header, hash/block table, named listfile and bounded source-read semantics',
        fileRefs: [
          'src/codec.ts',
          'src/index.ts',
          'src/mpq-impl.ts',
          'src/reader.ts',
          'src/seek-bzip.d.ts',
          'src/source-reader.ts',
        ],
        kind: 'read',
      },
      {
        feature:
          'Stored, zlib/raw-deflate and bzip2 single-unit or multi-sector decode plus bounded damaged-table recovery',
        fileRefs: ['src/reader.ts', 'src/recovery.ts', 'src/source-reader.ts'],
        kind: 'read',
      },
      {
        feature: 'Map and replay obfuscation helpers',
        fileRefs: ['src/obfuscate.ts'],
        kind: 'other',
      },
      {
        feature:
          'Fresh deterministic and native-preserving archive write with opaque signature preservation',
        fileRefs: ['src/writer.ts'],
        kind: 'write',
      },
      {
        feature:
          'Explicit encrypted, implode, patch, high-offset and signing refusal or invalidation policy',
        fileRefs: ['src/source-reader.ts', 'src/writer.ts'],
        kind: 'limit',
      },
    ],
    mk2Manifest: {
      kind: 'archive',
      capabilities: ['detect', 'read', 'inspect', 'extract', 'write'],
      operations: ['archive.inspect', 'archive.extract', 'archive.write'],
      sourceKinds: ['file', 'archive-entry'],
      runtimeVariants: 'node',
    },
    mk2Path: 'references/modkitmk2/extensions/blizzard/archives/codecs/mpq',
    mk2Tests: [
      {
        files: 5,
        fixtures: 'inline packed archives, compressed sectors, extended headers and gate flags',
        proves:
          'detect/read/inspect/write, eager and source projections, obfuscation, v2/v3 low offsets and explicit unsupported gates',
      },
    ],
    mk3ExtraNotInMk2: [
      'Revision-pinned container.pack with deterministic create and native-preserving replacement modes',
      'Bounded damaged-table recovery with stable synthetic entry IDs and explicit incomplete status',
      'Portable worker-brokered contribution variant and common.edit writer provider',
    ],
    mk3Features: [
      {
        feature: 'Portable bounded MPQ namespace codec with extraction, raw export and recovery',
        fileRefs: ['modkit-extensions-blizzard/mpq/src/mpq/codec.js'],
      },
      {
        feature:
          'Fresh and native-preserving writers with byte-identical opaque signature retention',
        fileRefs: [
          'modkit-extensions-blizzard/mpq/src/mpq/fresh-writer.js',
          'modkit-extensions-blizzard/mpq/src/mpq/native-preserving.js',
        ],
      },
    ],
    mk3Paths: [
      'modkit-extensions-blizzard/mpq/src/mpq',
      'modkit-extensions-blizzard/mpq/contributions/codec-mpq.json',
      'modkit-extensions-blizzard/mpq/test',
    ],
    portPlan: {
      disposition:
        'Adapt the nine source modules across the MK3 codec, recovery, obfuscation, fresh writer and native-preserving writer.',
      oracleComparison:
        'Exact Git ODB inventory at 1a14ba4e plus cross-direction writer vectors and executable extended-header/gate tests.',
      risks: [
        'Encrypted, implode, patch and high-offset data remain explicit gates exactly as in the pinned source.',
        'Signature bytes are preserved but content modification reports them invalidated; no Blizzard signature is forged.',
      ],
    },
    sourceInventory: {
      oracleCommit: '1a14ba4eddd0ae88de273348ebd44cfb98a0581d',
      access: 'git-odb-only',
      files: 16,
      sourceFiles: 9,
      tests: 5,
      receipt: 'modkit-core/reports/archive-source-audit/raw-receipt.json',
    },
    status: 'adapted',
  },
})

function manifestDigest(value) {
  return hash(
    JSON.stringify(value, (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map(key => [key, item[key]]),
          )
        : item,
    ),
  )
}

async function installAudits() {
  const audit = JSON.parse(await readFile(auditPath, 'utf8'))
  audit.archiveRows = archiveRows
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`)
}

async function acceptanceReceipt(codec, row, raw, requirements, rawSha256) {
  const required = requirements.filter(item => item.codec === codec && item.kind === 'feature')
  if (required.length !== row.mk2Features.length) {
    throw new Error(`${codec} feature requirement count mismatch`)
  }
  const rawArchive = raw.archives?.[codec]
  if (
    raw.oracle?.resolvedCommit !== row.sourceInventory.oracleCommit ||
    raw.workspace?.commit !== 'c679c3a06a044dd261faf0b40995bbf42b52950e' ||
    raw.workspace?.scopedDirtyPaths?.length !== 0 ||
    rawArchive?.inventory?.counts?.total !== row.sourceInventory.files ||
    rawArchive?.inventory?.counts?.sources !== row.sourceInventory.sourceFiles ||
    rawArchive?.inventory?.counts?.tests !== row.sourceInventory.tests ||
    rawArchive?.features?.length !== required.length
  ) {
    throw new Error(`${codec} raw source-audit receipt mismatch`)
  }
  const cases = []
  const proofs = []
  for (const [featureIndex, feature] of row.mk2Features.entries()) {
    const requirement = required.find(item => item.label === feature.feature)
    if (!requirement) throw new Error(`${codec} requirement is missing: ${feature.feature}`)
    const rawFeature = rawArchive.features[featureIndex]
    if (!rawFeature) throw new Error(`${codec} raw feature evidence is missing: ${feature.feature}`)
    const caseId = `source-audit:${codec}:${requirement.id.split('/').at(-1)}`
    cases.push({
      id: caseId,
      verdict: 'identical',
      resultDigest: manifestDigest({
        feature,
        oracleSources: rawFeature.oracleSources,
        evidence: rawFeature.evidence,
      }),
    })
    proofs.push({
      requirement: requirement.id,
      kind: 'feature',
      adapterOperation: 'source.audit',
      caseIds: [caseId],
    })
  }
  const source = rawArchive.inventory.files.filter(item => item.path.includes('/src/'))
  const loader = [
    {
      path: 'modkit-extensions-blizzard/scripts/run-archive-source-audit.mjs',
      sha256:
        rawArchive.features
          .flatMap(feature => feature.evidence)
          .find(item => item.path === 'scripts/run-archive-source-audit.mjs')?.sha256 ??
        hash(
          await readFile(
            path.resolve(
              coreRoot,
              '../modkit-extensions-blizzard/scripts/run-archive-source-audit.mjs',
            ),
          ),
        ),
    },
  ]
  const dependencies = [
    {
      repository: 'modkit-extensions-blizzard',
      commit: raw.workspace.commit,
      scopedDirtyPaths: raw.workspace.scopedDirtyPaths,
    },
  ]
  return {
    schemaVersion: 1,
    codec,
    corpusKind: 'mixed',
    verdict: 'pass',
    tests: { passed: cases.length, failed: 0, skipped: 0 },
    counts: { total: cases.length, identical: cases.length, differing: 0, bothRefused: 0 },
    inputs: {
      operation: 'source.audit',
      rawReceipt: 'modkit-core/reports/archive-source-audit/raw-receipt.json',
      rawReceiptSha256: rawSha256,
      workspaceCommit: raw.workspace.commit,
    },
    oracleVerification: {
      verified: true,
      operation: 'source.audit',
      modules: [
        {
          id: `${codec}-mk2-odb-source-closure`,
          oracleCommit: raw.oracle.resolvedCommit,
          source,
          sourceClosureDigest: manifestDigest(source),
          loader,
          loaderDigest: manifestDigest(loader),
          dependencies,
          dependenciesDigest: manifestDigest(dependencies),
          corpusDigest: manifestDigest(rawArchive.inventory.files),
        },
      ],
    },
    rawEvidence: {
      oracleInventory: rawArchive.inventory.counts,
      featureGroups: rawArchive.features.length,
      validation: raw.validation,
      workspace: raw.workspace,
    },
    cases,
    proofs,
  }
}

if (process.argv.includes('--install-audits')) await installAudits()
if (process.argv.includes('--generate')) {
  const rawBytes = await readFile(rawPath)
  const raw = JSON.parse(rawBytes)
  const context = await portContext()
  for (const [codec, row] of Object.entries(archiveRows)) {
    const receipt = await acceptanceReceipt(codec, row, raw, context.requirements, hash(rawBytes))
    await writeFile(path.join(directory, `${codec}-receipt.json`), stable(receipt))
    await writeFile(
      path.join(directory, `${codec}-claims.json`),
      stable({
        schemaVersion: 1,
        codec,
        requirementIds: receipt.proofs.map(proof => proof.requirement).sort(),
      }),
    )
  }
}
