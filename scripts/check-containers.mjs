#!/usr/bin/env node
// Data-only P11 container composition gate. It reads manifests and never imports entrypoints.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const roots = []
for (let index = 0; index < args.length; index += 1) {
  if (args[index] !== '--root') continue
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error('containers:check: --root requires a directory')
    process.exit(2)
  }
  roots.push(resolve(value))
  index += 1
}
if (roots.length === 0) roots.push(resolve('extensions'))
const quiet = args.includes('--quiet')

const files = []
const visit = directory => {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`root is not a directory: ${directory}`)
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.'))
      continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) visit(path)
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path)
  }
}
for (const root of roots) visit(root)

const codecs = []
for (const path of files) {
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    continue
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    value.contract === null ||
    typeof value.contract !== 'object' ||
    typeof value.contract.id !== 'string' ||
    !value.contract.id.endsWith('/codec-contribution') ||
    value.contract.major !== 1 ||
    value.spec === null ||
    typeof value.spec !== 'object'
  ) {
    continue
  }
  codecs.push({ path, id: String(value.id ?? ''), spec: value.spec })
}

const failures = []
const fail = (codec, message) =>
  failures.push(`${relative(process.cwd(), codec.path).replaceAll('\\', '/')}: ${message}`)
const formatsOf = codec =>
  Array.isArray(codec.spec.formatRefs)
    ? codec.spec.formatRefs.map(item => item?.formatId).filter(item => typeof item === 'string')
    : []
const operationsOf = codec => (Array.isArray(codec.spec.operations) ? codec.spec.operations : [])
const providers = codecs.filter(
  codec => Array.isArray(codec.spec.roles) && codec.spec.roles.includes('container'),
)
const aliases = codecs.filter(codec => codec.spec.container !== undefined)

for (const alias of aliases) {
  const formatId = alias.spec.container?.formatId
  if (typeof formatId !== 'string' || formatId.trim() === '') {
    fail(alias, 'container.formatId must be a non-empty string')
    continue
  }
  if (alias.spec.sourceTopology !== 'namespace' || alias.spec.probe?.kind !== 'namespace') {
    fail(alias, `container alias ${formatId} must use namespace topology/probe`)
  }
  if (alias.spec.roles?.includes('container')) {
    fail(alias, `container alias ${formatId} must not claim the container role`)
  }
  if ((alias.spec.match?.signatures?.length ?? 0) > 0) {
    fail(alias, `container alias ${formatId} must not declare carrier signatures`)
  }
  if (
    (alias.spec.match?.extensions?.length ?? 0) === 0 &&
    (alias.spec.match?.mediaTypes?.length ?? 0) === 0 &&
    (alias.spec.match?.pathGlobs?.length ?? 0) === 0
  ) {
    fail(alias, `container alias ${formatId} requires an extension, media type, or path selector`)
  }
  if (formatsOf(alias).includes(formatId))
    fail(alias, `container alias ${formatId} is a self-cycle`)

  const eligible = providers.filter(provider => formatsOf(provider).includes(formatId))
  if (eligible.length !== 1) {
    fail(
      alias,
      `container format ${formatId} has ${eligible.length} providers; exactly one is required`,
    )
    continue
  }
  const provider = eligible[0]
  if (
    !['single', 'bundle'].includes(provider.spec.sourceTopology) ||
    provider.spec.probe?.kind !== 'bytes' ||
    provider.spec.container !== undefined
  ) {
    fail(provider, `provider for ${formatId} must be a non-aliased byte-topology codec`)
  }
  if (
    !provider.spec.publishesDataSources?.some(
      item => item?.contract === 'common.view/namespace-entry-source' && item?.major === 1,
    )
  ) {
    fail(provider, `provider for ${formatId} must publish common.view/namespace-entry-source@1`)
  }
  const providerOperations = operationsOf(provider)
  if (!providerOperations.some(operation => operation?.id === 'container.extract')) {
    fail(provider, `provider for ${formatId} must publish container.extract`)
  }
  const mutatesEntries = operationsOf(alias).some(
    operation => operation?.mutatesSource === true && operation?.outputKinds?.includes('edit-plan'),
  )
  if (
    mutatesEntries &&
    !providerOperations.some(
      operation =>
        operation?.id === 'container.pack' &&
        operation?.mutatesSource === true &&
        operation?.outputKinds?.includes('edit-plan'),
    )
  ) {
    fail(
      provider,
      `provider for mutating alias ${alias.id} must publish container.pack -> edit-plan`,
    )
  }
  if (
    operationsOf(alias).some(operation => operation?.id === 'export.raw') &&
    !providerOperations.some(
      operation => operation?.id === 'export.raw' && operation?.outputKinds?.includes('bytes'),
    )
  ) {
    fail(provider, `provider for raw-export alias ${alias.id} must publish export.raw -> bytes`)
  }
}

const referencedFormats = new Set(
  aliases.map(alias => alias.spec.container?.formatId).filter(item => typeof item === 'string'),
)
const signatures = new Map()
for (const provider of providers.filter(codec =>
  formatsOf(codec).some(format => referencedFormats.has(format)),
)) {
  for (const signature of provider.spec.match?.signatures ?? []) {
    const key = JSON.stringify({
      from: signature?.from,
      offset: signature?.offset,
      bytesHex: signature?.bytesHex,
      maskHex: signature?.maskHex,
    })
    const prior = signatures.get(key)
    if (prior !== undefined && prior.id !== provider.id) {
      fail(provider, `carrier signature duplicates referenced provider ${prior.id}`)
    } else signatures.set(key, provider)
  }
}

if (failures.length > 0) {
  console.error(
    `containers:check: ${failures.length} failure(s) across ${codecs.length} codec manifests`,
  )
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
if (!quiet) {
  console.log(
    `containers:check: clean (${aliases.length} aliases, ${providers.length} container providers, ${codecs.length} codec manifests)`,
  )
}
