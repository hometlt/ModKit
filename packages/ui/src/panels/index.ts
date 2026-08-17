import type { AnyDescriptor, ViewerModule } from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  diagnosticsBySeverity,
  element,
  invokeOperation,
  setViewerText,
  ViewerMountScope,
} from '../viewer/index.js'

function renderDiagnostics(root: HTMLElement, descriptor: AnyDescriptor): void {
  root.replaceChildren()
  const grouped = diagnosticsBySeverity(descriptor.diagnostics)
  for (const severity of ['error', 'warning', 'information', 'hint'] as const) {
    const section = element(root, 'section', { part: 'diagnostics.group' })
    section.dataset['severity'] = severity
    element(section, 'h2', {
      text: `${severity} (${grouped[severity].length})`,
      part: 'diagnostics.heading',
    })
    const list = element(section, 'ul', { part: 'diagnostics.list' })
    for (const diagnostic of grouped[severity]) {
      const item = element(list, 'li', { part: 'diagnostics.item' })
      item.dataset['severity'] = severity
      const button = element(item, 'button', {
        text: diagnostic.message,
        part: 'diagnostics.message',
      }) as HTMLButtonElement
      button.type = 'button'
      button.dataset['diagnosticId'] = diagnostic.id
      button.addEventListener('click', () => {
        root.dispatchEvent(
          new CustomEvent('modkit-diagnostic-jump', {
            bubbles: true,
            detail: { id: diagnostic.id, range: diagnostic.range },
          }),
        )
      })
    }
  }
}

export const diagnosticsPanel: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Diagnostics')
    renderDiagnostics(root, args.descriptor)
    return createViewerMount(root, scope, args, ({ descriptor }) => {
      renderDiagnostics(root, descriptor)
    })
  },
})

function renderToolbar(
  root: HTMLElement,
  descriptor: AnyDescriptor,
  operations: Parameters<typeof invokeOperation>[1],
  signal: AbortSignal,
): void {
  root.replaceChildren()
  const status = element(root, 'output', { text: 'Ready', part: 'operations.status' })
  for (const operation of descriptor.operations) {
    const button = element(root, 'button', {
      text: operation.id,
      part: 'operations.button',
    }) as HTMLButtonElement
    button.type = 'button'
    button.disabled = operation.state !== 'available'
    if (operation.state !== 'available') {
      button.title = operation.reason
      continue
    }
    button.addEventListener('click', async () => {
      button.disabled = true
      const result = await invokeOperation(descriptor, operations, operation.id, null, {
        signal,
        onProgress: (completed, total, message) =>
          setViewerText(status, `${message ?? 'Working'}: ${completed}/${total ?? '?'}`),
      })
      setViewerText(status, result.state === 'ok' ? `${operation.id}: complete` : result.reason)
      button.disabled = false
    })
  }
}

export const operationToolbar: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Operations')
    renderToolbar(root, args.descriptor, args.operations, scope.signal)
    return createViewerMount(root, scope, args, ({ descriptor }) => {
      renderToolbar(root, descriptor, args.operations, scope.signal)
    })
  },
})
