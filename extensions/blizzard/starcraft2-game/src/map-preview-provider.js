import { MAP_PREVIEW_PREPARATION_CONTRACT } from '@modkitx-x3/sdk/maps'

const GAME_ID = 'org.modkitx/starcraft-2'
const CASC_FORMAT_ID = 'casc'
const PACKED_MAP_FORMAT_ID = 'sc2-map'
const SUBJECT_FORMAT_IDS = Object.freeze([CASC_FORMAT_ID, PACKED_MAP_FORMAT_ID])
const MAXIMUM_CANDIDATES = 256
const MAXIMUM_ROOTS = 64
const MAXIMUM_DEPTH = 128
const MAXIMUM_NAMESPACE_ENTRIES = 20_000
const MAXIMUM_LOGICAL_PATH_CHARS = 4_096
const REQUIRED_ROOTS = 1
const REQUIRED_DEPTH = 1

const REQUIRED_DOCUMENTS = Object.freeze({
  objects: new Set(['objects', 'mapobjects']),
  regions: new Set(['regions']),
  terrain: new Set(['t3heightmap', 'mapheightmap']),
})
const NAMESPACE_MARKER_SEARCH_ID = 'sc2-map-marker-documents'
const NAMESPACE_MARKER_BASENAMES = Object.freeze(
  [...new Set(Object.values(REQUIRED_DOCUMENTS).flatMap(names => [...names]))].sort(),
)

export const STARCRAFT2_MAP_PREVIEW_PREPARATION_ID = 'org.modkitx.blizzard.starcraft2.map-preview'

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
    parts.push(part.toLowerCase())
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

function validateNamespaceSearches(subject) {
  if (subject.namespaceSearches === undefined) return Object.freeze([])
  if (!Array.isArray(subject.namespaceSearches) || subject.namespaceSearches.length > 8) {
    throw new TypeError('subject.namespaceSearches must be a bounded array when supplied')
  }
  let observed = 0
  const searches = subject.namespaceSearches.map((search, searchIndex) => {
    const value = recordOf(search)
    if (
      value === undefined ||
      !Object.keys(value).every(
        key => key === 'searchId' || key === 'state' || key === 'entries',
      ) ||
      typeof value.searchId !== 'string' ||
      value.searchId.length === 0 ||
      value.searchId.length > 512 ||
      value.searchId.includes('\0') ||
      !['unsupported', 'complete', 'truncated'].includes(String(value.state)) ||
      !Array.isArray(value.entries)
    ) {
      throw new TypeError(`subject.namespaceSearches[${searchIndex}] is malformed`)
    }
    const entries = value.entries.map((entry, entryIndex) => {
      const item = recordOf(entry)
      if (
        item === undefined ||
        !Object.keys(item).every(key => key === 'path' || key === 'kind' || key === 'size') ||
        typeof item.path !== 'string' ||
        (item.kind !== 'file' && item.kind !== 'directory') ||
        (item.size !== undefined &&
          (typeof item.size !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(item.size)))
      ) {
        throw new TypeError(
          `subject.namespaceSearches[${searchIndex}].entries[${entryIndex}] is malformed`,
        )
      }
      observed += 1
      if (observed > MAXIMUM_NAMESPACE_ENTRIES) {
        throw new TypeError('subject.namespaceSearches exceed the provider entry budget')
      }
      return item
    })
    return Object.freeze({
      searchId: value.searchId,
      state: value.state,
      entries: Object.freeze(entries),
    })
  })
  if (new Set(searches.map(search => search.searchId)).size !== searches.length) {
    throw new TypeError('subject.namespaceSearches contains duplicate searchId values')
  }
  return Object.freeze(searches)
}

