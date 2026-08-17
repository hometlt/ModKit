export interface TextDataEntrypoint {
  readonly id: string
  readonly kind: 'codec' | 'provider'
  readonly manifest?: string
  readonly declared?: string
  readonly absolute?: string
  readonly reason?: string
}

export function discoverTextDataEntrypoints(
  repoRoot: string,
  requestedFormatIds: readonly string[],
): readonly TextDataEntrypoint[]
