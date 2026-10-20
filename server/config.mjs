import { dirname, isAbsolute, resolve } from 'node:path'
import { mkdirSync, lstatSync, chmodSync } from 'node:fs'

export function configuration(environment = process.env) {
  const mode = environment.LIBRARY_MODE ?? 'local'
  if (!['local', 'hosted'].includes(mode))
    throw new Error('LIBRARY_MODE deve ser local ou hosted.')
  const hosted = mode === 'hosted'
  const portValue =
    environment.LIBRARY_PORT ?? (hosted ? environment.PORT : undefined) ?? '3001'
  const port = Number(portValue)
  const host = environment.LIBRARY_HOST || '127.0.0.1'
  if (!/^\d+$/u.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Porta inválida; informe um inteiro entre 1 e 65535.')
  const allowedHosts = hosted
    ? ['127.0.0.1', '::1', '0.0.0.0']
    : ['127.0.0.1', '::1']
  if (!allowedHosts.includes(host))
    throw new Error(hosted ? 'Endereço de hospedagem inválido.' : 'Este ambiente deve escutar apenas em loopback.')
  const originValue = environment.LIBRARY_ORIGIN
  if (hosted && !originValue)
    throw new Error('A hospedagem exige LIBRARY_ORIGIN HTTPS explícita.')
  let url
  try {
    url = new URL(originValue || 'http://localhost:' + port)
  } catch {
    throw new Error('Origem inválida; informe uma URL HTTP ou HTTPS válida.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Origem inválida; credenciais na URL não são permitidas.')
  if (hosted && (url.protocol !== 'https:' || !/^https:\/\/[^/?#\\\s@]+\/?$/iu.test(originValue)))
    throw new Error('A origem hospedada deve usar HTTPS sem caminho, consulta ou fragmento.')
  const secureCookies = environment.LIBRARY_COOKIE_SECURE === 'true'
  if (hosted && !secureCookies)
    throw new Error('A hospedagem exige LIBRARY_COOKIE_SECURE=true.')
  const databasePath = environment.LIBRARY_DB_PATH
  if (hosted && (!databasePath || !isAbsolute(databasePath)))
    throw new Error('A hospedagem exige LIBRARY_DB_PATH absoluto e explícito no volume persistente.')
  return {
    filename: resolve(databasePath || '.library-data/library.sqlite'),
    port,
    host,
    origin: url.origin,
    secureCookies,
  }
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
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error('O banco precisa ser um arquivo regular sem link simbólico.')
  chmodSync(filename, 0o600)
}
