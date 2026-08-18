// HW-11 — envelope forgery after a legitimate start. `options.variant`: 'session' (default, a
// foreign session id → `bad-envelope`), 'generation' (generation + 5 → `stale-generation`),
// 'previous-generation' (generation - 1, a worker left over from before a restart →
// `stale-generation`), 'domain' (`x3.host/rpc2` → `bad-envelope`). Each is fatal on the host.
import { generation, options, post, serveDemoChain, session } from './_lib.mjs'

const variant = typeof options.variant === 'string' ? options.variant : 'session'

serveDemoChain({
  afterOpen() {
    const overrides =
      variant === 'generation'
        ? { generation: generation + 5 }
        : variant === 'previous-generation'
          ? { generation: generation - 1 }
          : variant === 'domain'
            ? { domain: 'x3.host/rpc2' }
            : { session: `${session}-forged` }
    post({ t: 'call', handle: `h${generation}-1`, method: 'size', args: [] }, overrides)
  },
})
