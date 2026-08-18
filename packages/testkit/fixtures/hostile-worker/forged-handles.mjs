// HW-10 — the worker calls host-owned handles it was never given. `options.variant`:
//  - 'unknown'  (default): `call` on `h<gen>-77`, a host handle that does not exist → violation
//                `unknown-handle`, host fails closed, worker is terminated;
//  - 'foreign-owner': `call` on a `w…` handle sent *to the host* → `unknown-handle` violation;
//  - 'released': the test passes a host lease ref through `echo`, releases it, then asks the
//                fixture (via `echo('forge')`) to call it → the host answers with a structured
//                `x3.host/rpc-released-handle` throw and stays open; the fixture reports the code
//                back through `echo('forged-reply')`.
import { generation, options, post, serveDemoChain } from './_lib.mjs'

const variant = typeof options.variant === 'string' ? options.variant : 'unknown'
let seenRef
let forgedCallId
let forgedReply = 'none'

serveDemoChain({
  afterOpen() {
    if (variant === 'unknown') {
      post({ t: 'call', handle: `h${generation}-77`, method: 'size', args: [] })
    } else if (variant === 'foreign-owner') {
      post({ t: 'call', handle: `w${generation}-1`, method: 'size', args: [] })
    }
  },
  onCall(frame) {
    if (frame.method !== 'echo') return undefined
    const arg = frame.args[0]
    if (typeof arg === 'object' && arg !== null && '@x3.handle' in arg) {
      seenRef = arg['@x3.handle'].id
      post({ t: 'return', inReplyTo: frame.id, value: { seen: seenRef } })
      return 'handled'
    }
    if (arg === 'forge' && seenRef !== undefined) {
      forgedCallId = post({ t: 'call', handle: seenRef, method: 'size', args: [] })
      post({ t: 'return', inReplyTo: frame.id, value: 'forging' })
      return 'handled'
    }
    if (arg === 'forged-reply') {
      post({ t: 'return', inReplyTo: frame.id, value: forgedReply })
      return 'handled'
    }
    return undefined
  },
  onFrame(frame) {
    if (frame.t === 'throw' && forgedCallId !== undefined && frame.inReplyTo === forgedCallId) {
      forgedReply = frame.error?.code ?? 'throw-without-code'
    }
    if (frame.t === 'return' && forgedCallId !== undefined && frame.inReplyTo === forgedCallId) {
      forgedReply = 'return'
    }
  },
})
