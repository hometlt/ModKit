#!/usr/bin/env node
// MK2 → MK3 mechanical converter (OPUS-MK2-01 task A/A2; MK3/27 §0.2/§6, 23 §3.1, 24 §3 G4).
//
// Reads the sibling `modkitx` (MK2) checkout read-only through the same parser the allocation
// report uses (scripts/lib/mk2-manifests.mjs) and emits, for every codec the report calls
// `mechanical` or `convertible with rework` (the latter only under the default mode; pass
// --mechanical-only to reproduce the OPUS-MK2-01 tree), an MK3 extension directory:
//
//   extensions/mk2/<family>-<name>/
//   ├── package.json                     "modkit" block = authored extension manifest (27 §0.2)
//   ├── MK2-CONVERSION.json              inert conversion notes: the debt, as data (task D)
//   ├── contributions/codec-<id>.json    ContributionManifestV1 + CodecContributionSpecV1
//   ├── src/<id>/codec.js                probe-only skeleton over @modkitx-x3/codec-kit
//   └── README.md
//
// What it will NOT do: invent contracts, operations, method surfaces (32 §3), traits or
// permissions. Anything that cannot be derived from the v1 manifest either keeps a converter
// default recorded in `--json` output, or the codec is skipped with a reason. A codec whose
// *extra* v1 plane needs a new contract still gets an honest read/inspection stub when an
// existing bundled representation can describe that side; the missing plane remains inert debt.
//
// The emitted `probe` is honest: real magic from the v1 manifest becomes a real byte compare,
// and a codec without magic reports `confidence: 0` with a TODO instead of a fake 1.0. `open`
// throws `x3.mk2/port-pending` until a human ports it.
//
// Output is byte-stable: same input tree → same bytes (prettier with the repo config is the
// only formatter, key order is fixed by the emitters, arrays keep v1 order after dedupe).
// A hand-ported `src/<id>/codec.js` (one that lost the generated marker) is never overwritten
// and never counted as drift — that is how task C ports live beside regenerated manifests.
//
// Nothing the converter cannot derive is invented and nothing is silently lost: the planes a v1
// variant declared but a v2 codec contribution cannot carry (`viewer`, `language`, …), the AC §5
// renames, the converter's own defaults and every v1 operation left without a handler are
// written next to the extension as MK2-CONVERSION.json — inert data a human reads before
// porting, not a schema the host knows (task D).
//
// Usage: node scripts/convert-mk2.mjs [--mk2-root <dir>] [--out <dir>] [--mechanical-only]
//        [--check] [--json <file.json>] [--quiet]

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { format as prettierFormat, resolveConfig } from 'prettier'
import { PERMISSION_MAPPING, X3_ROLE_BY_KIND } from './lib/mk3-vocabulary.mjs'
import { analyzeCodec, isMk2Root, readMk2Tree, toPosix } from './lib/mk2-manifests.mjs'

const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const x3Root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const mk2Root = resolve(argValue('--mk2-root') ?? join(x3Root, '..', 'references', 'modkitmk2'))
const outputArgument = argValue('--out')
if (outputArgument === undefined) {
  throw new Error('convert-mk2 is archival and requires an explicit --out <directory>')
}
const outRoot = resolve(outputArgument)
const jsonPath = argValue('--json')
// D2: the committed tree is mechanical + rework. `--mechanical-only` reproduces the narrower
// OPUS-MK2-01 tree for reports and comparisons; `--check` compares with whatever flags it is
// given, so the gate and the tree always speak about the same conversion.
const withRework = !args.includes('--mechanical-only')
const checkOnly = args.includes('--check')
const quiet = args.includes('--quiet')

// Families that completed the staging migration are product-owned outside extensions/mk2.
// The converter keeps reading the canonical source for allocation reports but no longer emits
// duplicate staging packages for these coordinates.
const RELOCATED_FAMILIES = new Set([
  'blizzard-casc',
  'blizzard-models',
  'blizzard-mpq',
  'blizzard-starcraft2',
  'common-models',
  'common-images',
  'common-archives',
  'common-audio',
  'common-vector',
  'common-video',
  'common-containers',
  'ea-archives',
  'ea-emperor',
  'ea-westwood',
  'ea-big',
  'ea-sage',
  'ea-models',
  'ea-tiberian-sun',
  'opensource-warzone-2100',
])

// A single codec can finish the staging migration without its whole family: block 11 slice 11A
// moved plain text into extensions/common/data/plain-text while the rest of `uncommon-documents` stayed,
// slice 11B did the same for the OpenDocument trio into extensions/common/documents.
// The converter keeps reading the canonical source, but stops emitting a staging duplicate for the
// coordinates listed here. Entries are `<staging directory>/<codec local id>`.
const RELOCATED_CODECS = new Set([
  'uncommon-documents/odp',
  'uncommon-documents/ods',
  'uncommon-documents/odt',
  'uncommon-documents/txt',
])

if (!isMk2Root(mk2Root)) {
  // `--check` runs inside `pnpm check`, and CI does not necessarily have the MK2 checkout beside
  // the lab. Without a source there is nothing to compare, which is not a failure — the same
  // stance the acceptance harness takes. Writing without a source stays an error.
  if (checkOnly) {
    if (!quiet) console.log(`convert-mk2 --check: skipped (no MK2 checkout at ${toPosix(mk2Root)})`)
    process.exit(0)
  }
  console.error(`convert-mk2: no extensions/ under ${mk2Root} (use --mk2-root)`)
  process.exit(2)
}

// ---------------------------------------------------------------- conversion tables
//
// Every value below is either read from the v1 manifest or comes from this table. The table
// only names contracts that already exist in the lab (extensions/common/**), because 32 §3 is
// explicit that a converter never invents a surface and 27 §6 that it never invents a contract.

