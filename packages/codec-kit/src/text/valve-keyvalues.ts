/**
 * Valve KeyValues1 syntax reader; ordered duplicate-preserving entries for VDF/VMT/gameinfo.
 * Reads quoted/unquoted strings, // comments, blocks and trailing [conditions]. Directives
 * remain ordinary entries. No condition evaluation, include resolution, filesystem or KV2/KV3.
 * Limits count UTF-16 code units, entries and block nesting. Offsets are zero-based UTF-16.
 * Independent implementation for Core review; no Source SDK or third-party source copied.
 */
export interface ValveKeyValuesEntry {
  readonly key: string;
  readonly value: string | readonly ValveKeyValuesEntry[];
  readonly condition?: string;
}

export interface ValveKeyValuesLimits {
  /** Caller selects native escape-disabled paths or escaped text; no inferred default. */
  readonly quotedEscapes: 'literal' | 'escaped';
  readonly maxInputLength: number;
  readonly maxTokenLength: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
}

/** Carries the exact source offset of a syntax or resource-limit refusal. */
export class ValveKeyValuesError extends SyntaxError {
  constructor(message: string, readonly offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = 'ValveKeyValuesError';
  }
}

/** Parses syntax only; finite caller limits and cancellation apply to every scan. */
export function parseValveKeyValues(
  text: string,
  limits: ValveKeyValuesLimits,
  signal?: AbortSignal,
): readonly ValveKeyValuesEntry[] {
  for (const key of ['maxInputLength', 'maxTokenLength', 'maxNodes', 'maxDepth'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0) throw new RangeError(`Invalid ${key}`);
  }
  if (limits.quotedEscapes !== 'literal' && limits.quotedEscapes !== 'escaped') throw new RangeError('Invalid quotedEscapes');
  signal?.throwIfAborted();
  if (text.length > limits.maxInputLength) throw new ValveKeyValuesError('Input limit exceeded', limits.maxInputLength);
  let offset = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let nodes = 0;
  const root: ValveKeyValuesEntry[] = [];
  const stack: ValveKeyValuesEntry[][] = [root];

  /** Polls even within long comments, tokens and whitespace runs. */
  function advance(): void {
    offset++;
    if ((offset & 1023) === 0) signal?.throwIfAborted();
  }
  /** Skips only syntax whitespace and line comments; no include/file access. */
  function skip(): void {
    while (offset < text.length) {
      if (/\s/.test(text[offset]!)) advance();
      else if (text[offset] === '/' && text[offset + 1] === '/') {
        while (offset < text.length && text[offset] !== '\n') advance();
      } else break;
    }
  }
  /** Bounds raw token length, including quoted escapes and condition syntax. */
  function bound(start: number): void {
    if (offset - start > limits.maxTokenLength) throw new ValveKeyValuesError('Token limit exceeded', start + limits.maxTokenLength);
  }
  /** Literal mode preserves backslashes; escaped mode decodes known escapes only. */
  function token(): string {
    const start = offset;
    const quoted = text[offset] === '"';
    if (quoted) advance();
    let value = '';
    while (offset < text.length) {
      const char = text[offset]!;
      if (quoted && char === '"') { advance(); bound(start); return value; }
      if (!quoted && (/\s/.test(char) || '{}[]"'.includes(char) || (char === '/' && text[offset + 1] === '/'))) break;
      if (quoted && char === '\\' && limits.quotedEscapes === 'escaped') {
        advance(); bound(start);
        if (offset === text.length) throw new ValveKeyValuesError('Unterminated quoted string', start);
        const escaped = text[offset]!;
        value += ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' } as Record<string, string>)[escaped] ?? `\\${escaped}`;
      } else value += char;
      advance(); bound(start);
    }
    if (quoted) throw new ValveKeyValuesError('Unterminated quoted string', start);
    if (offset === start) throw new ValveKeyValuesError('Expected string', offset);
    return value;
  }
  /** Attaches one uninterpreted trailing conditional expression to its entry. */
  function condition(entry: ValveKeyValuesEntry): ValveKeyValuesEntry {
    skip();
    if (text[offset] !== '[') return entry;
    const start = offset;
    advance();
    const content = offset;
    while (offset < text.length && text[offset] !== ']') {
      if (text[offset] === '[' || text[offset] === '{' || text[offset] === '}') throw new ValveKeyValuesError('Invalid condition', offset);
      advance(); bound(start);
    }
    if (offset === text.length) throw new ValveKeyValuesError('Unterminated condition', start);
    const expression = text.slice(content, offset);
    if (expression.trim().length === 0) throw new ValveKeyValuesError('Empty condition', start);
    advance(); bound(start);
    return { ...entry, condition: expression };
  }

  while (true) {
    signal?.throwIfAborted();
    skip();
    if (offset === text.length) {
      if (stack.length !== 1) throw new ValveKeyValuesError('Unclosed block', offset);
      return root;
    }
    if (text[offset] === '}') {
      if (stack.length === 1) throw new ValveKeyValuesError('Unexpected closing brace', offset);
      advance();
      stack.pop();
      const parent = stack[stack.length - 1]!;
      parent[parent.length - 1] = condition(parent[parent.length - 1]!);
      continue;
    }
    const start = offset;
    const key = token();
    if (++nodes > limits.maxNodes) throw new ValveKeyValuesError('Node limit exceeded', start);
    skip();
    const parent = stack[stack.length - 1]!;
    if (text[offset] === '{') {
      if (stack.length > limits.maxDepth) throw new ValveKeyValuesError('Depth limit exceeded', offset);
      advance();
      const children: ValveKeyValuesEntry[] = [];
      parent.push({ key, value: children });
      stack.push(children);
    } else {
      if (offset === text.length) throw new ValveKeyValuesError('Missing value', offset);
      parent.push(condition({ key, value: token() }));
    }
  }
}
