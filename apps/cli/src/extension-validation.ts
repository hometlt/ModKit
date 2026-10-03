/** CLI reporting over Host root admission and inventory validation, shared by every verb. */
import { diagnostic, type Diagnostic } from '@modkit/core'
import {
  commandRequest,
  COMMAND_PROTOCOL_SCHEMA_VERSION,
  inventoryHasErrors,
  type CommandInput,
  type CommandReceipt,
  type Inventory,
} from '@modkit/host'
import type { ExtensionRootFailure } from '@modkit/host/node'

export function cliExtensionDiagnostics(
  inventory: Inventory,
  failures: readonly ExtensionRootFailure[] = [],
): readonly Diagnostic[] {
  return [
    ...failures.map(item =>
      diagnostic('error', item.code, `${item.root}: ${item.message}`, [item.root]),
    ),
    ...inventory.diagnostics,
    ...inventory.extensions.flatMap(extension =>
      extension.contributions.flatMap(contribution =>
        contribution.diagnostics.map(item => ({
          ...item,
          message: `${extension.source}/${contribution.path}: ${item.message}`,
          path: [extension.source, contribution.path, ...(item.path ?? [])],
        })),
      ),
    ),
  ]
}

export function cliExtensionFailure(
  command: string,
  input: CommandInput,
  inventory: Inventory,
  failures: readonly ExtensionRootFailure[] = [],
): CommandReceipt | undefined {
  if (failures.length === 0 && !inventoryHasErrors(inventory)) return undefined
  return {
    schemaVersion: COMMAND_PROTOCOL_SCHEMA_VERSION,
    request: commandRequest(command, input),
    result: {
      state: 'failed',
      command,
      code: 'x3.cli/invalid-extensions',
      message: 'Requested extension roots failed admission or inventory validation',
      diagnostics: cliExtensionDiagnostics(inventory, failures),
    },
  }
}

export function renderCliExtensionValidation(
  inventory: Inventory,
  json: boolean,
  failures: readonly ExtensionRootFailure[] = [],
): string {
  const extension = inventory.extensions[0]
  const contributions = inventory.extensions.flatMap(item => item.contributions)
  const diagnostics = cliExtensionDiagnostics(inventory, failures)
  const ok = failures.length === 0 && !inventoryHasErrors(inventory)
  const identity = (item: Inventory['extensions'][number]) => ({
    publisher: item.manifest.publisher,
    id: item.manifest.id,
    version: item.manifest.version,
  })
  const contribution = (item: Inventory['extensions'][number]['contributions'][number]) => ({
    path: item.path,
    specState: item.specState,
    ...(item.manifest === undefined ? {} : { id: item.manifest.id }),
  })
  if (json) {
    return `${JSON.stringify(
      {
        ok,
        ...(extension === undefined
          ? {}
          : { container: extension.container, extension: identity(extension) }),
        extensions: inventory.extensions.map(item => ({
          source: item.source,
          container: item.container,
          extension: identity(item),
          contributions: item.contributions.map(contribution),
        })),
        contributions: contributions.map(contribution),
        diagnostics,
      },
      null,
      2,
    )}\n`
  }
  const lines = [
    `${ok ? 'VALID' : 'INVALID'} (${inventory.extensions.length} extension(s), ${contributions.length} contribution(s))`,
  ]
  for (const item of inventory.extensions) {
    lines.push(
      `  ${item.manifest.publisher}/${item.manifest.id}@${item.manifest.version} — ${item.source}`,
    )
    for (const entry of item.contributions)
      lines.push(
        `    ${entry.path}: ${entry.specState}${entry.manifest ? ` [${entry.manifest.id}]` : ''}`,
      )
  }
  for (const item of diagnostics)
    lines.push(
      `  ${item.severity} ${item.code} ${item.message}${item.path ? ` @ ${item.path.join('/')}` : ''}`,
    )
  return `${lines.join('\n')}\n`
}
