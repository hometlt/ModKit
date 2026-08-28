import { MAP_PREVIEW_PREPARATION_CONTRACT } from '@modkitx-x3/sdk/maps'

const GAME_ID = 'org.modkitx/warzone-2100'
const SUBJECT_FORMAT_ID = 'warzone-wz'
const MAXIMUM_CANDIDATES = 256
const MAXIMUM_ROOTS = 64
const MAXIMUM_DEPTH = 128
const MAXIMUM_NAMESPACE_ENTRIES = 20_000
const MAXIMUM_LOGICAL_PATH_CHARS = 4_096
const REQUIRED_ROOTS = 3
const REQUIRED_DEPTH = 2

export const WARZONE_MAP_PREVIEW_PREPARATION_ID = 'org.modkitx.opensource.warzone2100.map-preview'
export const WARZONE_MAP_PREVIEW_RESOLVER_ID =
  'org.modkitx.node/game-installation-archive-map-preview'

function recordOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

function positiveLimit(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}`)
  }
  return value
}

function diagnostic(severity, code, message, data) {
  return Object.freeze({
    severity,
    code,
    message,
    ...(data === undefined ? {} : { data: Object.freeze(data) }),
  })
}

function normalizeLogicalPath(value, label) {
  nonEmptyString(value, label)
  const normalized = value.replace(/\\/gu, '/').replace(/^\.\//u, '')
  if (
    normalized.length > MAXIMUM_LOGICAL_PATH_CHARS ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized)
  ) {
    throw new TypeError(`${label} must be a confined logical path`)
  }
  const parts = []
  for (const part of normalized.split('/')) {
    if (part.length === 0 || part === '.') continue
    if (part === '..') throw new TypeError(`${label} must not escape the subject namespace`)
    parts.push(part)
  }
  if (parts.length === 0) throw new TypeError(`${label} must name a logical path`)
  return parts.join('/')
}

function validateRequest(request) {
  const value = recordOf(request)
  if (value === undefined) throw new TypeError('map preview preparation request must be an object')
  const subject = recordOf(value.subject)
  if (subject?.schemaVersion !== 1) {
    throw new TypeError('map preview preparation requires a versioned subject')
  }
  nonEmptyString(subject.subjectUri, 'subject.subjectUri')
  nonEmptyString(subject.revision, 'subject.revision')
  nonEmptyString(subject.formatId, 'subject.formatId')
  if (!Array.isArray(subject.traits)) throw new TypeError('subject.traits must be an array')
  if (!Array.isArray(subject.dataSources)) {
    throw new TypeError('subject.dataSources must be an array')
  }
  if (!Array.isArray(subject.operations)) throw new TypeError('subject.operations must be an array')
  const maxCandidates = positiveLimit(value.maxCandidates, 'maxCandidates', MAXIMUM_CANDIDATES)
  const maxRoots = positiveLimit(value.maxRoots, 'maxRoots', MAXIMUM_ROOTS)
  const maxDepth = positiveLimit(value.maxDepth, 'maxDepth', MAXIMUM_DEPTH)
  if (value.selectionId !== undefined && typeof value.selectionId !== 'string') {
    throw new TypeError('selectionId must be an opaque string when supplied')
  }
  return { ...value, subject, maxCandidates, maxRoots, maxDepth }
}

function validateNamespace(subject) {
  const namespace = recordOf(subject.namespace)
  if (
    namespace === undefined ||
    !['unavailable', 'complete', 'truncated'].includes(String(namespace.state)) ||
    !Array.isArray(namespace.entries)
  ) {
    throw new TypeError('subject.namespace must be a bounded namespace index')
  }
  if (namespace.entries.length > MAXIMUM_NAMESPACE_ENTRIES) {
    return Object.freeze({
      state: 'over-budget',
      entries: Object.freeze([]),
      observed: namespace.entries.length,
    })
  }
  const entries = namespace.entries.map((entry, index) => {
    const item = recordOf(entry)
    if (
      item === undefined ||
      typeof item.path !== 'string' ||
      (item.kind !== 'file' && item.kind !== 'directory') ||
      (item.size !== undefined &&
        (typeof item.size !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(item.size)))
    ) {
      throw new TypeError(`subject.namespace.entries[${index}] is malformed`)
    }
    return item
  })
  return Object.freeze({
    state: namespace.state,
    entries: Object.freeze(entries),
    observed: entries.length,
  })
}

function hasNamespaceSource(subject) {
  return subject.dataSources.some(item => {
    const value = recordOf(item)
    return value?.contract === 'common.view/namespace-entry-source' && value.major === 1
  })
}

function hasEntryExtraction(subject) {
  return subject.operations.some(item => {
    const value = recordOf(item)
    return value?.id === 'container.extract' && value.state === 'available'
  })
}

function hashText(value) {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

function discoverCandidates(subject, namespace) {
  const byFoldedRoot = new Map()
  let refusedPaths = 0
  for (const entry of namespace.entries) {
    if (entry.kind !== 'file') continue
    let path
    try {
      path = normalizeLogicalPath(entry.path, 'namespace entry path')
    } catch {
      refusedPaths += 1
      continue
    }
    const match = /^multiplay\/maps\/([^/]+)\/game\.map$/u.exec(path)
    if (match === null) continue
    const root = path.slice(0, -'/game.map'.length)
    const foldedRoot = root.toLowerCase()
    const previous = byFoldedRoot.get(foldedRoot)
    if (
      previous !== undefined &&
      (previous.root !== root || previous.observedPath !== entry.path)
    ) {
      return Object.freeze({ state: 'collision', candidates: Object.freeze([]), refusedPaths })
    }
    byFoldedRoot.set(foldedRoot, { root, observedPath: entry.path })
  }
  const candidates = [...byFoldedRoot.values()]
    .map(item => item.root)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map(root => {
      const mapId = root.split('/').at(-1)
      return Object.freeze({
        candidateId: `wz-map:${hashText(`${subject.revision}\0${root}`)}`,
        displayName: mapId,
        sourcePath: root,
      })
    })
  if (new Set(candidates.map(item => item.candidateId)).size !== candidates.length) {
    return Object.freeze({ state: 'collision', candidates: Object.freeze([]), refusedPaths })
  }
  return Object.freeze({ state: 'complete', candidates: Object.freeze(candidates), refusedPaths })
}

function archiveLocator(archiveName, openedSubjectPolicy) {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'game-installation-archive',
    gameId: GAME_ID,
    archiveRelativePaths: Object.freeze([`data/${archiveName}`, archiveName]),
    openedSubjectPolicy,
  })
}

function preparedPlan(candidate) {
  const workspaceId = `warzone-preview-${hashText(candidate.candidateId)}`
  return Object.freeze({
    schemaVersion: 1,
    workspace: Object.freeze({
      workspaceId,
      gameId: GAME_ID,
      activeRootId: 'map',
      sources: Object.freeze([
        Object.freeze({
          sourceId: 'warzone-opened-subject',
          kind: 'warzone-wz-subject',
          location: 'map-preview:opened-subject',
        }),
        Object.freeze({
          sourceId: 'warzone-multiplayer-content',
          kind: 'warzone-multiplayer-package',
          location: 'map-preview:host-resolved-mp',
        }),
        Object.freeze({
          sourceId: 'warzone-installation',
          kind: 'warzone-installation',
          location: 'map-preview:host-resolved-installation',
        }),
      ]),
      roots: Object.freeze([
        Object.freeze({
          rootId: 'base',
          sourceId: 'warzone-installation',
          sourcePath: 'base',
          displayName: 'Warzone 2100 base.wz',
          kind: 'warzone-package',
          dependencies: Object.freeze([]),
        }),
        Object.freeze({
          rootId: 'mp',
          sourceId: 'warzone-multiplayer-content',
          sourcePath: 'mp',
          displayName: 'Warzone 2100 mp.wz',
          kind: 'warzone-package',
          dependencies: Object.freeze([
            Object.freeze({
              targetRootId: 'base',
              ref: 'base.wz',
              required: true,
              provenance: 'implicit',
            }),
          ]),
        }),
        Object.freeze({
          rootId: 'map',
          sourceId: 'warzone-opened-subject',
          sourcePath: candidate.sourcePath,
          displayName: candidate.displayName,
          kind: 'warzone-map',
          dependencies: Object.freeze([
            Object.freeze({
              targetRootId: 'mp',
              ref: 'mp.wz',
              required: true,
              provenance: 'implicit',
            }),
          ]),
        }),
      ]),
      maxRoots: REQUIRED_ROOTS,
      maxDepth: REQUIRED_DEPTH,
    }),
    resources: Object.freeze({
      schemaVersion: 1,
      strategy: 'host-resolved',
      resolverId: WARZONE_MAP_PREVIEW_RESOLVER_ID,
      subjectNamespaceRoots: Object.freeze([
        Object.freeze({ rootId: 'map', namespacePrefix: candidate.sourcePath }),
      ]),
      roots: Object.freeze([
        Object.freeze({
          rootId: 'mp',
          locator: archiveLocator('mp.wz', 'prefer-matching-opened-subject'),
        }),
        Object.freeze({
          rootId: 'base',
          locator: archiveLocator('base.wz', 'installation-only'),
        }),
      ]),
    }),
  })
}

export async function prepareWarzoneMapPreview(request) {
  request?.signal?.throwIfAborted()
  const value = validateRequest(request)
  if (value.subject.formatId !== SUBJECT_FORMAT_ID) {
    return Object.freeze({
      state: 'not-applicable',
      diagnostics: Object.freeze([
        diagnostic(
          'information',
          'org.modkitx.opensource.warzone2100/map-preview-format-not-applicable',
          `Warzone map preparation does not inspect ${value.subject.formatId}`,
        ),
      ]),
    })
  }
  if (!hasNamespaceSource(value.subject)) {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          'org.modkitx.opensource.warzone2100/map-preview-namespace-unavailable',
          'Warzone map preparation requires a bounded namespace-entry source',
        ),
      ]),
    })
  }
  if (!hasEntryExtraction(value.subject)) {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          'org.modkitx.opensource.warzone2100/map-preview-extraction-unavailable',
          'the opened Warzone package cannot extract the selected map files',
        ),
      ]),
    })
  }
  const namespace = validateNamespace(value.subject)
  if (namespace.state === 'over-budget') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          'org.modkitx.opensource.warzone2100/map-preview-namespace-budget-exceeded',
          `subject namespace contains ${namespace.observed} entries but the provider admits at most ${MAXIMUM_NAMESPACE_ENTRIES}`,
          { observed: namespace.observed, maximum: MAXIMUM_NAMESPACE_ENTRIES },
        ),
      ]),
    })
  }
  if (namespace.state !== 'complete') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        diagnostic(
          'warning',
          'org.modkitx.opensource.warzone2100/map-preview-namespace-incomplete',
          `Warzone map selection requires a complete bounded namespace index; received ${namespace.state}`,
          { namespaceState: namespace.state },
        ),
      ]),
    })
  }
  const discovered = discoverCandidates(value.subject, namespace)
  if (discovered.state === 'collision') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          'org.modkitx.opensource.warzone2100/map-preview-candidate-collision',
          'map candidates could not be assigned unique opaque ids without guessing',
        ),
      ]),
    })
  }
  const findings =
    discovered.refusedPaths === 0
      ? []
      : [
          diagnostic(
            'warning',
            'org.modkitx.opensource.warzone2100/map-preview-namespace-paths-refused',
            `${discovered.refusedPaths} unsafe or malformed namespace path(s) were ignored`,
            { refusedPaths: discovered.refusedPaths },
          ),
        ]
  if (discovered.candidates.length > value.maxCandidates) {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...findings,
        diagnostic(
          'error',
          'org.modkitx.opensource.warzone2100/map-preview-candidate-budget-exceeded',
          `found ${discovered.candidates.length} map roots but maxCandidates is ${value.maxCandidates}`,
          { observed: discovered.candidates.length, maximum: value.maxCandidates },
        ),
      ]),
    })
  }
  const selected =
    value.selectionId === undefined
      ? undefined
      : discovered.candidates.find(candidate => candidate.candidateId === value.selectionId)
  if (value.selectionId !== undefined && selected === undefined) {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...findings,
        diagnostic(
          'error',
          'org.modkitx.opensource.warzone2100/map-preview-selection-invalid',
          'selectionId does not name a candidate in this exact subject revision',
        ),
      ]),
    })
  }
  if (discovered.candidates.length === 0) {
    return Object.freeze({
      state: 'not-applicable',
      diagnostics: Object.freeze([
        ...findings,
        diagnostic(
          'information',
          'org.modkitx.opensource.warzone2100/map-preview-map-absent',
          'the complete Warzone package namespace contains no multiplay/maps/<id>/game.map',
        ),
      ]),
    })
  }
  if (selected === undefined && discovered.candidates.length > 1) {
    return Object.freeze({
      state: 'selection-required',
      candidates: discovered.candidates,
      diagnostics: Object.freeze(findings),
    })
  }
  if (value.maxRoots < REQUIRED_ROOTS || value.maxDepth < REQUIRED_DEPTH) {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...findings,
        diagnostic(
          'error',
          'org.modkitx.opensource.warzone2100/map-preview-workspace-budget-exceeded',
          `Warzone map preparation requires ${REQUIRED_ROOTS} roots and dependency depth ${REQUIRED_DEPTH}`,
          {
            requiredRoots: REQUIRED_ROOTS,
            requiredDepth: REQUIRED_DEPTH,
            maxRoots: value.maxRoots,
            maxDepth: value.maxDepth,
          },
        ),
      ]),
    })
  }
  const active = selected ?? discovered.candidates[0]
  return Object.freeze({
    state: 'prepared',
    plan: preparedPlan(active),
    diagnostics: Object.freeze([
      ...findings,
      diagnostic(
        'information',
        'org.modkitx.opensource.warzone2100/map-preview-external-resolver-required',
        `base.wz and mp.wz require host resolver ${WARZONE_MAP_PREVIEW_RESOLVER_ID}; no live capability crossed the preparation ABI`,
        { resolverId: WARZONE_MAP_PREVIEW_RESOLVER_ID },
      ),
    ]),
  })
}

export const abiVersion = 1
export const provides = Object.freeze([MAP_PREVIEW_PREPARATION_CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== MAP_PREVIEW_PREPARATION_CONTRACT || selection.major !== 1) {
    throw new TypeError(
      `unsupported Warzone map-preview preparation selection ${selection.contract}@${selection.major}`,
    )
  }
  return Object.freeze({
    value: Object.freeze({
      contract: MAP_PREVIEW_PREPARATION_CONTRACT,
      preparationId: WARZONE_MAP_PREVIEW_PREPARATION_ID,
      subjectFormatIds: Object.freeze([SUBJECT_FORMAT_ID]),
      prepare: prepareWarzoneMapPreview,
    }),
    release: async () => undefined,
  })
}
