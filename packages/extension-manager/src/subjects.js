import { nestedSubject, rootSubject, serializeSubjectRef } from '@modkit/sdk/subjects'

import { ExtensionManagerError } from './schema.js'
import { normalizeGameSubjectProfile, normalizeVendorSubjectProfile } from './subject-profiles.js'

export const EXTENSION_SUBJECT_KIND = 'modkit/extension'
export const CONTRIBUTION_SUBJECT_KIND = 'modkit/contribution'
export const VENDOR_SUBJECT_KIND = 'modkit/vendor'
export const GAME_SUBJECT_KIND = 'modkit/game'

function fail(message, context = {}) {
  throw new ExtensionManagerError('extension-manager/subject-projection-invalid', message, context)
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function optionalText(value, label) {
  return value === undefined ? undefined : requiredText(value, label)
}

function snapshotJson(value, label, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} must contain only finite JSON numbers`)
    return value
  }
  if (typeof value !== 'object') fail(`${label} must contain only JSON values`)
  if (seen.has(value)) fail(`${label} must not contain cycles`)
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((item, index) => snapshotJson(item, `${label}[${index}]`, seen)),
      )
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      fail(`${label} must contain only plain JSON objects`)
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      fail(`${label} must not contain symbol properties`)
    }
    const result = {}
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || !('value' in descriptor)) {
        fail(`${label}.${key} must be an enumerable data property`)
      }
      result[key] = snapshotJson(descriptor.value, `${label}.${key}`, seen)
    }
    return Object.freeze(result)
  } finally {
    seen.delete(value)
  }
}

function contractCoordinate(contract, label) {
  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
    fail(`${label}.contract must be an object`)
  }
  const id = requiredText(contract.id, `${label}.contract.id`)
  if (!Number.isSafeInteger(contract.major) || contract.major < 0) {
    fail(`${label}.contract.major must be a non-negative safe integer`)
  }
  return Object.freeze({ id, major: contract.major })
}

function contractKey(contract) {
  return `${contract.id}@${contract.major}`
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareContribution(left, right) {
  return compareText(left.displayName, right.displayName) || compareText(left.id, right.id)
}

function throwIfAborted(signal) {
  signal?.throwIfAborted()
}

function page(items, request, signal) {
  throwIfAborted(signal)
  if (!Number.isSafeInteger(request?.limit) || request.limit <= 0) {
    fail('page limit must be a positive safe integer')
  }
  let offset = 0
  if (request.cursor !== undefined) {
    if (!/^(?:0|[1-9]\d*)$/u.test(request.cursor)) fail('page cursor is invalid')
    offset = Number(request.cursor)
    if (!Number.isSafeInteger(offset)) fail('page cursor is outside the safe integer range')
  }
  const selected = items.slice(offset, offset + request.limit)
  const nextOffset = offset + selected.length
  return Object.freeze({
    items: Object.freeze(selected),
    ...(nextOffset < items.length ? { nextCursor: String(nextOffset) } : {}),
  })
}

function fact(id, label, value, provenance) {
  return Object.freeze({ id, label, value, provenance })
}

function factsSource({
  snapshotId,
  subjectId,
  label,
  kind,
  type,
  groups,
  facts,
  relations,
  origin,
}) {
  const summary = Object.freeze({
    snapshotId,
    identity: Object.freeze({
      subjectId,
      label,
      kind,
      ...(type === undefined ? {} : { type }),
      origins: origin,
    }),
    groupCount: groups.length,
    relationCount: relations.length,
  })
  const factsByGroup = new Map(facts.map(entry => [entry.groupId, entry.items]))
  return Object.freeze({
    async summary(signal) {
      throwIfAborted(signal)
      return summary
    },
    async groups(request, signal) {
      return page(groups, request, signal)
    },
    async facts(groupId, request, signal) {
      const items = factsByGroup.get(groupId)
      if (items === undefined) fail(`unknown subject fact group «${groupId}»`, { groupId })
      return page(items, request, signal)
    },
    async relations(request, signal) {
      return page(relations, request, signal)
    },
  })
}

function group(id, label, items) {
  return Object.freeze({ id, label, factCount: items.length })
}

function relation(role, record) {
  return Object.freeze({
    role,
    subjectId: record.subjectId,
    label: record.displayName,
    kind: record.kind,
  })
}

function extensionPresentationFacts(presentation, provenance) {
  const vendor = presentation.vendor?.displayName
  const games = presentation.games?.map(game => game.displayName).join(', ')
  const source =
    presentation.source?.kind === 'root'
      ? presentation.source.root
      : presentation.source?.kind === 'url'
        ? presentation.source.url
        : undefined
  const licenses = presentation.licenseFiles?.map(item => item.displayName ?? item.path).join(', ')
  return [
    ...(vendor === undefined ? [] : [fact('vendor', 'Vendor', vendor, provenance)]),
    ...(games === undefined || games === '' ? [] : [fact('games', 'Games', games, provenance)]),
    ...(source === undefined ? [] : [fact('source-details', 'Source details', source, provenance)]),
    ...(licenses === undefined || licenses === ''
      ? []
      : [fact('license-files', 'License files', licenses, provenance)]),
  ]
}

async function collectPages(openPage, signal) {
  const items = []
  const cursors = new Set()
  let cursor
  do {
    throwIfAborted(signal)
    const result = await openPage(
      { ...(cursor === undefined ? {} : { cursor }), limit: 256 },
      signal,
    )
    if (result === null || typeof result !== 'object' || !Array.isArray(result.items)) {
      fail('subject facts source returned an invalid page')
    }
    items.push(...result.items)
    if (items.length > 100_000) fail('subject card exceeds the 100000 item wire limit')
    cursor = result.nextCursor
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || cursors.has(cursor)) {
        fail('subject facts source returned an invalid or repeated cursor')
      }
      cursors.add(cursor)
    }
  } while (cursor !== undefined)
  return items
}

/** Creates a function-free JSON document suitable for Webview, worker and RPC boundaries. */
export async function subjectRecordToWire(record, signal) {
  if (record === null || typeof record !== 'object' || record.facts === undefined) {
    fail('subject record must provide facts')
  }
  const summary = await record.facts.summary(signal)
  const groups = await collectPages(
    (request, pageSignal) => record.facts.groups(request, pageSignal),
    signal,
  )
  const wireGroups = []
  for (const groupDescriptor of groups) {
    const groupFacts = await collectPages(
      (request, pageSignal) => record.facts.facts(groupDescriptor.id, request, pageSignal),
      signal,
    )
    wireGroups.push(Object.freeze({ ...groupDescriptor, facts: Object.freeze(groupFacts) }))
  }
  const relations = await collectPages(
    (request, pageSignal) => record.facts.relations(request, pageSignal),
    signal,
  )
  const subject = {
    kind: record.kind,
    subjectId: record.subjectId,
    id: record.id,
    displayName: record.displayName,
    ...('enabled' in record ? { enabled: record.enabled } : {}),
    ...('version' in record ? { version: record.version } : {}),
    ...('extensionId' in record ? { extensionId: record.extensionId } : {}),
    ...('contract' in record ? { contract: record.contract, contractKey: record.contractKey } : {}),
    ...('effectiveEnabled' in record ? { effectiveEnabled: record.effectiveEnabled } : {}),
    ...('presentation' in record && record.presentation !== undefined
      ? { presentation: record.presentation }
      : {}),
    ...('contributions' in record ? { contributions: record.contributions } : {}),
    ...('profile' in record ? { profile: record.profile } : {}),
    ...('resources' in record ? { resources: record.resources } : {}),
  }
  return snapshotJson(
    {
      schemaVersion: 1,
      subject,
      summary,
      groups: wireGroups,
      relations,
    },
    'extension subject card wire document',
  )
}

/** Backward-compatible name retained for extension/contribution callers. */
export async function extensionSubjectRecordToWire(record, signal) {
  return subjectRecordToWire(record, signal)
}

/** Restores the neutral facts ABI from an inert card document received across a process boundary. */
export function subjectFactsSourceFromWire(value) {
  const document = snapshotJson(value, 'extension subject card wire document')
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    fail('extension subject card wire document must be an object')
  }
  if (document.schemaVersion !== 1) {
    fail('extension subject card wire schemaVersion must be 1')
  }
  if (
    document.summary === null ||
    typeof document.summary !== 'object' ||
    Array.isArray(document.summary)
  ) {
    fail('extension subject card wire summary must be an object')
  }
  if (!Array.isArray(document.groups) || !Array.isArray(document.relations)) {
    fail('extension subject card wire groups and relations must be lists')
  }
  const ids = new Set()
  const groups = []
  const entries = []
  for (const [index, wireGroup] of document.groups.entries()) {
    if (wireGroup === null || typeof wireGroup !== 'object' || Array.isArray(wireGroup)) {
      fail(`extension subject card wire groups[${index}] must be an object`)
    }
    const id = requiredText(wireGroup.id, `groups[${index}].id`)
    if (ids.has(id)) fail(`subject fact group «${id}» is duplicated`, { groupId: id })
    ids.add(id)
    const label = requiredText(wireGroup.label, `groups[${index}].label`)
    if (!Array.isArray(wireGroup.facts)) fail(`groups[${index}].facts must be a list`)
    if (wireGroup.factCount !== wireGroup.facts.length) {
      fail(`groups[${index}].factCount does not match its facts list`)
    }
    groups.push(Object.freeze({ id, label, factCount: wireGroup.factCount }))
    entries.push(Object.freeze({ groupId: id, items: wireGroup.facts }))
  }
  if (document.summary.groupCount !== groups.length) {
    fail('extension subject card wire summary.groupCount does not match its groups')
  }
  if (document.summary.relationCount !== document.relations.length) {
    fail('extension subject card wire summary.relationCount does not match its relations')
  }
  return factsSource({
    snapshotId: document.summary.snapshotId,
    subjectId: document.summary.identity?.subjectId,
    label: document.summary.identity?.label,
    kind: document.summary.identity?.kind,
    type: document.summary.identity?.type,
    groups: Object.freeze(groups),
    facts: Object.freeze(entries),
    relations: document.relations,
    origin: document.summary.identity?.origins ?? Object.freeze([]),
  })
}

function contributionFacts(manifest, ownerId, enabled, effectiveEnabled, provenance) {
  const formatLabels = Array.isArray(manifest.spec?.formatRefs)
    ? manifest.spec.formatRefs
        .map(item => (typeof item?.label === 'string' ? item.label.trim() : ''))
        .filter(Boolean)
    : []
  const description =
    typeof manifest.description === 'string' && manifest.description.trim() !== ''
      ? manifest.description.trim()
      : formatLabels.length === 0
        ? `${manifest.displayName} contribution for Modkit.`
        : `${manifest.displayName} support for ${formatLabels.join(', ')}.`
  const overview = [
    fact('id', 'Contribution ID', manifest.id, provenance),
    fact('display-name', 'Display name', manifest.displayName, provenance),
    fact('description', 'Description', description, provenance),
    fact('owner-extension', 'Owner extension', ownerId, provenance),
    fact('contract-id', 'Contract', manifest.contract.id, provenance),
    fact('contract-major', 'Contract major', manifest.contract.major, provenance),
    fact('contract-coordinate', 'Contract coordinate', contractKey(manifest.contract), provenance),
    fact('status', 'Status', manifest.status ?? 'supported', provenance),
  ]
  const state = [
    fact('enabled', 'Contribution enabled', enabled, provenance),
    fact('effective-enabled', 'Effectively enabled', effectiveEnabled, provenance),
  ]
  const declaration = []
  if (manifest.dependsOn !== undefined) {
    declaration.push(fact('depends-on', 'Dependencies', manifest.dependsOn, provenance))
  }
  if (manifest.limitations !== undefined) {
    declaration.push(fact('limitations', 'Limitations', manifest.limitations, provenance))
  }
  if (manifest.runtimeVariants !== undefined) {
    declaration.push(
      fact('runtime-variants', 'Runtime variants', manifest.runtimeVariants, provenance),
    )
  }
  const specification = []
  if (
    manifest.spec !== null &&
    typeof manifest.spec === 'object' &&
    !Array.isArray(manifest.spec)
  ) {
    for (const key of Object.keys(manifest.spec).sort(compareText)) {
      specification.push(fact(`spec.${key}`, key, manifest.spec[key], provenance))
    }
  } else {
    specification.push(fact('spec', 'Specification', manifest.spec, provenance))
  }
  return Object.freeze([
    Object.freeze({ id: 'overview', label: 'Overview', items: Object.freeze(overview) }),
    Object.freeze({ id: 'state', label: 'State', items: Object.freeze(state) }),
    ...(declaration.length === 0
      ? []
      : [
          Object.freeze({
            id: 'declaration',
            label: 'Declaration',
            items: Object.freeze(declaration),
          }),
        ]),
    Object.freeze({
      id: 'specification',
      label: 'Specification',
      items: Object.freeze(specification),
    }),
  ])
}

/**
 * Projects one already validated extension root and its contribution manifests into the neutral
 * subject-facts ABI. Hosts render the returned facts as cards and use contractGroups for trees;
 * no presentation or codec-specific entity is introduced here.
 */
export function projectExtensionSubjects(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('extension subject projection input must be an object')
  }
  const normalizedInput = snapshotJson(input, 'input')
  const extensionInput = normalizedInput.extension
  if (
    extensionInput === null ||
    typeof extensionInput !== 'object' ||
    Array.isArray(extensionInput)
  ) {
    fail('extension must be an object')
  }
  const publisher = requiredText(extensionInput.publisher, 'extension.publisher')
  const localId = requiredText(extensionInput.id, 'extension.id')
  const extensionId = `${publisher}/${localId}`
  const version = requiredText(extensionInput.version, 'extension.version')
  const license = requiredText(extensionInput.license, 'extension.license')
  const metadata = normalizedInput.metadata ?? {}
  const manifestPresentation = extensionInput.presentation ?? {}
  const metadataPresentation = metadata.presentation ?? {}
  if (
    manifestPresentation === null ||
    typeof manifestPresentation !== 'object' ||
    Array.isArray(manifestPresentation) ||
    metadataPresentation === null ||
    typeof metadataPresentation !== 'object' ||
    Array.isArray(metadataPresentation)
  ) {
    fail('extension presentation must be an object')
  }
  const presentation = Object.freeze({ ...manifestPresentation, ...metadataPresentation })
  const displayName =
    optionalText(metadata.displayName, 'metadata.displayName') ??
    optionalText(presentation.displayName, 'presentation.displayName') ??
    extensionId
  const description =
    optionalText(metadata.description, 'metadata.description') ??
    optionalText(presentation.description, 'presentation.description')
  const homepage = optionalText(metadata.homepage, 'metadata.homepage')
  const sourceLabel = optionalText(metadata.source, 'metadata.source')
  const trusted = metadata.trusted
  if (trusted !== undefined && typeof trusted !== 'boolean') {
    fail('metadata.trusted must be a boolean')
  }
  const extensionEnabled = normalizedInput.enabled !== false
  const contributionEnablement = normalizedInput.contributionEnablement ?? {}
  if (
    contributionEnablement === null ||
    typeof contributionEnablement !== 'object' ||
    Array.isArray(contributionEnablement)
  ) {
    fail('contributionEnablement must be an object')
  }
  const source =
    normalizedInput.source ??
    Object.freeze({ id: `modkit-extension:${encodeURIComponent(extensionId)}` })
  const owner = rootSubject(source, normalizedInput.workspace)
  const extensionRef = nestedSubject(owner, EXTENSION_SUBJECT_KIND, extensionId)
  const extensionSubjectId = serializeSubjectRef(extensionRef)
  const extensionOrigin = Object.freeze([Object.freeze({ label: 'extension manifest' })])
  const contributionOrigin = Object.freeze([Object.freeze({ label: 'contribution manifest' })])

  if (!Array.isArray(normalizedInput.contributions)) fail('contributions must be a list')
  const seen = new Set()
  const contributions = normalizedInput.contributions.map((manifest, index) => {
    const id = requiredText(manifest.id, `contributions[${index}].id`)
    if (seen.has(id)) fail(`contribution «${id}» is duplicated`, { contributionId: id })
    seen.add(id)
    const contract = contractCoordinate(manifest.contract, `contributions[${index}]`)
    const normalized = Object.freeze({
      ...manifest,
      id,
      displayName: requiredText(manifest.displayName, `contributions[${index}].displayName`),
      contract,
    })
    const configured = contributionEnablement[id]
    if (configured !== undefined && typeof configured !== 'boolean') {
      fail(`contributionEnablement.${id} must be a boolean`)
    }
    const enabled = configured !== false
    const effectiveEnabled = extensionEnabled && enabled
    const ref = nestedSubject(owner, CONTRIBUTION_SUBJECT_KIND, id)
    const subjectId = serializeSubjectRef(ref)
    return {
      kind: CONTRIBUTION_SUBJECT_KIND,
      ref,
      subjectId,
      id,
      displayName: normalized.displayName,
      extensionId,
      contract,
      contractKey: contractKey(contract),
      enabled,
      effectiveEnabled,
      manifest: normalized,
    }
  })
  contributions.sort(compareContribution)

  const extensionRecord = {
    kind: EXTENSION_SUBJECT_KIND,
    ref: extensionRef,
    subjectId: extensionSubjectId,
    id: extensionId,
    displayName,
    version,
    enabled: extensionEnabled,
    manifest: extensionInput,
    ...(Object.keys(presentation).length === 0 ? {} : { presentation }),
  }

  for (const contribution of contributions) {
    const sections = contributionFacts(
      contribution.manifest,
      extensionId,
      contribution.enabled,
      contribution.effectiveEnabled,
      contributionOrigin,
    )
    contribution.facts = factsSource({
      snapshotId: `${extensionId}@${version}#${contribution.id}`,
      subjectId: contribution.subjectId,
      label: contribution.displayName,
      kind: CONTRIBUTION_SUBJECT_KIND,
      type: contribution.contractKey,
      groups: Object.freeze(
        sections.map(section => group(section.id, section.label, section.items)),
      ),
      facts: sections.map(section => Object.freeze({ groupId: section.id, items: section.items })),
      relations: Object.freeze([relation('belongs-to', extensionRecord)]),
      origin: contributionOrigin,
    })
    Object.freeze(contribution)
  }

  const grouped = new Map()
  for (const contribution of contributions) {
    const entries = grouped.get(contribution.contractKey) ?? []
    entries.push(contribution)
    grouped.set(contribution.contractKey, entries)
  }
  const contractGroups = [...grouped.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, entries]) =>
      Object.freeze({
        key,
        contract: entries[0].contract,
        contributions: Object.freeze([...entries]),
      }),
    )

  const contributionLinks = Object.freeze(
    contributions.map(contribution =>
      Object.freeze({
        ...relation('owns', contribution),
        id: contribution.id,
        contract: contribution.contract,
        contractKey: contribution.contractKey,
        enabled: contribution.enabled,
        effectiveEnabled: contribution.effectiveEnabled,
      }),
    ),
  )
  extensionRecord.contributions = contributionLinks

  const overview = [
    fact('id', 'Extension ID', extensionId, extensionOrigin),
    fact('display-name', 'Display name', displayName, extensionOrigin),
    fact('publisher', 'Publisher', publisher, extensionOrigin),
    fact('version', 'Version', version, extensionOrigin),
    fact('license', 'License', license, extensionOrigin),
    ...(description === undefined
      ? []
      : [fact('description', 'Description', description, extensionOrigin)]),
    ...(homepage === undefined ? [] : [fact('homepage', 'Homepage', homepage, extensionOrigin)]),
    ...(sourceLabel === undefined ? [] : [fact('source', 'Source', sourceLabel, extensionOrigin)]),
    ...(trusted === undefined ? [] : [fact('trusted', 'Trusted', trusted, extensionOrigin)]),
    ...extensionPresentationFacts(presentation, extensionOrigin),
  ]
  const state = [
    fact('enabled', 'Extension enabled', extensionEnabled, extensionOrigin),
    fact('contribution-count', 'Contributions', contributions.length, extensionOrigin),
  ]
  const contributionItems = contributionLinks.map(link =>
    fact(`contribution.${link.id}`, link.label, link, extensionOrigin),
  )
  const extensionSections = [
    Object.freeze({ id: 'overview', label: 'Overview', items: Object.freeze(overview) }),
    Object.freeze({ id: 'state', label: 'State', items: Object.freeze(state) }),
    Object.freeze({
      id: 'contributions',
      label: 'Contributions',
      items: Object.freeze(contributionItems),
    }),
  ]
  extensionRecord.facts = factsSource({
    snapshotId: `${extensionId}@${version}`,
    subjectId: extensionSubjectId,
    label: displayName,
    kind: EXTENSION_SUBJECT_KIND,
    groups: Object.freeze(
      extensionSections.map(section => group(section.id, section.label, section.items)),
    ),
    facts: extensionSections.map(section =>
      Object.freeze({ groupId: section.id, items: section.items }),
    ),
    relations: contributionLinks,
    origin: extensionOrigin,
  })
  Object.freeze(extensionRecord)

  const records = Object.freeze([extensionRecord, ...contributions])
  const recordsBySubjectId = new Map(records.map(record => [record.subjectId, record]))
  return Object.freeze({
    extension: extensionRecord,
    contributions: Object.freeze(contributions),
    contractGroups: Object.freeze(contractGroups),
    records,
    subject(subjectId) {
      return recordsBySubjectId.get(subjectId)
    },
  })
}

