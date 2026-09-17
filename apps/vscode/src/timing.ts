/**
 * Phase timing for the paths a person waits on.
 *
 * Opening an asset crosses three boundaries — extension activation, the subject open in the
 * extension host, and the page's own mount — and "it feels slow" is unactionable without knowing
 * which of them spent the time. Every phase is written to the output channel, so a profile comes
 * from the machine that felt slow rather than from a developer's.
 *
 * Deliberately trivial: `performance.now()` and a string. Anything that needed a budget, a
 * sampler or a buffer would be a profiler, and this has to be cheap enough to leave switched on.
 */
export interface PhaseLog {
  /** Start a phase; the returned function ends it and writes the line. */
  phase(name: string): () => void
  /** Time an awaited step. */
  step<T>(name: string, work: () => Promise<T>): Promise<T>
  /** Record a duration measured elsewhere (the page reports its own marks this way). */
  mark(name: string, milliseconds: number): void
}

export function createPhaseLog(write: (line: string) => void): PhaseLog {
  const round = (value: number): string => value.toFixed(0)
  return {
    phase(name) {
      const started = performance.now()
      return () => write(`[timing] ${name}: ${round(performance.now() - started)} ms`)
    },
    async step(name, work) {
      const started = performance.now()
      try {
        return await work()
      } finally {
        write(`[timing] ${name}: ${round(performance.now() - started)} ms`)
      }
    },
    mark(name, milliseconds) {
      write(`[timing] ${name}: ${round(milliseconds)} ms`)
    },
  }
}
