/**
 * The translation transports, carried over from MK2 and separated from the format they served.
 *
 * Source: `references/modkitmk2/extensions/blizzard/starcraft-2/codecs/sc2-strings/src/core/translate.ts`.
 * That file did two jobs at once — talk to six services, and protect StarCraft II's markup while
 * doing it. Only the first is vendor-neutral, and this module is that half, unchanged in behaviour:
 * the same endpoints, the same request bodies, the same response unwrapping.
 *
 * What deliberately did not travel is the masking. Which parts of a string are markup is a fact
 * about a format, and a transport that tried to work it out would have to know every format's
 * grammar — and would quietly mangle the one it did not. Callers mask, and tell the service to keep
 * the placeholders intact through the prompt below.
 *
 * The placeholder form is `[[MK0]]`, `[[MK1]]`, … and it is part of the contract rather than a
 * detail: a caller converts its own sentinels into it, the prompt names it, and a model that moves
 * one is caught by the caller's own check afterwards.
 */

const DEFAULT_PROMPT = [
  'Translate the game string from {sourceLanguage} to {targetLanguage}.',
  'Use the context when it helps terminology, faction names, unit names, ability names, and tone.',
  'Preserve placeholders like [[MK0]] exactly and in the correct position.',
  'Output only the translated string value.',
  '',
  'Key: {key}',
  'Context:',
  '{context}',
  '',
  'Text:',
  '{text}',
].join('\n')

/** Backends that talk to a chat model rather than a translation endpoint. */
const CHAT_BACKENDS = new Set(['openai', 'codex', 'openai-compatible', 'anthropic', 'gemini'])

export function isChatBackend(backend) {
  return CHAT_BACKENDS.has(backend)
}

function fillPrompt(template, text, options) {
  const values = {
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
    key: options.key ?? '',
    context: options.context ?? '',
    text,
  }
  return template.replace(
    /\{(sourceLanguage|targetLanguage|key|context|text)\}/gu,
    (_, name) => values[name] ?? '',
  )
}

async function readTextResponse(response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

/**
 * Unwrap what a chat model puts around an answer.
 *
 * Models fence code and quote strings even when told not to; MK2 learned this and stripped both.
 * Leaving the wrapper in place would write triple backticks into a shipped localization file.
 */
function stripResponseWrapper(text) {
  const trimmed = text.trim()
  const fenced = /^```(?:\w+)?\s*([\s\S]*?)\s*```$/u.exec(trimmed)
  const body = fenced?.[1]?.trim() ?? trimmed
  const quoted = /^"([\s\S]*)"$/u.exec(body)
  return quoted ? quoted[1].replaceAll('\\"', '"') : body
}

async function callGoogle(text, options, doFetch) {
  if (options.apiKey !== undefined && options.apiKey !== '') {
    const response = await doFetch(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(options.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: options.sourceLanguage,
          target: options.targetLanguage,
          format: 'text',
        }),
      },
    )
    if (!response.ok) throw new Error(`translate ${response.status}`)
    const json = await response.json()
    return json?.data?.translations?.[0]?.translatedText ?? text
  }
  /*
   * The keyless endpoint. MK2 used it as a best-effort default so the feature worked without any
   * configuration; it is rate-limited and unofficial, and that is why `backends()` reports Google
   * as available without credentials while every other backend is not.
   */
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx` +
    `&sl=${encodeURIComponent(options.sourceLanguage)}` +
    `&tl=${encodeURIComponent(options.targetLanguage)}&dt=t&q=${encodeURIComponent(text)}`
  const response = await doFetch(url)
  if (!response.ok) throw new Error(`translate ${response.status}`)
  const json = await response.json()
  if (!Array.isArray(json) || !Array.isArray(json[0])) return text
  return json[0].map(segment => (typeof segment[0] === 'string' ? segment[0] : '')).join('')
}

async function callOpenAiChat(text, options, doFetch, compatible) {
  const name = compatible ? 'OpenAI-compatible' : 'OpenAI'
  if (!options.apiKey) throw new Error(`${name} API key is not configured`)
  if (!options.model) throw new Error(`${name} model is not configured`)
  const endpoint =
    options.endpoint || (compatible ? '' : 'https://api.openai.com/v1/chat/completions')
  if (!endpoint) throw new Error('OpenAI-compatible endpoint is not configured')
  const prompt = fillPrompt(options.prompt?.trim() || DEFAULT_PROMPT, text, options)
  const response = await doFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'You are a professional game localization translator.' },
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error(`translate ${response.status}: ${(await readTextResponse(response)).slice(0, 300)}`)
  }
  const json = await response.json()
  return json?.choices?.[0]?.message?.content ?? text
}

async function callAnthropic(text, options, doFetch) {
  if (!options.apiKey) throw new Error('Anthropic API key is not configured')
  if (!options.model) throw new Error('Anthropic model is not configured')
  const prompt = fillPrompt(options.prompt?.trim() || DEFAULT_PROMPT, text, options)
  const response = await doFetch(options.endpoint || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: 1024,
      temperature: 0.1,
      system: 'You are a professional game localization translator.',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!response.ok) {
    throw new Error(`translate ${response.status}: ${(await readTextResponse(response)).slice(0, 300)}`)
  }
  const json = await response.json()
  return json?.content?.map(part => part.text ?? '').join('') || text
}

async function callGemini(text, options, doFetch) {
  if (!options.apiKey) throw new Error('Gemini API key is not configured')
  if (!options.model) throw new Error('Gemini model is not configured')
  const prompt = fillPrompt(options.prompt?.trim() || DEFAULT_PROMPT, text, options)
  const endpoint =
    options.endpoint ||
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}` +
      `:generateContent?key=${encodeURIComponent(options.apiKey)}`
  const response = await doFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: { temperature: 0.1 },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  })
  if (!response.ok) {
    throw new Error(`translate ${response.status}: ${(await readTextResponse(response)).slice(0, 300)}`)
  }
  const json = await response.json()
  return json?.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('') || text
}

/**
 * Send one string to one backend.
 *
 * The answer from a chat backend goes through `stripResponseWrapper`; a translation endpoint returns
 * the string itself and needs none.
 */
export async function callBackend(backend, text, options) {
  const doFetch = options.fetchImpl ?? fetch
  if (backend === 'google') return callGoogle(text, options, doFetch)
  if (backend === 'openai' || backend === 'codex') {
    return stripResponseWrapper(await callOpenAiChat(text, options, doFetch, false))
  }
  if (backend === 'openai-compatible') {
    return stripResponseWrapper(await callOpenAiChat(text, options, doFetch, true))
  }
  if (backend === 'anthropic') return stripResponseWrapper(await callAnthropic(text, options, doFetch))
  if (backend === 'gemini') return stripResponseWrapper(await callGemini(text, options, doFetch))
  throw new TypeError(`unknown translation backend: ${String(backend)}`)
}

export const BACKENDS = Object.freeze([
  { id: 'google', label: 'Google Translate', requiresCredentials: false },
  { id: 'openai', label: 'OpenAI', requiresCredentials: true },
  { id: 'codex', label: 'Codex', requiresCredentials: true },
  { id: 'openai-compatible', label: 'OpenAI-compatible endpoint', requiresCredentials: true },
  { id: 'anthropic', label: 'Anthropic', requiresCredentials: true },
  { id: 'gemini', label: 'Gemini', requiresCredentials: true },
])
