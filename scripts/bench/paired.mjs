// Paired measurement for process-level scenarios (owner instruction 5, 2026-08-14).
//
// The earlier design timed every bare-node run first and every target run afterwards, then
// subtracted the two medians. Any load change between the blocks lands entirely in the
// result. Here each bare run is immediately followed by its target run and the pair is
// subtracted at once, so a drift that affects both halves cancels instead of accumulating.
//
// `timeOnce` is injected so the property can be tested with deterministic timings; the
// harness passes a spawn-based implementation.

export function percentileOf(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))]
}

export function pairedStats({ timeOnce, n, warmup = 3 }) {
  const differences = []
  const rawSamples = []
  for (let i = 0; i < n + warmup; i += 1) {
    const bare = timeOnce('bare')
    const withTarget = timeOnce('target')
    if (i >= warmup) {
      differences.push(withTarget - bare)
      rawSamples.push(withTarget)
    }
  }
  const p50 = percentileOf(differences, 50)
  return {
    p50,
    p95: percentileOf(differences, 95),
    spread: p50 === 0 ? 0 : (percentileOf(differences, 75) - percentileOf(differences, 25)) / p50,
    n: differences.length,
    rawP50: percentileOf(rawSamples, 50),
  }
}
