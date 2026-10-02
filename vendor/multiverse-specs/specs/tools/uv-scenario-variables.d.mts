export type ScenarioVariableInitializer = Readonly<{ id: string; type: string; packageId: string; path: string }>
  & (Readonly<{ initialHex: string }> | Readonly<{ initialAddress: string }>)
export function projectScenarioVariables(documents: readonly Readonly<{
  packageId: string; path: string; document: unknown
}>[]): { variables: readonly ScenarioVariableInitializer[] } | { refusal: { rule: string; message: string } }
export function verifyInertScenarioProfile(documents: readonly Readonly<{
  packageId: string; path: string; document: unknown
}>[]): { admitted: true } | { refusal: { rule: string; message: string } }
