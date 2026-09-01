/**
 * Runtime preparation and result assertions for the generated installed-format smoke.
 *
 * This module deliberately imports no extension or vendor-checkout code. The generated descriptor
 * owns every corpus relative path, digest, stage and selected contribution route; the harness only
 * supplies the three machine-local roots and a reader for entries inside a container.
 */
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_FORMAT_SMOKE_AUTHORITY = resolve(
  here,
  '..',
  'generated',
  'format-smoke.v1.json',
)

export const FORMAT_SMOKE_CASE_IDS = Object.freeze([
  'image-dds',
  'image-png',
  'image-tga',
  'image-jpeg',
  'document-odt',
  'data-xml',
  'archive-zip',
  'archive-warzone-wz',
  'archive-mpq',
  'casc-dds',
  'audio-wav',
  'audio-ogg',
  'model-m3',
  'model-warzone-pie',
])

const EXPECTED_CORPUS_KINDS = Object.freeze({
  'image-dds': 'workspace-reference',
  'image-png': 'workspace-reference',
  'image-tga': 'workspace-reference',
  'image-jpeg': 'workspace-reference',
  'document-odt': 'workspace-reference',
  'data-xml': 'workspace-reference',
  'archive-zip': 'workspace-reference',
  'archive-warzone-wz': 'warzone-install-file',
  'archive-mpq': 'sc2-install-file',
  'casc-dds': 'sc2-casc-entry',
  'audio-wav': 'sc2-casc-entry',
  'audio-ogg': 'sc2-casc-entry',
  'model-m3': 'sc2-casc-entry',
  'model-warzone-pie': 'warzone-wz-entry',
})

/** @typedef {{ formatId: string, extensionId: string, contributionId: string }} RouteIdentity */

/**
 * @typedef {object} FormatSmokeOpenCase
 * @property {'open'} kind
 * @property {string} id
 * @property {string} family
 * @property {readonly string[]} formats
 * @property {'raster'|'tree-text'|'tree'|'metadata-tree'|'model-or-wireframe'} stage
 * @property {readonly RouteIdentity[]} selectedRoute
 * @property {FormatSmokeFileSource|FormatSmokeContainerSource} source
 */

/**
 * @typedef {object} FormatSmokeExcludedCase
 * @property {'excluded'} kind
 * @property {string} id
 * @property {string} family
 * @property {readonly string[]} formats
 * @property {string} stage
 * @property {readonly RouteIdentity[]} selectedRoute
 * @property {string} reason
 */

/**
 * @typedef {object} FormatSmokeFileSource
 * @property {'file'} kind
 * @property {string} filePath
 * @property {string} uri
 * @property {number} expectedBytes
 * @property {string} expectedSha256
 */

/**
 * @typedef {object} FormatSmokeContainerSource
 * @property {'container-entry'} kind
 * @property {'sc2-casc'|'warzone-wz'} containerKind
 * @property {string} containerPath
 * @property {string} entryPath
 * @property {string} uri
 * @property {number} expectedBytes
 * @property {string} expectedSha256
 */

/**
 * @typedef {object} FormatSmokeWebviewObservation
 * @property {string} caseId
 * @property {string} uri
 * @property {readonly RouteIdentity[]} selectedRoute
 * @property {{width:number,height:number,opaquePixels:number}=} raster
 * @property {{entryCount:number}=} metadata
 * @property {{nodeCount:number}=} tree
 * @property {{characterCount:number}=} text
 * @property {{canvas?:{width:number,height:number},wireframeFallback?:{recorded:boolean,segmentCount:number}}=} model
 */

/**
 * @typedef {object} FormatSmokeResultRecord
 * @property {'x3.vscode-installed-format-smoke-result'} kind
 * @property {1} schemaVersion
 * @property {string} caseId
 * @property {string} uri
 * @property {readonly RouteIdentity[]} selectedRoute
 * @property {string} stage
 * @property {readonly string[]} assertions
 * @property {'pass'} verdict
 */

const object = (value, label) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

const nonBlank = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

const expectedInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
  return value
}

