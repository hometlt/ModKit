/**
 * Accordion — the collapsible property sections of the MK2 model viewer
 * (RENDERING / ANIMATION / BOUNDS / MESHES / MATERIALS / BONES …).
 *
 * Sections are independent by default, so several can stay open at once, which is how the MK2
 * panel behaved. Bodies render lazily on first expand: a bone list with a thousand entries costs
 * nothing until someone opens it.
 */
import { setPart, setState } from '../parts.js'
import { safeViewerText } from '../viewer/index.js'

export interface AccordionSectionSpec {
  readonly id: string
  readonly title: string
  /** Short right-aligned annotation: a count, a unit, a state word. */
  readonly hint?: string
  readonly expanded?: boolean
  /** Called on first expand. Return DOM, or fill the supplied host yourself. */
  render(host: HTMLElement): void | Promise<void>
}

export interface AccordionOptions {
  readonly label: string
  readonly sections: readonly AccordionSectionSpec[]
  /** When true, opening one section closes the others. Off by default. */
  readonly exclusive?: boolean
}

export interface Accordion {
  readonly root: HTMLElement
  expand(id: string): Promise<void>
  collapse(id: string): void
  collapseAll(): void
  destroy(): void
}

export function createAccordion(document: Document, options: AccordionOptions): Accordion {
  const root = document.createElement('div')
  root.className = 'modkit-accordion'
  root.setAttribute('aria-label', options.label)
  setPart(root, 'accordion')

  interface Entry {
    readonly spec: AccordionSectionSpec
    readonly section: HTMLElement
    readonly header: HTMLButtonElement
    readonly body: HTMLElement
    expanded: boolean
    rendered: boolean
  }

  const entries = new Map<string, Entry>()

  const setOpen = async (entry: Entry, open: boolean): Promise<void> => {
    if (options.exclusive === true && open) {
      for (const other of entries.values()) {
        if (other !== entry && other.expanded) await setOpen(other, false)
      }
    }
    entry.expanded = open
    entry.header.setAttribute('aria-expanded', String(open))
    entry.body.hidden = !open
    setState(entry.section, open ? ['active'] : [])
    if (open && !entry.rendered) {
      entry.rendered = true
      setState(entry.section, ['loading'])
      try {
        await entry.spec.render(entry.body)
        setState(entry.section, ['active'])
      } catch (error) {
        setState(entry.section, ['error'])
        entry.body.textContent = safeViewerText(
          `section failed: ${error instanceof Error ? error.message : String(error)}`,
          512,
        )
      }
    }
  }

  for (const spec of options.sections) {
    const section = document.createElement('section')
    section.className = 'modkit-accordion__section'
    section.dataset['sectionId'] = spec.id
    setPart(section, 'accordion.section')

    const header = document.createElement('button')
    header.type = 'button'
    header.className = 'modkit-accordion__header'
    header.setAttribute('aria-expanded', 'false')
    setPart(header, 'accordion.header')

    const twisty = document.createElement('span')
    twisty.className = 'modkit-accordion__twisty'
    twisty.setAttribute('aria-hidden', 'true')
    twisty.textContent = '›'
    setPart(twisty, 'accordion.twisty')
    header.append(twisty)

    const title = document.createElement('span')
    title.className = 'modkit-accordion__title'
    title.textContent = safeViewerText(spec.title, 128)
    setPart(title, 'accordion.title')
    header.append(title)

    if (spec.hint !== undefined) {
      const hint = document.createElement('span')
      hint.className = 'modkit-accordion__hint'
      hint.textContent = safeViewerText(spec.hint, 64)
      setPart(hint, 'accordion.hint')
      header.append(hint)
    }

    const body = document.createElement('div')
    body.className = 'modkit-accordion__body'
    body.hidden = true
    setPart(body, 'accordion.body')

    const identifier = `mk-acc-${spec.id}`
    body.id = identifier
    header.setAttribute('aria-controls', identifier)

    section.append(header, body)
    root.append(section)

    const entry: Entry = { spec, section, header, body, expanded: false, rendered: false }
    entries.set(spec.id, entry)
    header.addEventListener('click', () => void setOpen(entry, !entry.expanded))
  }

  for (const spec of options.sections) {
    if (spec.expanded === true) {
      const entry = entries.get(spec.id)
      if (entry !== undefined) void setOpen(entry, true)
    }
  }

  return {
    root,
    async expand(id) {
      const entry = entries.get(id)
      if (entry !== undefined) await setOpen(entry, true)
    },
    collapse(id) {
      const entry = entries.get(id)
      if (entry !== undefined) void setOpen(entry, false)
    },
    collapseAll() {
      for (const entry of entries.values()) void setOpen(entry, false)
    },
    destroy() {
      root.remove()
    },
  }
}

/** Key/value row helper, matching the MK2 property rows inside each section. */
export function accordionField(host: HTMLElement, name: string, value: unknown): HTMLElement {
  const field = host.ownerDocument.createElement('div')
  field.className = 'modkit-accordion__field'
  setPart(field, 'accordion.field')
  const label = host.ownerDocument.createElement('span')
  label.textContent = safeViewerText(name, 128)
  setPart(label, 'accordion.field-name')
  const content = host.ownerDocument.createElement('span')
  content.textContent = safeViewerText(value, 1024)
  setPart(content, 'accordion.field-value')
  field.append(label, content)
  host.append(field)
  return field
}
