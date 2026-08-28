/** The data shape accepted by the shared-command target catalogue. */
interface SubjectCommandTargetShape {
  readonly commandId: string
  readonly needsSubject: true
  readonly mutatesSource: false
  readonly operationIds: readonly string[]
  readonly dataSourceContracts: readonly string[]
  readonly hostCallers: readonly ('automation' | 'cli' | 'electron' | 'pwa' | 'server' | 'vscode')[]
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

/**
 * Construct a catalogue whose runtime value is immutable at every nested object and array.
 *
 * Migration tooling recognizes this exact constructor at the TypeScript AST boundary and reads
 * its literal argument without importing this module or evaluating the call.
 */
export function defineSubjectCommandTargets<
  const T extends Readonly<Record<string, SubjectCommandTargetShape>>,
>(targets: T): T {
  return deepFreeze(targets)
}
