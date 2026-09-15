import { isAbsolute, resolve } from 'node:path'

export interface ModkitLspConfiguration {
  readonly roots: readonly string[]
  readonly extensions: readonly string[]
  readonly trustExtensions: boolean
  readonly maxDocuments: number
  readonly maxDocumentBytes: number
  readonly maxWorkspaceBytes: number
}

export class ConfigurationError extends Error {}

const positiveInteger = (value: string, option: string): number => {
  if (!/^[1-9][0-9]*$/u.test(value))
    throw new ConfigurationError(`${option} needs a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new ConfigurationError(`${option} is too large`)
  return parsed
}

const absolute = (value: string, option: string): string => {
  if (!isAbsolute(value)) throw new ConfigurationError(`${option} needs an absolute directory`)
  return resolve(value)
}

export function modkitLspUsage(): string {
  return [
    'Usage: modkit-lsp --root <absolute-directory> --extension <absolute-directory> [options]',
    '',
    'Options:',
    '  --root <path>                 Repeatable loose-workspace root (at least one)',
    '  --extension <path>            Repeatable directory extension (at least one)',
    '  --trust-extensions            Run explicitly configured extensions in-process',
    '  --max-documents <count>       Semantic snapshot limit (default 64, maximum 256)',
    '  --max-document-bytes <bytes>  Per-file UTF-8 limit (default 4194304)',
    '  --max-workspace-bytes <bytes> Snapshot UTF-8 limit (default 16777216)',
    '  --help                        Print this text',
    '',
  ].join('\n')
}

export function parseModkitLspConfiguration(argv: readonly string[]): ModkitLspConfiguration {
  const roots: string[] = []
  const extensions: string[] = []
  let trustExtensions = false
  let maxDocuments = 64
  let maxDocumentBytes = 4_194_304
  let maxWorkspaceBytes = 16_777_216
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--help') throw new ConfigurationError('help requested')
    if (option === '--trust-extensions') {
      trustExtensions = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined) throw new ConfigurationError(`${option ?? 'option'} needs a value`)
    index += 1
    switch (option) {
      case '--root':
        roots.push(absolute(value, option))
        break
      case '--extension':
        extensions.push(absolute(value, option))
        break
      case '--max-documents':
        maxDocuments = positiveInteger(value, option)
        break
      case '--max-document-bytes':
        maxDocumentBytes = positiveInteger(value, option)
        break
      case '--max-workspace-bytes':
        maxWorkspaceBytes = positiveInteger(value, option)
        break
      default:
        throw new ConfigurationError(`unknown option ${option ?? ''}`)
    }
  }
  if (roots.length === 0) throw new ConfigurationError('at least one --root is required')
  if (extensions.length === 0) throw new ConfigurationError('at least one --extension is required')
  if (maxDocuments > 256) throw new ConfigurationError('--max-documents cannot exceed 256')
  if (maxDocumentBytes > maxWorkspaceBytes) {
    throw new ConfigurationError('--max-document-bytes cannot exceed --max-workspace-bytes')
  }
  return Object.freeze({
    roots: Object.freeze([...new Set(roots)]),
    extensions: Object.freeze([...new Set(extensions)]),
    trustExtensions,
    maxDocuments,
    maxDocumentBytes,
    maxWorkspaceBytes,
  })
}
