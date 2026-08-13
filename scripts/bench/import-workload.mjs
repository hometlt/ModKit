// Cold-import workload (C3 protocol): measures what a host actually pays the first time
// it loads the package in a process — the whole module graph, nothing cached.
//
// The timer wraps only the dynamic import, so process startup is excluded by construction
// (the harness spawns this script once per sample and aggregates; a warm re-import with a
// cache-busting query was tried and rejected as dishonest: it re-evaluates the entry file
// while its dependency graph stays cached, which is not a cost anyone pays).
//
// Usage: node import-workload.mjs core|closure   → prints a single duration in ms

import process from 'node:process'

const which = process.argv[2] ?? 'core'
const packages =
  which === 'closure'
    ? ['@modkitx-x3/core', '@modkitx-x3/sdk', '@modkitx-x3/vfs', '@modkitx-x3/host']
    : ['@modkitx-x3/core']

const t0 = performance.now()
for (const name of packages) await import(name)
console.log(performance.now() - t0)
