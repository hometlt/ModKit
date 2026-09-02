/**
 * Run Electron A6 over the exact generated format-smoke authority.
 *
 * Inputs are explicit. The runner does not discover checkout paths and does not read authority
 * corpus paths as files. Supply every included case through either:
 *
 *   MODKIT_ELECTRON_FORMAT_SMOKE_CASES='{"image-png":"C:/.../icon.png", ...}'
 *   node apps/electron/scripts/run-format-smoke-acceptance.mjs --cases-json cases.json
 *
 * JSON object values may be strings, { "path": "...", "boundary": "..." }, or for nested cases
 * { "parentPath": "...", "boundary": "product-container-entry", "entryPath": "..." }. The workspace
 * this script builds is temporary; the receipt printed by the app carries only basenames, case ids
 * and content hashes.
 */
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import electronPath from 'electron'

import { syncElectronFormatSmoke } from './sync-format-smoke.mjs'

const arg = name => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const here = dirname(fileURLToPath(import.meta.url))
const defaultAppRoot = resolve(here, '..')
const appRoot = resolve(arg('--app-root') ?? defaultAppRoot)
const usesExplicitAppRoot = appRoot !== defaultAppRoot
const repoRoot = resolve(defaultAppRoot, '..', '..')
const authorityPath = join(appRoot, 'dist-app', 'format-smoke.v1.json')

const timeoutMs = Number(arg('--timeout-ms') ?? 300_000)
const receiptPath = arg('--receipt')
const keepWorkspace = process.argv.includes('--keep-workspace')
const skipBuild = process.argv.includes('--skip-build')

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

const boundaryFor = kind => {
  switch (kind) {
    case 'sc2-casc-entry':
    case 'warzone-wz-entry':
      return 'product-container-entry'
    case 'sc2-install-file':
    case 'warzone-install-file':
      return 'container-file'
    default:
      return 'direct-file'
  }
}

const casesInput = (() => {
  const file = arg('--cases-json')
  if (file !== undefined) return readJson(resolve(file))
  const text = process.env.MODKIT_ELECTRON_FORMAT_SMOKE_CASES
  if (text === undefined || text.trim() === '') {
    throw new Error('missing --cases-json or MODKIT_ELECTRON_FORMAT_SMOKE_CASES')
  }
  return JSON.parse(text)
})()

if (typeof casesInput !== 'object' || casesInput === null || Array.isArray(casesInput)) {
  throw new TypeError('format-smoke cases input must be a JSON object')
}

if (usesExplicitAppRoot && !skipBuild) {
  throw new Error('--app-root requires --skip-build; pass an already staged Electron app root')
}

if (!usesExplicitAppRoot && !skipBuild) {
  await import('./build-app.mjs')
} else if (!usesExplicitAppRoot) {
  syncElectronFormatSmoke({ repoRoot, appRoot: defaultAppRoot })
  mkdirSync(join(defaultAppRoot, 'dist-app'), { recursive: true })
  copyFileSync(
    join(defaultAppRoot, 'format-smoke.v1.json'),
    join(defaultAppRoot, 'dist-app', 'format-smoke.v1.json'),
  )
}

