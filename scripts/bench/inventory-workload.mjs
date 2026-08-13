// In-process bench workload (C3 protocol): inventory of 100 synthetic manifests.
// Prints {p50,p95,n} of per-iteration duration; process startup excluded by design.
import { buildInventory } from '@modkitx-x3/host'
import { createSpecSchemaRegistry } from '@modkitx-x3/sdk'

const registry = createSpecSchemaRegistry([
  {
    contract: 'x3.demo/greeter',
    major: 1,
    schema: { type: 'object', properties: { greeting: { type: 'string' } } },
  },
])

const inputs = Array.from({ length: 100 }, (_, i) => {
  const path = `contributions/c${i}.json`
  return {
    source: `synthetic-${i}`,
    containers: {
      standalone: {
        schemaVersion: 1,
        publisher: 'org.bench',
        id: `pack-${i}`,
        version: '1.0.0',
        license: 'MIT',
        contributionManifests: ['./contributions/*.json'],
      },
    },
    files: [path],
    documents: new Map([
      [
        path,
        {
          schemaVersion: 1,
          contract: { id: 'x3.demo/greeter', major: 1 },
          id: `org.bench/c${i}`,
          displayName: `c${i}`,
          spec: { greeting: 'hi' },
        },
      ],
    ]),
  }
})

const WARMUP = 3
const N = 100
const samples = []
for (let i = 0; i < WARMUP + N; i += 1) {
  const t0 = performance.now()
  await buildInventory(inputs, registry)
  const ms = performance.now() - t0
  if (i >= WARMUP) samples.push(ms)
}
samples.sort((a, b) => a - b)
const pick = p =>
  samples[Math.max(0, Math.min(samples.length - 1, Math.ceil((p / 100) * samples.length) - 1))]
console.log(JSON.stringify({ p50: pick(50), p95: pick(95), n: N }))
