#!/usr/bin/env node
// Distinguishes an M3 SEQS declaration from executable STC/SD animation payload.
//
// The ordinary parity probe intentionally observes the canonical RenderModel surface. Its
// `animations` count cannot say whether a sequence owns sampled channels or only a rest pose. This
// focused ratchet reads the pinned bytes through the sealed canonical implementation and then asks
// X3 for its executable projection. It does not change the corpus, fixture, canonical probe,
// baseline or allowlist.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { externalRepositoryRoot } from '../lib/external-extension-roots.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const { decodeM3Animations } = await import(
  pathToFileURL(
    path.join(
      externalRepositoryRoot(repoRoot, 'blizzard'),
      'models',
      'src',
      'm3',
      'animation.node.js',
    ),
  ).href
)
const quiet = process.argv.includes('--quiet')
const lockPath = path.join(repoRoot, 'migration', 'oracle', 'legacy-oracle.lock.json')
const localDescriptorPath = path.join(
  repoRoot,
  'migration',
  'oracle',
  'local',
  'legacy-environment.local.json',
)
const untrackedSnapshotPath = path.join(
  repoRoot,
  'migration',
  'oracle',
  'legacy-oracle.pre-lock.untracked.txt',
)
const fixturePath = path.join(
  repoRoot,
  'packages',
  'testkit',
  'test',
  'fixtures',
  'models',
  'triangle.m3',
)
const FIXTURE_BYTES = 11_952
const FIXTURE_SHA256 = 'd34480c1b726c37bfeea9dd75fc71a13ca7e47d6ff15b2d66487c6a4b3369de7'
const MAX_GIT_OUTPUT = 1 << 28

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

function gitBytes(legacyRoot, args, label) {
  const result = spawnSync('git', ['-C', legacyRoot, ...args], {
    encoding: null,
    windowsHide: true,
    maxBuffer: MAX_GIT_OUTPUT,
  })
  if (result.status !== 0) {
    const detail = result.stderr?.toString('utf8').trim()
    throw new Error(`sealed canonical ${label} failed${detail ? `: ${detail}` : ''}`)
  }
  return result.stdout
}

function resolveLegacyRoot() {
  const override = process.env.MODKIT_PARITY_CANON_ROOT?.trim()
  if (override) return path.resolve(override)
  if (existsSync(localDescriptorPath)) {
    const descriptor = JSON.parse(readFileSync(localDescriptorPath, 'utf8'))
    if (typeof descriptor.legacyRoot === 'string' && descriptor.legacyRoot.trim() !== '') {
      return path.resolve(descriptor.legacyRoot)
    }
  }
  return path.resolve(repoRoot, '..', 'modkitx')
}

