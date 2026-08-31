/**
 * The `MessagePort` → `FramePort` adapter is the production one in `@modkit/host/execution`
 * (`framePortFromMessagePort`); the kit re-exports it so a transport test proves exactly the
 * adapter the Node worker backend and the Electron bridge run.
 */

export {
  framePortFromMessagePort,
  type MessagePortFrameOptions,
  type MessagePortLike,
} from '@modkit/host/execution'
