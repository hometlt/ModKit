import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PARTS,
  STATES,
  auditParts,
  setPart,
  setState,
  isPartName,
  type PartName,
  type StateName,
} from '../src/parts.js'
import {
  TOKENS,
  TOKENS_BY_NAME,
  cssVariableName,
  validateTokenValue,
} from '../src/tokens/registry.js'
import { PALETTES } from '../src/tokens/palettes.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

const readText = (...segments: string[]) => readFile(join(packageRoot, ...segments), 'utf8')

/** Minimal Element stand-in: the part helpers only touch the attribute API. */
function stubElement(): Element & { attributes: Map<string, string> } {
  const attributes = new Map<string, string>()
  return {
    attributes,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
  } as unknown as Element & { attributes: Map<string, string> }
}

describe('part vocabulary', () => {
  it('has no duplicates', () => {
    expect(new Set(PARTS).size).toBe(PARTS.length)
  })

  it('uses lowercase dotted names at most two segments deep', () => {
    for (const part of PARTS) {
      expect(part, `${part} is not a valid part name`).toMatch(
        /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/u,
      )
    }
  })

  it('rejects an unregistered part', () => {
    expect(() => setPart(stubElement(), 'table.bogus' as PartName)).toThrow(/unregistered part/u)
  })

  it('rejects an unregistered state', () => {
    expect(() => setState(stubElement(), ['glowing' as StateName])).toThrow(/unregistered state/u)
  })

  it('writes states as a deduplicated space separated list', () => {
    const node = stubElement()
    setState(node, ['loading', 'stale', 'loading'])
    expect(node.attributes.get('data-mk-state')).toBe('loading stale')
    setState(node, [])
    expect(node.attributes.has('data-mk-state')).toBe(false)
  })

  it('has no duplicate states', () => {
    expect(new Set(STATES).size).toBe(STATES.length)
  })
})

describe('token registry', () => {
  it('has no duplicate token names', () => {
    expect(TOKENS_BY_NAME.size).toBe(TOKENS.length)
  })

  it('gives every tier-3 token a tier-2 origin or a runtime default', () => {
    for (const token of TOKENS.filter(item => item.tier === 3)) {
      // A runtime slot is written per instance by its component and has no theme origin.
      if (token.runtimeDefault !== undefined) {
        expect(
          token.derivesFrom,
          `${token.name} cannot be both derived and a runtime slot`,
        ).toBeUndefined()
        continue
      }
      expect(token.derivesFrom, `${token.name} has no derivesFrom`).toBeDefined()
      const origin = TOKENS_BY_NAME.get(token.derivesFrom as string)
      expect(origin, `${token.name} derives from unknown ${token.derivesFrom}`).toBeDefined()
      expect(origin?.tier, `${token.name} must derive from tier 2`).toBe(2)
    }
  })

  it('gives every themed token a valid value in every palette', () => {
    for (const palette of PALETTES) {
      for (const token of TOKENS.filter(item => item.tier !== 3)) {
        const value = palette.values[token.name]
        expect(value, `${palette.id} is missing ${token.name}`).toBeDefined()
        const result = validateTokenValue(token.name, value as string)
        expect(result.valid, `${palette.id}/${token.name}: ${result.reason ?? ''}`).toBe(true)
      }
    }
  })

  it('rejects resource loads and declaration escapes', () => {
    expect(validateTokenValue('color.bg', 'url(https://evil.example/x.png)').valid).toBe(false)
    expect(validateTokenValue('color.bg', 'red;}body{display:none').valid).toBe(false)
    expect(validateTokenValue('color.bg', 'image-set("a.png")').valid).toBe(false)
    expect(validateTokenValue('space.3', '8').valid).toBe(false)
    expect(validateTokenValue('nope.token', '#fff').valid).toBe(false)
  })
})

