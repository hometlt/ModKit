/**
 * Block 12 item 11 — generic viewers and renderers carry no game or format identity.
 *
 * `packages/ui` owns format- and game-neutral viewers; extensions own the format-specific ones
 * (§2.3 rule 2). That rule has been true by discipline since block 9 and enforced by nobody, which
 * is the state every architectural rule is in right before it stops being true: one `if (formatId
 * === 'sc2-m3')` in a shared viewer is a five-line change that quietly makes the generic package
 * own a game.
 *
 * The check has to be sharper than a grep, because the *correct* files mention games too. Two of
 * them do today, both in prose:
 *
 *   card/index.ts   "A SC2 unit is assembled from many files and owns none of them"
 *   model/index.ts  "the same loop answers for a SAGE W3X, a Westwood VXL"
 *
 * Those are the opposite of a violation — they explain why the code is neutral by naming what it
 * refuses to special-case. So comments are stripped before the scan, and what remains is executable
 * code: identifiers, string literals and branches. A game named in prose is documentation; a game
 * named in a comparison is a dependency.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..')

/**
 * Game and engine families, and the format tokens that name one game's file type.
 *
 * Deliberately not a list of every extension: the rule is about *identity leaking into shared
 * code*, so the tokens are the ones that could only have come from a specific game or a specific
 * game's format. Neutral words a generic viewer legitimately uses — model, texture, archive,
 * skeleton — are absent on purpose.
 */
const GAME_TOKENS = [
  'sc2',
  'starcraft',
  'warcraft',
  'blizzard',
  'westwood',
  'petroglyph',
  'relic',
  'cnc',
  'sage',
  'warzone',
  'spring',
  'beyond-all-reason',
  'emperor',
  'tiberian',
  'red-alert',
]

/** Format tokens that belong to exactly one game family. */
const FORMAT_TOKENS = [
  'm3a',
  'w3d',
  'w3x',
  'sc2map',
  'sc2mod',
  'casc',
  'mpq',
  'scd',
  'vxl',
  'hva',
  'skudef',
  'sdp',
]

/** Strip line and block comments so prose can name a game without failing the rule. */
function stripComments(source: string): string {
  let result = ''
  let index = 0
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  while (index < source.length) {
    const two = source.slice(index, index + 2)
    const char = source[index] as string
    if (state === 'code') {
      if (two === '//') {
        state = 'line'
        index += 2
        continue
      }
      if (two === '/*') {
        state = 'block'
        index += 2
        continue
      }
      if (char === "'") state = 'single'
      else if (char === '"') state = 'double'
      else if (char === '`') state = 'template'
      result += char
      index += 1
      continue
    }
    if (state === 'line') {
      if (char === '\n') {
        state = 'code'
        result += char
      }
      index += 1
      continue
    }
    if (state === 'block') {
      if (two === '*/') {
        state = 'code'
        index += 2
        continue
      }
      // keep newlines so reported line numbers stay honest
      if (char === '\n') result += char
      index += 1
      continue
    }
    // inside a string literal: copy it, because a game id in a literal IS the violation
    result += char
    if (char === '\\') {
      result += source[index + 1] ?? ''
      index += 2
      continue
    }
    if (
      (state === 'single' && char === "'") ||
      (state === 'double' && char === '"') ||
      (state === 'template' && char === '`')
    ) {
      state = 'code'
    }
    index += 1
  }
  return result
}

async function sourceFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        await walk(path)
      } else if (/\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) {
        found.push(path)
      }
    }
  }
  await walk(root)
  return found.sort()
}

interface Violation {
  readonly file: string
  readonly line: number
  readonly token: string
  readonly text: string
}

async function scan(root: string, tokens: readonly string[]): Promise<Violation[]> {
  const violations: Violation[] = []
  const pattern = new RegExp(`\\b(${tokens.join('|')})\\b`, 'iu')
  for (const file of await sourceFiles(root)) {
    const code = stripComments(await readFile(file, 'utf8'))
    for (const [index, text] of code.split('\n').entries()) {
      const match = pattern.exec(text)
      if (match === null) continue
      violations.push({
        file: file.slice(repoRoot.length + 1).replaceAll('\\', '/'),
        line: index + 1,
        token: match[1] as string,
        text: text.trim().slice(0, 120),
      })
    }
  }
  return violations
}

describe('12-4 architecture — generic presentation names no game and no game-specific format', () => {
  it('packages/ui carries no game identity in executable code', async () => {
    const violations = await scan(join(repoRoot, 'packages', 'ui', 'src'), GAME_TOKENS)
    expect(
      violations,
      violations.map(item => `${item.file}:${item.line} «${item.token}» ${item.text}`).join('\n'),
    ).toEqual([])
  }, 120_000)

  it('packages/ui carries no single-game format identity in executable code', async () => {
    const violations = await scan(join(repoRoot, 'packages', 'ui', 'src'), FORMAT_TOKENS)
    expect(
      violations,
      violations.map(item => `${item.file}:${item.line} «${item.token}» ${item.text}`).join('\n'),
    ).toEqual([])
  }, 120_000)

  it('the same rule holds for the host presentation stage that chooses viewers', async () => {
    /*
     * The resolver decides which viewer a subject gets. A game id here would be worse than one in a
     * viewer, because it would route by game while every viewer stayed honestly neutral — the
     * dependency would exist and no viewer would show it.
     */
    const presentation = join(repoRoot, 'packages', 'host', 'src', 'presentation.ts')
    const code = stripComments(await readFile(presentation, 'utf8'))
    const pattern = new RegExp(`\\b(${[...GAME_TOKENS, ...FORMAT_TOKENS].join('|')})\\b`, 'iu')
    const offending = code
      .split('\n')
      .map((text, index) => ({ text: text.trim(), line: index + 1 }))
      .filter(entry => pattern.test(entry.text))
    expect(offending, JSON.stringify(offending)).toEqual([])
  }, 60_000)

  it('proves the scan can fail: a game id in code is caught, the same id in prose is not', async () => {
    /*
     * Without this, an over-eager comment stripper that ate the whole file would make the three
     * tests above pass forever while checking nothing. The fixture is the distinction itself.
     */
    const pattern = new RegExp(`\\b(${GAME_TOKENS.join('|')})\\b`, 'iu')
    const prose = stripComments(`
      /* A SC2 unit is assembled from many files. */
      // the same loop answers for a SAGE W3X
      export const pick = (id: string) => id
    `)
    expect(pattern.test(prose)).toBe(false)

    const branching = stripComments(`
      export const pick = (id: string) => (id === 'sc2-m3' ? 'special' : 'generic')
    `)
    expect(pattern.test(branching)).toBe(true)
  })
})
