/** Deterministic migration inventory and evidence checks; pending is never acceptance. */
import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, glob } from 'node:fs/promises'
import path from 'node:path'

export const hash = value => createHash('sha256').update(value).digest('hex')
export const stable = value =>
  JSON.stringify(
    value,
    (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map(key => [key, item[key]]),
          )
        : item,
    2,
  ) + '\n'
export const readJson = async file => JSON.parse(await readFile(file, 'utf8'))

export function confined(root, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    relative.includes('\\') ||
    relative.split('/').some(part => part === '..' || part === '') ||
    path.isAbsolute(relative) ||
    /^[a-z]:/iu.test(relative)
  )
    throw new Error(`unsafe relative path: ${relative}`)
  const resolved = path.resolve(root, relative)
  if (!resolved.startsWith(path.resolve(root) + path.sep))
    throw new Error(`path escapes root: ${relative}`)
  return resolved
}

export async function readEvidence(root, reference) {
  if (
    !reference ||
    typeof reference.path !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(reference.sha256 ?? '')
  )
    throw new Error('evidence needs a path and sha256')
  const file = confined(root, reference.path)
  const realRoot = await realpath(root)
  if (!(await realpath(file)).startsWith(realRoot + path.sep))
    throw new Error(`evidence symlink escapes root: ${reference.path}`)
  const bytes = await readFile(file)
  if (hash(bytes) !== reference.sha256)
    throw new Error(`evidence digest changed: ${reference.path}`)
  return bytes
}

export async function discoverContributions(repositories) {
  const records = []
  const walk = async (root, relative = '') => {
    const rows = await readdir(path.join(root.directory, relative), { withFileTypes: true })
    for (const row of rows.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (
        row.name.startsWith('.') ||
        [
          'node_modules',
          'dist',
          'dist-app',
          'vendor',
          'reports',
          'migration',
          'test',
          'tests',
          'fixtures',
        ].includes(row.name)
      )
        continue
      const file = relative ? `${relative}/${row.name}` : row.name
      if (row.isDirectory()) await walk(root, file)
      else if (row.isFile() && row.name === 'package.json') {
        const pkg = await readJson(path.join(root.directory, file))
        const manifests = pkg.modkit?.contributions ?? pkg.modkit?.contributionManifests ?? []
        if (!Array.isArray(manifests))
          throw new Error(`invalid contributions in ${root.id}/${file}`)
        for (const authored of manifests) {
          if (
            typeof authored !== 'string' ||
            authored.split('/').includes('..') ||
            path.isAbsolute(authored)
          )
            throw new Error(`unsafe manifest pattern: ${authored}`)
          const matched = []
          for await (const match of glob(authored, { cwd: path.join(root.directory, relative) }))
            matched.push(match)
          if (!matched.length)
            throw new Error(`manifest pattern matches nothing: ${root.id}/${relative}/${authored}`)
          for (const match of matched.sort()) {
            const manifestPath = path
              .relative(root.directory, path.resolve(root.directory, relative, match))
              .replaceAll('\\', '/')
            const manifest = await readJson(confined(root.directory, manifestPath))
            if (manifest.contract?.id !== 'modkit/codec-contribution') continue
            records.push({
              repository: root.id,
              package: relative,
              path: manifestPath,
              id: manifest.id,
              status: manifest.status ?? 'unspecified',
              formats: (manifest.spec?.formatRefs ?? []).map(format => format.formatId),
              operations: (manifest.spec?.operations ?? []).map(operation => ({
                id: operation.id,
                handlerId: operation.handlerId ?? null,
              })),
              runtimeVariants: manifest.runtimeVariants ?? [],
            })
          }
        }
      }
    }
  }
  for (const repository of repositories) await walk(repository)
  const seen = new Set()
  for (const record of records) {
    const key = `${record.repository}/${record.path}`
    if (seen.has(key)) throw new Error(`duplicate contribution: ${key}`)
    seen.add(key)
  }
  return records.sort((a, b) =>
    `${a.repository}/${a.path}`.localeCompare(`${b.repository}/${b.path}`, 'en'),
  )
}

