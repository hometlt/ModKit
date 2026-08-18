// HW-14 — ignores the `terminate` frame, keeps its port and an interval alive. A supervisor must
// not wait forever: `release()` resolves within `graceMs + ε` because it calls
// `worker.terminate()` itself (acc-4/T13).
import { serveDemoChain } from './_lib.mjs'

serveDemoChain({
  onTerminate() {
    return 'handled' // silently ignore
  },
})
setInterval(() => undefined, 1_000)
