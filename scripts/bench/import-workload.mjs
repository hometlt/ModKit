// Cold-import workload (C3 protocol): measures what a host actually pays the first time it
// loads a module graph in a process — nothing cached in-process.
//
// The timer wraps only the dynamic import, so process startup is excluded by construction;
// the harness spawns this script once per sample and aggregates.
//
// Targets:
//   core     @modkit/core
//   closure  core + sdk + vfs + host
//
// Usage: node import-workload.mjs <target>   → prints a single duration in ms

import process from 'node:process'

const target = process.argv[2] ?? 'core'
const targets = {
  core: ['@modkit/core'],
  closure: ['@modkit/core', '@modkit/sdk', '@modkit/vfs', '@modkit/host'],
}

const specifiers = targets[target]
if (!specifiers) throw new Error(`unknown import target «${target}»`)

const t0 = performance.now()
for (const specifier of specifiers) await import(specifier)
console.log(performance.now() - t0)
