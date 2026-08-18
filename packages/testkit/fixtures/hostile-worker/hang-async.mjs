// HW-06 — the event loop stays alive but `hang` is never answered and `cancel` is ignored: the
// deadline fires on the host, the cancel goes unacknowledged, the supervisor terminates after the
// grace period (acc-4). With `options.honourCancel === true` the fixture answers the cancel with a
// cancelled `throw`, which a live, well-behaved worker must do — then no termination happens.
import { options, post, serveDemoChain } from './_lib.mjs'

let pendingHang
serveDemoChain({
  onCall(frame) {
    if (frame.method === 'hang') {
      pendingHang = frame.id
      return 'handled'
    }
    return undefined
  },
  onCancel(frame) {
    if (options.honourCancel === true && frame.target === pendingHang) {
      post({
        t: 'throw',
        inReplyTo: pendingHang,
        error: {
          code: 'x3.core/operation-cancelled',
          message: 'cancelled',
          retryability: 'conditional',
          cancelled: true,
        },
      })
    }
  },
})
setInterval(() => undefined, 1_000) // keep the loop alive
