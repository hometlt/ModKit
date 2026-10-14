/**
 * The extension repositories as the owner tests them: a read-only worktree per repository at its
 * committed HEAD, installed and built there.
 *
 * VS Code loads extension roots straight from the folders it is pointed at, and the host pins every
 * file of a root in its artifact digest. When the roots are the live repositories, another agent
 * saving any file — committed or not — changes the digest, and the host refuses every contribution
 * of that root until the window restarts: the owner then sees a flat file list for a mod and no
 * references. The acceptance profile (run-vscode-modkit.ps1) loads these copies instead; nothing
 * but this script writes to them.
 *
 *   node modkit-core/scripts/acceptance-snapshot.mjs [--repo modkit-extensions-blizzard [--ref <commit>]] [--rebuild]
 *
 * A copy is moved to the repository's current HEAD (or the selected repository's --ref), reinstalled when its lockfile changed and
 * rebuilt when its commit changed (or with --rebuild). Uncommitted work never reaches it. A copy
 * that does not build keeps no `.acceptance-built` marker, and the launcher uses the live repository
 * for it.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync,
  symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const coding = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const snapshotRoot = join(coding, '.acceptance')
// pnpm's workspace links in sibling snapshots resolve through `.acceptance/modkit-core`.
// Keep that one link pointed at the shared, already-built core rather than silently falling
// back to live extension roots when TypeScript cannot resolve @modkit/* packages.
mkdirSync(snapshotRoot, { recursive: true })
const coreRoot = join(coding, 'modkit-core')
const coreLink = join(snapshotRoot, 'modkit-core')
if (existsSync(coreLink)) {
  if (realpathSync(coreLink).toLowerCase() !== realpathSync(coreRoot).toLowerCase())
    throw new Error(`${coreLink} must point at ${coreRoot}`)
} else symlinkSync(coreRoot, coreLink, process.platform === 'win32' ? 'junction' : 'dir')
const REPOSITORIES = [
  'modkit-extensions-blizzard',
  'modkit-extensions-warzone',
  'modkit-extensions-ea',
  'modkit-extensions-annihilation',
  'modkit-extensions-other',
  'modkit-extensions-petroglyph',
  'modkit-extensions-relic',
  'modkit-extensions-gas-powered',
  'modkit-extensions-realitypump',
  'modkit-extensions-idsoftware',
  'modkit-extensions-roblox',
  'modkit-extensions-minecraft',
  'modkit-extensions-dune2000',
  'multiverse',
  // Optional GPL Oodle decoder (rad/oodle): no lockfile, so no install; its build runs the core's tsc.
  'modkit-extensions-rad',
  // Optional Luau VM (question 56): no lockfile yet, so no install; its build is a stub for now.
  'modkit-extensions-luau',
]

const argument = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const only = argument('--repo')
if (process.argv.includes('--repo') && !REPOSITORIES.includes(only))
  throw new Error(`unknown acceptance repository: ${only}`)
const pinnedRef = argument('--ref')
if (process.argv.includes('--ref') &&
  (only === undefined || pinnedRef === undefined || pinnedRef.trim() === '' || pinnedRef.startsWith('--')))
  throw new Error('--ref requires --repo and a nonempty commit reference')
const rebuild = process.argv.includes('--rebuild')

const run = (command, args, cwd, capture = false) => {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === 'win32' && command !== 'git',
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}${capture ? `: ${result.stderr}` : ''}`,
    )
  }
  return capture ? result.stdout.trim() : ''
}
const git = (cwd, ...args) => run('git', args, cwd, true)
const readText = path => (existsSync(path) ? readFileSync(path, 'utf8') : undefined)
const installFingerprint = (target, lock) => {
  // pnpm links are absolute junctions: a snapshot that moved with the workspace must reinstall.
  const digest = createHash('sha256').update(target).update(lock)
  const vendor = join(target, 'vendor')
  if (existsSync(vendor)) {
    for (const name of readdirSync(vendor)
      .filter(item => item.endsWith('.tgz'))
      .sort()) {
      digest.update(name).update(readFileSync(join(vendor, name)))
    }
  }
  return digest.digest('hex')
}

const failed = []
for (const repository of REPOSITORIES) {
  if (only !== undefined && only !== repository) continue
  const live = join(coding, repository)
  if (!existsSync(join(live, '.git'))) continue
  const target = join(snapshotRoot, repository)
  const head = pinnedRef === undefined
    ? git(live, 'rev-parse', 'HEAD')
    : git(live, 'rev-parse', '--verify', '--end-of-options', `${pinnedRef}^{commit}`)
  const marker = join(target, '.acceptance-built')
  console.log(`== ${repository} @ ${head.slice(0, 8)}`)
  try {
    if (!existsSync(target)) {
      git(live, 'worktree', 'prune')
      git(live, 'worktree', 'add', '--relative-paths', '--detach', target, head)
    } else if (git(target, 'rev-parse', 'HEAD') !== head) {
      // Only this script writes here; build outputs are untracked and survive the move.
      git(target, 'checkout', '--detach', '--force', head)
    }

    const lock = readText(join(target, 'pnpm-lock.yaml'))
    const installed = readText(join(target, 'node_modules', '.acceptance-lock'))
    const fingerprint = lock === undefined ? undefined : installFingerprint(target, lock)
    const needsInstall =
      fingerprint !== undefined &&
      (installed !== fingerprint || !existsSync(join(target, 'node_modules')))
    if (needsInstall) {
      // pnpm may retain the old extraction of a file: vendor archive at the same path.
      // Without a TTY pnpm refuses to purge an existing modules directory unless told not to ask.
      run('pnpm', ['install', '--force', '--frozen-lockfile', '--prefer-offline', '--config.confirmModulesPurge=false'], target)
      writeFileSync(join(target, 'node_modules', '.acceptance-lock'), fingerprint)
    }

    const scripts = JSON.parse(readText(join(target, 'package.json')) ?? '{}').scripts ?? {}
    if (scripts.build !== undefined && (rebuild || needsInstall || readText(marker) !== head)) {
      run('pnpm', ['run', 'build'], target)
    }
    writeFileSync(marker, head)
    console.log(`   ready: ${target}`)
  } catch (error) {
    // The launcher falls back to the live repository for a copy without a build marker.
    rmSync(marker, { force: true })
    failed.push(repository)
    console.error(`   FAILED: ${error instanceof Error ? error.message : String(error)}`)
  }
}
if (failed.length > 0) {
  console.error(`Not built (the launcher uses the live repository): ${failed.join(', ')}`)
  process.exitCode = 1
}
