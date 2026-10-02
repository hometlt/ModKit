/** Typed trust-boundary surface; validation consumes untrusted source documents. */
type Refusal = Readonly<{ rule: string; message: string }>
export function verifyCharts(document: unknown, registry: unknown, events: unknown,
  options?: Readonly<{ modules?: Readonly<Record<string, unknown>>; granted?: readonly string[] }>):
  Readonly<{ verified: true; bound: readonly string[] }> | Readonly<{ refusal: Refusal }>
export function verifyModule(module: unknown, registry: unknown,
  options?: Readonly<{ granted?: readonly string[] }>):
    Readonly<{ verified: true; bound: readonly string[] }> | Readonly<{ refusal: Refusal }>
export function verifyExecutableModuleProfile(module: unknown):
  Readonly<{ admitted: true }> | Readonly<{ refusal: Refusal }>
