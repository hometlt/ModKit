export interface OfflineReleaseVerification {
  readonly packages: number
  readonly roots: number
  readonly catalog: {
    readonly path: string
    readonly sha256: `sha256:${string}`
    readonly bytes: number
  }
  readonly files: readonly string[]
}

export const offlineReleaseSource: string
export const managedPackagesDirectory: 'managed-packages'
export const offlineReleaseDescriptor: 'release.v1.json'
export const offlineReleaseCatalog: 'catalog.v1.json'
export const expectedOfflineReleasePackages: 2
export const expectedOfflineReleaseRoots: 9

export function verifyOfflineReleaseDirectory(root: string): OfflineReleaseVerification
export function verifyPackagedOfflineRelease(output: string): OfflineReleaseVerification
export function copyOfflineReleaseToDist(options: {
  readonly source?: string
  readonly output: string
}): OfflineReleaseVerification
export function verifyVirtualOfflineRelease(
  files: readonly string[],
  readBytes: (relativePath: string) => Uint8Array,
): OfflineReleaseVerification
