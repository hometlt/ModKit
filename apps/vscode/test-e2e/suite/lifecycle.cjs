/**
 * Runs inside a real VS Code extension-test host. The state file makes the suite a three-phase
 * state machine because `workbench.action.reloadWindow` destroys this extension host and starts a
 * fresh one. Seeing phases two and three is therefore the assertion that reload actually occurred.
 */
'use strict'
/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')

const INJECTED_ERROR = 'x3.block14/injected-update-activation-failure'

// MODKITX_* remains a deprecated read-only alias so older local smoke launchers still work.
const required = name => {
  const value = process.env[name] ?? process.env[name.replace(/^MODKIT_/, 'MODKITX_')]
  if (value === undefined || value === '') throw new Error(`${name} is not set`)
  return value
}

const stagePath = required('MODKIT_LIFECYCLE_STAGE')
const currentPath = required('MODKIT_LIFECYCLE_CURRENT_EXTENSION')
const statePath = required('MODKIT_LIFECYCLE_STATE')
const resultsPath = required('MODKIT_LIFECYCLE_RESULTS')
const expectedHead = required('MODKIT_LIFECYCLE_EXPECTED_HEAD')
const expectedVersion = required('MODKIT_LIFECYCLE_EXPECTED_VERSION')
const expectedDigests = JSON.parse(required('MODKIT_LIFECYCLE_EXPECTED_DIGESTS'))

const digest = file =>
  `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`

const samePath = (left, right) =>
  path.resolve(String(left)).toLowerCase() === path.resolve(String(right)).toLowerCase()

const readState = () =>
  fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
    : { phase: 'predecessor', reloadsRequested: 0 }

const writeState = state => fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)

const stagedExtension = () => {
  const extension = vscode.extensions.all.find(candidate =>
    samePath(candidate.extensionPath, stagePath),
  )
  if (extension === undefined) throw new Error('VS Code did not enumerate the staged extension')
  return extension
}

function copyCurrentShell() {
  const names = Object.keys(expectedDigests)
  for (const name of names) {
    const source = path.join(currentPath, 'dist-app', name)
    const target = path.join(stagePath, 'dist-app', name)
    const temporary = `${target}.lifecycle-next`
    fs.copyFileSync(source, temporary)
    fs.renameSync(temporary, target)
  }
  const manifest = path.join(stagePath, 'package.json')
  const temporaryManifest = `${manifest}.lifecycle-next`
  fs.copyFileSync(path.join(currentPath, 'package.json'), temporaryManifest)
  fs.renameSync(temporaryManifest, manifest)
}

function installBrokenUpdate() {
  copyCurrentShell()
  fs.appendFileSync(
    path.join(stagePath, 'dist-app', 'extension.cjs'),
    `\nthrow new Error(${JSON.stringify(INJECTED_ERROR)});\n`,
  )
}

function observedDigests() {
  return Object.fromEntries(
    Object.keys(expectedDigests).map(name => [
      name,
      digest(path.join(stagePath, 'dist-app', name)),
    ]),
  )
}

const equalRecords = (left, right) => JSON.stringify(left) === JSON.stringify(right)

async function requestReload(state) {
  writeState({ ...state, reloadsRequested: state.reloadsRequested + 1 })
  await vscode.commands.executeCommand('workbench.action.reloadWindow')
  await new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error('VS Code did not replace this extension host')), 30_000)
  })
}

async function runPredecessor(state) {
  const extension = stagedExtension()
  const beforeDigest = digest(path.join(stagePath, 'dist-app', 'extension.cjs'))
  if (extension.packageJSON.version !== '0.0.0') {
    throw new Error(`expected predecessor version 0.0.0, got ${extension.packageJSON.version}`)
  }
  if (beforeDigest === expectedDigests['extension.cjs']) {
    throw new Error('the predecessor entry already equals the current-head entry')
  }
  await extension.activate()
  await vscode.commands.executeCommand('modkit.explainResolution')
  installBrokenUpdate()
  return requestReload({
    ...state,
    phase: 'broken-update-installed',
    predecessor: {
      version: extension.packageJSON.version,
      entryDigest: beforeDigest,
      activated: extension.isActive,
    },
    brokenUpdate: {
      version: expectedVersion,
      injectedError: INJECTED_ERROR,
      differsFromCurrentHead:
        digest(path.join(stagePath, 'dist-app', 'extension.cjs')) !==
        expectedDigests['extension.cjs'],
    },
  })
}

async function runBrokenUpdate(state) {
  const extension = stagedExtension()
  let activationError = null
  try {
    await extension.activate()
  } catch (error) {
    activationError = error instanceof Error ? error.message : String(error)
  }
  if (activationError === null || !activationError.includes(INJECTED_ERROR)) {
    throw new Error(
      `the broken update did not fail with ${INJECTED_ERROR}: ${activationError ?? 'no error'}`,
    )
  }
  copyCurrentShell()
  return requestReload({
    ...state,
    phase: 'current-head-installed',
    brokenUpdate: {
      ...state.brokenUpdate,
      activationError,
      failureObserved: true,
    },
    recoveryInstall: {
      exactCurrentHeadBeforeReload: equalRecords(observedDigests(), expectedDigests),
    },
  })
}

async function runRecovered(state) {
  const extension = stagedExtension()
  const currentDigests = observedDigests()
  const commandsBeforeActivation = await vscode.commands.getCommands(true)
  await extension.activate()
  const commandsAfterActivation = await vscode.commands.getCommands(true)
  await vscode.commands.executeCommand('modkit.explainResolution')
  const exactCurrentHead = equalRecords(currentDigests, expectedDigests)
  const currentVersion = extension.packageJSON.version === expectedVersion
  const commandRecovered = commandsAfterActivation.includes('modkit.explainResolution')
  const allPassed =
    state.reloadsRequested === 2 &&
    state.brokenUpdate?.failureObserved === true &&
    state.recoveryInstall?.exactCurrentHeadBeforeReload === true &&
    exactCurrentHead &&
    currentVersion &&
    extension.isActive &&
    commandRecovered
  const result = {
    currentHead: expectedHead,
    predecessor: state.predecessor,
    brokenUpdate: state.brokenUpdate,
    reload: {
      requested: state.reloadsRequested,
      observedFreshExtensionHosts: 2,
    },
    recovery: {
      installedVersion: extension.packageJSON.version,
      expectedVersion,
      exactCurrentHead,
      shellDigests: currentDigests,
      activated: extension.isActive,
      commandWasPresentBeforeActivation: commandsBeforeActivation.includes(
        'modkit.explainResolution',
      ),
      commandRegisteredAfterActivation: commandRecovered,
      commandExecutedAfterRecovery: true,
    },
    allPassed,
  }
  fs.mkdirSync(path.dirname(resultsPath), { recursive: true })
  fs.writeFileSync(resultsPath, `${JSON.stringify(result, null, 2)}\n`)
  writeState({ ...state, phase: 'complete', result })
  if (!allPassed) throw new Error(`lifecycle assertions failed: ${JSON.stringify(result)}`)
}

exports.run = async function run() {
  const state = readState()
  if (state.phase === 'predecessor') return runPredecessor(state)
  if (state.phase === 'broken-update-installed') return runBrokenUpdate(state)
  if (state.phase === 'current-head-installed') return runRecovered(state)
  if (state.phase === 'complete') return undefined
  throw new Error(`unknown lifecycle phase: ${state.phase}`)
}
