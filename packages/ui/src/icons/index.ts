/**
 * Codicons — the icon font MK2's viewers drew with, shipped as `@modkit/ui/assets/codicons`.
 *
 * A host links `codicon.css` once (the VS Code page does; VS Code's own status bar spells the same
 * names as `$(name)`), and a viewer asks for an icon by its codicon name. Decorative only: the
 * control that holds the icon carries the accessible name.
 */
export function icon(document: Document, name: string): HTMLSpanElement {
  const node = document.createElement('span')
  node.className = `codicon codicon-${name}`
  node.setAttribute('aria-hidden', 'true')
  return node
}

/** A button showing one icon, titled for screen readers and tooltips. */
export function iconButton(
  parent: HTMLElement,
  name: string,
  title: string,
  onClick?: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = parent.ownerDocument.createElement('button')
  button.type = 'button'
  button.title = title
  button.setAttribute('aria-label', title)
  button.append(icon(parent.ownerDocument, name))
  if (onClick !== undefined) button.addEventListener('click', onClick)
  parent.append(button)
  return button
}
