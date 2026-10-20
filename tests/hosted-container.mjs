// Mutates only an isolated Docker fixture with fictional data. Never use on production.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = process.env.LIBRARY_TEST_CONTAINER || 'biblioteca-ci'
const base = process.env.LIBRARY_TEST_URL || 'http://127.0.0.1:4301'
const origin = 'https://biblioteca.example'
assert.match(container, /^biblioteca-ci(?:-[a-z0-9-]+)?$/)
assert.equal(base, 'http://127.0.0.1:4301')
const password = 'Ficticia-CI-9a-' + randomUUID()
const passphrase = 'Backup ficticio CI 9a ' + randomUUID()
let sessionCookie = ''
let sessionCsrf = ''

function docker(args, environment = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}
function execute(args, environment = {}) {
  const flags = Object.keys(environment).flatMap((name) => ['-e', name])
  return docker(['exec', ...flags, container, ...args], environment)
}
function cli(args, environment = {}) {
  return JSON.parse(execute(['node', 'server/cli.mjs', ...args], environment))
}
async function ready() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const result = await fetch(base + '/api/health', {
        signal: AbortSignal.timeout(2000),
      })
      if (result.ok) {
        const json = await result.json()
        assert.equal(json.data.status, 'ok')
        assert.equal(json.data.datasetKind, 'fictional-local')
        return
      }
    } catch {
      // A restart may briefly close the socket. Retry only within the deadline.
    }
    await delay(250)
  }
  throw new Error('O container ficticio nao ficou pronto em 30 segundos.')
}
async function api(path, options = {}) {
  const {
    method = 'GET', body, expected = 200, requestOrigin = origin,
    cookie = sessionCookie, token = sessionCsrf,
  } = options
  const headers = { Accept: 'application/json' }
  if (cookie) headers.Cookie = cookie
  if (method !== 'GET') headers.Origin = requestOrigin
  if (token) headers['X-CSRF-Token'] = token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(base + '/api' + path, {
    method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(response.status, expected, method + ' ' + path)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const result = await response.json()
  if (expected >= 400) return result.error
  assert.equal(result.error, undefined)
  return result.data
}
async function login(username) {
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie') || ''
  assert.match(cookie, /; HttpOnly/)
  assert.match(cookie, /; SameSite=Strict/)
  assert.match(cookie, /; Secure(?:;|$)/)
  assert.match(cookie, /; Path=\/api/)
  const result = await response.json()
  return { ...result.data, cookie: cookie.split(';')[0] }
}
function futureDate(days) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const inspected = JSON.parse(docker(['inspect', container]))[0]
assert.equal(inspected.Config.User, 'node')
assert.equal(inspected.HostConfig.ReadonlyRootfs, true)
for (const variable of [
  'LIBRARY_MODE=hosted', 'LIBRARY_DB_PATH=/data/library.sqlite',
  'LIBRARY_COOKIE_SECURE=true', 'LIBRARY_ORIGIN=' + origin,
]) {
  assert.ok(inspected.Config.Env.includes(variable), variable)
}
for (const destination of ['/data', '/backups']) {
  const mount = inspected.Mounts.find((item) => item.Destination === destination)
  assert.equal(mount?.Type, 'volume')
  assert.match(mount.Name, /^biblioteca-ci[-_]/)
}
await ready()
execute(['node', 'server/cli.mjs', 'init'], {
  LIBRARY_ADMIN_USERNAME: 'ci-admin',
  LIBRARY_ADMIN_NAME: 'Administracao Ficticia CI',
  LIBRARY_ADMIN_PASSWORD: password,
})
assert.equal((await api('/readers', { expected: 401, cookie: '' })).code, 'AUTH_REQUIRED')
assert.equal((await api('/auth/login', {
  method: 'POST', expected: 403, requestOrigin: 'https://negada.example',
  body: { username: 'ci-admin', password },
})).code, 'ORIGIN_DENIED')
const session = await login('ci-admin')
sessionCookie = session.cookie
sessionCsrf = session.csrfToken
assert.equal(session.user.role, 'admin')
assert.equal((await api('/readers', {
  method: 'POST', expected: 403, token: '', body: { name: 'Negado Ficticio' },
})).code, 'CSRF_DENIED')
await api('/users', {
  method: 'POST',
  body: { username: 'ci-leitor', name: 'Conta Ficticia CI', password, role: 'reader' },
})
const readerSession = await login('ci-leitor')
assert.equal((await api('/readers', {
  expected: 403, cookie: readerSession.cookie, token: readerSession.csrfToken,
})).code, 'ACCESS_DENIED')
assert.equal((await api('/readers', {
  method: 'POST', expected: 400, body: { name: 'A' },
})).code, 'INVALID_FIELD')
const reader = await api('/readers', {
  method: 'POST', body: { name: 'Leitora Ficticia CI' },
})
const editedReader = await api('/readers/' + reader.id, {
  method: 'PATCH', body: { name: 'Leitora Ficticia CI Atualizada', version: reader.version },
})
assert.equal(editedReader.version, reader.version + 1)
assert.equal((await api('/readers/' + reader.id, {
  method: 'PATCH', expected: 409, body: { name: 'Edicao Desatualizada', version: reader.version },
})).code, 'VERSION_CONFLICT')
const work = await api('/works', {
  method: 'POST', body: { title: 'Obra Ficticia CI', author: 'Autora Ficticia' },
})
await api('/works/' + work.id, {
  method: 'PATCH', body: { edition: '2 ficticia', version: work.version },
})
const copies = []
for (let index = 0; index < 2; index += 1) {
  copies.push(await api('/copies', {
    method: 'POST', body: { workId: work.id, shelf: 'Estante ficticia', accessionNumber: null },
  }))
}
assert.notEqual(copies[0].id, copies[1].id)
await api('/copies/' + copies[0].id, {
  method: 'PATCH', body: { condition: 'Revisado ficticio', version: copies[0].version },
})
const checkout = {
  requestId: randomUUID(), readerId: reader.id,
  copyIds: copies.map((copy) => copy.id), dueAt: futureDate(14),
}
const loan = await api('/loans', { method: 'POST', body: checkout })
assert.equal(loan.items.length, 2)
assert.equal((await api('/loans', { method: 'POST', body: checkout })).id, loan.id)
assert.equal((await api('/loans', {
  method: 'POST', expected: 409, body: { ...checkout, requestId: randomUUID() },
})).code, 'COPY_UNAVAILABLE')
const returned = await api('/loans/' + loan.id + '/return', {
  method: 'POST', body: { requestId: randomUUID(), copyIds: [copies[0].id] },
})
assert.equal(returned.status, 'partial')
assert.ok(returned.items.find((item) => item.copyId === copies[0].id).returnedAt)
const renewalDate = futureDate(28)
const renewed = await api('/loans/' + loan.id + '/items/' + copies[1].id + '/renew', {
  method: 'POST',
  body: { requestId: randomUUID(), dueAt: renewalDate, reason: 'Renovacao ficticia de CI' },
})
assert.equal(renewed.items.find((item) => item.copyId === copies[1].id).renewalCount, 1)
const history = await api('/history')
for (const type of ['reader.created', 'reader.updated', 'work.updated', 'copy.updated',
  'loan.created', 'loan.items_returned', 'loan.item_renewed']) {
  assert.ok(history.some((event) => event.type === type), type)
}
assert.equal(history.filter((event) => event.type === 'loan.created').length, 1)
docker(['restart', '--time', '5', container])
await ready()
assert.equal((await api('/auth/session')).user.id, session.user.id)
assert.deepEqual(await api('/history'), history)
assert.deepEqual((await api('/loans')).find((item) => item.id === loan.id), renewed)
assert.equal((await api('/readers')).find((item) => item.id === reader.id).name, editedReader.name)
const backupEnvironment = { LIBRARY_BACKUP_PASSPHRASE: passphrase }
const created = cli(['backup', '/backups/fixture.backup'], backupEnvironment)
const verified = cli(['verify-backup', '/backups/fixture.backup'], backupEnvironment)
assert.deepEqual(verified.tableDigests, created.tableDigests)
const restored = cli(['restore', '/backups/fixture.backup', '/backups/restored.sqlite'], backupEnvironment)
assert.equal(restored.counts.auth_sessions, 0)
for (const table of Object.keys(created.counts)) {
  if (table === 'auth_sessions') continue
  assert.equal(restored.counts[table], created.counts[table], table)
  assert.equal(restored.tableDigests[table], created.tableDigests[table], table)
}
const snapshotScript = [
  "import { DatabaseSync } from 'node:sqlite'",
  "import { readFileSync, statSync } from 'node:fs'",
  "const db = new DatabaseSync('/backups/restored.sqlite', { readOnly: true })",
  "const mode = path => statSync(path).mode & 0o777",
  'console.log(JSON.stringify({',
  'uid: process.getuid(),',
  "dataMode: mode('/data'), backupsMode: mode('/backups'),",
  "databaseMode: mode('/data/library.sqlite'),",
  "backupMode: mode('/backups/fixture.backup'),",
  "restoredMode: mode('/backups/restored.sqlite'),",
  "plaintext: readFileSync('/backups/fixture.backup').includes(Buffer.from('Leitora Ficticia CI')),",
  "items: db.prepare('SELECT copy_id AS copyId, due_at AS dueAt, returned_at AS returnedAt, renewal_count AS renewalCount FROM loan_items ORDER BY copy_id').all()",
  '}))',
  'db.close()',
].join('\n')
const snapshot = JSON.parse(execute(['node', '--input-type=module', '-e', snapshotScript]))
assert.notEqual(snapshot.uid, 0)
for (const key of ['dataMode', 'backupsMode']) assert.equal(snapshot[key], 0o700)
for (const key of ['databaseMode', 'backupMode', 'restoredMode']) assert.equal(snapshot[key], 0o600)
assert.equal(snapshot.plaintext, false)
assert.deepEqual(snapshot.items, renewed.items.map((item) => ({
  copyId: item.copyId, dueAt: item.dueAt,
  returnedAt: item.returnedAt, renewalCount: item.renewalCount,
})).sort((left, right) => left.copyId.localeCompare(right.copyId)))
assert.deepEqual(await api('/history'), history)
assert.equal((await api('/auth/session')).user.id, session.user.id)
console.log('Integracao ficticia: container, permissoes, API, circulacao, reinicio e recuperacao aprovados.')
