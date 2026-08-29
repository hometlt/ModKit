/** A bounded, auditable host projection of presentation-neutral subject calculations. */
import type {
  JsonValue,
  Page,
  SubjectCalculation,
  SubjectCalculationsSource,
  SubjectCalculationsSummary,
  ViewerModule,
} from '@modkitx-x3/sdk'
import { setPart, setState } from '../parts.js'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  safeViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'

export interface SubjectCalculationsLoadOptions {
  readonly maximum?: number
  readonly pageSize?: number
  readonly signal?: AbortSignal
}

export interface SubjectCalculationsSnapshot {
  readonly summary: SubjectCalculationsSummary
  readonly calculations: readonly SubjectCalculation[]
  readonly capped: boolean
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be positive`)
  return value
}

async function loadPages(
  source: SubjectCalculationsSource,
  maximum: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<{ readonly items: readonly SubjectCalculation[]; readonly capped: boolean }> {
  const items: SubjectCalculation[] = []
  let cursor: string | undefined
  const seen = new Set<string>()
  while (items.length < maximum) {
    const page: Page<SubjectCalculation> = await source.calculations(
      {
        ...(cursor === undefined ? {} : { cursor }),
        limit: Math.min(pageSize, maximum - items.length),
      },
      signal,
    )
    items.push(...page.items)
    if (page.nextCursor === undefined) return { items: Object.freeze(items), capped: false }
    if (seen.has(page.nextCursor))
      throw new Error('subject calculations source repeated a page cursor')
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  }
  return { items: Object.freeze(items), capped: cursor !== undefined }
}

export async function loadSubjectCalculations(
  source: SubjectCalculationsSource,
  options: SubjectCalculationsLoadOptions = {},
): Promise<SubjectCalculationsSnapshot> {
  const maximum = positiveLimit(options.maximum ?? 512, 'maximum')
  const pageSize = positiveLimit(options.pageSize ?? 64, 'pageSize')
  const [summary, page] = await Promise.all([
    source.summary(options.signal),
    loadPages(source, maximum, pageSize, options.signal),
  ])
  return Object.freeze({ summary, calculations: page.items, capped: page.capped })
}

function displayValue(value: JsonValue | undefined): string {
  if (value === undefined) return 'not available'
  if (typeof value === 'string') return value
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return JSON.stringify(value)
}

function text(
  document: Document,
  part: Parameters<typeof setPart>[1],
  value: unknown,
): HTMLElement {
  const node = document.createElement('span')
  setPart(node, part)
  node.textContent = safeViewerText(value, 2_048)
  return node
}

export interface SubjectCalculationsView {
  readonly root: HTMLElement
  destroy(): void
}

export function createSubjectCalculationsView(
  document: Document,
  snapshot: SubjectCalculationsSnapshot,
): SubjectCalculationsView {
  const root = document.createElement('article')
  root.className = 'modkit-calculations'
  root.setAttribute('aria-label', 'Subject calculations')
  setPart(root, 'calculations')

  const summary = document.createElement('p')
  setPart(summary, 'calculations.summary')
  const visible = snapshot.calculations.length
  summary.textContent = safeViewerText(
    `${visible} of ${snapshot.summary.totalCalculations} calculations · ${
      snapshot.capped ? 'capped by the viewer' : snapshot.summary.completeness
    }${snapshot.summary.reason === undefined ? '' : ` · ${snapshot.summary.reason}`}`,
    1_024,
  )
  if (snapshot.capped || snapshot.summary.completeness !== 'complete')
    setState(summary, ['degraded'])
  root.append(summary)

  const list = document.createElement('div')
  setPart(list, 'calculations.list')
  root.append(list)
  for (const calculation of snapshot.calculations) {
    const item = document.createElement('section')
    setPart(item, 'calculations.item')
    item.dataset['status'] = calculation.status

    const heading = document.createElement('h3')
    setPart(heading, 'calculations.heading')
    heading.textContent = safeViewerText(calculation.label, 256)

    const result = text(
      document,
      'calculations.result',
      `${displayValue(calculation.value)}${calculation.unit === undefined ? '' : ` ${calculation.unit}`} · ${calculation.status}`,
    )
    const formula = text(
      document,
      'calculations.formula',
      `${calculation.formula.name} ${calculation.formula.version}: ${calculation.formula.expression}`,
    )
    item.append(heading, result, formula)
    if (calculation.provenance.length > 0) {
      item.append(
        text(
          document,
          'calculations.formula',
          `Sources: ${calculation.provenance.map(origin => origin.label).join(' · ')}`,
        ),
      )
    }

    if (calculation.inputs.length > 0) {
      const inputs = document.createElement('dl')
      setPart(inputs, 'calculations.inputs')
      for (const input of calculation.inputs) {
        const row = document.createElement('div')
        setPart(row, 'calculations.input')
        const label = document.createElement('dt')
        label.textContent = safeViewerText(input.label, 256)
        const value = document.createElement('dd')
        value.textContent = safeViewerText(
          `${displayValue(input.value)}${input.unit === undefined ? '' : ` ${input.unit}`} · ${input.state}${
            input.provenance.length === 0
              ? ''
              : ` · ${input.provenance.map(origin => origin.label).join(' · ')}`
          }`,
          2_048,
        )
        row.append(label, value)
        inputs.append(row)
      }
      item.append(inputs)
    }

    if (calculation.warnings.length > 0) {
      const warnings = document.createElement('ul')
      setPart(warnings, 'calculations.warnings')
      for (const warning of calculation.warnings) {
        const entry = document.createElement('li')
        entry.textContent = safeViewerText(`${warning.code}: ${warning.message}`, 2_048)
        warnings.append(entry)
      }
      item.append(warnings)
    }
    list.append(item)
  }

  if (snapshot.calculations.length === 0) {
    const empty = document.createElement('p')
    setPart(empty, 'viewer.empty')
    empty.textContent = 'This subject publishes no calculations.'
    list.append(empty)
  }

  return { root, destroy: () => root.remove() }
}

/** Standard stage adapter over the selected calculations data-source binding. */
export const subjectCalculationsViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Subject calculations')
    try {
      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/subject-calculations-source',
      )
      if (lease === undefined) throw new TypeError('subject calculations binding is unavailable')
      scope.lease(lease)
      const snapshot = await loadSubjectCalculations(lease.value as SubjectCalculationsSource, {
        signal: scope.signal,
      })
      const view = createSubjectCalculationsView(root.ownerDocument, snapshot)
      root.append(view.root)
      scope.cleanup(() => view.destroy())
      root.dataset['revision'] = args.descriptor.revision
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
      })
    } catch (error) {
      await scope.close()
      root.remove()
      throw error
    }
  },
})

export default subjectCalculationsViewer