function uniqueProfiles(values, normalize, label) {
  if (!Array.isArray(values)) fail(`${label} must be a list`)
  const seen = new Set()
  return values.map((value, index) => {
    const profile = normalize(value)
    if (seen.has(profile.id)) fail(`${label}[${index}] duplicates «${profile.id}»`)
    seen.add(profile.id)
    return profile
  })
}

function presentedVendorId(record) {
  return typeof record?.presentation?.vendor?.id === 'string'
    ? record.presentation.vendor.id
    : undefined
}

function presentedGameIds(record) {
  return Array.isArray(record?.presentation?.games)
    ? record.presentation.games
        .map(game => (typeof game?.id === 'string' ? game.id : undefined))
        .filter(Boolean)
    : []
}

function appendRelation(target, role, record) {
  if (record === undefined) return
  const key = `${role}\u0000${record.subjectId}`
  if (target.keys.has(key)) return
  target.keys.add(key)
  target.items.push(relation(role, record))
}

function resourceFacts(profile, provenance) {
  const resources = [
    ...(profile.officialSite === undefined
      ? []
      : [
          Object.freeze({ id: 'official-site', label: 'Official site', url: profile.officialSite }),
        ]),
    ...profile.resources,
  ]
  return Object.freeze({
    resources: Object.freeze(resources),
    facts: Object.freeze(
      resources.map(resource =>
        fact(`resource.${resource.id}`, resource.label, resource, provenance),
      ),
    ),
  })
}

