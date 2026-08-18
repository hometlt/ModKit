// HW-04 — an uncaught exception after `ready`: the Worker emits 'error' and exits; the host sees a
// peer exit (with the error on the harness), never a hang.
import { serveDemoChain } from './_lib.mjs'

serveDemoChain({
  onCall(frame) {
    if (frame.method === 'hang') {
      setTimeout(() => {
        throw new Error('boom from the fixture')
      }, 5)
      return 'handled'
    }
    return undefined
  },
})