function verifySealedCanonical(legacyRoot, lock) {
  assert.ok(existsSync(path.join(legacyRoot, '.git')), 'sealed canonical repository is unavailable')
  const head = gitBytes(legacyRoot, ['rev-parse', 'HEAD'], 'HEAD').toString('utf8').trim()
  assert.equal(head, lock.legacy.headCommit, 'sealed canonical HEAD moved')

  const status = gitBytes(legacyRoot, ['status', '--porcelain'], 'status')
  assert.equal(
    hash(status),
    lock.legacy.worktree.statusPorcelainSha256,
    'sealed canonical status moved',
  )
  const statusLines = status.toString('utf8').split(/\r?\n/u).filter(Boolean).length
  assert.equal(
    statusLines,
    lock.legacy.worktree.statusPorcelainLineCount,
    'sealed canonical status count moved',
  )

  assert.equal(
    hash(gitBytes(legacyRoot, ['diff', '--binary', 'HEAD'], 'worktree diff')),
    lock.legacy.worktree.worktreeVsHeadBinaryDiffSha256,
    'sealed canonical worktree diff moved',
  )
  assert.equal(
    hash(gitBytes(legacyRoot, ['diff', '--binary', '--cached'], 'index diff')),
    lock.legacy.worktree.indexVsHeadBinaryDiffSha256,
    'sealed canonical index diff moved',
  )

  const pinnedUntracked = readFileSync(untrackedSnapshotPath, 'utf8')
    .trimEnd()
    .split(/\r?\n/u)
    .map(line => {
      const match = /^([0-9a-f]{64}) \*(.+)$/u.exec(line)
      assert.ok(match, `invalid sealed untracked snapshot row: ${line}`)
      return { sha256: match[1], relativePath: match[2] }
    })
  assert.equal(
    pinnedUntracked.length,
    lock.legacy.untracked.fileCount,
    'sealed canonical untracked snapshot count moved',
  )
  for (const entry of pinnedUntracked) {
    const file = path.join(legacyRoot, ...entry.relativePath.split('/'))
    assert.ok(
      existsSync(file),
      `sealed canonical untracked file disappeared: ${entry.relativePath}`,
    )
    assert.equal(
      hash(readFileSync(file)),
      entry.sha256,
      `sealed canonical untracked file moved: ${entry.relativePath}`,
    )
  }
  const actualUntracked = gitBytes(
    legacyRoot,
    ['ls-files', '--others', '--exclude-standard', '-z'],
    'untracked inventory',
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .toSorted((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
  assert.deepEqual(
    actualUntracked,
    pinnedUntracked
      .map(entry => entry.relativePath)
      .toSorted((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
    'sealed canonical untracked inventory moved',
  )
}

const CANONICAL_SCRIPT = String.raw`
import { readFile } from 'node:fs/promises';
import { createM3ModelCodec } from './extensions/blizzard/starcraft-2/codecs/m3/src/index.ts';
import { M3SectionList } from './extensions/blizzard/starcraft-2/codecs/m3/src/binary/sections.ts';

const bytes = new Uint8Array(await readFile(process.env.MODKIT_M3_FIXTURE));
const model = await createM3ModelCodec({ includeRawMetadata: true }).parse(bytes, 'triangle.m3');
const buffer = new ArrayBuffer(bytes.byteLength);
new Uint8Array(buffer).set(bytes);
const sections = await M3SectionList.load(buffer);
const section = reference => sections.getSectionByReference(reference);
const values = reference =>
  (section(reference)?.content ?? []).map(value => Number(value?.value ?? value));
const text = reference => {
  const raw = Uint8Array.from(
    section(reference)?.content ?? [],
    value => Number(value?.value ?? value),
  );
  const zero = raw.indexOf(0);
  return new TextDecoder().decode(zero < 0 ? raw : raw.subarray(0, zero));
};
const sequences = section(sections.model.sequences)?.content ?? [];
const collections = section(sections.model.sequence_transformation_collections)?.content ?? [];
const groups = section(sections.model.sequence_transformation_groups)?.content ?? [];
const memberships = section(sections.model.sts)?.content ?? [];
const sdFields = [
  'sdev', 'sd2v', 'sd3v', 'sd4q', 'sdcc', 'sdr3', 'sdu8',
  'sds6', 'sdu6', 'sds3', 'sdu3', 'sdfg', 'sdmb',
];
const tracks = model.animations.flatMap(clip =>
  (clip.nodeTracks ?? []).flatMap(node =>
    ['translation', 'rotation', 'scale'].flatMap(kind => {
      const track = node[kind];
      return track === undefined
        ? []
        : [{
            kind,
            lineType: track.lineType,
            keys: track.keys.map(key => ({ frame: key.frame, vector: [...key.vector] })),
          }];
    }),
  ),
);
console.log(
  'M3_ANIMATION_SEMANTICS ' +
    JSON.stringify({
      animations: model.animations.length,
      clips: model.animations.map(clip => ({
        name: clip.name,
        durationSeconds: clip.durationSeconds,
        nodeTracks: clip.nodeTracks?.length ?? 0,
      })),
      tracks,
      declarations: {
        SEQS: sequences.length,
        STC: collections.length,
        STG: groups.length,
        STS: memberships.length,
      },
      sequences: sequences.map(sequence => ({
        name: text(sequence.name),
        start: Number(sequence.anim_ms_start),
        end: Number(sequence.anim_ms_end),
      })),
      collections: collections.map(collection => ({
        refCount: Number(collection.ref_count),
        animIds: values(collection.anim_ids),
        animRefs: values(collection.anim_refs),
        sdRecords: sdFields.reduce(
          (total, field) => total + Number(collection[field]?.entries ?? 0),
          0,
        ),
      })),
      groups: groups.map(group => values(group.stc_indices)),
      memberships: memberships.map(membership => values(membership.anim_ids)),
    }),
);
`

function canonicalObservation(legacyRoot) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', CANONICAL_SCRIPT],
    {
      cwd: legacyRoot,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1 << 24,
      env: { ...process.env, MODKIT_M3_FIXTURE: fixturePath },
    },
  )
  if (result.status !== 0) {
    const detail = [result.error?.message, result.stderr?.trim()].filter(Boolean).join(': ')
    throw new Error(
      `sealed canonical M3 parse exited ${String(result.status)}${detail ? `: ${detail}` : ''}`,
    )
  }
  const stdout = result.stdout ?? ''
  const marker = stdout.split(/\r?\n/u).find(line => line.startsWith('M3_ANIMATION_SEMANTICS '))
  assert.ok(marker, `sealed canonical M3 parse returned no marker: ${stdout.trim()}`)
  return JSON.parse(marker.slice('M3_ANIMATION_SEMANTICS '.length))
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
const legacyRoot = resolveLegacyRoot()
verifySealedCanonical(legacyRoot, lock)

const fixture = readFileSync(fixturePath)
assert.equal(fixture.byteLength, FIXTURE_BYTES, 'pinned M3 fixture size moved')
assert.equal(hash(fixture), FIXTURE_SHA256, 'pinned M3 fixture hash moved')

assert.deepEqual(canonicalObservation(legacyRoot), {
  animations: 1,
  clips: [{ name: 'Stand', durationSeconds: 1, nodeTracks: 1 }],
  tracks: [
    {
      kind: 'translation',
      lineType: 0,
      keys: [{ frame: 0, vector: [0, 0, 0] }],
    },
    {
      kind: 'rotation',
      lineType: 0,
      keys: [{ frame: 0, vector: [0, 0, 0, 1] }],
    },
    {
      kind: 'scale',
      lineType: 0,
      keys: [{ frame: 0, vector: [1, 1, 1] }],
    },
  ],
  declarations: { SEQS: 1, STC: 1, STG: 1, STS: 1 },
  sequences: [{ name: 'Stand', start: 0, end: 1000 }],
  collections: [{ refCount: 0, animIds: [], animRefs: [], sdRecords: 0 }],
  groups: [[0]],
  memberships: [[]],
})

const decoded = await decodeM3Animations(new Uint8Array(fixture), {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 10_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
})
assert.equal(decoded.declaredSequences, 1)
assert.deepEqual(decoded.clips, [], 'X3 invented an executable clip from an empty STC payload')
assert.deepEqual(decoded.timelineContainers, [
  {
    index: 0,
    name: 'Stand',
    channels: 0,
    unsupportedChannels: 0,
    frames: 0,
  },
])
assert.equal(decoded.supportedChannels, 0)
assert.equal(decoded.unsupportedChannels, 0)
assert.equal(decoded.invalidBounds, 0)
assert.equal(decoded.rejectedTargets, 0)
assert.deepEqual(decoded.issues, [])
assert.equal(decoded.fatal, false)

if (!quiet) {
  console.log(
    'm3-animation-semantics: sealed canonical declares SEQS=1 with three one-key rest tracks; ' +
      'native STC/SD payload and X3 executable clips are both 0',
  )
}
