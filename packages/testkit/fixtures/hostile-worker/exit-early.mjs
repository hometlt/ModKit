// HW-03 — the worker dies before it ever answers `load` (`options.code`, default 3). The host's
// activation must reject with `x3.host/rpc-peer-exited` and leave nothing behind (acc-1).
import { exit, listen, options } from './_lib.mjs'

const code = typeof options.code === 'number' ? options.code : 3
listen(frame => {
  if (frame?.t === 'load') exit(code)
})