/** v1 `kind` → the MK3 shape a mechanical envelope can carry. Kinds absent here are skipped. */
const FAMILIES = {
  image: {
    representationId: 'raster-metadata',
    representation: 'common.image/raster-metadata',
    dataSources: ['common.view/raster-image-source'],
    stages: ['authored', 'compiled', 'runtime'],
    extraIntents: ['thumbnail'],
  },
  vector: {
    representationId: 'vector-scene',
    representation: 'common.vector/scene-metadata',
    dataSources: ['common.view/vector-scene-source'],
    stages: ['authored', 'runtime'],
    extraIntents: [],
  },
  model: {
    representationId: 'geometry-metadata',
    representation: 'common.model/geometry-metadata',
    dataSources: ['common.view/model-scene-source'],
    stages: ['authored', 'compiled', 'runtime'],
    extraIntents: [],
  },
  audio: {
    representationId: 'audio-stream-metadata',
    representation: 'common.audio/stream-metadata',
    dataSources: ['common.view/audio-media-source'],
    stages: ['authored', 'compiled'],
    extraIntents: ['stream'],
  },
  video: {
    representationId: 'video-container',
    representation: 'common.video/container-metadata',
    dataSources: ['common.view/video-media-source'],
    stages: ['authored', 'compiled', 'runtime'],
    extraIntents: ['stream', 'thumbnail'],
  },
  archive: {
    representationId: 'archive-namespace',
    representation: 'common.archive/entry-namespace',
    dataSources: ['common.view/namespace-entry-source'],
    stages: ['authored', 'compiled'],
    extraIntents: [],
  },
  document: {
    representationId: 'flow-metadata',
    representation: 'common.document/flow-metadata',
    dataSources: [],
    stages: ['authored'],
    extraIntents: [],
  },
  data: {
    representationId: 'flow-metadata',
    representation: 'common.document/flow-metadata',
    dataSources: ['common.view/table-data-source'],
    stages: ['authored', 'compiled', 'runtime'],
    extraIntents: [],
  },
  layout: {
    representationId: 'flow-metadata',
    representation: 'common.document/flow-metadata',
    dataSources: ['common.view/text-data-source', 'common.view/table-data-source'],
    stages: ['authored', 'compiled', 'runtime'],
    extraIntents: [],
  },
  localization: {
    representationId: 'flow-metadata',
    representation: 'common.document/flow-metadata',
    dataSources: ['common.view/text-data-source', 'common.view/table-data-source'],
    stages: ['authored', 'compiled', 'runtime'],
    extraIntents: [],
  },
  map: {
    representationId: 'archive-namespace',
    representation: 'common.archive/entry-namespace',
    dataSources: ['common.view/namespace-entry-source'],
    stages: ['authored', 'compiled', 'runtime'],
    extraIntents: [],
  },
  mod: {
    representationId: 'archive-namespace',
    representation: 'common.archive/entry-namespace',
    dataSources: ['common.view/namespace-entry-source'],
    stages: ['authored', 'compiled', 'runtime'],
    extraIntents: [],
  },
  replay: {
    representationId: 'flow-metadata',
    representation: 'common.document/flow-metadata',
    dataSources: ['common.view/table-data-source'],
    stages: ['runtime'],
    extraIntents: [],
  },
  runtime: {
    representationId: 'flow-metadata',
    representation: 'common.document/flow-metadata',
    dataSources: ['common.view/text-data-source', 'common.view/table-data-source'],
    stages: ['runtime'],
    extraIntents: [],
  },
  save: {
    representationId: 'flow-metadata',
    representation: 'common.document/flow-metadata',
    dataSources: ['common.view/table-data-source'],
    stages: ['runtime'],
    extraIntents: [],
  },
  script: {
    representationId: 'flow-metadata',
    representation: 'common.document/flow-metadata',
    dataSources: ['common.view/text-data-source'],
    stages: ['authored', 'compiled', 'runtime'],
    extraIntents: [],
  },
}

/** Present in every emitted spec: the two sources codec-kit publishes for any inspection codec. */
const BASE_DATA_SOURCES = ['common.view/tree-data-source', 'common.view/byte-range-source']

/** codec-kit's INSPECTION_OPERATIONS — the three the generated module really implements. */
const BASE_OPERATIONS = [
  { id: 'view.inspect', handlerId: 'inspect', outputKinds: ['json'] },
  { id: 'asset.validate', handlerId: 'validate', outputKinds: ['none'] },
  { id: 'export.raw', handlerId: 'export-raw', outputKinds: ['bytes'] },
]

const BASE_INTENTS = ['probe', 'inspect', 'full', 'export']
const INTENT_ORDER = ['probe', 'inspect', 'thumbnail', 'full', 'stream', 'export']

/** 27 §12 acceptance keeps probe reads bounded; 4096 is the declared cap for a byte plan. */
const PROBE_BYTES = 4096

const BUDGETS = {
  maxInputBytes: '1073741824',
  maxDepth: 64,
  maxNodes: 100000,
  maxScalarBytes: 104857600,
  maxDiagnostics: 1000,
}

const DEFAULT_NAMESPACE_PROBE = {
  kind: 'namespace',
  markers: ['.modkit-namespace-probe-marker'],
  maxEntries: 1,
  maxBytes: PROBE_BYTES,
  maxDepth: 1,
  maxPathBytes: 4096,
}

const NAMESPACE_PROBES = {
  'org.modkitx/casc': {
    kind: 'namespace',
    markers: ['.build.info', 'Data/config', 'Data/data'],
    maxEntries: 3,
    maxBytes: 65536,
    maxDepth: 2,
    maxPathBytes: 4096,
  },
}

/** AC §5 rename table from the report; applies to the rework verdicts (task A2). */
const OPERATION_RENAMES = { 'image.compressed.read': 'image.compressed-read' }

/** Hand ports can expose a shared operation that the v1 manifest did not declare explicitly. */
const PORT_OPERATIONS = {
  'org.modkitx/age-bar': [
    {
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: ['read-source'],
      outputKinds: ['bytes'],
    },
  ],
  'org.modkitx/age-drs': [
    {
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: ['read-source'],
      outputKinds: ['bytes'],
    },
  ],
  'org.modkitx/big': [
    {
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: ['read-source'],
      outputKinds: ['bytes'],
    },
  ],
  'org.modkitx/mpq': [
    {
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: ['read-source'],
      outputKinds: ['bytes'],
    },
  ],
}

/**
 * The v1 spelling of "let the detector decide" is a single path glob matching everything. It is
 * NOT a v2 wildcard — `matchesGlob` compiles it into a regular expression that requires a
 * directory component, so it never matches a bare file name (REPORT §7.5) — and MK3 expresses
 * detect-by-content with `match.signatures` instead (NXT-101B, data-only, host-side byte compare
 * before any activation). The converter drops that glob rather than carry a rule that lies.
 */
const WILDCARD_GLOB = '**/*'

/**
 * Task E: specification-backed signatures absent from a v1 manifest.
 * These are not derived from the v1 manifest — v1 declared no magic for them — so each entry
 * names the specification clause it comes from, the citation is copied into the generated
 * README, and the addition is recorded in MK2-CONVERSION.json as a converter default.
 *
 * All patterns are the well-known file signatures of the containers themselves, never a guess:
 * a rule that cannot be pointed at a paragraph does not belong here.
 */
