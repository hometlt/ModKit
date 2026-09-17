// sc2-data catalog library probes (flatten, Filter, relations, graph view, subtree extraction),
// driven identically over a catalog opened by either implementation.
const ids = entities => entities.map(entity => `${entity.namespace ?? ''}/${entity.id}`)
export const plain = value => (value === undefined ? null : JSON.parse(JSON.stringify(value, (_key, item) =>
  item instanceof Map ? [...item.entries()] : item instanceof Set ? [...item] : item)))

export function drive(api, catalog) {
  const namespaces = [...catalog.namespaces()].sort()
  const filters = Object.fromEntries(namespaces.map(ns => {
    const first = catalog.all(ns).find(entity => entity.id !== '')
    return [ns, {
      byNamespace: ids(api.Filter.byNamespace(catalog, ns)),
      nonDefault: ids(api.Filter.nonDefault(catalog, ns)),
      byClass: first === undefined ? [] : ids(api.Filter.byClass(catalog, ns, first.class)),
      byPrefix: first === undefined ? [] : ids(api.Filter.byPrefix(catalog, ns, first.id.slice(0, 2))),
      byId: ids(api.Filter.byId(catalog, ns, id => id.length % 2 === 0)),
    }]
  }))
  const graph = api.buildCatalogRelations(catalog)
  const seeds = namespaces.flatMap(ns => catalog.all(ns).filter(entity => entity.id !== '').slice(0, 2))
  return {
    filters,
    units: ids(api.Filter.units(catalog)),
    flatten: plain(api.flatten(catalog, { namespaces })),
    flattenDefault: plain(api.flatten(catalog)),
    graph: plain(graph),
    views: seeds.slice(0, 4).map(entity => plain(api.toRelationGraphView(graph, { ns: entity.namespace, id: entity.id, depth: 2 }))),
    subtree: ids(api.extractSubtree(catalog, graph, seeds, {})),
    subtreeExcluded: ids(api.extractSubtree(catalog, graph, seeds, { excludeNamespaces: namespaces.slice(0, 1) })),
  }
}
