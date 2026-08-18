// HW-03 (variant) — a legitimate start, then the worker exits while a call is in flight: pending
// calls reject with `x3.host/rpc-peer-exited`, host-side leases are released, counters drain
// (acc-2).
import { exit, serveDemoChain } from './_lib.mjs'

serveDemoChain({
  onCall(frame) {
    if (frame.method === 'hang') {
      // never answer: die instead, a tick later so the call is really pending on the host
      setTimeout(() => exit(7), 5)
      return 'handled'
    }
    return undefined
  },
})
