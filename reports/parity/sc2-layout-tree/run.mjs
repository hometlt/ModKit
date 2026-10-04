import { runDifferentialCli } from '../../../scripts/migration/lib/port-generators.mjs'
await runDifferentialCli({ codec: 'sc2-layout', requirementIds: ['legacy/codec-manifest/modkit/sc2-layout/feature/b1388f61ccf518e2'] })
