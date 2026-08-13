// S3 spy entrypoint: importing this module leaves a visible mark. The gate test proves
// a denied activation never imports it (MK3/24 trust ladder).
globalThis.__x3SpyImports = (globalThis.__x3SpyImports ?? 0) + 1

export function createGreeter(spec) {
  const greeting = spec?.greeting ?? 'Hello'
  return { greet: name => `${greeting}, ${name}!` }
}
