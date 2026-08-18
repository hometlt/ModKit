// HW-12 — reply games. `options.variant`:
//  - 'duplicate' (default): answers `descriptor` twice → `duplicate-reply`, fatal;
//  - 'unknown-id': answers a call id that never existed → `unknown-reply-target`, fatal;
//  - 'ready-for-call': answers `descriptor` with a `ready` frame → `unexpected-frame`, fatal;
//  - 'late-after-cancel': answers `hang` only after the host cancelled it → dropped and counted
//                         (`droppedLateReplies` + 1), the endpoint stays open — not a violation.
import { handleRef, MODULE, options, post, serveDemoChain } from './_lib.mjs'

const variant = typeof options.variant === 'string' ? options.variant : 'duplicate'
let pendingHang

serveDemoChain({
  onCall(frame) {
    if (frame.method === 'descriptor' && variant === 'duplicate') {
      post({ t: 'return', inReplyTo: frame.id, value: { id: 'demo', traits: [] } })
      post({ t: 'return', inReplyTo: frame.id, value: { id: 'demo', traits: [] } })
      return 'handled'
    }
    if (frame.method === 'descriptor' && variant === 'unknown-id') {
      post({ t: 'return', inReplyTo: frame.id + 5_000, value: { id: 'demo' } })
      return 'handled'
    }
    if (frame.method === 'descriptor' && variant === 'ready-for-call') {
      post({
        t: 'ready',
        inReplyTo: frame.id,
        abiVersion: 1,
        exports: ['x'],
        root: handleRef(1, 'lease', MODULE),
      })
      return 'handled'
    }
    if (frame.method === 'hang' && variant === 'late-after-cancel') {
      pendingHang = frame.id
      return 'handled'
    }
    return undefined
  },
  onCancel(frame) {
    if (variant === 'late-after-cancel' && frame.target === pendingHang) {
      // reply *after* the cancel with a plain value, as a slow but honest worker might
      setTimeout(() => post({ t: 'return', inReplyTo: pendingHang, value: 'too late' }), 5)
    }
  },
})
