export interface ReadyAppExtension {
  readonly path?: readonly string[]
  readonly coordinate: string
  readonly contributions: readonly string[]
}

export const READY_APP_EXTENSIONS: Readonly<Record<string, ReadyAppExtension>>
export const APP_EXTENSION_SETS: Readonly<Record<string, readonly string[]>>

export function extensionDirectory(name: string): readonly string[]
export function extensionSet(name: string): readonly string[]
export function expectedExtensionCoordinates(name: string): readonly string[]
export function expectedContributionIds(name: string): readonly string[]
