import { isAbsolute, resolve } from 'node:path'

export interface ModkitLspConfiguration {
  readonly roots: readonly string[]
  readonly extensions: readonly string[]
  readonly trustExtensions: boolean
  readonly maxDocuments: number
  readonly maxDocumentBytes: number
  readonly maxWorkspaceBytes: number
  /** Ordered game-data locales that affect localized semantic answers. */
  readonly locales: readonly string[]
  /** Trusted content-source module configuration; packed dependencies resolve through it. */
  readonly contentSourceConfig?: string
  readonly contentSourceStorage?: string
  /** Packages a root that belongs to no package opens inside; the game's own default when empty. */
  readonly baseMods: readonly string[]
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
  if (!isAbsolute(value)) throw new ConfigurationError(`${option} needs an absolute path`)
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
    '  --max-workspace-bytes <bytes> Snapshot UTF-8 limit (default 67108864)',
    '  --locale <id>                 Repeatable game-data locale (default enUS)',
    '  --content-source-config <path>  Trusted content-source JSON; resolves packed dependencies',
    '  --content-source-storage <path> Cache/state directory for that content source',
    '  --base-mod <package>          Repeatable package a root outside any mod opens inside',
    '                                (default: the game default, Void for StarCraft II)',
    '  --help                        Print this text',
    '',
  ].join('\n')
}

export function parseModkitLspConfiguration(argv: readonly string[]): ModkitLspConfiguration {
  const roots: string[] = []
  const extensions: string[] = []
  let trustExtensions = false
  // Cover a whole mod by default; the byte budgets below stay the real bound.
  let maxDocuments = 1_024
  let maxDocumentBytes = 4_194_304
  /*
   * A mod, not a file, is what these languages resolve against, and Blizzard's core mod is 25 MiB of
   * layouts, scripts, catalogs and string catalogs. At 16 MiB a string key's uses in the layouts fell
   * outside the snapshot and a reference search answered with the catalog alone.
   */
  let maxWorkspaceBytes = 67_108_864
  const locales: string[] = []
  let contentSourceConfig: string | undefined
  let contentSourceStorage: string | undefined
  const baseMods: string[] = []
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
      case '--locale':
        if (!/^[A-Za-z][A-Za-z0-9_-]{1,31}$/u.test(value)) {
          throw new ConfigurationError('--locale needs a bounded locale identifier')
        }
        locales.push(value)
        break
      case '--content-source-config':
        contentSourceConfig = absolute(value, option)
        break
      case '--content-source-storage':
        contentSourceStorage = absolute(value, option)
        break
      case '--base-mod':
        if (value.length > 4096) throw new ConfigurationError('--base-mod is too long')
        baseMods.push(value)
        break
      default:
        throw new ConfigurationError(`unknown option ${option ?? ''}`)
    }
  }
  if (roots.length === 0) throw new ConfigurationError('at least one --root is required')
  if (extensions.length === 0) throw new ConfigurationError('at least one --extension is required')
  if (maxDocuments > 4_096) throw new ConfigurationError('--max-documents cannot exceed 4096')
  if ((contentSourceConfig === undefined) !== (contentSourceStorage === undefined)) {
    throw new ConfigurationError(
      '--content-source-config and --content-source-storage must be given together',
    )
  }
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
    locales: Object.freeze(locales.length === 0 ? ['enUS'] : [...new Set(locales)]),
    baseMods: Object.freeze([...new Set(baseMods)]),
    ...(contentSourceConfig === undefined || contentSourceStorage === undefined
      ? {}
      : { contentSourceConfig, contentSourceStorage }),
  })
}
