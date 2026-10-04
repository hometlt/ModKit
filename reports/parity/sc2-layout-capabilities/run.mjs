import { runDifferentialCli } from '../../../scripts/migration/lib/port-generators.mjs'
await runDifferentialCli({
  codec: 'sc2-layout',
  requirementIds: ['legacy/codec-manifest/modkit/sc2-layout/feature/f3b803a24538e2ef'],
})