function mergeNamespaceEntries(...groups) {
  const byIdentity = new Map()
  for (const entries of groups) {
    for (const entry of entries) {
      let identity
      try {
        identity = `${normalizeLogicalPath(entry.path, 'namespace entry path')}\0${entry.kind}`
      } catch {
        identity = `${entry.path}\0${entry.kind}`
      }
      if (!byIdentity.has(identity)) byIdentity.set(identity, entry)
    }
  }
  return Object.freeze([...byIdentity.values()])
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

function packedMapDisplayName(subject) {
  const tail = subject.subjectUri.split(/[\\/]/u).at(-1)?.split(/[?#]/u)[0] ?? ''
  if (/\.sc2map$/iu.test(tail)) {
    try {
      return decodeURIComponent(tail)
    } catch {
      return tail
    }
  }
  return 'Opened SC2Map'
}

function documentRole(name) {
  for (const [role, names] of Object.entries(REQUIRED_DOCUMENTS)) {
    if (names.has(name)) return role
  }
  return undefined
}

function discoverCandidates(subject, namespace) {
  const markersByRoot = new Map()
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
    const slash = path.lastIndexOf('/')
    const root = slash === -1 ? '' : path.slice(0, slash)
    const role = documentRole(slash === -1 ? path : path.slice(slash + 1))
    if (role === undefined) continue
    if (subject.formatId === CASC_FORMAT_ID && !root.endsWith('.sc2map')) continue
    if (subject.formatId === PACKED_MAP_FORMAT_ID && root.length > 0 && !root.endsWith('.sc2map')) {
      continue
    }
    const markers = markersByRoot.get(root) ?? new Set()
    markers.add(role)
    markersByRoot.set(root, markers)
  }

  const candidates = [...markersByRoot.entries()]
    .filter(([, markers]) => Object.keys(REQUIRED_DOCUMENTS).every(role => markers.has(role)))
    .map(([namespacePrefix]) => {
      const identityRoot = namespacePrefix.length === 0 ? '<namespace-root>' : namespacePrefix
      const candidateId = `sc2-map:${hashText(
        `${subject.revision}\0${subject.formatId}\0${identityRoot}`,
      )}`
      const standalone = subject.formatId === PACKED_MAP_FORMAT_ID && namespacePrefix.length === 0
      const sourcePath = standalone
        ? `opened/${hashText(`${subject.revision}\0${subject.subjectUri}`)}.sc2map`
        : namespacePrefix
      return Object.freeze({
        candidateId,
        displayName: standalone
          ? packedMapDisplayName(subject)
          : (namespacePrefix.split('/').at(-1) ?? 'SC2Map'),
        sourcePath,
        namespacePrefix,
      })
    })
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, 'en'))

  if (new Set(candidates.map(item => item.candidateId)).size !== candidates.length) {
    return Object.freeze({ state: 'collision', candidates: Object.freeze([]), refusedPaths })
  }
  return Object.freeze({ state: 'complete', candidates: Object.freeze(candidates), refusedPaths })
}

function selectionCandidates(candidates) {
  return Object.freeze(
    candidates.map(candidate =>
      Object.freeze({
        candidateId: candidate.candidateId,
        displayName: candidate.displayName,
        sourcePath: candidate.sourcePath,
      }),
    ),
  )
}

function preparedPlan(subject, candidate) {
  return Object.freeze({
    schemaVersion: 1,
    workspace: Object.freeze({
      workspaceId: `starcraft2-preview-${hashText(candidate.candidateId)}`,
      gameId: GAME_ID,
      activeRootId: 'map',
      sources: Object.freeze([
        Object.freeze({
          sourceId: 'starcraft2-opened-subject',
          kind: `${subject.formatId}-subject`,
          location: 'map-preview:opened-subject',
        }),
      ]),
      roots: Object.freeze([
        Object.freeze({
          rootId: 'map',
          sourceId: 'starcraft2-opened-subject',
          sourcePath: candidate.sourcePath,
          displayName: candidate.displayName,
          kind: 'map',
          dependencies: Object.freeze([]),
        }),
      ]),
      maxRoots: REQUIRED_ROOTS,
      maxDepth: REQUIRED_DEPTH,
    }),
    resources: Object.freeze({
      schemaVersion: 1,
      strategy: 'subject-namespace',
      roots: Object.freeze([
        Object.freeze({ rootId: 'map', namespacePrefix: candidate.namespacePrefix }),
      ]),
    }),
  })
}