export async function discoverPublications(repositories, root) {
  const contributions = await discoverContributions(repositories)
  return contributions.map(contribution => {
    const repository = repositories.find(item => item.id === contribution.repository)
    const workspaceRelativeRoot = repository.workspaceRelativeRoot?.replaceAll('\\', '/')
    if (
      workspaceRelativeRoot !== undefined &&
      (path.posix.isAbsolute(workspaceRelativeRoot) ||
        workspaceRelativeRoot.split('/').some(part => part === '' || part === '..'))
    )
      throw new Error(`unsafe workspace-relative repository root: ${workspaceRelativeRoot}`)
    return {
      ...contribution,
      workspacePath:
        workspaceRelativeRoot === undefined
          ? path
              .relative(root, path.join(repository.directory, contribution.path))
              .replaceAll('\\', '/')
          : path.posix.join(workspaceRelativeRoot, contribution.path),
    }
  })
}

export function codecFamily(codec, audits) {
  return audits[codec] || ['mpq', 'casc'].includes(codec) ? 'sc2' : 'other'
}

export function requirementsFor(inventory, audits, authored) {
  const requirements = []
  const units = inventory.units.filter(unit => unit.kind === 'codec-manifest')
  const ids = new Set(units.map(unit => unit.extracted.id))
  if (!units.length) throw new Error('empty codec inventory')
  if (new Set(units.map(unit => unit.sourceUnitId)).size !== units.length)
    throw new Error('duplicate source units')
  for (const id of Object.keys(audits))
    if (!ids.has(id)) throw new Error(`audit has no source unit: ${id}`)
  for (const unit of units) {
    const audit = audits[unit.extracted.id]
    const base = {
      sourceUnitId: unit.sourceUnitId,
      codec: unit.extracted.id,
      family: codecFamily(unit.extracted.id, audits),
    }
    const operations = [
      ...new Set([...(unit.extracted.operations ?? []), ...(audit?.mk2Manifest?.operations ?? [])]),
    ].sort()
    for (const operation of operations)
      requirements.push({
        ...base,
        id: `${unit.sourceUnitId}/operation/${operation}`,
        kind: 'operation',
        label: operation,
      })
    if (audit) {
      if (!Array.isArray(audit.mk2Features) || !audit.mk2Features.length)
        throw new Error(`empty feature audit: ${base.codec}`)
      for (const feature of audit.mk2Features)
        requirements.push({
          ...base,
          id: `${unit.sourceUnitId}/feature/${hash(stable(feature)).slice(0, 16)}`,
          kind: 'feature',
          label: feature.feature,
          sourceRefs: feature.fileRefs ?? [],
        })
    } else
      requirements.push({
        ...base,
        id: `${unit.sourceUnitId}/audit`,
        kind: 'audit',
        label: 'Full source feature audit remains required before family acceptance',
      })
  }
  for (const unit of authored) {
    if (!unit.id || !Array.isArray(unit.requirements) || !unit.requirements.length)
      throw new Error('empty authored requirements')
    for (const requirement of unit.requirements)
      requirements.push({
        sourceUnitId: `authored/${unit.id}`,
        codec: unit.id,
        family: unit.family,
        id: `authored/${unit.id}/${requirement.id}`,
        kind: 'authored',
        label: requirement.label,
      })
  }
  if (new Set(requirements.map(row => row.id)).size !== requirements.length)
    throw new Error('duplicate requirement IDs')
  return requirements.sort((a, b) => a.id.localeCompare(b.id, 'en'))
}

export function initialState(requirements) {
  return {
    schemaVersion: 1,
    entries: requirements.map(requirement => ({
      id: requirement.id,
      status: 'pending',
      evidence: [],
    })),
    protectedEvidence: [],
  }
}

