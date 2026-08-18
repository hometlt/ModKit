// T6 / §6 checklist — reports, from inside the thread, what ambient state the production spawn
// path (`spawnWorkerRealm`) actually left it: `process.env` keys, `argv`, `execArgv`, the V8
// resource limits and the parent-port situation. Not a protocol fixture: it posts one raw object
// on the dedicated port and exits 0. The acceptance test asserts `env: {}`, `execArgv: []`,
// `argv` = [execPath, script] and the policy's resource limits — the isolation options are
// proven, not read from the backend's source.
import { parentPort, resourceLimits } from 'node:worker_threads'
import { postRaw } from './_lib.mjs'

postRaw({
  report: 'env',
  envKeys: Object.keys(process.env),
  argv: process.argv,
  execArgv: process.execArgv,
  resourceLimits: { ...resourceLimits },
  hasParentPort: parentPort !== null,
  isMainThread: false,
})
setTimeout(() => process.exit(0), 20)
