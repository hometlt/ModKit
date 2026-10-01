/** Node reference digest over the shared portable UV canonical byte form. */
export function uvDigest(domain: string, value: unknown,
  options?: { schemaVersion?: number; algorithm?: 'sha256' }): string
