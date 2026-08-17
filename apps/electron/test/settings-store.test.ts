import { createRequire } from 'node:module'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const store = require('../electron/settings-store.cjs') as {
  readSettings(app: { getPath(name: string): string }): Promise<{
    location: string
    raw?: unknown
    problem?: string
  }>
  writeSettings(app: { getPath(name: string): string }, text: string): Promise<string>
}

describe('Electron settings persistence', () => {
  it('writes atomically and reads the portable JSON document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'modkit-settings-'))
    const app = { getPath: () => directory }
    const file = join(directory, 'modkit-settings.json')
    const text =
      '{"schemaVersion":1,"appearance":{"theme":"modkit-dark","density":"compact"},"extensions":[]}'

    await expect(store.readSettings(app)).resolves.toEqual({ location: file, raw: undefined })
    await expect(store.writeSettings(app, text)).resolves.toBe(file)
    await expect(readFile(file, 'utf8')).resolves.toBe(text)
    await expect(store.readSettings(app)).resolves.toMatchObject({
      raw: { schemaVersion: 1, extensions: [] },
    })
  })

  it('keeps the final file valid when writes overlap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'modkit-settings-race-'))
    const app = { getPath: () => directory }
    const documents = Array.from({ length: 8 }, (_, index) => JSON.stringify({ index }))

    await Promise.all(documents.map(document => store.writeSettings(app, document)))
    const persisted = await readFile(join(directory, 'modkit-settings.json'), 'utf8')
    expect(documents).toContain(persisted)
    expect(JSON.parse(persisted)).toHaveProperty('index')
  })
})
