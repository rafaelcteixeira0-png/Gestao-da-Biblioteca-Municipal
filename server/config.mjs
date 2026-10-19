import { dirname, resolve } from 'node:path'
import { mkdirSync, lstatSync, chmodSync } from 'node:fs'

export function configuration() {
  const port = Number(process.env.LIBRARY_PORT || 3001)
  const host = process.env.LIBRARY_HOST || '127.0.0.1'
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta local inválida.')
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('Este ambiente deve escutar apenas em loopback.')
  const url = new URL(process.env.LIBRARY_ORIGIN || `http://localhost:${port}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Origem local inválida.')
  return { filename: resolve(process.env.LIBRARY_DB_PATH || '.library-data/library.sqlite'), port, host, origin: url.origin, secureCookies: process.env.LIBRARY_COOKIE_SECURE === 'true' }
}
export function prepareDatabasePath(filename) {
  process.umask(0o077)
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  let info
  try {
    info = lstatSync(filename)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('O banco precisa ser um arquivo regular sem link simbólico.')
  chmodSync(filename, 0o600)
}
