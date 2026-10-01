/** UVS 1 chart-local initializers projected from verified documents. Not reaction admission. */
import { encodeCanonicalValue } from './uv-value.mjs'

const namespaceName = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/
const chartName = /^[a-z][a-z0-9-]*$/
const variableName = /^[a-z][a-zA-Z0-9]*$/
const refKind = /^[a-z][a-z0-9-]*$/
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')

/** Namespaces are composition-wide: two packages cannot silently replace one chart. */
export function projectScenarioVariables(documents) {
  const reject = (rule, message) => ({ refusal: { rule, message } })
  if (!Array.isArray(documents)) return reject('scenario-documents-invalid', 'UVS documents are required.')
  const charts = new Set()
  const variables = []
  for (const entry of documents) {
    const doc = entry?.document
    const source = `${entry?.packageId}/${entry?.path}`
    if (doc?.uv?.format !== 'UVS' || doc.uv.version !== '1.0'
      || typeof doc.namespace !== 'string' || !namespaceName.test(doc.namespace)
      || !Array.isArray(doc.charts) || doc.charts.length === 0)
      return reject('scenario-document-invalid', `${source} has no UVS 1 namespace and charts.`)
    for (const chart of doc.charts) {
      if (typeof chart?.name !== 'string' || !chartName.test(chart.name))
        return reject('scenario-chart-invalid', `${source} has an invalid chart name.`)
      const chartId = `${doc.namespace}/${chart.name}`
      if (chartId.length > 1024)
        return reject('scenario-chart-id-budget', `${chartId.slice(0, 80)} exceeds the strref ID budget.`)
      if (charts.has(chartId))
        return reject('scenario-chart-duplicate', `${chartId} is declared more than once in the composition.`)
      charts.add(chartId)
      if (chart.variables !== undefined && !Array.isArray(chart.variables))
        return reject('scenario-variables-invalid', `${chartId} has no variable list.`)
      const local = new Set()
      for (const variable of chart.variables ?? []) {
        if (typeof variable?.name !== 'string' || !variableName.test(variable.name)
          || local.has(variable.name) || !Object.hasOwn(variable, 'initial'))
          return reject('scenario-variable-invalid', `${chartId} has a missing or repeated variable.`)
        local.add(variable.name)
        const id = `${chartId}/${variable.name}`
        if (id.length > 1024)
          return reject('scenario-variable-id-budget', `${id.slice(0, 80)} exceeds the strref ID budget.`)
        const type = variable.type === 'ref' && refKind.test(variable.refKind ?? '')
          ? `ref<${variable.refKind}>` : variable.type
        if (variable.type === 'ref' ? type === 'ref' : !['bool', 'i64', 'fixed64', 'strref'].includes(type))
          return reject('scenario-variable-type', `${chartId}/${variable.name} has an unsupported type.`)
        try {
          variables.push({ id, type,
            initialHex: hex(encodeCanonicalValue({ type, value: variable.initial })),
            packageId: entry.packageId, path: entry.path })
        } catch (error) {
          return reject('scenario-variable-initial', `${chartId}/${variable.name}: ${error.message}`)
        }
      }
    }
  }
  variables.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return { variables }
}

/** The scalar VM stores variable values but has no UVS state machine or subscriptions yet. */
export function verifyInertScenarioProfile(documents) {
  for (const entry of documents) {
    const doc = entry.document
    if (Object.keys(doc).some(key => !['uv', 'namespace', 'charts'].includes(key)))
      return { refusal: { rule: 'scenario-profile-unavailable',
        message: `${entry.packageId}/${entry.path} needs an unsupported UVS document field.` } }
    for (const chart of doc.charts) {
      const state = chart.states?.[0]
      if (chart.states?.length !== 1 || state?.name !== chart.initialState
        || !Array.isArray(state.on) || state.on.length !== 0
        || Object.keys(chart).some(key => !['name', 'initialState', 'variables', 'states'].includes(key))
        || Object.keys(state).some(key => !['name', 'on'].includes(key))
        || chart.variables?.some(variable => Object.keys(variable).some(key =>
          !['name', 'type', 'refKind', 'initial'].includes(key)))) {
        return { refusal: { rule: 'scenario-profile-unavailable',
          message: `${entry.packageId}/${entry.path}: ${doc.namespace}/${chart.name} needs UVS state transitions or reactions.` } }
      }
    }
  }
  return { admitted: true }
}
