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
 *   node modkit-core/scripts/acceptance-snapshot.mjs [--repo modkit-extensions-blizzard] [--rebuild]
 *
 * A copy is moved to the repository's current HEAD, reinstalled when its lockfile changed and
 * rebuilt when its commit changed (or with --rebuild). Uncommitted work never reaches it. A copy
 * that does not build keeps no `.acceptance-built` marker, and the launcher uses the live repository
 * for it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const coding = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const snapshotRoot = join(coding, '.acceptance')
const REPOSITORIES = [
  'modkit-extensions-blizzard',
  'modkit-extensions-warzone',
  'modkit-extensions-ea',
  'modkit-extensions-spring',
  'modkit-extensions-other',
]

const argument = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const only = argument('--repo')
const rebuild = process.argv.includes('--rebuild')

const run = (command, args, cwd, capture = false) => {
  const result = spawnSync(command, args, {
    cwd,
    shell: process.platform === 'win32',
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}${capture ? `: ${result.stderr}` : ''}`)
  }
  return capture ? result.stdout.trim() : ''
}
const git = (cwd, ...args) => run('git', args, cwd, true)
const readText = path => (existsSync(path) ? readFileSync(path, 'utf8') : undefined)

const failed = []
for (const repository of REPOSITORIES) {
  if (only !== undefined && only !== repository) continue
  const live = join(coding, repository)
  if (!existsSync(join(live, '.git'))) continue
  const target = join(snapshotRoot, repository)
  const head = git(live, 'rev-parse', 'HEAD')
  const marker = join(target, '.acceptance-built')
  console.log(`== ${repository} @ ${head.slice(0, 8)}`)
  try {
    if (!existsSync(target)) {
      git(live, 'worktree', 'prune')
      git(live, 'worktree', 'add', '--detach', target, head)
    } else if (git(target, 'rev-parse', 'HEAD') !== head) {
      // Only this script writes here; build outputs are untracked and survive the move.
      git(target, 'checkout', '--detach', '--force', head)
    }

    const lock = readText(join(target, 'pnpm-lock.yaml'))
    const installed = readText(join(target, 'node_modules', '.acceptance-lock'))
    if (lock !== undefined && (installed !== lock || !existsSync(join(target, 'node_modules')))) {
      run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], target)
      writeFileSync(join(target, 'node_modules', '.acceptance-lock'), lock)
    }

    const scripts = JSON.parse(readText(join(target, 'package.json')) ?? '{}').scripts ?? {}
    if (scripts.build !== undefined && (rebuild || readText(marker) !== head)) {
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
