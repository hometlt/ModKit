// Cold-import workload (C3 protocol): measures what a host actually pays the first time it
// loads a module graph in a process — nothing cached in-process.
//
// The timer wraps only the dynamic import, so process startup is excluded by construction;
// the harness spawns this script once per sample and aggregates.
//
// Targets — measurands and calibration probes are deliberately measured by the SAME code
// path, because a probe that runs differently from the measurand proves nothing (that was
// the flaw of the previous floor probe, which imported a file it had just written itself):
//
//   core     @modkitx-x3/core                      (measurand)
//   closure  core + sdk + vfs + host               (measurand)
//   probe1   one pre-existing module               (calibration)
//   probe9   pre-existing 9-module barrel graph    (calibration)
//
// Usage: node import-workload.mjs <target>   → prints a single duration in ms

import process from 'node:process'

const target = process.argv[2] ?? 'core'
// A file: URL, not a path: on Windows an absolute path is not a valid ESM specifier.
const fixture = name => new URL(`./fixtures/${name}/index.mjs`, import.meta.url).href

const targets = {
  core: ['@modkitx-x3/core'],
  closure: ['@modkitx-x3/core', '@modkitx-x3/sdk', '@modkitx-x3/vfs', '@modkitx-x3/host'],
  probe1: [fixture('probe1')],
  probe9: [fixture('probe9')],
}

const specifiers = targets[target]
if (!specifiers) throw new Error(`unknown import target «${target}»`)

const t0 = performance.now()
for (const specifier of specifiers) await import(specifier)
console.log(performance.now() - t0)
