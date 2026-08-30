import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installEmbedHostLifecycle } from '../src/embed.js'

const shellSource = readFileSync(join(import.meta.dirname, '..', 'src', 'shell.ts'), 'utf8')
const embedSource = readFileSync(join(import.meta.dirname, '..', 'src', 'embed.ts'), 'utf8')

describe('PWA command lifecycle wiring', () => {
  it('wires the legacy folder store into the shell reload that uses its non-creating list path', () => {
    expect(shellSource).toMatch(
      /const extensionStore = createIndexedDbExtensionStore\(indexedDB as unknown as IdbFactoryLike\)/u,
    )
    expect(shellSource).toMatch(
      /mountExtensionsUi\(document,\s*\{\s*localizer,\s*store: extensionStore,/u,
    )
    expect(shellSource.indexOf('await extensionsUi.reload()')).toBeGreaterThan(
      shellSource.indexOf('store: extensionStore'),
    )
  })

  it('disposes both page-scoped runtimes from one one-shot pagehide listener', () => {
    expect(shellSource.match(/window\.addEventListener\(\s*['"]pagehide['"]/gu)).toHaveLength(1)

    const lifecycle = shellSource.match(
      /window\.addEventListener\(\s*['"]pagehide['"],(?<handler>[\s\S]*?)\{\s*once:\s*true\s*\},?\s*\)/u,
    )
    expect(lifecycle).not.toBeNull()
    const handler = lifecycle?.groups?.handler ?? ''
    expect(handler.match(/services\.dispose\(\)/gu)).toHaveLength(1)
    expect(handler.match(/managedRuntime\.dispose\(\)/gu)).toHaveLength(1)
    expect(handler).toMatch(
      /void\s+Promise\.all\(\s*\[\s*services\.dispose\(\),\s*managedRuntime\.dispose\(\)\s*\]\s*\)/u,
    )
  })

  it('owns cached embed hosts at page scope rather than per custom element', () => {
    const listeners: { type: string; listener: () => void; once: boolean }[] = []
    const scope = {
      addEventListener(type: string, listener: () => void, options?: { readonly once?: boolean }) {
        listeners.push({ type, listener, once: options?.once === true })
      },
    }
    expect(installEmbedHostLifecycle(scope)).toBe(true)
    expect(installEmbedHostLifecycle(scope)).toBe(false)
    expect(listeners).toHaveLength(1)
    expect(listeners[0]).toMatchObject({ type: 'pagehide', once: true })
    listeners[0]?.listener()
    expect(embedSource).toContain('installEmbedHostLifecycle()')
    expect(embedSource).toContain('item.value.services.dispose()')
    expect(embedSource).not.toContain('disconnectedCallback() {\n    void disposeEmbedHosts()')
  })
})
