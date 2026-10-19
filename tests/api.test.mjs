import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { openLibrary } from '../server/library.mjs'
import { createAuth } from '../server/auth.mjs'
import { createApi } from '../server/http.mjs'

const origin = 'http://localhost:3001'
const password = 'SenhaSomenteFicticia123!'
function fixture(t) {
  const library = openLibrary({ filename: ':memory:', clock: () => '2026-10-18T15:00:00.000Z' })
  const auth = createAuth({ db: library.db })
  const admin = auth.bootstrap({ username: 'admin-ficticio', name: 'Administração Fictícia', password })
  const api = createApi({ library, auth, origin })
  t.after(() => library.close())
  async function call(method, path, payload, session, extraHeaders = {}) {
    const headers = { ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...extraHeaders }
    const result = await api(new Request(`${origin}/api${path}`, { method, headers, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) }))
    return { status: result.status, headers: result.headers, ...(await result.json()) }
  }
  async function login(username = admin.username) {
    const result = await call('POST', '/auth/login', { username, password })
    assert.equal(result.status, 200)
    return { ...result.data, cookie: result.headers.get('set-cookie').split(';')[0] }
  }
  return { library, auth, admin, api, call, login }
}

test('API anônima não recebe cadastros, histórico, contas ou circulação', async (t) => {
  const { call } = fixture(t)
  for (const path of ['/readers', '/works', '/copies', '/loans', '/history', '/summary', '/users']) {
    const result = await call('GET', path)
    assert.equal(result.status, 401)
    assert.equal(result.data, undefined)
  }
  assert.equal((await call('POST', '/readers', { name: 'Pessoa Fictícia' })).status, 401)
  assert.equal((await call('GET', '/health')).data.datasetKind, 'fictional-local')
})

test('sessão é HttpOnly/SameSite; comandos exigem origem correta e CSRF', async (t) => {
  const { call } = fixture(t)
  const result = await call('POST', '/auth/login', { username: 'admin-ficticio', password })
  assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.equal(result.data.token, undefined)
  const session = { ...result.data, cookie: result.headers.get('set-cookie').split(';')[0] }
  assert.equal((await call('POST', '/readers', { name: 'Pessoa Fictícia' }, session, { Origin: 'http://origem-invalida.example' })).status, 403)
  assert.equal((await call('POST', '/readers', { name: 'Pessoa Fictícia' }, session, { 'X-CSRF-Token': '' })).status, 403)
  assert.equal((await call('POST', '/auth/login', { username: 'admin-ficticio', password }, undefined, { Origin: '' })).status, 403)
  assert.equal((await call('POST', '/readers', { name: 'Pessoa Fictícia' }, session)).status, 200)
})

test('papéis são autorizados no servidor e adulterar IDs não concede acesso', async (t) => {
  const { auth, admin, call, login } = fixture(t)
  auth.saveUser(admin, { username: 'equipe-ficticia', name: 'Equipe Fictícia', role: 'staff', active: true, password })
  auth.saveUser(admin, { username: 'leitor-ficticio', name: 'Leitor Fictício', role: 'reader', active: true, password })
  const staff = await login('equipe-ficticia')
  const reader = await login('leitor-ficticio')
  assert.equal((await call('POST', '/readers', { name: 'Pessoa Fictícia' }, staff)).status, 200)
  assert.equal((await call('GET', '/users', undefined, staff)).status, 403)
  assert.equal((await call('POST', '/users', { role: 'admin' }, staff)).status, 403)
  for (const path of ['/readers', `/readers/${randomUUID()}`, '/loans', '/history', '/summary', '/users']) assert.equal((await call('GET', path, undefined, reader)).status, 403)
  assert.equal((await call('POST', '/readers', { name: 'Pessoa Fictícia', role: 'admin' }, reader)).status, 403)
  assert.equal((await call('GET', '/auth/session', undefined, reader)).data.user.role, 'reader')
})