export function validateReceipt(receipt, requirement) {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.verdict !== 'pass' ||
    !Number.isSafeInteger(receipt.tests?.passed) ||
    receipt.tests.passed <= 0 ||
    receipt.tests.failed !== 0 ||
    (receipt.tests.skipped ?? 0) !== 0
  )
    throw new Error(`non-passing/empty receipt for ${requirement.id}`)
  if (!['synthetic', 'real', 'mixed'].includes(receipt.corpusKind))
    throw new Error(`missing corpus kind: ${requirement.id}`)
  if (
    receipt.corpusKind !== 'synthetic' &&
    (receipt.oracleVerification?.verified !== true ||
      !receipt.oracleVerification.modules?.length ||
      receipt.oracleVerification.operation !== receipt.inputs?.operation)
  )
    throw new Error(`real receipt lacks verified oracle artifacts: ${requirement.id}`)
  const proof = receipt.proofs?.find(item => item.requirement === requirement.id)
  if (!proof || proof.kind !== requirement.kind)
    throw new Error(`receipt does not prove ${requirement.id}`)
  if (receipt.codec !== requirement.codec)
    throw new Error(`receipt codec mismatch: ${requirement.id}`)
  const cases = receipt.cases ?? []
  const successful = cases.filter(item => item.verdict === 'identical')
  if (
    typeof receipt.inputs?.operation !== 'string' ||
    !receipt.inputs.operation ||
    proof.adapterOperation !== receipt.inputs.operation ||
    !Array.isArray(proof.caseIds) ||
    !proof.caseIds.length ||
    new Set(proof.caseIds).size !== proof.caseIds.length ||
    new Set(cases.map(item => item.id)).size !== cases.length ||
    successful.length !== receipt.tests.passed ||
    cases.filter(item => item.verdict === 'different').length !== receipt.tests.failed ||
    proof.caseIds.some(id => !successful.some(item => item.id === id))
  )
    throw new Error(`proof is not bound to successful executed cases: ${requirement.id}`)
  if (
    requirement.kind === 'operation' &&
    (proof.legacyOperation !== requirement.label ||
      typeof proof.targetOperation !== 'string' ||
      !proof.targetOperation ||
      typeof proof.handlerId !== 'string' ||
      !proof.handlerId ||
      proof.executed !== true)
  )
    throw new Error(`operation execution proof missing: ${requirement.id}`)
  return proof
}

/** Explicit partial acceptance; every selected ID must still belong to the named codec. */
export function validateLedgerClaims(claims, requirements) {
  if (
    !claims ||
    typeof claims !== 'object' ||
    Array.isArray(claims) ||
    claims.schemaVersion !== 1 ||
    Object.keys(claims).some(key => !['schemaVersion', 'codec', 'requirementIds'].includes(key))
  )
    throw new Error('invalid claims schema: expected schemaVersion 1, codec and requirementIds')
  if (
    typeof claims.codec !== 'string' ||
    !claims.codec.trim() ||
    !requirements.some(requirement => requirement.codec === claims.codec)
  )
    throw new Error(`unknown or empty claims codec: ${claims.codec}`)
  if (!Array.isArray(claims.requirementIds) || !claims.requirementIds.length)
    throw new Error('empty or invalid claims requirementIds')
  const required = new Map(requirements.map(requirement => [requirement.id, requirement]))
  const selected = new Set()
  for (const id of claims.requirementIds) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('invalid claims requirement ID')
    if (selected.has(id)) throw new Error(`duplicate claims requirement: ${id}`)
    const requirement = required.get(id)
    if (!requirement) throw new Error(`unknown or stale claims requirement: ${id}`)
    if (requirement.codec !== claims.codec)
      throw new Error(`claims requirement belongs to another codec: ${id}`)
    selected.add(id)
  }
  return selected
}