const PORT_SIGNATURES = {
  'org.modkitx/ani': {
    source:
      'Microsoft RIFF animated cursor form type ACON at byte 8; Warzone 2100 text animation header ANIM3DFRAMES at byte 0',
    signatures: [
      { from: 'start', offset: 8, bytesHex: '41434f4e' },
      { from: 'start', offset: 0, bytesHex: '414e494d33444652414d4553' },
    ],
  },
  'org.modkitx/avif': {
    source:
      'ISO/IEC 14496-12 §4.3 (FileTypeBox: the "ftyp" box type at byte 4); the codec probe then requires an AVIF brand',
    signatures: [{ from: 'start', offset: 4, bytesHex: '66747970' }],
  },
  'org.modkitx/basis': {
    source: 'Basis Universal container specification (file signature "sB" at byte zero)',
    signatures: [{ from: 'start', offset: 0, bytesHex: '7342' }],
  },
  'org.modkitx/pal': {
    source:
      'JASC-PAL text identifier at byte 0; Microsoft RIFF palette form type PAL followed by space at byte 8',
    signatures: [
      { from: 'start', offset: 0, bytesHex: '4a4153432d50414c' },
      { from: 'start', offset: 8, bytesHex: '50414c20' },
    ],
  },
  'org.modkitx/pcx': {
    source:
      'ZSoft PCX file header manufacturer byte 0A at byte 0; the codec probe validates version, encoding, dimensions, planes, and stride',
    signatures: [{ from: 'start', offset: 0, bytesHex: '0a' }],
  },
  'org.modkitx/tga': {
    source:
      'Truevision TGA 2.0 footer signature TRUEVISION-XFILE followed by dot and NUL, starting 18 bytes before end of file',
    signatures: [{ from: 'end', offset: 18, bytesHex: '54525545564953494f4e2d5846494c452e00' }],
  },
  'org.modkitx/tiff': {
    source:
      'TIFF 6.0 §2 byte-order marker plus version 42: little-endian II 2A 00 or big-endian MM 00 2A',
    signatures: [
      { from: 'start', offset: 0, bytesHex: '49492a00' },
      { from: 'start', offset: 0, bytesHex: '4d4d002a' },
    ],
  },
  'org.modkitx/m3': {
    source:
      'Blizzard M3 container header: reversed little-endian MD33 / MD34 tags at byte zero (M3_FILE_FORMAT_SPECIFICATION, header and index table)',
    signatures: [
      { from: 'start', offset: 0, bytesHex: '3333444d' },
      { from: 'start', offset: 0, bytesHex: '3433444d' },
    ],
  },
  'org.modkitx/flv': {
    source: 'Adobe Video File Format Specification v10.1 §E.2 (FLV header: "FLV" + version)',
    signatures: [{ from: 'start', offset: 0, bytesHex: '464c5601' }],
  },
  'org.modkitx/swf': {
    source: 'SWF File Format Specification v19 §"The SWF header" (FWS / CWS / ZWS)',
    signatures: [
      { from: 'start', offset: 0, bytesHex: '465753' },
      { from: 'start', offset: 0, bytesHex: '435753' },
      { from: 'start', offset: 0, bytesHex: '5a5753' },
    ],
  },
  'org.modkitx/ogg': {
    source:
      'RFC 3533 §6 (Ogg "OggS" capture pattern) + RFC 5334 §4 / Vorbis I §4.2.1 (packet type 1 + "vorbis" identification header in the first page payload, which starts at byte 28 of a one-segment page)',
    signatures: [{ from: 'start', offset: 28, bytesHex: '01766f72626973' }],
  },
  'org.modkitx/opus': {
    source:
      'RFC 3533 §6 (Ogg capture pattern) + RFC 7845 §5.1 ("OpusHead" identification header, first page payload at byte 28)',
    signatures: [{ from: 'start', offset: 28, bytesHex: '4f70757348656164' }],
  },
  'org.modkitx/ogv': {
    source:
      'RFC 3533 §6 (Ogg capture pattern) + Theora I §6.1 (theora identification header, first page payload at byte 28)',
    signatures: [{ from: 'start', offset: 28, bytesHex: '807468656f7261' }],
  },
  'org.modkitx/mp4': {
    source: 'ISO/IEC 14496-12 §4.3 (FileTypeBox: the "ftyp" box type at byte 4)',
    signatures: [{ from: 'start', offset: 4, bytesHex: '66747970' }],
  },
  'org.modkitx/mpeg': {
    source:
      'ISO/IEC 11172-1 §2.4.3.2 (pack start code 00 00 01 BA) and ISO/IEC 11172-2 §2.4.2.3 (sequence header code 00 00 01 B3)',
    signatures: [
      { from: 'start', offset: 0, bytesHex: '000001ba' },
      { from: 'start', offset: 0, bytesHex: '000001b3' },
    ],
  },
  'org.modkitx/webm': {
    source: 'RFC 8794 §4.1 (EBML header element id 1A 45 DF A3) — Matroska/WebM container',
    signatures: [{ from: 'start', offset: 0, bytesHex: '1a45dfa3' }],
  },
}

const PORT_LIMITATIONS = {
  'org.modkitx/big': [
    'The MK3 port reads BIG4/BIGF tables and stored or RefPack entries; deterministic repacking and all mutation paths remain pending.',
  ],
  'org.modkitx/mpq': [
    'The MK3 port reads classic MPQ v0-v3 hash/block tables and stored or zlib payloads; encrypted, implode, bzip2, patch, high-offset, and writing paths remain pending.',
  ],
  'org.modkitx/m3': [
    'The MK3 port indexes MD33/MD34 sections and publishes a metadata-only scene; decoded geometry, materials, skeletons, animations, external M3A sidecars, and writing remain pending.',
  ],
}

const PORT_MAY_EXPOSE_TRAITS = {
  'org.modkitx/m3': new Set([
    'model.animations',
    'model.geometry',
    'model.materials',
    'model.skeleton',
    'model.textures',
    'scene.cameras',
    'scene.effects',
  ]),
}

/** Prose header of MK2-CONVERSION.json; JSON has no comments, so it is a field. */
const NOTES_COMMENT = [
  'Inert MK2 \u2192 MK3 conversion notes, generated by scripts/convert-mk2.mjs.',
  'Not a contribution, not a schema and not on the loader manifest glob: this is the debt of a',
  'mechanical conversion, written down as data.',
  '`lostPlanes` are v1 entrypoints a codec contribution has no home for (a viewer is its own',
  'contribution kind, 13C; a language plane has no X3 form) \u2014 the converter drops the plane',
  'instead of inventing a spec for it.',
  '`contractGaps` are v1 verbs whose extra plane has no bundled X3 contract; the readable',
  'inspection side may still be a stub, but this debt is not presented as implemented.',
  '`renames` are the AC \u00a75 operation-id fixes the conversion applied.',
  '`converterDefaults` are choices v1 did not make; REPORT \u00a77.6/\u00a77.7 asks each port to narrow them.',
  '`droppedOperations` are v1 operation ids emitted without a handler, spelled as v2 would.',
  '`needsSignatures` means no candidate rule survived conversion and `match.signatures` has to be',
  'declared by hand before the codec can be a candidate.',
  'Re-run `pnpm convert:mk2` instead of editing.',
].join(' ')