const authorityBytes = readFileSync(authorityPath)
const authoritySha256 = sha256(authorityBytes)
const authority = JSON.parse(authorityBytes.toString('utf8'))
const included = authority.cases.filter(item => item?.corpus?.kind !== 'named-exclusion')
const workspace = mkdtempSync(join(tmpdir(), 'modkit-electron-format-smoke-'))
const userData = mkdtempSync(join(tmpdir(), 'modkit-electron-format-smoke-profile-'))
const planPath = join(workspace, 'format-smoke-plan.v1.json')
const fileNames = new Set()
const planned = []
const grants = new Set()
const requiredStagedEntries = [
  join(appRoot, 'electron', 'main.cjs'),
  join(appRoot, 'dist-app', 'main-runtime', 'dist', 'index.js'),
  join(appRoot, 'dist-app', 'index.html'),
  join(appRoot, 'dist-app', 'format-smoke.v1.json'),
  join(appRoot, 'generated', 'bundled-catalog.cjs'),
  join(appRoot, 'dist-app', 'node_modules', '@modkit', 'host', 'package.json'),
  join(appRoot, 'dist-app', 'node_modules', '@modkit', 'codec-kit', 'package.json'),
  join(appRoot, 'dist-app', 'node_modules', '@rgrove', 'parse-xml', 'package.json'),
  join(appRoot, 'dist-app', 'node_modules', 'smol-toml', 'package.json'),
  join(appRoot, 'dist-app', 'node_modules', 'yaml', 'package.json'),
  join(appRoot, 'dist-app', 'extensions', 'archives'),
  join(appRoot, 'dist-app', 'extensions', 'audio'),
  join(appRoot, 'dist-app', 'extensions', 'data'),
  join(appRoot, 'dist-app', 'extensions', 'documents'),
  join(appRoot, 'dist-app', 'extensions', 'images'),
  join(appRoot, 'dist-app', 'extensions', 'models'),
  join(appRoot, 'dist-app', 'extensions', 'vector'),
  join(appRoot, 'dist-app', 'extensions', 'video'),
]

for (const entry of requiredStagedEntries) {
  if (!existsSync(entry)) throw new Error(`staged Electron app is missing ${entry}`)
}

const auditRuntimeResolution = () => {
  const runtime = join(appRoot, 'dist-app', 'main-runtime', 'dist', 'index.js')
  const requireFromRuntime = createRequire(runtime)
  const expectedRoot = resolve(appRoot, 'dist-app', 'node_modules')
  const packages = ['@modkit/host', '@modkit/codec-kit', '@rgrove/parse-xml', 'smol-toml', 'yaml']
  return packages.map(name => {
    let resolved
    try {
      resolved = resolve(requireFromRuntime.resolve(`${name}/package.json`))
    } catch {
      let current = dirname(resolve(requireFromRuntime.resolve(name)))
      for (;;) {
        const manifest = join(current, 'package.json')
        if (existsSync(manifest) && readJson(manifest).name === name) {
          resolved = manifest
          break
        }
        const parent = dirname(current)
        if (parent === current) break
        current = parent
      }
    }
    if (resolved === undefined) {
      throw new Error(`${name} package manifest is not resolvable from staged runtime`)
    }
    if (resolved !== resolve(expectedRoot, ...name.split('/'), 'package.json')) {
      throw new Error(`${name} resolves outside staged dist-app node_modules: ${resolved}`)
    }
    return { package: name, source: 'dist-app/node_modules' }
  })
}

const resolutionAudit = usesExplicitAppRoot ? auditRuntimeResolution() : []

