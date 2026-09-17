// Galaxy detection, batch checking and fallback-audit probes, driven identically against either
// implementation's public API. Only call sequencing and JSON projection live here.
export const plain = value => (value === undefined ? null : JSON.parse(JSON.stringify(value)))

export async function drive(api, input, corpus, { caseBytes, caseName, resolveInput }) {
  const text = async index => new TextDecoder().decode(await caseBytes(resolveInput({ f: index }, corpus)))
  switch (input.probe) {
    case 'detect':
      return { accepted: await api.accepted(await caseBytes(input), caseName(input)) }
    case 'galaxy-check': {
      // The checker reads files itself; both arms receive the same absolute paths.
      const paths = index => resolveInput({ f: index }, corpus).file
      const result = api.checkGalaxyScripts(input.targets.map(paths), input.deps.map(paths))
      return { result: plain(result), formatted: api.formatGalaxyFindings(result) }
    }
    case 'galaxy-audit': {
      const report = api.auditGalaxyFallbacks(await text(input.f), caseName(input))
      return { report: plain(report), formatted: api.formatScriptFallbackAudit(report) }
    }
    case 'trigger-audit': {
      const report = api.auditTriggerFallbacks(await text(input.f), caseName(input))
      return { report: plain(report), formatted: api.formatScriptFallbackAudit(report) }
    }
    case 'audit-compare': {
      const baseline = api.auditGalaxyFallbacks(await text(input.baseline), 'Lib.galaxy')
      const candidate = api.auditGalaxyFallbacks(await text(input.f), 'Lib.galaxy')
      return plain(api.compareScriptFallbackAudits(baseline, candidate))
    }
    case 'sentinels':
      return plain(api.auditScriptPayloadSentinels(await text(input.f)))
  }
  throw new Error(`unknown galaxy extras probe: ${input.probe}`)
}
