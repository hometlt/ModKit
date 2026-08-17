globalThis.__x3EmptyMatchImports = (globalThis.__x3EmptyMatchImports ?? 0) + 1

export const abiVersion = 1

export const createCodec = () => {
  throw new Error('an empty match rule set must never activate a codec')
}
