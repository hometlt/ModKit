let adapters = {}
let initializer
let initialization
/** Install host adapters without importing Node modules into the portable M3 graph. */
export function installM3PlatformAdapters(next) {
  adapters = { ...adapters, ...next }
}
/** Install a lazy host initializer. The Node-only leaf uses this compatibility seam. */
export function installM3PlatformInitializer(next) {
  initializer = next
  initialization = undefined
}
/** Initialize the active host. Browser-main uses its native DOMParser. */
export async function initPlatform() {
  if (initializer) {
    initialization ??= initializer()
    await initialization
  }
  if (!adapters.DOMParser && !globalThis.DOMParser) {
    throw new Error('No DOMParser is available for the M3 runtime.')
  }
}
export function getFs() {
  if (!adapters.fs) throw new Error('M3 filesystem access requires the Node platform entrypoint.')
  return adapters.fs
}
export function getPath() {
  if (!adapters.path) throw new Error('M3 path access requires the Node platform entrypoint.')
  return adapters.path
}
export function getDirname() {
  if (!adapters.dirname) {
    throw new Error('M3 module path access requires the Node platform entrypoint.')
  }
  return adapters.dirname
}
export function getDOMParser() {
  const DOMParserImpl = adapters.DOMParser ?? globalThis.DOMParser
  if (!DOMParserImpl) throw new Error('No DOMParser is available for the M3 runtime.')
  return DOMParserImpl
}