/** Report verdicts, spelled for the notes file (segment grammar, no spaces). */
const VERDICT_WIRE = {
  mechanical: 'mechanical',
  'convertible with rework': 'convertible-with-rework',
  'needs new contract': 'needs-new-contract',
}

const GENERATED_MARKER = '@generated by scripts/convert-mk2.mjs'
const CODEC_KIT = '@modkitx-x3/codec-kit'

// ---------------------------------------------------------------- helpers

const dedupe = values => [...new Set(values)]

function lastDottedSegment(publisher) {
  const parts = String(publisher).split('.')
  return parts[parts.length - 1] ?? String(publisher)
}

const SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** v1 magic `{offset, bytes, encoding}` → S3 `SignatureRule` `{from, offset, bytesHex}`. */
function signatureFromMagic(magic) {
  const offset = magic.offset ?? 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 4096) {
    return {
      skipped: `magic offset ${String(magic.offset)} is outside the declared 0..4096 window`,
    }
  }
  let hex
  if (magic.encoding === 'hex') {
    const raw = String(magic.bytes).toLowerCase()
    if (!/^(?:[0-9a-f]{2})+$/.test(raw)) return { skipped: `magic «${magic.bytes}» is not hex` }
    hex = raw
  } else if (magic.encoding === 'ascii') {
    // v1 `ascii` is a byte-per-character string, not printable ASCII: `earth-par` spells its
    // magic `PAR` + a NUL byte. Anything above U+00FF has no single-byte reading and is dropped.
    const raw = String(magic.bytes)
    const codes = [...raw].map(character => character.codePointAt(0) ?? 0x100)
    if (codes.length === 0 || codes.some(code => code > 0xff)) {
      return { skipped: `magic «${raw}» is not a single-byte string` }
    }
    hex = codes.map(code => code.toString(16).padStart(2, '0')).join('')
  } else {
    return { skipped: `magic encoding «${String(magic.encoding)}» has no S3 form` }
  }
  const length = hex.length / 2
  if (length < 1 || length > 64) return { skipped: `magic is ${length} bytes (S3 allows 1..64)` }
  return { signature: { from: 'start', offset, bytesHex: hex } }
}

// ---------------------------------------------------------------- per-codec conversion

/**
 * Turns one analyzed v1 codec into the data the emitters need, or explains why it cannot be
 * converted. Nothing here reaches outside the v1 manifest and the tables above.
 */
