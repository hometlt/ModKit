// Fancy provider: consumes ONLY public exports of the installed lab packages —
// no deep dist paths, no workspace links (S4 acceptance).
import { serializeSubjectRef, rootSubject } from '@modkitx-x3/sdk/subjects'
import { collectStream, createMemorySource } from '@modkitx-x3/vfs'

export function createGreeter(spec) {
  const greeting = spec?.greeting ?? 'Salute'
  return {
    greet: name => `${greeting}, ${name}!`,
    async greetFromSource(name) {
      const bytes = new TextEncoder().encode(`${greeting} via vfs`)
      const source = createMemorySource('mem://greeting', bytes)
      const collected = await collectStream(source.stream())
      const subject = serializeSubjectRef(rootSubject({ id: source.id }))
      await source.dispose()
      return `${new TextDecoder().decode(collected)}, ${name}! [subject ${subject}]`
    },
  }
}
