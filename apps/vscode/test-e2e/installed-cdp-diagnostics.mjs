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

/** Read-only canvas inspection: no resizing, drawing, or context fallback that changes rendering. */
export function imageDiagnosticDocument(doc, win) {
  const selects = Array.from(doc.querySelectorAll('select'))
    .slice(0, 8)
    .map(select => ({
      selected: String(select.selectedOptions?.[0]?.textContent ?? '').slice(0, 120),
      options: Array.from(select.options)
        .slice(0, 32)
        .map(option => String(option.textContent ?? '').slice(0, 120)),
    }))
  const canvases = Array.from(doc.querySelectorAll('canvas'))
    .slice(0, 8)
    .map(canvas => {
      const result = {
        part: canvas.getAttribute('data-mk-part'),
        width: canvas.width,
        height: canvas.height,
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        context: 'unavailable',
      }
      try {
        const context = canvas.getContext('2d')
        if (context) {
          result.context = '2d'
          if (canvas.width > 0 && canvas.height > 0) {
            result.sampleBytes = context.getImageData(0, 0, 1, 1).data.byteLength
          }
        }
      } catch (error) {
        result.readError = String(error?.message ?? error).slice(0, 2000)
      }
      return result
    })
  return {
    text: (doc.body?.innerText ?? '').slice(0, 2000),
    receiptPresent: !!win.__MODKIT_ACCEPTANCE__,
    selects,
    canvases,
  }
}

/** Frozen Fit never enlarges: sample the fixture's 16 centered texels, not the viewport backing store. */
export function displayedDdsRaster(doc, win) {
  const canvas = doc.querySelector('[data-mk-part="image.canvas"]')
  const stage = doc.querySelector('[data-mk-part="image"]')
  if (!(canvas instanceof win.HTMLCanvasElement) || !stage) return undefined
  if (
    !Array.from(doc.querySelectorAll('dd')).some(item =>
      /^4\s*×\s*4$/u.test(item.textContent?.trim() ?? ''),
    )
  )
    return undefined
  const box = stage.getBoundingClientRect()
  const width = Math.max(1, Math.round(box.width)),
    height = Math.max(1, Math.round(box.height))
  const ratio = win.devicePixelRatio || 1
  if (
    width < 16 ||
    height < 16 ||
    canvas.width !== Math.round(width * ratio) ||
    canvas.height !== Math.round(height * ratio)
  )
    return undefined
  const context = canvas.getContext('2d')
  if (!context) return undefined
  const x = Math.round((width - 4) / 2),
    y = Math.round((height - 4) / 2)
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 4; column++) {
      const pixel = context.getImageData(
        Math.floor((x + column + 0.5) * ratio),
        Math.floor((y + row + 0.5) * ratio),
        1,
        1,
      ).data
      if (pixel[0] !== 255 || pixel[1] !== 0 || pixel[2] !== 0 || pixel[3] !== 255) return undefined
    }
  const outside = context.getImageData(0, 0, 1, 1).data
  if (outside[0] === 255 && outside[1] === 0 && outside[2] === 0 && outside[3] === 255)
    return undefined
  return {
    width: 4,
    height: 4,
    pixelBytes: 64,
    opaquePixels: 16,
    evidence: 'centered-1csspx-texels-exact-red',
    viewportWidth: canvas.width,
    viewportHeight: canvas.height,
    devicePixelRatio: ratio,
  }
}

/** Native custom editors expose Metadata as visible sidebar facts, not select options. */
export function readDdsMetadata(doc, win) {
  if (win?.__MODKIT_ACCEPTANCE__?.subject?.descriptor?.identity?.formatId !== 'dds')
    return undefined
  const sidebar = doc.querySelector('[data-mk-part="media-shell.sidebar"]')
  if (!sidebar) return undefined
  if (sidebar.hidden)
    doc.querySelector('[data-mk-part="media-shell.toggle"][data-side="right"]')?.click()
  const sections = ['image', 'format', 'metadata'].map(id =>
    doc.querySelector(`[data-mk-part="media-shell.section"][data-section-id="${id}"]`),
  )
  if (sections.some(section => !section)) return undefined
  for (const section of sections) {
    const header = section.querySelector('[data-mk-part="media-shell.section-header"]')
    if (header?.getAttribute('aria-expanded') === 'false') header.click()
    const body = section.querySelector('[data-mk-part="media-shell.section-body"]')
    if (body?.hidden !== false) return undefined
    body.scrollIntoView({ block: 'nearest' })
    const box = body.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return undefined
  }
  if (sidebar.hidden) return undefined
  const rows = sections.map(section =>
    Array.from(section.querySelectorAll('[data-mk-part="metadata.row"]'))
      .slice(0, 32)
      .map(row => ({
        label: (row.querySelector('dt')?.textContent ?? '').trim().slice(0, 120),
        value: (row.querySelector('dd')?.textContent ?? '').trim().slice(0, 512),
      })),
  )
  if (
    !rows[0].some(row => /^4\s*×\s*4$/u.test(row.value)) ||
    !rows[1].some(row => /^(?:DDS|DirectDraw Surface)(?:\s*·\s*DXT1)?$/iu.test(row.value)) ||
    rows[1].filter(row => row.label && row.value).length < 3 ||
    !rows[2].some(row => row.label === 'width' && row.value === '4') ||
    !rows[2].some(row => row.label === 'height' && row.value === '4')
  )
    return undefined
  return {
    surface: 'image-sidebar-metadata',
    presentation: 'sidebar-sections',
    image: rows[0],
    format: rows[1],
    headerMetadata: rows[2],
  }
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
              expression: webviewDocumentExpression(imageDiagnosticDocument.toString(), true),
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
                          selects: (item.value?.selects ?? []).slice(0, 8).map(select => ({
                            selected: redactDiagnosticText(select.selected),
                            options: select.options.slice(0, 32).map(redactDiagnosticText),
                          })),
                          canvases: (item.value?.canvases ?? []).slice(0, 8).map(canvas => ({
                            part: redactDiagnosticText(canvas.part),
                            width: canvas.width,
                            height: canvas.height,
                            cssWidth: canvas.cssWidth,
                            cssHeight: canvas.cssHeight,
                            context: canvas.context,
                            sampleBytes: canvas.sampleBytes,
                            ...(canvas.readError === undefined
                              ? {}
                              : { readError: redactDiagnosticText(canvas.readError) }),
                          })),
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
