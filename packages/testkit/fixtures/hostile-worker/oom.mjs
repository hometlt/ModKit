// HW-07 — allocates until the V8 heap limit set through `resourceLimits` is hit. Node terminates
// the worker with `ERR_WORKER_OUT_OF_MEMORY` (an 'error' then 'exit'); the host must see a plain
// peer exit, and the host process must survive untouched (acc-5).
import { serveDemoChain } from './_lib.mjs'

const hoard = []
serveDemoChain({
  onCall(frame) {
    if (frame.method === 'hang') {
      const grow = () => {
        // 1 MiB of live objects per tick, kept reachable
        for (let i = 0; i < 4_096; i += 1) hoard.push({ i, pad: new Array(32).fill(i) })
        setImmediate(grow)
      }
      grow()
      return 'handled'
    }
    return undefined
  },
})
