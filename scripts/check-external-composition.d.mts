export declare function externalCompositionViolations(
  files: string[],
  read?: (path: string) => string,
): string[]
export declare function checkExternalComposition(root?: string): { checked: number }
