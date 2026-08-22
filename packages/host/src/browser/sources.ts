/**
 * Compatibility exports for browser hosts. Provider-neutral implementations live in VFS so web,
 * Electron and third-party hosts share the same range and file-capability semantics.
 */
export {
  createBrowserFileHandleSource,
  openOpfsSource,
  type BrowserBlobSlice,
  type BrowserDirectoryHandle,
  type BrowserFileHandle,
  type BrowserFileSnapshot,
} from '@modkitx-x3/vfs/providers/browser-file'
export {
  createHttpRangeSource,
  type HttpFetch as BrowserFetch,
  type HttpFetchHeaders as BrowserFetchHeaders,
  type HttpFetchResponse as BrowserFetchResponse,
  type HttpRangeSourceOptions,
} from '@modkitx-x3/vfs/providers/http'
