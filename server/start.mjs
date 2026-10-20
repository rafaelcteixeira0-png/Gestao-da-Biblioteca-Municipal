import { createServer } from 'node:http'
import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openLibrary } from './library.mjs'
import { createAuth } from './auth.mjs'
import { createApi } from './http.mjs'
import { configuration, prepareDatabasePath } from './config.mjs'

export function startServer(config = configuration()) {
  prepareDatabasePath(config.filename)
  const library = openLibrary({ filename: config.filename })
  const auth = createAuth({
    db: library.db,
    secureCookies: config.secureCookies,
  })
  const api = createApi({
    library,
    auth,
    origin: config.origin,
    secureCookies: config.secureCookies,
  })
  const root = resolve('dist')
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  }
  const server = createServer(
    { maxHeaderSize: 16384 },
    async (incoming, outgoing) => {
      try {
        const url = new URL(incoming.url, config.origin)
        if (url.pathname.startsWith('/api/')) {
          const chunks = []
          let length = 0
          for await (const chunk of incoming) {
            length += chunk.length
            if (length > 65536) {
              outgoing.writeHead(413, {
                'content-type': 'application/json',
                connection: 'close',
              })
              outgoing.end(
                JSON.stringify({
                  error: {
                    code: 'BODY_TOO_LARGE',
                    message: 'Os dados excedem o limite permitido.',
                  },
                }),
              )
              return
            }
            chunks.push(chunk)
          }
          const request = new Request(url, {
            method: incoming.method,
            headers: incoming.headers,
            ...(!['GET', 'HEAD'].includes(incoming.method)
              ? { body: Buffer.concat(chunks) }
              : {}),
          })
          const result = await api(request, {
            remoteAddress: incoming.socket.remoteAddress || 'local',
          })
          outgoing.writeHead(result.status, Object.fromEntries(result.headers))
          outgoing.end(Buffer.from(await result.arrayBuffer()))
          return
        }
        if (!['GET', 'HEAD'].includes(incoming.method)) {
          outgoing.writeHead(405)
          outgoing.end()
          return
        }
        const filename = resolve(
          root,
          `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
        )
        if (!filename.startsWith(root + sep)) {
          outgoing.writeHead(404)
          outgoing.end()
          return
        }
        const actual = await realpath(filename)
        const actualRoot = await realpath(root)
        if (
          !actual.startsWith(actualRoot + sep) ||
          !(await stat(actual)).isFile()
        ) {
          outgoing.writeHead(404)
          outgoing.end()
          return
        }
        outgoing.writeHead(200, {
          'content-type':
            types[extname(filename)] || 'application/octet-stream',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'cache-control': filename.endsWith('.html')
            ? 'no-cache'
            : 'public, max-age=3600',
          'content-security-policy':
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        })
        outgoing.end(
          incoming.method === 'HEAD' ? undefined : await readFile(actual),
        )
      } catch {
        if (!outgoing.headersSent)
          outgoing.writeHead(404, {
            'content-type': 'text/plain; charset=utf-8',
          })
        outgoing.end(
          'Arquivo não encontrado. Compile a interface com npm run build.',
        )
      }
    },
  )
  server.requestTimeout = 15000
  server.headersTimeout = 15000
  server.once('close', () => library.close())
  server.listen(config.port, config.host)
  return { server, library, auth }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const config = configuration()
    const { server } = startServer(config)
    server.once('listening', () =>
      console.log(`Atendimento fictício local: ${config.origin}/#atendimento`),
    )
    server.once('error', () => {
      console.error(
        'Não foi possível abrir a porta local. Confira permissões e configuração.',
      )
      process.exitCode = 1
    })
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.once(signal, () => server.close())
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
