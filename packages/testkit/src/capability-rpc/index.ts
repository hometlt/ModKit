/**
 * Capability-RPC conformance kit (F1): run the protocol's round-trip and hostile suite against
 * any `FramePort` pair, plus the reference loopback and a `MessagePort` adapter used to prove
 * the kit against real structured-clone ports.
 */

export {
  CONFORMANCE_CASE_IDS,
  describeConformanceReport,
  runFramePortConformance,
  type ConformanceFailure,
  type ConformanceOptions,
  type ConformancePair,
  type ConformancePairFactory,
  type ConformanceReport,
  type ConformanceSkip,
} from './conformance.js'
export {
  createLoopbackPair,
  type LoopbackLogEntry,
  type LoopbackOptions,
  type LoopbackPair,
  type LoopbackSide,
  type LoopbackTap,
} from './loopback.js'
export {
  framePortFromMessagePort,
  type MessagePortFrameOptions,
  type MessagePortLike,
} from './message-port.js'
export {
  DEMO_CODEC,
  DEMO_LOAD_REQUEST,
  DEMO_MODULE,
  DEMO_SESSION,
  DEMO_SOURCE,
  DEMO_SURFACES,
  DEMO_TEXT,
  createDemoWorld,
  type DemoWorld,
} from './demo-world.js'