const expectedSha = (value, label) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`)
  }
  return value
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

/** Validate the generated descriptor as the exact Wave 1C authority: 14 real cases, no exclusion. */
export function validateFormatSmokeAuthority(value) {
  const authority = object(value, 'format smoke authority')
  if (authority.kind !== 'x3.ga-recovery/format-family-smoke' || authority.schemaVersion !== 1) {
    throw new TypeError('format smoke authority has the wrong kind or schemaVersion')
  }
  if (!Array.isArray(authority.cases) || authority.cases.length !== FORMAT_SMOKE_CASE_IDS.length) {
    throw new TypeError(`format smoke authority must contain exactly 14 cases`)
  }
  const ids = authority.cases.map((entry, index) =>
    nonBlank(object(entry, `cases[${index}]`).id, `cases[${index}].id`),
  )
  if (!same(ids, FORMAT_SMOKE_CASE_IDS)) {
    throw new TypeError(`format smoke authority case order is ${JSON.stringify(ids)}`)
  }
  if (new Set(ids).size !== ids.length)
    throw new TypeError('format smoke authority repeats a case id')

  for (const entry of authority.cases) {
    if (!Array.isArray(entry.formats) || entry.formats.length === 0) {
      throw new TypeError(`${entry.id}.formats must be a non-empty array`)
    }
    if (!Array.isArray(entry.route) || entry.route.length !== entry.formats.length) {
      throw new TypeError(`${entry.id}.route must have exactly one step per format`)
    }
    const routeFormats = entry.route.map((step, index) => {
      const route = object(step, `${entry.id}.route[${index}]`)
      nonBlank(route.extensionId, `${entry.id}.route[${index}].extensionId`)
      nonBlank(route.contributionId, `${entry.id}.route[${index}].contributionId`)
      return nonBlank(route.formatId, `${entry.id}.route[${index}].formatId`)
    })
    if (!same(routeFormats, entry.formats)) {
      throw new TypeError(`${entry.id}.route does not exactly follow its formats`)
    }
    if (entry.runtime?.vscode !== 'open') {
      throw new TypeError(`${entry.id} is not declared openable in VS Code`)
    }
    const corpus = object(entry.corpus, `${entry.id}.corpus`)
    if (corpus.kind !== EXPECTED_CORPUS_KINDS[entry.id]) {
      throw new TypeError(`${entry.id}.corpus.kind is ${String(corpus.kind)}`)
    }
    if (corpus.kind === 'named-exclusion') {
      nonBlank(corpus.reason, `${entry.id}.corpus.reason`)
    } else {
      nonBlank(corpus.path, `${entry.id}.corpus.path`)
      expectedInteger(corpus.bytes, `${entry.id}.corpus.bytes`)
      expectedSha(corpus.sha256, `${entry.id}.corpus.sha256`)
    }
  }

  if (!Array.isArray(authority.namedExclusions) || authority.namedExclusions.length !== 0) {
    throw new TypeError('format smoke authority must contain no named exclusions')
  }
  return authority
}

/** Read only the generated installed-format descriptor; no source policy or vendor manifest. */
export function loadFormatSmokeAuthority(authorityPath = DEFAULT_FORMAT_SMOKE_AUTHORITY) {
  return validateFormatSmokeAuthority(JSON.parse(readFileSync(authorityPath, 'utf8')))
}

const absoluteRoot = (value, label) => {
  const root = nonBlank(value, label)
  if (!isAbsolute(root)) throw new TypeError(`${label} must be absolute`)
  return resolve(root)
}

const confinedPath = (root, portablePath, label) => {
  const path = nonBlank(portablePath, label)
  if (path.includes('\0')) throw new TypeError(`${label} contains NUL`)
  const normalized = path.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[a-z]:\//iu.test(normalized)) {
    throw new TypeError(`${label} escapes its explicit root`)
  }
  const target = resolve(root, ...normalized.split('/'))
  const fromRoot = relative(root, target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new TypeError(`${label} escapes its explicit root`)
  }
  return target
}

const entryPath = (value, label) => {
  const path = nonBlank(value, label).replaceAll('\\', '/')
  const segments = path.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError(`${label} is not a confined container entry`)
  }
  return segments.join('/')
}

const selectedRoute = entry =>
  Object.freeze(
    entry.route.map(step =>
      Object.freeze({
        formatId: step.formatId,
        extensionId: step.extensionId,
        contributionId: step.contributionId,
      }),
    ),
  )

/** Build the exact authority-less URI understood by apps/vscode/src/container-uri.ts. */
export function formatSmokeContainerUri(containerPath, entry) {
  const container = nonBlank(containerPath, 'containerPath')
  const member = entryPath(entry, 'entryPath')
  return `modkit-container:/${Buffer.from(container, 'utf8').toString('hex')}/${member}`
}

/** Decode an exact runtime URI for round-trip checks and harness diagnostics. */
export function parseFormatSmokeContainerUri(uri) {
  const prefix = 'modkit-container:/'
  if (typeof uri !== 'string' || !uri.startsWith(prefix)) return undefined
  const separator = uri.indexOf('/', prefix.length)
  if (separator < 0) return undefined
  const token = uri.slice(prefix.length, separator)
  if (!/^(?:[0-9a-f]{2})+$/u.test(token)) return undefined
  const member = uri.slice(separator + 1)
  if (member === '') return undefined
  return Object.freeze({
    containerPath: Buffer.from(token, 'hex').toString('utf8'),
    entryPath: entryPath(member, 'URI entryPath'),
  })
}

/**
 * Resolve all generated corpus locators from explicit machine-local roots without testing whether
 * the paths exist. Existence, byte size and digest are checked separately immediately before open.
 *
 * @returns {readonly (FormatSmokeOpenCase|FormatSmokeExcludedCase)[]}
 */
export function resolveFormatSmokeCases(authorityValue, rootsValue) {
  const authority = validateFormatSmokeAuthority(authorityValue)
  const roots = object(rootsValue, 'format smoke roots')
  const workspaceRoot = absoluteRoot(roots.workspaceRoot, 'workspaceRoot')
  const sc2InstallRoot = absoluteRoot(roots.sc2InstallRoot, 'sc2InstallRoot')
  const warzoneInstallRoot = absoluteRoot(roots.warzoneInstallRoot, 'warzoneInstallRoot')

  return Object.freeze(
    authority.cases.map(entry => {
      const common = {
        id: entry.id,
        family: entry.family,
        formats: Object.freeze([...entry.formats]),
        stage: entry.stage,
        selectedRoute: selectedRoute(entry),
      }
      const corpus = entry.corpus
      if (corpus.kind === 'named-exclusion') {
        return Object.freeze({ ...common, kind: 'excluded', reason: corpus.reason })
      }

      const expected = {
        expectedBytes: corpus.bytes,
        expectedSha256: corpus.sha256,
      }
      if (corpus.kind === 'sc2-casc-entry') {
        const member = entryPath(corpus.path, `${entry.id}.corpus.path`)
        return Object.freeze({
          ...common,
          kind: 'open',
          source: Object.freeze({
            ...expected,
            kind: 'container-entry',
            containerKind: 'sc2-casc',
            containerPath: sc2InstallRoot,
            entryPath: member,
            uri: formatSmokeContainerUri(sc2InstallRoot, member),
          }),
        })
      }
      if (corpus.kind === 'warzone-wz-entry') {
        const containerPath = confinedPath(
          warzoneInstallRoot,
          corpus.container,
          `${entry.id}.corpus.container`,
        )
        const member = entryPath(corpus.path, `${entry.id}.corpus.path`)
        return Object.freeze({
          ...common,
          kind: 'open',
          source: Object.freeze({
            ...expected,
            kind: 'container-entry',
            containerKind: 'warzone-wz',
            containerPath,
            entryPath: member,
            uri: formatSmokeContainerUri(containerPath, member),
          }),
        })
      }

      const root =
        corpus.kind === 'workspace-reference'
          ? workspaceRoot
          : corpus.kind === 'sc2-install-file'
            ? sc2InstallRoot
            : warzoneInstallRoot
      const filePath = confinedPath(root, corpus.path, `${entry.id}.corpus.path`)
      return Object.freeze({
        ...common,
        kind: 'open',
        source: Object.freeze({
          ...expected,
          kind: 'file',
          filePath,
          uri: pathToFileURL(filePath).href,
        }),
      })
    }),
  )
}

const digestFile = async path => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

const bytesFrom = (value, label) => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new TypeError(`${label} must return Uint8Array or ArrayBuffer`)
}

/**
 * Verify corpus bytes before returning control to an installed harness that will open `source.uri`.
 * Container entries require a read-only host callback; loose/install files are streamed directly.
 */
export async function verifyFormatSmokeCorpusBeforeOpen(testCase, options = {}) {
  if (testCase?.kind !== 'open')
    throw new TypeError('only an open format smoke case can be verified')
  const source = testCase.source
  let actualBytes
  let actualSha256
  if (source.kind === 'file') {
    const details = await stat(source.filePath)
    if (!details.isFile()) throw new TypeError(`${testCase.id} corpus is not a file`)
    actualBytes = details.size
    if (actualBytes !== source.expectedBytes) {
      throw new TypeError(
        `${testCase.id} corpus size mismatch: expected ${source.expectedBytes}, got ${actualBytes}`,
      )
    }
    actualSha256 = await digestFile(source.filePath)
  } else {
    if (typeof options.readContainerEntry !== 'function') {
      throw new TypeError(`${testCase.id} needs a readContainerEntry callback before open`)
    }
    const bytes = bytesFrom(
      await options.readContainerEntry({
        containerKind: source.containerKind,
        containerPath: source.containerPath,
        entryPath: source.entryPath,
        uri: source.uri,
      }),
      'readContainerEntry',
    )
    actualBytes = bytes.byteLength
    if (actualBytes !== source.expectedBytes) {
      throw new TypeError(
        `${testCase.id} corpus size mismatch: expected ${source.expectedBytes}, got ${actualBytes}`,
      )
    }
    actualSha256 = createHash('sha256').update(bytes).digest('hex')
  }
  if (actualSha256 !== source.expectedSha256) {
    throw new TypeError(
      `${testCase.id} corpus SHA-256 mismatch: expected ${source.expectedSha256}, got ${actualSha256}`,
    )
  }
  return Object.freeze({
    kind: 'x3.vscode-installed-format-smoke-corpus-verification',
    schemaVersion: 1,
    caseId: testCase.id,
    uri: source.uri,
    bytes: actualBytes,
    sha256: actualSha256,
    verifiedBeforeOpen: true,
  })
}

const positive = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be positive`)
  }
}