function convertCodec(analysis, codec) {
  const manifest = codec.manifest
  const contributionId = analysis.contributionId
  const notes = [] // converter decisions worth an owner's eye; they land in --json and the report
  // Task D — the same debt, structured, for MK2-CONVERSION.json beside the extension.
  const lostPlanes = [] // v1 entrypoints a v2 codec contribution has no home for
  const renames = [] // AC §5 operation-id renames the conversion had to apply
  const defaults = [] // choices the converter made because v1 said nothing
  const droppedOperations = [] // v1 operation ids emitted without a handler, i.e. not emitted
  const contractGaps = analysis.issues
    .filter(issue => ['absent', 'blocked', 'unclear'].includes(issue.class))
    .map(issue => String(issue.what))
    .sort()
  const skip = reason => ({ skipped: reason })

  if (analysis.verdict === 'convertible with rework' && !withRework) return skip(analysis.verdict)
  if (manifest.status === 'unsupported') {
    // 27 §0.5.2 / REPORT §9.6: a v1 codec that declares itself unsupported is a format
    // *definition*, not a codec. Document 30 has no format-definition contract in the lab yet,
    // so this is a skip with a name, not a codec that claims to open something.
    return skip('format-definition-pending')
  }

  const family = FAMILIES[manifest.kind]
  if (family === undefined) {
    return skip(
      `v1 kind «${manifest.kind}» has no bundled MK3 representation contract — the converter does not invent one (27 §6)`,
    )
  }
  const localId = String(manifest.id)
  if (!SEGMENT_RE.test(localId)) return skip(`codec id «${localId}» is not a segment (23 §3)`)

  let topology = analysis.topology
  if (topology === 'single+namespace') {
    topology = 'single'
    defaults.push('sourceTopology:single-from-mixed')
    notes.push(
      'v1 accepted both single and namespace sources; emitted the single-file side and recorded the split decision',
    )
  }
  if (topology !== 'single' && topology !== 'namespace') {
    return skip(`source topology «${topology}» needs a split decision (report: split)`)
  }

  // match -------------------------------------------------------------------------------
  const v1Match = manifest.match ?? {}
  const extensions = dedupe(
    (v1Match.extensions ?? []).map(value => String(value).replace(/^\./, '').toLowerCase()),
  ).filter(value => value.length > 0)
  const declaredGlobs = dedupe((v1Match.pathGlobs ?? []).map(String)).filter(v => v.length > 0)
  const pathGlobs = declaredGlobs.filter(glob => glob !== WILDCARD_GLOB)
  const droppedWildcard = declaredGlobs.length !== pathGlobs.length
  if (droppedWildcard) {
    notes.push(`match.pathGlobs «${WILDCARD_GLOB}» dropped — detect-by-content is match.signatures`)
    defaults.push('match:wildcard-glob-dropped')
  }
  const signatures = []
  for (const magic of v1Match.magic ?? []) {
    const converted = signatureFromMagic(magic)
    if (converted.signature === undefined) {
      notes.push(`dropped magic entry: ${converted.skipped}`)
      continue
    }
    if (signatures.length >= 8) {
      notes.push('more than 8 v1 magic entries; S3 allows 8 signatures per codec — extras dropped')
      break
    }
    signatures.push(converted.signature)
  }
  const declaredAtPort = PORT_SIGNATURES[contributionId]
  if (declaredAtPort !== undefined) {
    // Task E: not derived from v1 — added at port time from the container's own specification,
    // with the citation carried into the README and the conversion notes.
    for (const signature of declaredAtPort.signatures) {
      if (signatures.some(existing => existing.bytesHex === signature.bytesHex)) continue
      if (signatures.length >= 8) break
      signatures.push(signature)
    }
    defaults.push(`signatures:from-specification (${declaredAtPort.source})`)
  }
  if (v1Match.xmlRoots !== undefined) {
    notes.push('match.xmlRoots has no v2 field — probe() must parse the root element by hand')
  }
  if (v1Match.parentArtifacts !== undefined) {
    notes.push('match.parentArtifacts has no v2 field — host input planner / companion rule')
  }
  // A codec with no rule at all is still inventory-eligible; it simply cannot be a candidate
  // until someone declares a signature for it. That is a debt entry, not a reason to drop the
  // envelope: emitting it keeps the inventory honest about what MK2 actually contained.
  const needsSignatures =
    extensions.length === 0 && pathGlobs.length === 0 && signatures.length === 0
  if (needsSignatures) {
    notes.push('no candidate rule survives conversion — match.signatures must be declared by hand')
  }

  // permissions (24 §3 G4) --------------------------------------------------------------
  const permissions = new Set(['read-source'])
  for (const variant of manifest.runtimeVariants ?? []) {
    for (const declared of variant.permissions ?? []) {
      const mapped = PERMISSION_MAPPING[declared]
      if (mapped === undefined) {
        notes.push(`v1 permission «${declared}» has no G4 mapping — dropped, needs an owner call`)
        continue
      }
      for (const value of mapped) permissions.add(value)
    }
  }
  const requestedPermissionClasses = [...permissions].sort()
  if (requestedPermissionClasses.length > 1) {
    notes.push(
      `v1 per-variant permissions widened to both emitted variants: ${requestedPermissionClasses.join('+')}`,
    )
    defaults.push('permissions:union')
  }

  // operations --------------------------------------------------------------------------
  const operations = BASE_OPERATIONS.map(operation => ({
    id: operation.id,
    handlerId: operation.handlerId,
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: operation.outputKinds,
  }))
  for (const v1Operation of manifest.operations ?? []) {
    const renamed = OPERATION_RENAMES[v1Operation]
    if (renamed !== undefined) {
      notes.push(`v1 operation «${v1Operation}» → «${renamed}» (AC §5 rename) needs a handler`)
      renames.push({ from: v1Operation, to: renamed })
      droppedOperations.push(renamed)
      continue
    }
    notes.push(`v1 operation «${v1Operation}» has no mechanical handler — port it by hand`)
    droppedOperations.push(String(v1Operation))
  }
  for (const operation of PORT_OPERATIONS[contributionId] ?? []) {
    if (!operations.some(existing => existing.id === operation.id)) operations.push(operation)
  }
  defaults.push('operations:inspection-triple')
  if (PORT_OPERATIONS[contributionId] !== undefined) defaults.push('operations:narrowed-at-port')

  // traits ------------------------------------------------------------------------------
  const traitDeclarations = []
  for (const trait of manifest.traits ?? []) {
    for (const representation of trait.representations ?? []) {
      traitDeclarations.push({
        id: String(trait.id),
        representation: String(representation),
        // v1 `state` is fidelity, v2 `presence` is a release claim: only a full v1 state
        // promises the trait will be there (four-record model).
        presence: trait.state === undefined ? 'will-expose' : 'may-expose',
      })
    }
  }
  traitDeclarations.sort((a, b) =>
    a.id === b.id
      ? a.representation < b.representation
        ? -1
        : a.representation > b.representation
          ? 1
          : 0
      : a.id < b.id
        ? -1
        : 1,
  )
  const mayExposeTraits = PORT_MAY_EXPOSE_TRAITS[contributionId]
  if (mayExposeTraits !== undefined) {
    for (const declaration of traitDeclarations) {
      if (mayExposeTraits.has(declaration.id)) declaration.presence = 'may-expose'
    }
    defaults.push('traits:narrowed-at-port')
  }

  // lost planes ---------------------------------------------------------------------------
  // v1 `runtime` becomes the codec module and v1 `detect` folds into its probe. Every other
  // entrypoint names a plane a codec contribution cannot carry — a viewer is its own
  // contribution kind (13C) and a language plane has no X3 form at all. The converter does not
  // invent either, so the entrypoint is recorded here and dropped from the envelope.
  for (const variant of manifest.runtimeVariants ?? []) {
    for (const [plane, entrypoint] of Object.entries(variant.entrypoints ?? {})) {
      if (plane === 'runtime' || plane === 'detect') continue
      const record = { plane, entrypoint: String(entrypoint) }
      if (lostPlanes.some(item => item.plane === plane && item.entrypoint === record.entrypoint)) {
        continue
      }
      lostPlanes.push(record)
      notes.push(`v1 «${plane}» entrypoint ${record.entrypoint} has no v2 home — plane dropped`)
    }
  }
  lostPlanes.sort((a, b) =>
    a.plane === b.plane
      ? a.entrypoint < b.entrypoint
        ? -1
        : a.entrypoint > b.entrypoint
          ? 1
          : 0
      : a.plane < b.plane
        ? -1
        : 1,
  )

  if (manifest.dependencies !== undefined) {
    notes.push('v1 dependencies are codec→codec; dependsOn needs contract ids + mode/scope (23 §8)')
  }
  if (manifest.companions !== undefined) {
    notes.push('v1 companions differ in shape from spec.companions CompanionRule — not emitted')
  }

  const entrypoint = `./src/${localId}/codec.js`
  const displayName = String(manifest.displayName ?? localId)

  // Two variants and one probe plan are converter choices, not v1 data: v1 declared neither an
  // execution profile nor a probe budget. REPORT §7.6 asks every port to narrow the pair to what
  // the code actually supports, which is why the default is written down rather than assumed.
  defaults.push('variants:pair')
  defaults.push(topology === 'namespace' ? 'probe:namespace' : `probe:bytes-${PROBE_BYTES}`)
  defaults.push(`representation:${family.representation}`)

  const contribution = {
    schemaVersion: 1,
    contract: { id: 'org.modkitx/codec-contribution', major: 1 },
    id: contributionId,
    displayName,
    ...(manifest.status === undefined ? {} : { status: manifest.status }),
    runtimeVariants: [
      {
        variantId: 'trusted-node',
        entrypoint,
        target: { environments: ['node'] },
        executionProfile: 'trusted-in-process',
        requestedPermissionClasses,
      },
      {
        variantId: 'portable',
        entrypoint,
        target: { environments: ['browser-worker', 'node-worker'] },
        executionProfile: 'worker-brokered',
        requestedPermissionClasses,
      },
    ],
    ...((manifest.limitations ?? []).length === 0 && PORT_LIMITATIONS[contributionId] === undefined
      ? {}
      : {
          limitations: [
            ...(manifest.limitations ?? []),
            ...(PORT_LIMITATIONS[contributionId] ?? []),
          ],
        }),
    spec: {
      formatRefs: [{ formatId: localId, label: displayName }],
      roles: [X3_ROLE_BY_KIND[manifest.kind] ?? 'semantic'],
      sourceTopology: topology,
      artifactStages: family.stages,
      openIntents: INTENT_ORDER.filter(
        intent => BASE_INTENTS.includes(intent) || family.extraIntents.includes(intent),
      ),
      match: {
        ...(extensions.length === 0 ? {} : { extensions }),
        ...(pathGlobs.length === 0 ? {} : { pathGlobs }),
        ...(signatures.length === 0 ? {} : { signatures }),
      },
      probe:
        topology === 'namespace'
          ? (NAMESPACE_PROBES[contributionId] ?? DEFAULT_NAMESPACE_PROBE)
          : {
              kind: 'bytes',
              ranges: [{ from: 'start', length: PROBE_BYTES }],
              maxBytes: PROBE_BYTES,
            },
      representations: [
        {
          id: family.representationId,
          contract: family.representation,
          major: 1,
          stage: 'authored',
          lossy: false,
        },
      ],
      publishesDataSources: [...family.dataSources, ...BASE_DATA_SOURCES].map(contract => ({
        contract,
        major: 1,
      })),
      operations,
      ...(traitDeclarations.length === 0 ? {} : { traitDeclarations }),
      implementationTier: { claimed: 1 },
      budgets: BUDGETS,
    },
  }

  return {
    localId,
    contributionId,
    displayName,
    signatures,
    contribution,
    notes,
    debt: {
      lostPlanes,
      contractGaps,
      renames,
      converterDefaults: [...new Set(defaults)].sort(),
      droppedOperations: dedupe(droppedOperations).sort(),
      needsSignatures,
    },
  }
}

