import type { LanguagePosition, LanguageRange } from '@modkit/sdk'
import type { LuaRange } from './ast.js'

/**
 * UTF-16 offsets of a text to editor positions and back. Line breaks are `\n`, `\r\n` and `\r`,
 * the set LSP recognises.
 */
export class LuaLineIndex {
  readonly #starts: number[] = [0]
  readonly #length: number

  constructor(text: string) {
    this.#length = text.length
    for (let offset = 0; offset < text.length; offset += 1) {
      const code = text.charCodeAt(offset)
      if (code === 13) {
        if (text.charCodeAt(offset + 1) === 10) offset += 1
        this.#starts.push(offset + 1)
      } else if (code === 10) {
        this.#starts.push(offset + 1)
      }
    }
  }

  get lineCount(): number {
    return this.#starts.length
  }

  position(offset: number): LanguagePosition {
    const clamped = Math.max(0, Math.min(offset, this.#length))
    let low = 0
    let high = this.#starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if ((this.#starts[middle] ?? 0) <= clamped) low = middle
      else high = middle - 1
    }
    return { line: low, character: clamped - (this.#starts[low] ?? 0) }
  }

  offset(position: LanguagePosition): number {
    const start = this.#starts[position.line]
    if (start === undefined) return this.#length
    const next = this.#starts[position.line + 1] ?? this.#length
    return Math.min(start + Math.max(0, position.character), next)
  }

  range(range: LuaRange): LanguageRange {
    return { start: this.position(range[0]), end: this.position(range[1]) }
  }
}
