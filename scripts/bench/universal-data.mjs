#!/usr/bin/env node
import { createTextSyntaxProvider } from '../../extensions/common/text-data/src/providers/index.js'
import { VirtualTextModel } from '../../packages/ui/dist/text-virtual/index.js'
import { HexWindowModel } from '../../packages/ui/dist/hex/index.js'

const gate = process.argv.includes('--gate')
const MiB = 1024 * 1024

function memory() {
  globalThis.gc?.()
  return process.memoryUsage().heapUsed
}

async function measured(id, budget, run) {
  const before = memory()
  const started = performance.now()
  const evidence = await run()
  const elapsedMs = performance.now() - started
  const heapDeltaMiB = Math.max(0, memory() - before) / MiB
  const result = { id, elapsedMs, heapDeltaMiB, ...evidence, budget }
  const failures = []
  if (elapsedMs > budget.elapsedMs) failures.push(`time ${elapsedMs.toFixed(1)}ms`)
  if (heapDeltaMiB > budget.heapDeltaMiB) failures.push(`heap ${heapDeltaMiB.toFixed(1)}MiB`)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return failures
}

const failures = []
failures.push(
  ...(await measured(
    'csv-million-random-row',
    { elapsedMs: 10_000, heapDeltaMiB: 256 },
    async () => {
      const rows = 1_000_000
      const input = 'left,right\n'.repeat(rows)
      const provider = createTextSyntaxProvider('common.text-data/csv-syntax')
      const lease = await provider.dataSource({
        input: { text: input },
        dialect: 'csv-rfc4180',
        budget: {
          maxInputBytes: 20_000_000n,
          maxDepth: 128,
          maxNodes: 2,
          maxScalarBytes: 1_000_000,
          maxDiagnostics: 100,
        },
      })
      const first = await lease.value.rows({ kind: 'range', from: 0, count: 2 })
      const last = await lease.value.rows({ kind: 'range', from: rows - 1, count: 1 })
      await lease.release()
      if (first.items.length !== 2 || last.items[0]?.index !== rows - 1) {
        throw new Error('million-row paging returned the wrong bounded windows')
      }
      return { logicalRows: rows, materializedRows: first.items.length + last.items.length }
    },
  )),
)

failures.push(
  ...(await measured(
    'virtual-text-100mib-line',
    { elapsedMs: 2_000, heapDeltaMiB: 32 },
    async () => {
      const logicalBytes = 100n * 1024n * 1024n
      const requests = []
      const model = new VirtualTextModel({
        async info() {
          return {
            bytes: logicalBytes,
            encoding: 'utf-8',
            bom: false,
            newline: 'none',
            lines: 1,
            longestLineBytes: 'unknown',
          }
        },
        async slice(request) {
          requests.push(request)
          const text = 'x'.repeat(request.maxBytes)
          return request.kind === 'from-line'
            ? { complete: false, text, fromLine: 0, lineCount: 0, nextCursor: 'next' }
            : { complete: true, text, fromLine: 0, lineCount: 1 }
        },
        async *search() {
          yield* []
        },
      })
      await model.first()
      await model.next()
      const maximumRequestedBytes = Math.max(...requests.map(request => request.maxBytes))
      if (requests.length !== 2 || maximumRequestedBytes > 64 * 1024) {
        throw new Error('virtual text model attempted an eager or oversized read')
      }
      return {
        logicalBytes: logicalBytes.toString(10),
        reads: requests.length,
        maximumRequestedBytes,
      }
    },
  )),
)

failures.push(
  ...(await measured(
    'hex-bigint-random-access',
    { elapsedMs: 2_000, heapDeltaMiB: 16 },
    async () => {
      const size = 2n ** 63n + 8192n
      const offset = 2n ** 63n
      const reads = []
      const model = new HexWindowModel({
        async size() {
          return size
        },
        async read(readOffset, length) {
          reads.push({ offset: readOffset, length })
          return new Uint8Array(length)
        },
      })
      const window = await model.read(offset)
      if (reads.length !== 1 || reads[0].length !== 4096 || window.offset !== offset) {
        throw new Error('hex model lost bigint precision or exceeded its bounded window')
      }
      return { logicalBytes: size.toString(10), reads: reads.length, requestedBytes: 4096 }
    },
  )),
)

if (gate && failures.length > 0) {
  process.stderr.write(`universal data performance gate failed: ${failures.join('; ')}\n`)
  process.exitCode = 1
} else if (gate) {
  process.stdout.write('universal data performance gate: passed\n')
} else {
  process.stdout.write('informational universal data benchmark\n')
}
