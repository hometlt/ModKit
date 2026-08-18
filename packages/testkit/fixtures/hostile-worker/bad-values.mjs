// HW-02 — values that structured clone carries but the wire grammar refuses. `options.variant`
// selects one: 'nan' (non-finite number), 'partial-view' (Uint8Array over a larger buffer),
// 'shared' (SharedArrayBuffer-backed view), 'deep' (nesting beyond maxDepth), 'unknown-frame-key'
// (an extra key on an otherwise valid return frame). Each is a violation on the host.
import { options, post, serveDemoChain } from './_lib.mjs'

const variant = typeof options.variant === 'string' ? options.variant : 'nan'

function payload() {
  switch (variant) {
    case 'partial-view':
      return new Uint8Array(new ArrayBuffer(16), 4, 4)
    case 'shared':
      return new Uint8Array(new SharedArrayBuffer(8))
    case 'deep': {
      let value = { leaf: true }
      for (let i = 0; i < 40; i += 1) value = { d: value }
      return value
    }
    case 'nan':
    default:
      return { n: Number.NaN }
  }
}

serveDemoChain({
  onCall(frame) {
    if (frame.method !== 'descriptor') return undefined
    if (variant === 'unknown-frame-key') {
      post({ t: 'return', inReplyTo: frame.id, value: { id: 'demo' }, extra: 1 })
    } else {
      post({ t: 'return', inReplyTo: frame.id, value: payload() })
    }
    return 'handled'
  },
})