try {
  for (const item of included) {
    const value = casesInput[item.id]
    const source =
      typeof value === 'string'
        ? { path: value }
        : typeof value === 'object' && value !== null
          ? value
          : undefined
    if (source === undefined) {
      throw new Error(`missing explicit local file for format-smoke case ${item.id}`)
    }
    const requestedBoundary =
      typeof source.boundary === 'string' ? source.boundary : boundaryFor(item.corpus.kind)
    if (!['direct-file', 'container-file', 'product-container-entry'].includes(requestedBoundary)) {
      throw new Error(
        `${item.id}: runner supports direct/container files and product container entries; ${requestedBoundary} is not implemented`,
      )
    }
    const fileName = basename(item.corpus.path)
    if (fileNames.has(fileName.toLowerCase())) {
      throw new Error(`${item.id}: duplicate smoke workspace basename ${fileName}`)
    }
    fileNames.add(fileName.toLowerCase())
    if (requestedBoundary === 'product-container-entry') {
      if (typeof source.parentPath !== 'string' || source.parentPath.trim() === '') {
        throw new Error(`${item.id}: product-container-entry requires explicit parentPath`)
      }
      const parentPath = resolve(source.parentPath)
      if (!existsSync(parentPath)) {
        throw new Error(`${item.id}: explicit parentPath is missing`)
      }
      const parentStats = statSync(parentPath)
      if (item.corpus.kind === 'sc2-casc-entry') {
        if (!parentStats.isDirectory()) {
          throw new Error(
            `${item.id}: SC2 CASC product-container-entry parentPath must be a directory`,
          )
        }
      } else if (!parentStats.isFile()) {
        throw new Error(`${item.id}: product-container-entry parentPath must be a file`)
      }
      grants.add(parentStats.isDirectory() ? parentPath : dirname(parentPath))
      planned.push({
        caseId: item.id,
        fileName,
        boundary: requestedBoundary,
        stage: item.stage,
        parentPath,
        entryPath: typeof source.entryPath === 'string' ? source.entryPath : item.corpus.path,
      })
      continue
    }
    if (typeof source.path !== 'string' || source.path.trim() === '') {
      throw new Error(`missing explicit local file for format-smoke case ${item.id}`)
    }
    const sourcePath = resolve(source.path)
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      throw new Error(`${item.id}: explicit local file is missing or not a file`)
    }
    const sourceBytes = readFileSync(sourcePath)
    const sourceSha256 = sha256(sourceBytes)
    if (sourceBytes.byteLength !== item.corpus.bytes || sourceSha256 !== item.corpus.sha256) {
      throw new Error(
        `${item.id}: local file bytes/hash mismatch expected=${item.corpus.bytes}/${item.corpus.sha256} actual=${sourceBytes.byteLength}/${sourceSha256}`,
      )
    }
    copyFileSync(sourcePath, join(workspace, fileName))
    planned.push({ caseId: item.id, fileName, boundary: requestedBoundary, stage: item.stage })
  }

  const plan = {
    kind: 'x3.electron/format-smoke-plan',
    schemaVersion: 1,
    authoritySha256,
    cases: planned,
    ...(resolutionAudit.length === 0 ? {} : { resolutionAudit }),
  }
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`)

  const strippedFromChildEnv = new Set([
    'NODE_PATH',
    'MODKIT_EXTENSION_REGISTRY',
    'MODKIT_EXTENSION_ALLOWED_ORIGINS',
    'MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS',
    'MODKIT_EXTENSION_INSTALL_DIR',
  ])
  const childEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !strippedFromChildEnv.has(name)),
    ),
    MODKIT_ELECTRON_FORMAT_SMOKE_PLAN: planPath,
    MODKIT_ELECTRON_USER_DATA_DIR: userData,
  }

  const child = spawn(
    electronPath,
    [
      join(appRoot, 'electron', 'main.cjs'),
      '--selftest',
      '--format-smoke-only',
      '--format-smoke-plan',
      planPath,
      '--open',
      workspace,
      ...[...grants].flatMap(value => ['--grant', value]),
    ],
    {
      cwd: appRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    const text = chunk.toString()
    stdout += text
    process.stdout.write(text)
  })
  child.stderr.on('data', chunk => {
    const text = chunk.toString()
    stderr += text
    process.stderr.write(text)
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, timeoutMs)
  const code = await new Promise(resolve => child.on('exit', resolve))
  clearTimeout(timer)

  const receiptLine = stdout
    .split(/\r?\n/u)
    .map(line => line.match(/\[renderer\] selftest: format-smoke (\{.*\})$/u)?.[1])
    .find(Boolean)
  if (receiptLine !== undefined && receiptPath !== undefined) {
    const target = resolve(receiptPath)
    mkdirSync(dirname(target), { recursive: true })
    const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(tmp, `${JSON.stringify(JSON.parse(receiptLine), null, 2)}\n`)
    renameSync(tmp, target)
  }
  if (timedOut) throw new Error(`Electron format-smoke run timed out after ${timeoutMs}ms`)
  if (code !== 0) throw new Error(`Electron exited with code ${String(code)}\n${stderr}`)
  if (receiptLine === undefined) throw new Error('Electron did not print a format-smoke receipt')
  const receipt = JSON.parse(receiptLine)
  if (receipt.verdict !== 'pass') {
    throw new Error(`Electron format-smoke verdict=${receipt.verdict}`)
  }
} finally {
  if (!keepWorkspace) {
    rmSync(workspace, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
}
