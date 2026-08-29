export interface ExternalExtensionDescriptor {
  readonly repository: string
  readonly path?: readonly string[]
}

export function externalRepositoryRoot(
  workspaceRoot: string,
  repository: string,
  environment?: Readonly<Record<string, string | undefined>>,
): string

export function resolveExternalExtensionDirectory(
  workspaceRoot: string,
  descriptor: ExternalExtensionDescriptor,
  environment?: Readonly<Record<string, string | undefined>>,
): string

export function externalRepositoryEnvironment(
  repository: string,
  workspaceRoot?: string,
): string | undefined
export function externalRepositoryDescriptor(
  repository: string,
  workspaceRoot?: string,
  environment?: Readonly<Record<string, string | undefined>>,
): Readonly<{
  environment?: string
  publisher?: string
  sibling: string
  root: string
}>

export function productExtensionDirectory(
  workspaceRoot: string,
  parts: readonly string[],
  environment?: Readonly<Record<string, string | undefined>>,
): string