// ---------------------------------------------------------------- emitters

function codecModuleSource(converted, sourceRel) {
  const { contributionId, localId, displayName, signatures } = converted
  const needsSignatures = converted.debt.needsSignatures
  const lines = []
  lines.push(`// ${GENERATED_MARKER} from ${sourceRel} — probe is real, open() is not.`)
  lines.push('//')
  if (signatures.length > 0) {
    lines.push('// probe(): the v1 manifest declared magic, so detection is a real byte compare.')
  } else {
    lines.push('// probe(): the v1 manifest declared no magic, so there is nothing honest to')
    lines.push('// compare — detection reports 0 instead of a confidence this module cannot earn.')
    if (needsSignatures) {
      lines.push('//')
      lines.push('// This codec has no candidate rule at all: v1 routed it by a path glob matching')
      lines.push('// every file, which MK3 does not accept. Until a port declares match.signatures')
      lines.push('// the host will never shortlist it, and that is the honest state — see')
      lines.push('// MK2-CONVERSION.json (needsSignatures).')
    }
  }
  lines.push('// open(): every MK3 open() is hand-written; this one is still pending.')
  lines.push('')
  lines.push(`import { createInspectionCodec } from '${CODEC_KIT}'`)
  lines.push('')
  lines.push(`const ID = '${contributionId}'`)
  if (signatures.length > 0) {
    lines.push('')
    lines.push('/** v1 match.magic, byte for byte: `offset` then the expected bytes. */')
    lines.push('const SIGNATURES = Object.freeze([')
    for (const signature of signatures) {
      const bytes = (signature.bytesHex.match(/../g) ?? []).map(pair => `0x${pair}`).join(', ')
      lines.push(
        `  Object.freeze({ offset: ${signature.offset}, bytes: Object.freeze([${bytes}]) }),`,
      )
    }
    lines.push('])')
    lines.push('')
    lines.push('function matchedSignature(prefix) {')
    lines.push('  return SIGNATURES.find(signature =>')
    lines.push(
      '    signature.bytes.every((value, index) => prefix[signature.offset + index] === value),',
    )
    lines.push('  )')
    lines.push('}')
  }
  lines.push('')
  lines.push('const definition = Object.freeze({')
  lines.push('  id: ID,')
  lines.push(
    `  format: Object.freeze({ id: ${JSON.stringify(localId)}, label: ${JSON.stringify(displayName)} }),`,
  )
  lines.push('  async detect(prefix) {')
  if (signatures.length > 0) {
    lines.push('    const signature = matchedSignature(prefix)')
    lines.push('    return signature === undefined')
    lines.push("      ? { confidence: 0, kind: 'magic', note: 'signature-mismatch' }")
    lines.push("      : { confidence: 0.99, kind: 'magic', note: 'v1-magic' }")
  } else {
    lines.push('    // TODO(port): the v1 manifest declared no magic. Until this codec is ported,')
    lines.push('    // claiming anything above 0 would be a detection this module cannot back with')
    lines.push(
      needsSignatures
        ? '    // bytes, and no match rule shortlists it either (see MK2-CONVERSION.json).'
        : '    // bytes; the candidate still reaches probe through its match rules.',
    )
    lines.push('    void prefix')
    lines.push("    return { confidence: 0, kind: 'structure', note: 'mk2-port-pending' }")
  }
  lines.push('  },')
  lines.push('  async inspect() {')
  lines.push('    throw Object.assign(')
  lines.push(
    '      new Error(`${ID}: MK2 codec is not ported yet — open() has no implementation`),',
  )
  lines.push("      { code: 'x3.mk2/port-pending' },")
  lines.push('    )')
  lines.push('  },')
  lines.push('})')
  lines.push('')
  lines.push('export const abiVersion = 1')
  lines.push('export const createCodec = context => createInspectionCodec(definition, context)')
  lines.push('')
  return lines.join('\n')
}

function packageJsonSource(group) {
  return {
    name: `modkit-extension-mk2-${group.directory}`,
    version: group.version,
    license: group.license,
    private: true,
    type: 'module',
    description: `MK2 → MK3 converted contributions of ${group.coordinate} (generated; see REPORT_MK2_CONVERSION).`,
    modkit: {
      schemaVersion: 1,
      publisher: group.publisher,
      id: group.id,
      contributionManifests: ['./contributions/*.json'],
    },
    // The kit is a workspace link (`extensions/mk2/*` is a workspace member), so the generated
    // modules import it by package name — the same specifier a published extension would use.
    dependencies: {
      [CODEC_KIT]: 'workspace:*',
      ...(group.directory === 'blizzard-casc' ? { fflate: '^0.8.3' } : {}),
      ...(group.directory === 'blizzard-models' ? { '@xmldom/xmldom': '^0.9.10' } : {}),
    },
  }
}

