export function toPosixPath(path: string): string
export function hasAuthoredExtensionContainer(directory: string): boolean
export function discoverAuthoredExtensionRoots(baseDirectory: string): readonly string[]
export function authoredExtensionRootsRelativeTo(baseDirectory: string): readonly {
  readonly directory: string
  readonly relativePath: string
}[]
