// A *well-behaved* worker: a real worker-role endpoint over the transferred port, serving the
// testkit demo world. It exists so the acceptance suite has a positive control across a real
// thread boundary (load, leases, callbacks into the host, iterators, events, cancel, close → exit
// 0) next to the hostile fixtures. Imports the built testkit/host dist on purpose: fixtures run in
// a bare worker (`execArgv: []`), so there is no TypeScript there.
import { workerData } from 'node:worker_threads'
import { createEndpoint, protocolLimits } from '@modkitx-x3/host/execution'
import { DEMO_SURFACES, createDemoWorld } from '../../dist/capability-rpc/demo-world.js'
import { framePortFromMessagePort } from '../../dist/capability-rpc/message-port.js'

const { session, generation, port, options } = workerData
const world = createDemoWorld()
if (typeof options?.eventsCount === 'number') world.eventsControl.count = options.eventsCount

createEndpoint({
  role: 'worker',
  port: framePortFromMessagePort(port),
  session,
  generation,
  surfaces: DEMO_SURFACES,
  limits: protocolLimits({ defaultCallDeadlineMs: 2_000 }),
  loader: world.loader,
  onTerminate: () => process.exit(0),
  onFailure: () => process.exit(2),
})
