/**
 * Capability-RPC core v1 (NXT-105): transport-agnostic protocol + handle/lease state machine +
 * method-surface port. Deliberately *not* part of the package root: it is published as the
 * `@modkitx-x3/host/execution` subpath so transports (NXT-114/115/401), preload/worker
 * bootstraps and the testkit conformance kit can depend on the protocol alone, without pulling
 * inventory/resolution/gate code into a renderer or worker bundle. The execution backend SPI
 * (NXT-100) composes it inside the host. See ./protocol.ts, ./surface.ts, ./handles.ts and
 * ./endpoint.ts for the contracts.
 */

export {
  CAPABILITY_RPC_DOMAIN,
  CAPABILITY_RPC_VERSION,
  DEFAULT_PROTOCOL_LIMITS,
  HANDLE_MARKER,
  describeFrame,
  fromErrorDto,
  handleRef,
  isHandleId,
  isHandleRef,
  isMethodName,
  isPlainObject,
  isSubscriptionId,
  protocolLimits,
  protocolViolationError,
  toErrorDto,
  validateErrorDto,
  validateFrame,
  validateWireValue,
  violation,
  type Envelope,
  type ErrorDto,
  type Frame,
  type FrameExpectation,
  type FrameOf,
  type FrameType,
  type HandleKind,
  type HandleRef,
  type ProgressDto,
  type ProtocolLimits,
  type ProtocolViolation,
  type ProtocolViolationCode,
  type Validated,
  type WireScalar,
  type WireValue,
  type WireValueMeasure,
} from './protocol.js'
export {
  composeSurfaceRegistries,
  createSurfaceRegistry,
  surfaceKey,
  type CapabilitySurface,
  type MethodKind,
  type MethodSurface,
  type SurfaceRegistry,
} from './surface.js'
export {
  ActiveCalls,
  HandleTable,
  PendingCalls,
  Subscriptions,
  type ActiveCall,
  type HandleLookup,
  type HandleTableCounts,
  type LocalHandleRecord,
  type PendingCall,
  type PendingOutcome,
  type SettleResult,
  type SubscriptionRecord,
} from './handles.js'
export {
  CAPABILITY_OF,
  createEndpoint,
  type CallOptions,
  type CallOutcome,
  type Endpoint,
  type EndpointCounters,
  type EndpointOptions,
  type EndpointRole,
  type EndpointState,
  type FramePort,
  type LoadRequest,
  type LoadResult,
  type LoadedModule,
  type LocalCapability,
  type RemoteCapability,
  type Scheduler,
} from './endpoint.js'
