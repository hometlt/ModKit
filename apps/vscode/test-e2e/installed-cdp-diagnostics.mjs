/** Bounded failure evidence only; never retains target URLs or evaluated source. */
/** Shared acceptance traversal: first answer by default; bounded per-document evidence on failure. */
export const webviewDocumentExpression = (body, all = false) => `(() => {
  const candidates = [{ doc: document, win: globalThis, depth: 0 }];
  for (const frame of document.querySelectorAll('iframe')) {
    try {
      if (frame.contentDocument && frame.contentWindow) {
        candidates.push({ doc: frame.contentDocument, win: frame.contentWindow, depth: 1 });
      }
    } catch (error) { void error; }
  }
  const observations = [];
  for (const candidate of ${all ? 'candidates.slice(0, 8)' : 'candidates'}) {
    try {
      const value = (${body})(candidate.doc, candidate.win);
      if (value !== undefined && value !== null) {
        if (!${all}) return value;
        observations.push({ depth: candidate.depth, document: candidate.depth === 0 ? 'top' : 'iframe', value });
      }
    } catch (error) { void error; }
  }
  return ${all ? 'observations' : 'undefined'};
})()`

export function redactDiagnosticText(value) {
  return String(value ?? '')
    .replace(/(?:https?|vscode-webview):\/\/[^\s<>"']+/giu, '<url>')
    .replace(/\bBearer\s+[^\s]+/giu, 'Bearer <redacted>')
    .replace(
      /\b(token|password|secret|authorization|api[-_]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      '$1=<redacted>',
    )
    .slice(0, 2000)
}

export function probeFailureTarget(target, Socket = WebSocket) {
  return new Promise(resolve => {
    const contexts = []
    let socket
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        /* disappearing target */
      }
      resolve({ contexts, ...result })
    }
    const timer = setTimeout(() => finish({ status: 'timeout' }), 2000)
    try {
      socket = new Socket(target.webSocketDebuggerUrl)
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
        socket.send(
          JSON.stringify({
            id: 2,
            method: 'Runtime.evaluate',
            params: {
              expression: webviewDocumentExpression(
                `(doc, win) => ({ text: (doc.body?.innerText ?? '').slice(0, 2000), receiptPresent: !!win.__MODKIT_ACCEPTANCE__ })`,
                true,
              ),
              returnByValue: true,
            },
          }),
        )
      })
      socket.addEventListener('message', event => {
        try {
          const message = JSON.parse(String(event.data))
          if (message.method === 'Runtime.executionContextCreated' && contexts.length < 16) {
            const context = message.params?.context
            contexts.push({ id: context?.id, isDefault: context?.auxData?.isDefault === true })
          }
          if (message.id !== 2) return
          if (message.error) finish({ status: 'protocol-error', code: message.error.code })
          else if (message.result?.exceptionDetails)
            finish({
              status: 'exception',
              exception: redactDiagnosticText(message.result.exceptionDetails.text),
            })
          else {
            const value = message.result?.result?.value
            finish(
              value === undefined
                ? { status: 'empty' }
                : {
                    status: 'observed',
                    documents: Array.isArray(value)
                      ? value.slice(0, 8).map(item => ({
                          document: item.depth === 0 ? 'top' : 'iframe',
                          depth: item.depth === 0 ? 0 : 1,
                          text: redactDiagnosticText(item.value?.text),
                          receiptPresent: item.value?.receiptPresent === true,
                        }))
                      : [],
                  },
            )
          }
        } catch {
          finish({ status: 'invalid-response' })
        }
      })
      socket.addEventListener('error', () => finish({ status: 'socket-error' }))
      socket.addEventListener('close', () => finish({ status: 'socket-closed' }))
    } catch {
      finish({ status: 'socket-error' })
    }
  })
}

export async function collectFailureDiagnostics(port, fetcher = fetch, probe = probeFailureTarget) {
  try {
    const response = await fetcher(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) return { status: 'target-list-http-error', code: response.status }
    const targets = await response.json()
    if (!Array.isArray(targets)) return { status: 'invalid-target-list' }
    const selected = targets
      .filter(
        target =>
          typeof target?.url === 'string' &&
          target.url.includes('vscode-webview') &&
          typeof target.webSocketDebuggerUrl === 'string',
      )
      .slice(0, 4)
    return {
      status: selected.length === 0 ? 'no-webview-targets' : 'observed',
      targetCount: targets.length,
      targets: await Promise.all(
        selected.map(async (target, ordinal) => ({ ordinal, ...(await probe(target)) })),
      ),
    }
  } catch {
    return { status: 'target-list-unavailable' }
  }
}
