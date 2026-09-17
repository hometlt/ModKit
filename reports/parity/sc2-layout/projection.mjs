// Declared SC2Layout comparison projection. The workspace/render helpers below reproduce the
// published MK3 runtime's projection of the shared engine objects so both arms can be driven the
// same way; they contain no layout semantics of their own.
export const plain = value => (value === undefined ? null : JSON.parse(JSON.stringify(value, (_key, item) =>
  item instanceof Map ? [...item.entries()] : item instanceof Set ? [...item] : ArrayBuffer.isView(item) ? Buffer.from(item.buffer, item.byteOffset, item.byteLength).toString('hex') : item)))

const sourceOf = value => ({ uri: value.uri, start: value.start, end: value.end, contribution: { ...value.contribution } })

export function resolvedFrame(frame) {
  return {
    name: frame.name,
    type: frame.type,
    path: [...frame.path],
    ...(frame.source === undefined ? {} : { source: sourceOf(frame.source) }),
    contributions: frame.contributions.map(item => ({ ...item })),
    properties: [...frame.properties.entries()].map(([key, property]) => ({
      key, tag: property.tag, attrs: { ...property.attrs },
      ...(property.val === undefined ? {} : { val: property.val }),
      source: sourceOf(property.source), overridden: property.overridden.length,
    })),
    anchors: Object.entries(frame.anchors).map(([side, anchor]) => ({
      side, implicitSide: anchor.implicitSide,
      ...(anchor.relative === undefined ? {} : { relative: anchor.relative }),
      ...(anchor.pos === undefined ? {} : { pos: anchor.pos }),
      ...(anchor.offset === undefined ? {} : { offset: anchor.offset }),
      source: sourceOf(anchor.source),
    })),
    animations: [...frame.animations],
    stateGroups: frame.stateGroups.map(group => ({ name: group.name, defaultState: group.defaultState, states: group.states.map(state => state.name) })),
    diagnostics: frame.diagnostics.map(item => ({ ...item })),
    children: frame.children.map(resolvedFrame),
  }
}

const stem = uri => uri.slice(uri.lastIndexOf('/') + 1).replace(/\.sc2layout$/iu, '')

/** Store + LayoutChecker + rendering pipeline, parameterized by one implementation's modules. */
export function drive(impl, documents, primaryUri, probe, input) {
  const registry = impl.createRegistry(impl.schemaData)
  const store = new impl.Store(registry)
  for (const item of documents) store.updateDocument(item.uri, item.text, 1)
  if (probe === 'store-check') {
    const document = store.documents.get(primaryUri)
    return {
      schema: {
        simpleTypes: registry.catalog.simpleType.size, complexTypes: registry.catalog.complexType.size,
        elements: registry.catalog.element.size, frameClasses: registry.catalog.frameClass.size,
        frameTypes: registry.catalog.frameType.size,
      },
      documents: documents.length,
      diagnostics: new impl.LayoutChecker(store, store.index).checkFile(document).map(item => ({
        start: item.start, end: item.end, category: item.category, message: item.message,
      })),
    }
  }
  const candidates = [`${stem(primaryUri)}/${input.rootPath}`, input.rootPath]
  let root
  for (const candidate of candidates) {
    root = impl.resolveFrameByPath(store, candidate)
    if (root !== undefined) break
  }
  if (root === undefined) throw new RangeError(`SC2Layout frame path was not resolved: ${input.rootPath}`)
  const states = impl.applyStateGroups(root, { stateInputs: {}, index: store.index })
  const numeric = raw => {
    const resolved = impl.resolvePropertyValue(store.index, raw)
    if (resolved === undefined) return undefined
    const parsed = Number.parseFloat(resolved)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const solved = impl.solveLayout(root, { rootRect: { x: 0, y: 0, width: 1600, height: 1200 }, resolveValue: numeric })
  const expressions = impl.evaluateExpressions(root)
  const display = impl.buildDisplayList(root, solved, {
    includeHidden: undefined,
    resolveValue: raw => impl.resolvePropertyValue(store.index, raw),
    expressions: expressions.byFrame,
  })
  return {
    resolvedTree: resolvedFrame(root),
    displayItems: display.items,
    diagnostics: [...root.diagnostics, ...states.diagnostics, ...display.diagnostics],
    activeStates: [...states.active.entries()].map(([path, state]) => ({ path, state })),
    html: impl.emitHtml(display, { title: `${stem(primaryUri)} layout` }),
  }
}

export function project(probe, { value, native }) {
  switch (probe) {
    case 'store-check':
      if (native !== undefined) {
        const { provenance: _provenance, ...rest } = native
        return plain(rest)
      }
      return plain(value)
    case 'render-visual':
      if (native !== undefined) {
        const { candidateContract: _c, completeness: _k, fidelity: _f, provenance: _p, ...rest } = native
        return plain(rest)
      }
      return plain(value)
    case 'parse':
    case 'view.inspect':
    case 'view.render':
    case 'export.convert':
    case 'export.raw':
    case 'schema':
      return plain(value)
  }
  throw new Error(`unknown sc2-layout probe: ${probe}`)
}
