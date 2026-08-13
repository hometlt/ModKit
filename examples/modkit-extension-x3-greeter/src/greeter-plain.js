// Minimal provider for x3.demo/greeter@1: no dependencies at all.
export function createGreeter(spec) {
  const greeting = spec?.greeting ?? 'Hello'
  return { greet: name => `${greeting}, ${name}!` }
}
