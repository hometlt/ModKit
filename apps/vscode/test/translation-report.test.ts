import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  comparedLocales,
  gitRevision,
  gitShowSpec,
  gitText,
  hasGaps,
  missingAtRevision,
  withoutByteOrderMark,
} from '../src/translation-report.js'

const repository = mkdtempSync(join(tmpdir(), 'modkit-translation-report-'))
afterAll(() => rmSync(repository, { recursive: true, force: true }))

describe('the locale commands', () => {
  it('report every bound locale but the base the others translate', () => {
    expect(
      comparedLocales([
        { role: 'key' },
        { role: 'variant', variant: 'enUS', base: true },
        { role: 'variant', variant: 'ruRU' },
        { role: 'variant', variant: 'deDE' },
        { role: 'detail' },
      ]),
    ).toEqual(['ruRU', 'deDE'])
    // without a declared base the first locale is the one the others are compared with
    expect(
      comparedLocales([
        { role: 'variant', variant: 'enUS' },
        { role: 'variant', variant: 'koKR' },
      ]),
    ).toEqual(['koKR'])
    const empty = { missing: [], identical: [], empty: [], orphaned: [], total: 3, translated: 3 }
    expect(hasGaps(empty)).toBe(false)
    expect(hasGaps({ ...empty, orphaned: ['Old/Key'] })).toBe(true)
  })

  it('take a revision a reader typed, never an option or two words', () => {
    expect(gitRevision(' HEAD~1 ')).toBe('HEAD~1')
    expect(gitRevision('v1.2')).toBe('v1.2')
    expect(gitRevision('')).toBeUndefined()
    expect(gitRevision(undefined)).toBeUndefined()
    expect(gitRevision('--output=steal')).toBeUndefined()
    expect(gitRevision('HEAD ~1')).toBeUndefined()
    expect(withoutByteOrderMark(`${String.fromCharCode(0xfeff)}A=1`)).toBe('A=1')
  })

  it('read the file at a revision through git, and know a file the revision did not have', async () => {
    const git = (...args: string[]) => gitText(args, repository)
    await git('init', '--quiet')
    await git('config', 'user.email', 'test@example.invalid')
    await git('config', 'user.name', 'test')
    const folder = join(repository, 'Mod.SC2Mod', 'enUS.SC2Data', 'LocalizedData')
    mkdirSync(folder, { recursive: true })
    const file = join(folder, 'GameStrings.txt')
    writeFileSync(file, 'A=Old\n')
    await git('add', '.')
    await git('commit', '--quiet', '-m', 'first')
    writeFileSync(file, 'A=New\nB=Added\n')

    const topLevel = (await gitText(['rev-parse', '--show-toplevel'], folder)).trim()
    const spec = gitShowSpec('HEAD', topLevel, file)
    expect(spec).toBe('HEAD:Mod.SC2Mod/enUS.SC2Data/LocalizedData/GameStrings.txt')
    expect(await git('show', spec ?? '')).toBe('A=Old\n')
    expect(gitShowSpec('HEAD', topLevel, join(tmpdir(), 'elsewhere.txt'))).toBeUndefined()

    const later = join(folder, 'ObjectStrings.txt')
    writeFileSync(later, 'C=1\n')
    const failure = await git('show', gitShowSpec('HEAD', topLevel, later) ?? '').catch(
      (error: { stderr?: string }) => error.stderr ?? '',
    )
    expect(missingAtRevision(failure)).toBe(true)
    expect(missingAtRevision("fatal: invalid object name 'nope'.")).toBe(false)
  }, 60_000)
})