const exactSelectedRoute = (expected, actual, label) => {
  if (!Array.isArray(actual)) throw new TypeError(`${label}.selectedRoute must be an array`)
  const projected = actual.map((step, index) => {
    const route = object(step, `${label}.selectedRoute[${index}]`)
    return {
      formatId: route.formatId,
      extensionId: route.extensionId,
      contributionId: route.contributionId,
    }
  })
  if (!same(projected, expected)) {
    throw new TypeError(
      `${label} selected route mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(projected)}`,
    )
  }
  return projected
}

/**
 * Assert the stage-specific visible result and return a machine-readable installed-harness record.
 * Human copy, tab captions and localized labels are intentionally outside this contract.
 *
 * @param {FormatSmokeOpenCase} testCase
 * @param {FormatSmokeWebviewObservation} observation
 * @returns {FormatSmokeResultRecord}
 */
export function assertFormatSmokeWebviewResult(testCase, observation) {
  if (testCase?.kind !== 'open') throw new TypeError('an excluded format smoke case cannot open')
  const result = object(observation, `${testCase.id} observation`)
  if (result.caseId !== testCase.id)
    throw new TypeError(`${testCase.id} observation has wrong caseId`)
  if (result.uri !== testCase.source.uri)
    throw new TypeError(`${testCase.id} observation has wrong URI`)
  const route = exactSelectedRoute(testCase.selectedRoute, result.selectedRoute, testCase.id)
  const assertions = ['selected-route:exact']

  if (testCase.stage === 'raster') {
    positive(result.raster?.width, `${testCase.id}.raster.width`)
    positive(result.raster?.height, `${testCase.id}.raster.height`)
    positive(result.raster?.opaquePixels, `${testCase.id}.raster.opaquePixels`)
    positive(result.metadata?.entryCount, `${testCase.id}.metadata.entryCount`)
    assertions.push('raster:nonempty-opaque', 'metadata:nonempty')
  } else if (testCase.stage === 'tree-text') {
    positive(result.tree?.nodeCount, `${testCase.id}.tree.nodeCount`)
    positive(result.text?.characterCount, `${testCase.id}.text.characterCount`)
    assertions.push('tree:nonempty', 'text:nonempty')
  } else if (testCase.stage === 'tree') {
    positive(result.tree?.nodeCount, `${testCase.id}.tree.nodeCount`)
    assertions.push('tree:nonempty')
  } else if (testCase.stage === 'metadata-tree') {
    positive(result.metadata?.entryCount, `${testCase.id}.metadata.entryCount`)
    positive(result.tree?.nodeCount, `${testCase.id}.tree.nodeCount`)
    assertions.push('audio-metadata:nonempty', 'audio-tree:nonempty')
  } else if (testCase.stage === 'model-or-wireframe') {
    const canvas = result.model?.canvas
    const fallback = result.model?.wireframeFallback
    if (canvas !== undefined) {
      positive(canvas.width, `${testCase.id}.model.canvas.width`)
      positive(canvas.height, `${testCase.id}.model.canvas.height`)
      assertions.push('model-viewer:canvas')
    } else if (fallback?.recorded === true) {
      positive(fallback.segmentCount, `${testCase.id}.model.wireframeFallback.segmentCount`)
      assertions.push('model-viewer:wireframe-fallback-recorded')
    } else {
      throw new TypeError(
        `${testCase.id} has neither a model canvas nor a recorded wireframe fallback`,
      )
    }
  } else {
    throw new TypeError(`${testCase.id} has unknown stage ${String(testCase.stage)}`)
  }

  return Object.freeze({
    kind: 'x3.vscode-installed-format-smoke-result',
    schemaVersion: 1,
    caseId: testCase.id,
    uri: testCase.source.uri,
    selectedRoute: Object.freeze(route.map(step => Object.freeze(step))),
    stage: testCase.stage,
    assertions: Object.freeze(assertions),
    verdict: 'pass',
  })
}