export async function prepareStarcraft2MapPreview(request) {
  request?.signal?.throwIfAborted()
  const value = validateRequest(request)
  if (!SUBJECT_FORMAT_IDS.includes(value.subject.formatId)) {
    return Object.freeze({
      state: 'not-applicable',
      diagnostics: Object.freeze([
        diagnostic(
          'information',
          'org.modkitx.blizzard.starcraft2/map-preview-format-not-applicable',
          `StarCraft II map preparation does not inspect ${value.subject.formatId}`,
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
          'org.modkitx.blizzard.starcraft2/map-preview-namespace-unavailable',
          'StarCraft II map preparation requires a bounded namespace-entry source',
        ),
      ]),
    })
  }
  if (!hasEntryExtraction(value.subject)) {
    const standalone = value.subject.formatId === PACKED_MAP_FORMAT_ID
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          standalone
            ? 'org.modkitx.blizzard.starcraft2/map-preview-standalone-extraction-unavailable'
            : 'org.modkitx.blizzard.starcraft2/map-preview-extraction-unavailable',
          standalone
            ? 'the current packed SC2Map codec lists entries but does not expose container.extract; compressed MPQ document extraction remains a named remainder'
            : 'the opened CASC subject does not expose the container.extract operation required by the map resource session',
        ),
      ]),
    })
  }

  const namespace = validateNamespace(value.subject)
  const namespaceSearches = validateNamespaceSearches(value.subject)
  if (namespace.state === 'over-budget') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          'org.modkitx.blizzard.starcraft2/map-preview-namespace-budget-exceeded',
          `subject namespace contains ${namespace.observed} entries but the provider admits at most ${MAXIMUM_NAMESPACE_ENTRIES}`,
          { observed: namespace.observed, maximum: MAXIMUM_NAMESPACE_ENTRIES },
        ),
      ]),
    })
  }
  if (namespace.state === 'unavailable') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        diagnostic(
          'warning',
          'org.modkitx.blizzard.starcraft2/map-preview-namespace-unavailable',
          'the opened subject did not provide namespace facts for SC2 map-root discovery',
        ),
      ]),
    })
  }

  const markerSearch = namespaceSearches.find(
    search => search.searchId === NAMESPACE_MARKER_SEARCH_ID,
  )
  if (value.subject.formatId === CASC_FORMAT_ID && namespace.state === 'truncated') {
    if (markerSearch === undefined) {
      return Object.freeze({
        state: 'namespace-search-required',
        searches: Object.freeze([
          Object.freeze({
            searchId: NAMESPACE_MARKER_SEARCH_ID,
            query: Object.freeze({
              kind: 'basename-any',
              basenames: NAMESPACE_MARKER_BASENAMES,
              caseSensitive: false,
            }),
          }),
        ]),
        diagnostics: Object.freeze([
          diagnostic(
            'information',
            'org.modkitx.blizzard.starcraft2/map-preview-indexed-marker-search-required',
            'the bounded CASC root listing is incomplete; requesting one bounded host-owned basename search for map marker documents',
          ),
        ]),
      })
    }
    if (markerSearch.state === 'unsupported') {
      return Object.freeze({
        state: 'unresolved',
        diagnostics: Object.freeze([
          diagnostic(
            'warning',
            'org.modkitx.blizzard.starcraft2/map-preview-indexed-marker-search-unsupported',
            'the CASC namespace does not provide the indexed basename search required for bounded map discovery',
          ),
        ]),
      })
    }
  }

  const discoveryNamespace =
    value.subject.formatId === CASC_FORMAT_ID && namespace.state === 'truncated' && markerSearch
      ? Object.freeze({
          state: markerSearch.state,
          entries: mergeNamespaceEntries(namespace.entries, markerSearch.entries),
        })
      : namespace

  const discovered = discoverCandidates(value.subject, discoveryNamespace)
  if (discovered.state === 'collision') {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          'org.modkitx.blizzard.starcraft2/map-preview-candidate-collision',
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
            'org.modkitx.blizzard.starcraft2/map-preview-namespace-paths-refused',
            `${discovered.refusedPaths} unsafe or malformed namespace path(s) were ignored`,
            { refusedPaths: discovered.refusedPaths },
          ),
        ]
  const offeredCandidates = discovered.candidates.slice(0, value.maxCandidates)
  const candidateListTruncated = offeredCandidates.length < discovered.candidates.length
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
          'org.modkitx.blizzard.starcraft2/map-preview-selection-invalid',
          'selectionId does not name a fully observed map root in this exact subject revision',
        ),
      ]),
    })
  }
  if (discovered.candidates.length === 0) {
    return Object.freeze({
      state: discoveryNamespace.state === 'complete' ? 'not-applicable' : 'unresolved',
      diagnostics: Object.freeze([
        ...findings,
        diagnostic(
          discoveryNamespace.state === 'complete' ? 'information' : 'warning',
          discoveryNamespace.state === 'complete'
            ? 'org.modkitx.blizzard.starcraft2/map-preview-map-absent'
            : 'org.modkitx.blizzard.starcraft2/map-preview-namespace-truncated-prefix-discovery-required',
          discoveryNamespace.state === 'complete'
            ? 'the complete subject namespace contains no root with Objects, Regions and t3HeightMap documents'
            : 'the bounded CASC root listing ended before any complete SC2 map root was proved; the host must add a bounded prefix-discovery round before retrying preparation',
          ...(discoveryNamespace.state === 'complete'
            ? []
            : [{ namespaceState: discoveryNamespace.state }]),
        ),
      ]),
    })
  }
  if (
    selected === undefined &&
    (discoveryNamespace.state === 'truncated' || discovered.candidates.length > 1)
  ) {
    return Object.freeze({
      state: 'selection-required',
      candidates: selectionCandidates(offeredCandidates),
      diagnostics: Object.freeze([
        ...findings,
        ...(candidateListTruncated
          ? [
              diagnostic(
                'warning',
                'org.modkitx.blizzard.starcraft2/map-preview-candidate-list-truncated',
                `found ${discovered.candidates.length} map roots; this bounded selection page exposes the first ${offeredCandidates.length} stable candidates without choosing one`,
                {
                  observed: discovered.candidates.length,
                  offered: offeredCandidates.length,
                },
              ),
            ]
          : []),
        ...(discoveryNamespace.state === 'truncated'
          ? [
              diagnostic(
                'warning',
                'org.modkitx.blizzard.starcraft2/map-preview-namespace-truncated-selection-required',
                'the bounded CASC listing may omit other maps; an observed root must be selected explicitly and is never guessed, while broader choices require a bounded host prefix-discovery round',
                { namespaceState: discoveryNamespace.state },
              ),
            ]
          : []),
      ]),
    })
  }
  if (value.maxRoots < REQUIRED_ROOTS || value.maxDepth < REQUIRED_DEPTH) {
    return Object.freeze({
      state: 'unresolved',
      diagnostics: Object.freeze([
        ...findings,
        diagnostic(
          'error',
          'org.modkitx.blizzard.starcraft2/map-preview-workspace-budget-exceeded',
          `StarCraft II map preparation requires ${REQUIRED_ROOTS} root and dependency depth ${REQUIRED_DEPTH}`,
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
    plan: preparedPlan(value.subject, active),
    diagnostics: Object.freeze([
      ...findings,
      ...(discoveryNamespace.state === 'truncated'
        ? [
            diagnostic(
              'warning',
              'org.modkitx.blizzard.starcraft2/map-preview-truncated-selection-confirmed',
              'the selected map root is accepted because all required documents were observed; unseen CASC roots were not inferred',
            ),
          ]
        : []),
      diagnostic(
        'information',
        'org.modkitx.blizzard.starcraft2/map-preview-dependency-resolver-remainder',
        'map documents are mounted from the selected root; DocumentInfo dependency closure and installed catalog, model and material resolution remain a named follow-up',
      ),
    ]),
  })
}

export const abiVersion = 1
export const provides = Object.freeze([MAP_PREVIEW_PREPARATION_CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== MAP_PREVIEW_PREPARATION_CONTRACT || selection.major !== 1) {
    throw new TypeError(
      `unsupported StarCraft II map-preview preparation selection ${selection.contract}@${selection.major}`,
    )
  }
  return Object.freeze({
    value: Object.freeze({
      contract: MAP_PREVIEW_PREPARATION_CONTRACT,
      preparationId: STARCRAFT2_MAP_PREVIEW_PREPARATION_ID,
      subjectFormatIds: SUBJECT_FORMAT_IDS,
      prepare: prepareStarcraft2MapPreview,
    }),
    release: async () => undefined,
  })
}