describe('shipped stylesheet', () => {
  it('references only registered tokens', async () => {
    const css = await readText('styles', 'modkit-ui.css')
    const registered = new Set(TOKENS.map(token => cssVariableName(token.name)))
    const referenced = [...css.matchAll(/var\((--mk-[a-z0-9-]+)/gu)].map(
      match => match[1] as string,
    )
    const declared = [...css.matchAll(/^\s*(--mk-[a-z0-9-]+)\s*:/gmu)].map(
      match => match[1] as string,
    )
    const unknown = [...new Set([...referenced, ...declared])]
      .filter(name => !registered.has(name))
      .sort()
    expect(unknown, `unregistered custom properties in the shipped stylesheet`).toEqual([])
  })

  it('selects only registered parts and states', async () => {
    const css = await readText('styles', 'modkit-ui.css')
    const parts = [...css.matchAll(/\[data-mk-part='([^']+)'\]/gu)].map(match => match[1] as string)
    const states = [...css.matchAll(/\[data-mk-state~='([^']+)'\]/gu)].map(
      match => match[1] as string,
    )
    expect([...new Set(parts)].filter(part => !isPartName(part)).sort()).toEqual([])
    expect(
      [...new Set(states)].filter(state => !(STATES as readonly string[]).includes(state)).sort(),
    ).toEqual([])
  })

  it('carries no literal colours in the authored fragments', async () => {
    for (const fragment of ['base.css', 'components.css']) {
      const css = await readText('src', 'styles', fragment)
      const literals = [...css.matchAll(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/giu)].map(
        match => match[0],
      )
      expect(literals, `${fragment} must take every colour from a token`).toEqual([])
    }
  })

  it('declares the layer order before any layer block', async () => {
    const css = await readText('styles', 'modkit-ui.css')
    const statement = css.indexOf('@layer mk.reset, mk.tokens')
    const firstBlock = css.indexOf('@layer mk.tokens {')
    expect(statement).toBeGreaterThan(-1)
    expect(firstBlock).toBeGreaterThan(statement)
  })

  it('defines a complete light palette on bare :root', async () => {
    const css = await readText('styles', 'modkit-ui.css')
    const root = css.slice(css.indexOf('  :root {'), css.indexOf('@media (prefers-color-scheme'))
    for (const token of TOKENS.filter(item => item.tier !== 3)) {
      expect(root, `bare :root is missing ${token.name}`).toContain(
        `${cssVariableName(token.name)}:`,
      )
    }
  })

  it('lets an explicit theme choice beat the OS preference', async () => {
    const css = await readText('styles', 'modkit-ui.css')
    expect(css).toContain("data-mk-theme='modkit-light'")
    expect(css).toContain("data-mk-theme='modkit-dark'")
    expect(css).toContain("data-mk-theme='modkit-high-contrast'")
    expect(css).toContain("data-mk-theme='vscode-adapter'")

    // Regression guard. Enumerating themes inside :not() raises the media guard to (0,3,0) and
    // out-specifies every explicit [data-mk-theme='x'] selector at (0,2,0), which pins the OS
    // palette and silently breaks any theme not named in the guard. Found by the gallery harness.
    const media = css.slice(css.indexOf('@media (prefers-color-scheme'))
    const guard = media.slice(0, media.indexOf('{', media.indexOf('{') + 1))
    expect(guard).toContain(':not([data-mk-theme])')
    expect(guard).not.toMatch(/:not\(\[data-mk-theme=/u)
  })

  it('maps semantic roles onto system colours under forced-colors', async () => {
    const css = await readText('styles', 'modkit-ui.css')
    const block = css.slice(css.indexOf('@media (forced-colors: active)'))
    for (const systemColor of ['Canvas', 'CanvasText', 'GrayText', 'LinkText', 'Highlight']) {
      expect(block).toContain(systemColor)
    }
  })
})

describe('generated token contract', () => {
  it('matches the registry', async () => {
    const contract = JSON.parse(await readText('generated', 'token-contract.v1.json')) as {
      readonly tokens: readonly { readonly name: string; readonly cssVariable: string }[]
      readonly themes: readonly { readonly id: string }[]
    }
    expect(contract.tokens).toHaveLength(TOKENS.length)
    for (const entry of contract.tokens) {
      expect(TOKENS_BY_NAME.has(entry.name), `${entry.name} is not registered`).toBe(true)
      expect(entry.cssVariable).toBe(cssVariableName(entry.name))
    }
    expect(contract.themes.map(theme => theme.id)).toEqual(PALETTES.map(palette => palette.id))
  })
})

describe('part audit helper', () => {
  it('reports missing and unregistered parts', () => {
    const nodes = [{ part: 'viewer' }, { part: 'table' }, { part: 'table.rogue' }]
    const root = {
      getAttribute: () => 'viewer',
      querySelectorAll: () =>
        nodes.slice(1).map(node => ({ getAttribute: () => node.part })) as unknown as Element[],
    } as unknown as Element
    const audit = auditParts(root, ['viewer', 'table', 'table.cell'])
    expect(audit.missing).toEqual(['table.cell'])
    expect(audit.unregistered).toEqual(['table.rogue'])
    expect(audit.present).toContain('viewer')
  })
})
