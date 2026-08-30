import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { findInitialFileArgument } = require('../electron/file-arguments.cjs') as {
  findInitialFileArgument: (
    argv: readonly string[],
    isPackaged: boolean,
    exists: (value: string) => boolean,
    isFile: (value: string) => boolean,
  ) => string | undefined
}

const files = new Set(['electron/main.cjs', 'C:/samples/sample.json'])
const exists = (value: string): boolean => files.has(value)
const isFile = exists

describe('Electron initial file arguments', () => {
  it('skips the Electron development entry point and opens the user file', () => {
    expect(
      findInitialFileArgument(
        ['electron.exe', 'electron/main.cjs', 'C:/samples/sample.json'],
        false,
        exists,
        isFile,
      ),
    ).toBe('C:/samples/sample.json')
  })

  it('reads the first existing non-switch argument in a packaged application', () => {
    expect(
      findInitialFileArgument(
        ['modkit.exe', '--enable-logging', 'C:/samples/sample.json'],
        true,
        exists,
        isFile,
      ),
    ).toBe('C:/samples/sample.json')
  })

  it('returns no file when the shell did not provide one', () => {
    expect(
      findInitialFileArgument(
        ['electron.exe', 'electron/main.cjs', '--capture', 'missing.png'],
        false,
        exists,
        isFile,
      ),
    ).toBeUndefined()
  })
})
