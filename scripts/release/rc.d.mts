export interface RcBuildOptions {
  readonly repoRoot: string
  readonly outDir: string
  readonly signingKeyPath?: string
}

export interface RcArtifactDescriptor {
  readonly catalog: readonly {
    readonly root: string
    readonly sourceDigest: string
  }[]
  readonly file: string
  readonly id: string
  readonly kind: string
  readonly sha256: string
  readonly size: number
}

export interface RcBuildResult {
  readonly manifest: {
    readonly artifacts: readonly RcArtifactDescriptor[]
  }
  readonly signature?: unknown
  readonly files: readonly string[]
}

export function deterministicTar(files: ReadonlyMap<string, Buffer>): Buffer

export function canonicalExtensionDigest(repoRoot: string, extensionRoot: string): string

export function buildLicenseDocuments(options: {
  readonly repoRoot: string
  readonly releaseVersion: string
  readonly artifacts: readonly {
    readonly id: string
    readonly entries: ReadonlyMap<string, Buffer>
  }[]
}): {
  readonly sbomBytes: Buffer
  readonly noticeBytes: Buffer
}

export function buildRc(options: RcBuildOptions): RcBuildResult

export function verifyRc(options: {
  readonly outDir: string
  readonly publicKeyPath?: string
  readonly requireSignature?: boolean
}): {
  readonly state: 'verified-signed' | 'verified-unsigned'
  readonly artifactCount: number
}

export function checkRc(options: { readonly repoRoot: string; readonly generatedDir?: string }): {
  readonly state: 'checked'
  readonly fileCount: number
}

export function emitRcMetadata(options: {
  readonly repoRoot: string
  readonly generatedDir?: string
}): {
  readonly state: 'emitted'
  readonly count: number
}
