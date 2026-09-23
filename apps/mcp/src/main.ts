#!/usr/bin/env node

import { pathToFileURL } from 'node:url'
import {
  StdioServerTransport,
  serveStdio,
  type StdioServerHandle,
} from '@modelcontextprotocol/server/stdio'
import { ConfigurationError, modkitMcpUsage, parseModkitMcpConfiguration } from './config.js'
import { createHostMcpPort, type ModkitMcpHostPort } from './host-port.js'
import { createModkitMcpServer, type ModkitMcpServerRuntime } from './server.js'

// A language session admits 16 MiB of text; JSON can encode one byte as six (\uXXXX).
// Leave bounded room for the document metadata and JSON-RPC envelope as well.
const MAX_STDIO_MESSAGE_BYTES = 6 * 16_777_216 + 1_048_576

export interface RunningModkitMcp {
  readonly handle: StdioServerHandle
  readonly host: ModkitMcpHostPort
  close(): Promise<void>
}

const errorLine = (code: string, message: string): string =>
  `${JSON.stringify({ code, message: message.slice(0, 1_024) })}\n`

export async function runModkitMcp(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<RunningModkitMcp> {
  const configuration = parseModkitMcpConfiguration(argv, env)
  const host = await createHostMcpPort(configuration, diagnostic => {
    process.stderr.write(errorLine(diagnostic.code, diagnostic.message))
  })
  const runtimes = new Set<ModkitMcpServerRuntime>()
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: MAX_STDIO_MESSAGE_BYTES,
  })
  const handle = serveStdio(
    () => {
      const runtime = createModkitMcpServer(host)
      runtimes.add(runtime)
      return runtime.server
    },
    {
      transport,
      maxSubscriptions: 64,
      onerror: error => {
        process.stderr.write(errorLine('x3.mcp/protocol-error', error.message))
      },
    },
  )
  let closing: Promise<void> | undefined
  return Object.freeze({
    handle,
    host,
    close(): Promise<void> {
      closing ??= (async () => {
        await handle.close()
        await Promise.allSettled([...runtimes].map(runtime => runtime.dispose()))
        runtimes.clear()
        await host.close()
      })()
      return closing
    },
  })
}

async function main(): Promise<void> {
  let running: RunningModkitMcp
  try {
    running = await runModkitMcp(process.argv.slice(2))
  } catch (error) {
    if (error instanceof ConfigurationError) {
      if (error.message !== 'help requested') {
        process.stderr.write(errorLine('x3.mcp/configuration-error', error.message))
      }
      process.stderr.write(modkitMcpUsage())
      process.exitCode = error.message === 'help requested' ? 0 : 2
      return
    }
    process.stderr.write(
      errorLine('x3.mcp/startup-failed', 'The read-only MCP host failed to start.'),
    )
    process.exitCode = 1
    return
  }
  const close = (): void => {
    void running.close().catch(() => {
      process.exitCode = 1
    })
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  process.stdin.once('end', close)
}

const invoked = process.argv[1]
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) await main()
