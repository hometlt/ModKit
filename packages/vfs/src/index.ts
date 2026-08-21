export { collectStream, createMemorySource, rangeError, type RandomAccessSource } from './source.js'
export {
  DEFAULT_VFS_LIMITS,
  VfsProviderRegistry,
  VirtualFileSystem,
  clampVfsLimits,
  normalizeVfsPath,
  parseVfsScheme,
  type VfsLimits,
  type VfsMount,
  type VfsNode,
  type VfsNodeKind,
  type VfsOpenOptions,
  type VfsProvider,
  type VfsProviderContext,
  type VfsResolution,
} from './vfs.js'
