// HW-08 — after `subscribe`, floods `event` frames without pause (`options.count`, default
// 100 000). The consumer's bounded queue must overflow deterministically
// (`x3.host/rpc-events-overflow` + `unsubscribe`), the endpoint must stay open, and the host must
// not buffer the flood (acc-5). Events after `unsubscribe` are ignored by the host and counted.
import { generation, handleRef, options, post, serveDemoChain } from './_lib.mjs'

const count = typeof options.count === 'number' ? options.count : 100_000
const EVENTS_HANDLE = 9
let subscriptions = 0
let unsubscribed = false

serveDemoChain({
  onCall(frame) {
    if (frame.method === 'events') {
      post({ t: 'return', inReplyTo: frame.id, value: handleRef(EVENTS_HANDLE, 'events') })
      return 'handled'
    }
    return undefined
  },
  onSubscribe(frame) {
    subscriptions += 1
    const subscription = `ws${generation}-${subscriptions}`
    // subscribe is answered with the subscription id, then the flood begins
    post({ t: 'return', inReplyTo: frame.id, value: subscription })
    let sent = 0
    const burst = () => {
      if (unsubscribed) return
      for (let i = 0; i < 1_000 && sent < count; i += 1, sent += 1) {
        post({ t: 'event', subscription, value: { tick: sent } })
      }
      if (sent < count) setImmediate(burst)
      else post({ t: 'done', handle: `w${generation}-${EVENTS_HANDLE}` })
    }
    burst()
  },
  onFrame(frame) {
    if (frame.t === 'unsubscribe') unsubscribed = true
  },
})