test('cadastros validam dados, versão, referências e tombo sem deduplicar títulos', async (t) => {
  const { call, login } = fixture(t)
  const session = await login()
  const reader = (await call('POST', '/readers', { name: 'Pessoa Fictícia' }, session)).data
  assert.equal((await call('PATCH', `/readers/${reader.id}`, { name: 'Pessoa Fictícia Revisada', active: true, version: 1 }, session)).data.version, 2)
  assert.equal((await call('PATCH', `/readers/${reader.id}`, { name: 'Outra Edição', active: true, version: 1 }, session)).status, 409)
  assert.equal((await call('POST', '/works', { title: ' ' }, session)).status, 400)
  const work = (await call('POST', '/works', { title: 'Obra Fictícia', edition: '1ª' }, session)).data
  const another = (await call('POST', '/works', { title: 'Obra Fictícia', edition: '2ª' }, session)).data
  assert.notEqual(work.id, another.id)
  const copy = (await call('POST', '/copies', { workId: work.id, accessionNumber: 'FICTICIO-001', shelf: 'Estante de teste' }, session)).data
  assert.equal(copy.status, 'available')
  assert.equal((await call('POST', '/copies', { workId: work.id, accessionNumber: ' ficticio-001 ' }, session)).status, 409)
  assert.equal((await call('POST', '/copies', { workId: randomUUID() }, session)).status, 404)
  assert.equal((await call('DELETE', `/readers/${reader.id}`, undefined, session)).status, 404)
})

test('circulação persistida confirma todos os itens, idempotência, retorno parcial e renovação individual', async (t) => {
  const { call, login, library } = fixture(t)
  const session = await login()
  const reader = (await call('POST', '/readers', { name: 'Pessoa Fictícia' }, session)).data
  const work = (await call('POST', '/works', { title: 'Obra Fictícia' }, session)).data
  const copies = []
  for (let index = 0; index < 3; index++) copies.push((await call('POST', '/copies', { workId: work.id }, session)).data)
  const payload = { readerId: reader.id, copyIds: copies.map((copy) => copy.id), dueAt: '2026-10-30', requestId: randomUUID() }
  const created = await call('POST', '/loans', payload, session)
  assert.equal(created.status, 200)
  assert.equal(created.data.items.length, 3)
  assert.equal((await call('POST', '/loans', payload, session)).data.id, created.data.id)
  assert.equal((await call('POST', '/loans', { ...payload, requestId: randomUUID() }, session)).status, 409)
  const returned = await call('POST', `/loans/${created.data.id}/return`, { copyIds: [copies[0].id], requestId: randomUUID() }, session)
  assert.equal(returned.data.status, 'partial')
  const renewed = await call('POST', `/loans/${created.data.id}/items/${copies[1].id}/renew`, { dueAt: '2026-11-05', reason: 'Continuidade de leitura fictícia', requestId: randomUUID() }, session)
  assert.equal(renewed.data.items.find((item) => item.copyId === copies[1].id).dueAt, '2026-11-05')
  assert.equal(renewed.data.items.find((item) => item.copyId === copies[2].id).dueAt, '2026-10-30')
  assert.equal((await call('POST', `/loans/${created.data.id}/items/${copies[0].id}/renew`, { dueAt: '2026-11-06', reason: 'Exemplo fictício', requestId: randomUUID() }, session)).status, 409)
  const history = (await call('GET', '/history', undefined, session)).data
  assert.equal(history.filter((event) => event.type.startsWith('loan.')).length, 3)
  assert.ok(history.every((event) => event.actorId === session.user.id))
  assert.equal(library.listLoans().length, 1)
})

test('revogação e logout invalidam sessões anteriores', async (t) => {
  const { auth, admin, call, login } = fixture(t)
  const user = auth.saveUser(admin, { username: 'equipe-ficticia', name: 'Equipe Fictícia', role: 'staff', active: true, password })
  const session = await login(user.username)
  auth.revokeUserSessions(admin, user.id)
  assert.equal((await call('GET', '/readers', undefined, session)).status, 401)
  const administrator = await login()
  const revoked = await call('POST', `/users/${user.id}/revoke`, {}, administrator)
  assert.equal(revoked.status, 200)
  assert.equal(revoked.data.revoked, true)
  assert.equal((await call('POST', '/auth/logout', undefined, administrator)).status, 200)
  assert.equal((await call('GET', '/auth/session', undefined, administrator)).status, 401)
})

test('tipo, tamanho e JSON inválidos são rejeitados sem gravação', async (t) => {
  const { api, call, login } = fixture(t)
  const session = await login()
  const headers = { Origin: origin, Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }
  assert.equal((await api(new Request(`${origin}/api/readers`, { method: 'POST', headers, body: '{' }))).status, 400)
  assert.equal((await api(new Request(`${origin}/api/readers`, { method: 'POST', headers, body: JSON.stringify({ name: 'a'.repeat(70000) }) }))).status, 413)
  assert.equal((await call('POST', '/readers', { name: 'Pessoa Fictícia' }, session, { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await call('GET', '/readers', undefined, session)).data.length, 0)
})