export async function checkLedger({
  requirements,
  ledger,
  operationMap,
  root,
  previous,
  closure,
  claims,
  publications = [],
}) {
  const failures = []
  const fail = text => failures.push(text)
  if (!Array.isArray(requirements) || !requirements.length) return ['empty requirements']
  let selectedClaims = new Set()
  if (claims !== undefined) {
    if (closure !== undefined) fail('claims and closure are mutually exclusive')
    try {
      selectedClaims = validateLedgerClaims(claims, requirements)
    } catch (error) {
      fail(error.message)
    }
  }
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.entries) || !ledger.entries.length)
    return ['empty or invalid ledger']
  if (operationMap.schemaVersion !== 1 || !Array.isArray(operationMap.entries))
    return ['invalid operation map']
  const byId = new Map()
  for (const entry of ledger.entries) {
    if (byId.has(entry.id)) fail(`duplicate ledger entry: ${entry.id}`)
    byId.set(entry.id, entry)
  }
  const required = new Map(requirements.map(row => [row.id, row]))
  for (const id of byId.keys()) if (!required.has(id)) fail(`unexpected ledger entry: ${id}`)
  const mappings = new Map()
  for (const mapping of operationMap.entries ?? []) {
    if (mappings.has(mapping.id)) fail(`duplicate operation mapping: ${mapping.id}`)
    if (required.get(mapping.id)?.kind !== 'operation')
      fail(`unexpected operation mapping: ${mapping.id}`)
    mappings.set(mapping.id, mapping)
  }
  for (const requirement of requirements) {
    const entry = byId.get(requirement.id)
    if (!entry) {
      fail(`missing ledger entry: ${requirement.id}`)
      continue
    }
    if (!['pending', 'ported', 'adapted', 'owner-dropped'].includes(entry.status))
      fail(`invalid status: ${requirement.id}`)
    if (!Array.isArray(entry.evidence)) {
      fail(`invalid evidence list: ${requirement.id}`)
      continue
    }
    const mapping = mappings.get(requirement.id)
    if (requirement.kind === 'operation' && !mapping)
      fail(`missing operation mapping: ${requirement.id}`)
    if (mapping && mapping.status !== entry.status)
      fail(`operation status drift: ${requirement.id}`)
    if (entry.status === 'pending') {
      if (
        selectedClaims.has(requirement.id) ||
        closure === 'all' ||
        closure === requirement.family ||
        closure === requirement.codec
      )
        fail(`pending: ${requirement.id}`)
      if (entry.evidence.length) fail(`pending row carries acceptance evidence: ${requirement.id}`)
      continue
    }
    if (entry.status === 'owner-dropped') {
      if (
        !entry.decision ||
        entry.decision.approvedBy !== 'owner' ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(entry.decision.date ?? '') ||
        !entry.decision.reason
      )
        fail(`owner decision missing: ${requirement.id}`)
      else
        try {
          await readEvidence(root, entry.decision)
        } catch (error) {
          fail(error.message)
        }
      continue
    }
    if (!entry.evidence.length) fail(`no evidence: ${requirement.id}`)
    for (const reference of entry.evidence) {
      try {
        const receipt = JSON.parse(await readEvidence(root, reference))
        const proof = validateReceipt(receipt, requirement)
        if (
          mapping &&
          (mapping.targetOperation !== proof.targetOperation ||
            mapping.handlerId !== proof.handlerId)
        )
          fail(`operation target mismatch: ${requirement.id}`)
        if (mapping) {
          if (!publications.some(item => item.workspacePath === mapping.contribution))
            throw new Error(
              `contribution is not published by a configured package: ${mapping.contribution}`,
            )
          const manifest = await readJson(confined(root, mapping.contribution))
          if (
            manifest.contract?.id !== 'modkit/codec-contribution' ||
            !manifest.spec?.operations?.some(
              operation =>
                operation.id === mapping.targetOperation &&
                operation.handlerId === mapping.handlerId,
            )
          )
            fail(`published operation absent: ${requirement.id}`)
        }
      } catch (error) {
        fail(`${requirement.id}: ${error.message}`)
      }
    }
  }
  for (const reference of ledger.protectedEvidence ?? [])
    try {
      await readEvidence(root, reference)
    } catch (error) {
      fail(error.message)
    }
  for (const reference of previous?.protectedEvidence ?? [])
    if (
      !(ledger.protectedEvidence ?? []).some(
        item => item.path === reference.path && item.sha256 === reference.sha256,
      )
    )
      fail(`accepted proof removed: ${reference.path}`)
  for (const entry of previous?.entries ?? []) {
    if (entry.status === 'pending') continue
    const current = byId.get(entry.id)
    if (!current || current.status === 'pending') fail(`accepted requirement removed: ${entry.id}`)
    for (const proof of entry.evidence ?? [])
      if (
        !current?.evidence?.some(item => item.path === proof.path && item.sha256 === proof.sha256)
      )
        fail(`accepted requirement proof removed: ${entry.id}`)
  }
  if (
    closure &&
    !requirements.some(row => closure === 'all' || row.family === closure || row.codec === closure)
  )
    fail(`unknown or empty closure: ${closure}`)
  return failures
}