function readmeSource(group) {
  const lines = []
  lines.push(`# ${group.coordinate} (MK2 → MK3, generated)`)
  lines.push('')
  lines.push(`<!-- ${GENERATED_MARKER}; re-run \`pnpm convert:mk2\` instead of editing. -->`)
  lines.push('')
  lines.push(
    'Mechanically converted contribution envelopes for the v1 codecs of this MK2 extension.',
  )
  lines.push(
    'The manifests are complete MK3 data. A module under `src/` marked `port-pending` below',
  )
  lines.push(
    'implements `probe` only and throws `x3.mk2/port-pending` from `open`; one marked `ported`',
  )
  lines.push('is hand-written, owned by a human, and never regenerated.')
  lines.push('')
  lines.push('The conversion debt of every codec below \u2014 planes v2 has no home for, applied')
  lines.push(
    'renames, converter defaults and v1 operations left without a handler \u2014 is data in',
  )
  lines.push('`MK2-CONVERSION.json` beside this file.')
  lines.push('')
  lines.push('| contribution | v1 manifest | module | port |')
  lines.push('| --- | --- | --- | --- |')
  for (const codec of group.codecs) {
    lines.push(
      `| \`${codec.contributionId}\` | \`${codec.sourceRel}\` | \`src/${codec.localId}/codec.js\` | ${codec.portState} |`,
    )
  }
  const cited = group.codecs.filter(codec => PORT_SIGNATURES[codec.contributionId] !== undefined)
  if (cited.length > 0) {
    lines.push('')
    lines.push('## Signatures added at port time')
    lines.push('')
    lines.push(
      'The v1 manifests of these codecs carried no magic \u2014 they routed on a path glob',
    )
    lines.push('matching every file, which MK3 does not accept as a wildcard. Their')
    lines.push('`match.signatures` come from the container specifications, not from MK2:')
    lines.push('')
    for (const codec of cited) {
      const entry = PORT_SIGNATURES[codec.contributionId]
      const patterns = entry.signatures
        .map(signature => `\`${signature.bytesHex}\` @${signature.offset}`)
        .join(', ')
      lines.push(`- \`${codec.contributionId}\` \u2014 ${patterns}. Source: ${entry.source}.`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Task D \u2014 the conversion debt as inert data beside the extension. Nothing reads this file at
 * runtime: it is not a contribution, not a schema and not on the loader's manifest glob. It
 * exists so that committing a mechanically converted tree does not commit a *silent* loss \u2014
 * every plane the envelope could not carry is named, with the v1 entrypoint that carried it.
 */
function conversionNotesSource(group) {
  const codecs = {}
  for (const codec of group.codecs) {
    codecs[codec.contributionId] = {
      verdict: VERDICT_WIRE[codec.verdict] ?? codec.verdict,
      lostPlanes: codec.debt.lostPlanes,
      contractGaps: codec.debt.contractGaps,
      renames: codec.debt.renames,
      converterDefaults: codec.debt.converterDefaults,
      droppedOperations: codec.debt.droppedOperations,
      needsSignatures: codec.debt.needsSignatures,
      portState: codec.portState,
    }
  }
  return {
    $comment: NOTES_COMMENT,
    schemaVersion: 1,
    source: {
      repository: 'modkitx',
      manifests: group.codecs.map(codec => codec.sourceRel).sort(),
    },
    verdict: group.codecs.some(codec => codec.verdict === 'needs new contract')
      ? VERDICT_WIRE['needs new contract']
      : group.codecs.some(codec => codec.verdict === 'convertible with rework')
        ? VERDICT_WIRE['convertible with rework']
        : VERDICT_WIRE.mechanical,
    codecs,
  }
}

// ---------------------------------------------------------------- run

const { codecs: codecEntries } = readMk2Tree(mk2Root)
const groups = new Map()
const skipped = []
const converted = []
const collisions = []

function splitOwner(publisher, id, contributionId) {
  if (publisher === 'org.modkitx.ea' && id === 'sage' && contributionId === 'org.modkitx/big') {
    return { directory: 'ea-big', publisher, id: 'big' }
  }
  if (publisher === 'org.modkitx.blizzard' && id === 'archives') {
    return contributionId === 'org.modkitx/casc'
      ? { directory: 'blizzard-casc', publisher, id: 'casc' }
      : { directory: 'blizzard-mpq', publisher, id: 'mpq' }
  }
  if (publisher === 'org.modkitx.blizzard' && id === 'starcraft-2') {
    return contributionId === 'org.modkitx/m3'
      ? { directory: 'blizzard-models', publisher, id: 'models' }
      : { directory: 'blizzard-starcraft2', publisher, id: 'starcraft2' }
  }
  return { directory: `${lastDottedSegment(publisher)}-${id}`, publisher, id }
}

for (const codec of codecEntries) {
  const analysis = analyzeCodec(codec)
  const result = convertCodec(analysis, codec)
  if (result.skipped !== undefined) {
    skipped.push({
      contributionId: analysis.contributionId,
      kind: analysis.kind,
      verdict: analysis.verdict,
      reason: result.skipped,
    })
    continue
  }
  const owner = codec.owner
  if (owner === undefined) {
    skipped.push({
      contributionId: analysis.contributionId,
      kind: analysis.kind,
      verdict: analysis.verdict,
      reason: 'no owning v1 extension container — the MK3 artifact has no coordinate',
    })
    continue
  }
  const sourcePublisher = String(owner.manifest.publisher)
  const sourceId = String(owner.manifest.id)
  const { directory, publisher, id } = splitOwner(
    sourcePublisher,
    sourceId,
    analysis.contributionId,
  )
  let group = groups.get(directory)
  if (group === undefined) {
    group = {
      directory,
      publisher,
      id,
      coordinate: `${publisher}/${id}`,
      version: String(owner.manifest.version ?? '0.0.0'),
      license: String(owner.manifest.license ?? 'MIT'),
      codecs: [],
    }
    groups.set(directory, group)
  } else if (group.coordinate !== `${publisher}/${id}`) {
    collisions.push(`${directory}: ${group.coordinate} and ${publisher}/${id}`)
    continue
  }
  const entry = { ...result, sourceRel: codec.rel, verdict: analysis.verdict, kind: analysis.kind }
  group.codecs.push(entry)
  converted.push({
    contributionId: entry.contributionId,
    kind: entry.kind,
    verdict: entry.verdict,
    directory,
    module: `extensions/mk2/${directory}/src/${entry.localId}/codec.js`,
    signatures: entry.signatures.length,
    notes: entry.notes,
    debt: entry.debt,
  })
}

if (collisions.length > 0) {
  console.error(`convert-mk2: output directory collision(s):\n  ${collisions.join('\n  ')}`)
  process.exit(2)
}

const sortedGroups = [...groups.values()]
  .filter(group => !RELOCATED_FAMILIES.has(group.directory))
  .sort((a, b) => (a.directory < b.directory ? -1 : 1))
for (const group of sortedGroups) {
  group.codecs = group.codecs.filter(
    codec => !RELOCATED_CODECS.has(`${group.directory}/${codec.localId}`),
  )
  group.codecs.sort((a, b) => (a.localId < b.localId ? -1 : 1))
}

// ---------------------------------------------------------------- port state
//
// A module that lost the generated marker has a human owner: the converter never overwrites it,
// never calls it drift, and records it as `ported` in the notes. Reading the existing tree has
// to happen before the file map is rendered, because the notes carry that state.

const existing = listExisting(outRoot)
const isCodecModule = path => /\/src\/[^/]+\/codec\.js$/.test(path)
const handPorted = [...existing.keys()]
  .filter(path => isCodecModule(path) && !existing.get(path).includes(GENERATED_MARKER))
  .sort()
const handPortedSet = new Set(handPorted)
const handPortedRoots = handPorted.map(path => path.slice(0, -'codec.js'.length))
const isHandPortOwned = path => {
  if (handPortedSet.has(path)) return true
  if (handPortedRoots.some(root => path.startsWith(root))) return true
  const manifest = /^(.*)\/contributions\/codec-([^/]+)\.json$/u.exec(path)
  return manifest !== null && handPortedSet.has(`${manifest[1]}/src/${manifest[2]}/codec.js`)
}
const portStateOf = module => (handPortedSet.has(module) ? 'ported' : 'port-pending')
for (const group of sortedGroups) {
  for (const codec of group.codecs) {
    codec.portState = portStateOf(`${group.directory}/src/${codec.localId}/codec.js`)
  }
}
for (const entry of converted) {
  entry.portState = portStateOf(entry.module.slice('extensions/mk2/'.length))
}

// ---------------------------------------------------------------- render the file map

// Style comes from the lab's own prettier config, not from wherever --out points: the emitted
// bytes must not depend on the output directory, or --check could never compare them.
const prettierConfig = (await resolveConfig(join(x3Root, 'package.json'))) ?? {}
const formatted = (text, parser) => prettierFormat(text, { ...prettierConfig, parser })

const files = new Map() // posix path relative to outRoot → contents
for (const group of sortedGroups) {
  const base = group.directory
  // prettier picks `json-stringify` for a file literally named package.json; using anything
  // else here would make `pnpm format:check` disagree with the generator on every re-run.
  files.set(
    `${base}/package.json`,
    await formatted(JSON.stringify(packageJsonSource(group)), 'json-stringify'),
  )
  files.set(`${base}/README.md`, await formatted(readmeSource(group), 'markdown'))
  files.set(
    `${base}/MK2-CONVERSION.json`,
    await formatted(JSON.stringify(conversionNotesSource(group)), 'json'),
  )
  for (const codec of group.codecs) {
    files.set(
      `${base}/contributions/codec-${codec.localId}.json`,
      await formatted(JSON.stringify(codec.contribution), 'json'),
    )
    files.set(
      `${base}/src/${codec.localId}/codec.js`,
      await formatted(codecModuleSource(codec, codec.sourceRel), 'babel'),
    )
  }
}

// ---------------------------------------------------------------- compare / write

function listExisting(root) {
  const out = new Map()
  const walk = (dir, prefix) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(dir, entry.name)
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path, rel)
      else out.set(rel, readFileSync(path, 'utf8'))
    }
  }
  if (statSync(root, { throwIfNoEntry: false })?.isDirectory() === true) walk(root, '')
  return out
}

const drift = { added: [], changed: [], removed: [] }
for (const [path, contents] of files) {
  if (isHandPortOwned(path)) continue
  const current = existing.get(path)
  if (current === undefined) drift.added.push(path)
  else if (current !== contents) drift.changed.push(path)
}
for (const path of existing.keys()) {
  if (!files.has(path) && !isHandPortOwned(path) && !path.includes('/test/')) {
    drift.removed.push(path)
  }
}
for (const key of Object.keys(drift)) drift[key].sort()

if (!checkOnly) {
  for (const path of drift.removed) rmSync(join(outRoot, path), { force: true })
  for (const path of [...drift.added, ...drift.changed]) {
    const target = join(outRoot, path.split('/').join(sep))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, files.get(path))
  }
}

