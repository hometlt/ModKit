// In-process bench workload (C3): resolve+explain per contract (§6: < 1 ms/contract).
import { resolveProvider } from '@modkitx-x3/host'

const offers = [
  {
    kind: 'primary',
    extensionId: 'org.bench/greeters',
    extensionVersion: '1.0.0',
    providerId: 'org.bench/plain',
    runtimeVariant: 'portable',
    target: { environments: ['node'] },
    provides: [{ contract: 'x3.demo/greeter', version: '1.2.0' }],
    outputs: ['demo.plain'],
  },
  {
    kind: 'primary',
    extensionId: 'org.bench/greeters',
    extensionVersion: '1.0.0',
    providerId: 'org.bench/fancy',
    runtimeVariant: 'portable',
    target: { environments: ['node'] },
    provides: [{ contract: 'x3.demo/greeter', version: '1.4.0' }],
    outputs: ['demo.plain', 'demo.fancy'],
  },
]

const request = {
  contract: { contract: 'x3.demo/greeter', major: 1 },
  target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
  preferredOutputs: ['demo.fancy'],
}

const WARMUP = 3
const N = 100
const samples = []
for (let i = 0; i < WARMUP + N; i += 1) {
  const t0 = performance.now()
  const result = resolveProvider(request, offers)
  const ms = performance.now() - t0
  if (result.state !== 'resolved') throw new Error('bench resolution failed')
  if (i >= WARMUP) samples.push(ms)
}
samples.sort((a, b) => a - b)
const pick = p =>
  samples[Math.max(0, Math.min(samples.length - 1, Math.ceil((p / 100) * samples.length) - 1))]
console.log(JSON.stringify({ p50: pick(50), p95: pick(95), n: N }))
