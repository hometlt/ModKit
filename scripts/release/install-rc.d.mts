export function readReleaseTar(bytes: Buffer): ReadonlyMap<string, Buffer>

export function installRc(options: {
  readonly outDir: string
  readonly storeRoot: string
  readonly publicKeyPath: string
}): {
  readonly state: 'installed'
  readonly manifestDigest: string
  readonly root: string
  readonly previousManifestDigest?: string
}

export function rollbackRc(options: { readonly storeRoot: string }): {
  readonly state: 'rolled-back'
  readonly manifestDigest: string
  readonly root: string
}

export function activeRc(options: {
  readonly storeRoot: string
}): { readonly manifestDigest: string; readonly root: string } | undefined
