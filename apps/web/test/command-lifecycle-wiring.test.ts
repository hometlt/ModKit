import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installEmbedHostLifecycle } from '../src/embed.js'

const shellSource = readFileSync(join(import.meta.dirname, '..', 'src', 'shell.ts'), 'utf8')
const embedSource = readFileSync(join(import.meta.dirname, '..', 'src', 'embed.ts'), 'utf8')

describe('PWA command lifecycle wiring', () => {
  it('binds the workbench command realm to pagehide exactly once', () => {
    expect(shellSource).toContain(
      "window.addEventListener('pagehide', () => void services.dispose(), { once: true })",
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
