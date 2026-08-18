// HW-05 — a synchronous infinite loop on `hang`: the event loop is dead, `cancel` and `terminate`
// frames cannot be processed; only `worker.terminate()` from outside ends it (acc-4).
import { serveDemoChain } from './_lib.mjs'

serveDemoChain({
  onCall(frame) {
    if (frame.method === 'hang') {
      for (;;) {
        // spin
      }
    }
    return undefined
  },
})