const summary = {
  mk2Root: toPosix(mk2Root),
  outRoot: toPosix(relative(x3Root, outRoot)),
  rework: withRework,
  extensions: sortedGroups.length,
  converted: converted.length,
  skipped: skipped.length,
  handPorted: handPorted.length,
  // Task D/E counters the report quotes verbatim.
  withNotes: converted.filter(item => item.notes.length > 0).length,
  needsSignatures: converted.filter(item => item.debt.needsSignatures).length,
  withSignatures: converted.filter(item => item.signatures > 0).length,
  lostPlanes: converted.filter(item => item.debt.lostPlanes.length > 0).length,
  ported: converted.filter(item => item.portState === 'ported').length,
  byVerdict: converted.reduce((acc, item) => {
    acc[item.verdict] = (acc[item.verdict] ?? 0) + 1
    return acc
  }, {}),
  byKind: converted.reduce((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1
    return acc
  }, {}),
  skipReasons: skipped.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1
    return acc
  }, {}),
}

if (jsonPath !== undefined) {
  writeFileSync(
    resolve(jsonPath),
    `${JSON.stringify({ summary, converted, skipped, handPorted, drift }, null, 2)}\n`,
  )
}

if (checkOnly) {
  const total = drift.added.length + drift.changed.length + drift.removed.length
  if (total > 0) {
    console.error(`convert-mk2 --check: ${total} file(s) differ from a fresh conversion:`)
    for (const path of drift.added) console.error(`  + ${path}`)
    for (const path of drift.changed) console.error(`  ~ ${path}`)
    for (const path of drift.removed) console.error(`  - ${path}`)
    process.exit(1)
  }
  if (!quiet) {
    console.log(
      `convert-mk2 --check: clean (${files.size} generated file(s), ${handPorted.length} hand-ported module(s) skipped)`,
    )
  }
} else if (!quiet) {
  console.log(
    `convert-mk2: ${summary.converted} codec(s) → ${summary.extensions} extension(s) in ${summary.outRoot}` +
      ` (${summary.skipped} skipped, ${summary.handPorted} hand-ported module(s) kept)`,
  )
  console.log(
    `  notes: ${summary.withNotes} codec(s) with conversion debt, ${summary.withSignatures} with signatures,` +
      ` ${summary.needsSignatures} needing one, ${summary.lostPlanes} losing a plane`,
  )
  const changes = drift.added.length + drift.changed.length + drift.removed.length
  console.log(
    `  files: ${files.size} generated, ${drift.added.length} added, ${drift.changed.length} rewritten, ${drift.removed.length} removed (${changes === 0 ? 'byte-stable' : 'updated'})`,
  )
}
