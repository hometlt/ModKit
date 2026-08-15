import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  invokeOperation,
  ViewerMountScope,
} from '@modkitx-x3/ui/viewer'

export const syntheticViewer = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Packed synthetic viewer')
    const page = element(root, 'div', { role: 'region' })
    page.tabIndex = 0
    page.setAttribute('aria-label', 'Virtual page')
    page.style.maxHeight = '120px'
    page.style.overflow = 'auto'
    const pageText = element(page, 'p', { text: 'page 1 of a synthetic million-row source' })
    const next = element(root, 'button', { text: 'Next page' })
    next.setAttribute('type', 'button')
    next.addEventListener('click', () => {
      pageText.textContent = 'page 2 of a synthetic million-row source'
    })

    const tree = element(root, 'div', { role: 'tree' })
    const expand = element(tree, 'button', { text: 'Expand root' })
    expand.setAttribute('type', 'button')
    expand.addEventListener('click', () => {
      if (tree.querySelector('[role="treeitem"]') === null) {
        const child = element(tree, 'span', { role: 'treeitem', text: 'lazy child' })
        child.setAttribute('aria-label', 'lazy child')
      }
    })

    const table = element(root, 'table')
    table.setAttribute('aria-label', 'Synthetic table')
    const row = element(element(table, 'tbody'), 'tr')
    element(row, 'td', { text: '<untrusted cell>' })

    const diagnostic = element(root, 'button', { text: 'Jump to diagnostic' })
    diagnostic.setAttribute('type', 'button')
    diagnostic.addEventListener('click', () => {
      root.dispatchEvent(
        new CustomEvent('modkit-diagnostic-jump', {
          bubbles: true,
          detail: { id: 'packed-diagnostic' },
        }),
      )
    })

    const progress = element(root, 'output', { text: 'idle' })
    const run = element(root, 'button', { text: 'Run operation' })
    run.setAttribute('type', 'button')
    const cancel = element(root, 'button', { text: 'Cancel operation' })
    cancel.setAttribute('type', 'button')
    let operation
    run.addEventListener('click', async () => {
      operation?.abort('replaced')
      operation = new AbortController()
      const result = await invokeOperation(
        args.descriptor,
        args.operations,
        'asset.validate',
        {},
        {
          signal: operation.signal,
          onProgress(completed, total, message) {
            progress.textContent = `${completed}/${total ?? '?'} ${message ?? ''}`.trim()
          },
        },
      )
      progress.textContent = result.state === 'ok' ? 'complete' : result.reason
    })
    cancel.addEventListener('click', () => operation?.abort('user-cancelled'))

    scope.cleanup(() => {
      operation?.abort('viewer-unmounted')
      next.replaceWith(next.cloneNode(true))
      expand.replaceWith(expand.cloneNode(true))
      diagnostic.replaceWith(diagnostic.cloneNode(true))
      run.replaceWith(run.cloneNode(true))
      cancel.replaceWith(cancel.cloneNode(true))
    })
    return createViewerMount(root, scope, args, ({ descriptor }) => {
      root.dataset.revision = descriptor.revision
    })
  },
})

export default syntheticViewer
