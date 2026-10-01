export function verifyInertScenarioProfile(documents: readonly Readonly<{
  packageId: string; path: string; document: unknown
}>[]): { admitted: true } | { refusal: { rule: string; message: string } }
