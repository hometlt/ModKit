// HW-01 — prototype pollution attempts: an own `__proto__` key inside a return value, then an
// unknown key on a frame. Either must be a violation on the host (`forbidden-key`/`unknown-key`);
// nothing may reach `Object.prototype`.
import { post, serveDemoChain } from './_lib.mjs'

serveDemoChain({
  onCall(frame) {
    if (frame.method !== 'descriptor') return undefined
    // JSON.parse creates a real own property named __proto__ (an object literal would not)
    const polluted = JSON.parse('{"id":"demo","__proto__":{"admin":true}}')
    post({ t: 'return', inReplyTo: frame.id, value: polluted })
    return 'handled'
  },
})
