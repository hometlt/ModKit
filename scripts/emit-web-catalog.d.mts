export interface SelectedWebExtension {
  readonly directory: string
  readonly name: string
  readonly relativePath: string
}

export interface ExcludedWebExtension {
  readonly name: string
  readonly reason: string
}

export function selectWebExtensions(root: string): {
  readonly included: readonly SelectedWebExtension[]
  readonly excluded: readonly ExcludedWebExtension[]
}

export function emitWebCatalog(options?: {
  readonly root?: string
  readonly check?: boolean
}): Promise<{ readonly state: 'checked' | 'emitted' }>
