import { describe, expect, it } from 'vitest'

import { createWorkbench } from '../src/workbench/index.js'

class FakeElement {
  readonly children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  readonly classList = {
    add(name: string): void {
      void name
    },
  }
  className = ''
  textContent = ''
  title = ''
  removed = false

  append(...children: FakeElement[]): void {
    this.children.push(...children)
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children)
  }

  remove(): void {
    this.removed = true
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
}

function fakeDocument(): Document & { readonly created: FakeElement[] } {
  const created: FakeElement[] = []
  return {
    created,
    createElement: () => {
      const element = new FakeElement()
      created.push(element)
      return element
    },
  } as unknown as Document & { readonly created: FakeElement[] }
}

const parts = (root: FakeElement): readonly string[] =>
  root.children.map(child => child.attributes.get('data-mk-part') ?? '')

describe('workbench embedding', () => {
  it('mounts only main when a host owns all surrounding chrome', () => {
    const document = fakeDocument()
    const workbench = createWorkbench(document, { title: 'Embedded', embedded: true })

    expect(parts(workbench.root as unknown as FakeElement)).toEqual(['workbench.main'])
  })

  it('can retain only an aside beside main without restoring title or status chrome', () => {
    const document = fakeDocument()
    const workbench = createWorkbench(document, { title: 'Embedded', embedded: { aside: true } })

    expect(parts(workbench.root as unknown as FakeElement)).toEqual([
      'workbench.sidebar',
      'workbench.main',
    ])
  })

  it('keeps the complete workbench for existing hosts by default', () => {
    const document = fakeDocument()
    const workbench = createWorkbench(document, { title: 'Standalone' })

    expect(parts(workbench.root as unknown as FakeElement)).toEqual([
      'workbench.titlebar',
      'workbench.activitybar',
      'workbench.sidebar',
      'workbench.main',
      'workbench.panel',
      'workbench.statusbar',
    ])
  })
})