function sectionsFactsSource(record, sections, relations, origin) {
  return factsSource({
    snapshotId: `repository-subjects@1#${record.kind}/${record.id}`,
    subjectId: record.subjectId,
    label: record.displayName,
    kind: record.kind,
    groups: Object.freeze(sections.map(section => group(section.id, section.label, section.items))),
    facts: Object.freeze(
      sections.map(section => Object.freeze({ groupId: section.id, items: section.items })),
    ),
    relations: Object.freeze(relations),
    origin,
  })
}

/**
 * Project repository-owned vendor and game profiles into the same neutral subject ABI as
 * extensions. Concrete game knowledge stays in repository JSON; the core only joins declared ids.
 */
export function projectVendorGameSubjects(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('vendor/game subject projection input must be an object')
  }
  const vendors = uniqueProfiles(input.vendors, normalizeVendorSubjectProfile, 'vendors')
  const games = uniqueProfiles(input.games, normalizeGameSubjectProfile, 'games')
  const vendorProfiles = new Map(vendors.map(profile => [profile.id, profile]))
  for (const game of games) {
    if (!vendorProfiles.has(game.vendorId)) {
      fail(`game «${game.id}» references missing vendor «${game.vendorId}»`, {
        gameId: game.id,
        vendorId: game.vendorId,
      })
    }
  }

  const relatedRecords = input.records === undefined ? [] : input.records
  if (!Array.isArray(relatedRecords)) fail('records must be a list')
  const relatedByKey = new Map()
  for (const [index, record] of relatedRecords.entries()) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      fail(`records[${index}] must be a subject record`)
    }
    const id = requiredText(record.id, `records[${index}].id`)
    requiredText(record.subjectId, `records[${index}].subjectId`)
    requiredText(record.kind, `records[${index}].kind`)
    requiredText(record.displayName, `records[${index}].displayName`)
    const key = `${record.kind}\u0000${id}`
    if (relatedByKey.has(key)) fail(`records duplicate ${record.kind} id «${id}»`)
    relatedByKey.set(key, record)
  }

  const source =
    input.source === undefined
      ? Object.freeze({ id: 'modkit-repository:subjects' })
      : snapshotJson(input.source, 'source')
  const workspace = optionalText(input.workspace, 'workspace')
  const owner = rootSubject(source, workspace)
  const origin = Object.freeze([Object.freeze({ label: 'repository subject profile' })])
  const vendorRecords = vendors.map(profile => {
    const ref = nestedSubject(owner, VENDOR_SUBJECT_KIND, profile.id)
    return {
      kind: VENDOR_SUBJECT_KIND,
      ref,
      subjectId: serializeSubjectRef(ref),
      id: profile.id,
      displayName: profile.displayName,
      profile,
    }
  })
  const gameRecords = games.map(profile => {
    const ref = nestedSubject(owner, GAME_SUBJECT_KIND, profile.id)
    return {
      kind: GAME_SUBJECT_KIND,
      ref,
      subjectId: serializeSubjectRef(ref),
      id: profile.id,
      displayName: profile.displayName,
      profile,
    }
  })
  const vendorById = new Map(vendorRecords.map(record => [record.id, record]))
  const gameById = new Map(gameRecords.map(record => [record.id, record]))

  for (const record of vendorRecords) {
    const profile = record.profile
    const resources = resourceFacts(profile, origin)
    const related = { keys: new Set(), items: [] }
    const vendorGames = gameRecords
      .filter(game => game.profile.vendorId === profile.id)
      .sort((left, right) => compareText(left.displayName, right.displayName))
    for (const game of vendorGames) appendRelation(related, 'offers-game', game)
    const vendorExtensions = relatedRecords
      .filter(
        item => item.kind === EXTENSION_SUBJECT_KIND && presentedVendorId(item) === profile.id,
      )
      .sort(compareContribution)
    for (const extension of vendorExtensions) {
      appendRelation(
        related,
        presentedGameIds(extension).length === 0 ? 'provides-component' : 'provides-extension',
        extension,
      )
    }
    const overview = Object.freeze([
      fact('id', 'Vendor ID', profile.id, origin),
      fact('display-name', 'Display name', profile.displayName, origin),
      fact('description', 'Description', profile.description, origin),
      fact('game-count', 'Games', vendorGames.length, origin),
      fact('extension-count', 'Extensions and components', vendorExtensions.length, origin),
    ])
    const sections = [
      Object.freeze({ id: 'overview', label: 'Overview', items: overview }),
      ...(resources.facts.length === 0
        ? []
        : [Object.freeze({ id: 'resources', label: 'Resources', items: resources.facts })]),
    ]
    record.resources = resources.resources
    record.facts = sectionsFactsSource(record, sections, related.items, origin)
    Object.freeze(record)
  }

  for (const record of gameRecords) {
    const profile = record.profile
    const resources = resourceFacts(profile, origin)
    const related = { keys: new Set(), items: [] }
    appendRelation(related, 'belongs-to-vendor', vendorById.get(profile.vendorId))
    for (const extension of relatedRecords.filter(
      item => item.kind === EXTENSION_SUBJECT_KIND && presentedGameIds(item).includes(profile.id),
    )) {
      appendRelation(related, 'supported-by', extension)
    }
    for (const requirement of profile.extensionRequirements) {
      appendRelation(
        related,
        requirement.importance === 'required' ? 'requires-extension' : 'recommends-extension',
        relatedByKey.get(`${EXTENSION_SUBJECT_KIND}\u0000${requirement.id}`),
      )
    }
    for (const capability of profile.capabilityRequirements) {
      for (const contributionId of capability.contributionIds) {
        appendRelation(
          related,
          capability.importance === 'required' ? 'requires-capability' : 'recommends-capability',
          relatedByKey.get(`${CONTRIBUTION_SUBJECT_KIND}\u0000${contributionId}`),
        )
      }
    }
    const overview = Object.freeze([
      fact('id', 'Game ID', profile.id, origin),
      fact('display-name', 'Display name', profile.displayName, origin),
      fact('description', 'Description', profile.description, origin),
      fact('vendor', 'Vendor', vendorById.get(profile.vendorId).displayName, origin),
    ])
    const extensionRequirements = Object.freeze(
      profile.extensionRequirements.map(requirement =>
        fact(`extension.${requirement.id}`, requirement.id, requirement.importance, origin),
      ),
    )
    const capabilityRequirements = Object.freeze(
      profile.capabilityRequirements.map(requirement =>
        fact(
          `capability.${requirement.id}`,
          requirement.displayName,
          Object.freeze({
            id: requirement.id,
            importance: requirement.importance,
            contributionIds: requirement.contributionIds,
          }),
          origin,
        ),
      ),
    )
    const sections = [
      Object.freeze({ id: 'overview', label: 'Overview', items: overview }),
      ...(resources.facts.length === 0
        ? []
        : [Object.freeze({ id: 'resources', label: 'Resources', items: resources.facts })]),
      ...(extensionRequirements.length === 0
        ? []
        : [
            Object.freeze({
              id: 'extension-requirements',
              label: 'Extensions',
              items: extensionRequirements,
            }),
          ]),
      ...(capabilityRequirements.length === 0
        ? []
        : [
            Object.freeze({
              id: 'capability-requirements',
              label: 'Capabilities',
              items: capabilityRequirements,
            }),
          ]),
    ]
    record.resources = resources.resources
    record.facts = sectionsFactsSource(record, sections, related.items, origin)
    Object.freeze(record)
  }

  const records = Object.freeze([...vendorRecords, ...gameRecords])
  const recordsBySubjectId = new Map(records.map(record => [record.subjectId, record]))
  return Object.freeze({
    vendors: Object.freeze(vendorRecords),
    games: Object.freeze(gameRecords),
    records,
    vendor(id) {
      return vendorById.get(id)
    },
    game(id) {
      return gameById.get(id)
    },
    subject(subjectId) {
      return recordsBySubjectId.get(subjectId)
    },
  })
}
