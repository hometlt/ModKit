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
import { type UiLocalizationOptions, type UiLocalizer } from '../localization/index.js'
import { PANELS_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

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

export function createDiagnosticsPanel(options: UiLocalizationOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, PANELS_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('panels.diagnostics'))
      renderDiagnostics(root, args.descriptor)
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        renderDiagnostics(root, descriptor)
      })
    },
  })
}

export const diagnosticsPanel: ViewerModule = createDiagnosticsPanel()

function renderToolbar(
  root: HTMLElement,
  descriptor: AnyDescriptor,
  operations: Parameters<typeof invokeOperation>[1],
  signal: AbortSignal,
  localizer: UiLocalizer,
): void {
  root.replaceChildren()
  const status = element(root, 'output', {
    text: localizer.text('panels.ready'),
    part: 'operations.status',
  })
  for (const operation of descriptor.operations) {
    /*
     * This toolbar invokes with a `null` input, and a mutating operation's input is a record —
     * so a button for one is a control that can only refuse. It also is not this component's
     * place to author a mutation UI: a host that offers mutating operations builds forms for
     * their inputs (Electron's Edit panel is the worked example). Declared-but-unavailable
     * operations still render disabled with their reason, because "you cannot run this and here
     * is why" is information; "click me and be refused" is not.
     */
    if (operation.mutatesSource === true) continue
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
    button.addEventListener('click', () => {
      button.disabled = true
      /*
       * Explicitly settled, never floated: a handler that throws before producing a result (a
       * codec refusing outright does exactly that) used to become an unhandled rejection while
       * the status line kept saying "Ready" — the one moment the user most needs the reason is
       * the one moment it went to the console instead.
       */
      invokeOperation(descriptor, operations, operation.id, null, {
        signal,
        onProgress: (completed, total, message) =>
          setViewerText(
            status,
            `${message ?? localizer.text('panels.working')}: ${completed}/${total ?? '?'}`,
          ),
      })
        .then(result =>
          setViewerText(
            status,
            result.state === 'ok'
              ? localizer.text('panels.operationComplete', { operation: operation.id })
              : result.reason,
          ),
        )
        .catch((error: unknown) =>
          setViewerText(
            status,
            `${operation.id}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
        .finally(() => {
          button.disabled = false
        })
    })
  }
}

export function createOperationToolbar(options: UiLocalizationOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, PANELS_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('panels.operations'))
      renderToolbar(root, args.descriptor, args.operations, scope.signal, localizer)
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        renderToolbar(root, descriptor, args.operations, scope.signal, localizer)
      })
    },
  })
}

export const operationToolbar: ViewerModule = createOperationToolbar()
