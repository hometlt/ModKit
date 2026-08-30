import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')) as unknown

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}

const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

const reference = (value: string): string | undefined => /^%([^%]+)%$/u.exec(value)?.[1]

const visibleKeys = new Set([
  'title',
  'description',
  'markdownDescription',
  'displayName',
  'name',
  'enumDescriptions',
  'markdownEnumDescriptions',
])

const visibleStrings = (value: unknown): readonly string[] => {
  const found: string[] = []
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (typeof item !== 'object' || item === null) return
    for (const [key, child] of Object.entries(item)) {
      if (visibleKeys.has(key)) {
        if (typeof child === 'string') found.push(child)
        else if (Array.isArray(child)) {
          for (const text of child) if (typeof text === 'string') found.push(text)
        }
      }
      visit(child)
    }
  }
  visit(value)
  return found
}

describe('VS Code manifest localization', () => {
  const manifest = record(readJson('package.json'))
  const english = record(readJson('package.nls.json'))
  const russian = record(readJson('package.nls.ru.json'))

  it('keeps English and Russian package catalogs in exact key parity', () => {
    expect(Object.keys(russian).sort()).toEqual(Object.keys(english).sort())
    expect(Object.values(english).every(value => typeof value === 'string')).toBe(true)
    expect(Object.values(russian).every(value => typeof value === 'string')).toBe(true)
  })

  it('resolves every user-visible manifest string through both catalogs', () => {
    const contributions = manifest['contributes']
    const values = [
      manifest['displayName'],
      manifest['description'],
      ...visibleStrings(contributions),
    ]
    expect(values.length).toBeGreaterThan(20)

    for (const value of values) {
      expect(typeof value).toBe('string')
      const key = reference(String(value))
      expect(key, `plain user-visible manifest string: ${String(value)}`).toBeDefined()
      expect(english[key ?? ''], `missing English package.nls key: ${String(key)}`).toBeDefined()
      expect(russian[key ?? ''], `missing Russian package.nls key: ${String(key)}`).toBeDefined()
    }
  })

  it('ships both catalogs with the extension package', () => {
    const files = list(manifest['files'])
    expect(files).toContain('package.nls.json')
    expect(files).toContain('package.nls.ru.json')
  })
})
