// HW — output flood (T4/acc-10). A worker that tries to bury its supervisor in diagnostics:
// right after `ready` it writes 1 MiB to `stdout` *and* 1 MiB to `stderr` in 64 KiB chunks, then
// serves `terminate` like any well-behaved fixture. The harness caps captured output at
// `outputCapBytes` and flags `truncated`, so a hostile worker cannot turn the supervisor's own
// memory into its attack surface.
import { serveDemoChain } from './_lib.mjs'

const CHUNK_BYTES = 64 * 1024
const TOTAL_BYTES = 1024 * 1024
const chunk = 'x'.repeat(CHUNK_BYTES)

function flood() {
  for (let written = 0; written < TOTAL_BYTES; written += CHUNK_BYTES) {
    process.stdout.write(chunk)
    process.stderr.write(chunk)
  }
}

serveDemoChain({ afterReady: flood })
