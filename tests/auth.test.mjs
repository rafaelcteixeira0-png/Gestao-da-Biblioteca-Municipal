import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuth, AuthError } from '../server/auth.mjs'

const adminBody = {
  username: 'admin.ficticio',
  name: 'Admin Fictício',
  password: 'Senha-ficticia-123',
}
const staffBody = {
  username: 'servidor.ficticio',
  name: 'Servidor Fictício',
  password: 'Outra-senha-12345',
  role: 'staff',
}

function fixture(t, file = ':memory:') {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  let now = Date.UTC(2026, 0, 1)
  const auth = createAuth({ db, clock: () => now })
  t.after(() => db.close())
  return { db, auth, advance: (ms) => (now += ms) }
}

function fails(fn, code, status) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof AuthError)
    assert.equal(error.code, code)
    if (status) assert.equal(error.status, status)
    return true
  })
}

function seed(auth) {
  const admin = auth.bootstrap(adminBody)
  const staff = auth.saveUser(admin, staffBody)
  return { admin, staff }
}

test('bootstrap cria apenas o primeiro administrador sem senha padrão', (t) => {
  const { db, auth } = fixture(t)
  fails(
    () => auth.bootstrap({ ...adminBody, password: undefined }),
    'INVALID_PASSWORD',
  )
  const admin = auth.bootstrap(adminBody)
  assert.equal(admin.role, 'admin')
  assert.equal(admin.version, 1)
  assert.equal(admin.active, true)
  fails(() => auth.bootstrap(adminBody), 'ALREADY_INITIALIZED', 409)
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM auth_users').get().count,
    1,
  )
})

test('login válido emite token aleatório e DTO sem credenciais', (t) => {
  const { db, auth } = fixture(t)
  const admin = auth.bootstrap(adminBody)
  const result = auth.login({
    username: ' ADMIN.FICTICIO ',
    password: adminBody.password,
  })
  assert.deepEqual(result.user, admin)
  assert.deepEqual(auth.authenticate(result.token), admin)
  assert.equal(
    new Date(result.expiresAt).toISOString(),
    '2026-01-01T08:00:00.000Z',
  )
  assert.equal(result.token.length, 43)
  assert.deepEqual(Object.keys(result.user).sort(), [
    'active',
    'id',
    'name',
    'role',
    'username',
    'version',
  ])
  const session = db.prepare('SELECT * FROM auth_sessions').get()
  assert.notEqual(session.token_hash, result.token)
  const user = db.prepare('SELECT * FROM auth_users').get()
  assert.notEqual(user.password_hash, adminBody.password)
  assert.equal(user.password_salt.length, 64)
  assert.ok(!JSON.stringify(result).includes(adminBody.password))
})

test('senha incorreta e usuário desconhecido têm a mesma resposta genérica', (t) => {
  const { auth } = fixture(t)
  auth.bootstrap(adminBody)
  const errors = []
  for (const username of [adminBody.username, 'nao.existe']) {
    try {
      auth.login({ username, password: 'senha-errada' }, username)
    } catch (error) {
      errors.push({
        status: error.status,
        code: error.code,
        message: error.message,
      })
    }
  }
  assert.equal(errors.length, 2)
  assert.deepEqual(errors[0], errors[1])
  assert.equal(errors[0].status, 401)
})

test('cinco falhas limitam tentativas por usuário mesmo com origens diferentes', (t) => {
  const { auth, advance } = fixture(t)
  auth.bootstrap(adminBody)
  for (let i = 0; i < 5; i++) {
    fails(
      () => auth.login({ ...adminBody, password: 'errada' }, `origem-${i}`),
      'INVALID_CREDENTIALS',
    )
  }
  fails(() => auth.login(adminBody, 'outra-origem'), 'RATE_LIMITED', 429)
  advance(15 * 60 * 1000)
  assert.ok(auth.login(adminBody, 'outra-origem').token)
})

test('limite por origem também protege tentativas com diferentes usuários', (t) => {
  const { db, auth } = fixture(t)
  auth.bootstrap(adminBody)
  for (let i = 0; i < 5; i++) {
    fails(
      () => auth.login({ username: `nome-${i}`, password: 'errada' }, 'origem'),
      'INVALID_CREDENTIALS',
    )
  }
  fails(() => auth.login(adminBody, 'origem'), 'RATE_LIMITED')
  assert.ok(auth.login(adminBody, 'origem-limpa').token)
  const attempt = db.prepare('SELECT * FROM auth_login_attempts LIMIT 1').get()
  assert.notEqual(attempt.fingerprint_hash, 'origem')
  assert.ok(!JSON.stringify(attempt).includes('nome-'))
})

test('limite de tentativas persiste após fechar e reabrir o banco', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'biblioteca-auth-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = join(directory, 'test.sqlite')
  const db = new DatabaseSync(file)
  const auth = createAuth({ db })
  auth.bootstrap(adminBody)
  for (let i = 0; i < 5; i++) {
    fails(
      () => auth.login({ ...adminBody, password: 'errada' }, 'origem'),
      'INVALID_CREDENTIALS',
    )
  }
  db.close()
  const reopened = new DatabaseSync(file)
  try {
    const nextAuth = createAuth({ db: reopened })
    fails(() => nextAuth.login(adminBody, 'nova-origem'), 'RATE_LIMITED')
  } finally {
    reopened.close()
  }
})

test('sessão expira em oito horas e token inválido é rejeitado', (t) => {
  const { auth, advance } = fixture(t)
  auth.bootstrap(adminBody)
  const result = auth.login(adminBody)
  advance(8 * 60 * 60 * 1000 - 1)
  assert.ok(auth.authenticate(result.token))
  advance(1)
  assert.equal(auth.authenticate(result.token), null)
  assert.equal(auth.authenticate(undefined), null)
  assert.equal(auth.authenticate('inventado'), null)
  assert.equal(auth.authenticate('x'.repeat(43)), null)
})

test('logout revoga apenas a sessão indicada e é idempotente', (t) => {
  const { db, auth } = fixture(t)
  auth.bootstrap(adminBody)
  const one = auth.login(adminBody)
  const two = auth.login(adminBody)
  auth.logout(one.token)
  auth.logout(one.token)
  auth.logout(undefined)
  assert.equal(auth.authenticate(one.token), null)
  assert.ok(auth.authenticate(two.token))
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM auth_events WHERE type = 'LOGOUT'",
      )
      .get().count,
    1,
  )
})

test('admin cria e lista contas; staff e leitor não recebem acesso administrativo', (t) => {
  const { auth } = fixture(t)
  const { admin, staff } = seed(auth)
  const reader = auth.saveUser(admin, {
    ...staffBody,
    username: 'leitor.ficticio',
    role: 'reader',
  })
  assert.equal(auth.listUsers(admin).length, 3)
  for (const actor of [staff, reader, { ...staff, role: 'admin' }]) {
    fails(() => auth.listUsers(actor), 'FORBIDDEN', 403)
    fails(() => auth.saveUser(actor, staffBody), 'FORBIDDEN')
    fails(
      () =>
        auth.resetPassword(actor, admin.id, { password: staffBody.password }),
      'FORBIDDEN',
    )
    fails(() => auth.revokeUserSessions(actor, admin.id), 'FORBIDDEN')
  }
  fails(
    () => auth.listUsers({ id: 'inexistente', role: 'admin' }),
    'AUTH_REQUIRED',
    401,
  )
})

test('alteração exige versão atual e preserva conta quando há conflito', (t) => {
  const { auth } = fixture(t)
  const { admin, staff } = seed(auth)
  const updated = auth.saveUser(
    admin,
    { ...staff, name: 'Nome Atualizado' },
    staff.id,
  )
  assert.equal(updated.version, 2)
  fails(
    () => auth.saveUser(admin, { ...staff, name: 'Nome Antigo' }, staff.id),
    'CONFLICT',
    409,
  )
  fails(
    () => auth.saveUser(admin, { ...updated, version: undefined }, staff.id),
    'CONFLICT',
  )
  assert.equal(
    auth.listUsers(admin).find((user) => user.id === staff.id).name,
    'Nome Atualizado',
  )
})

test('último administrador ativo não pode ser desativado ou rebaixado', (t) => {
  const { auth } = fixture(t)
  const admin = auth.bootstrap(adminBody)
  fails(
    () => auth.saveUser(admin, { ...admin, active: false }, admin.id),
    'LAST_ADMIN',
  )
  fails(
    () => auth.saveUser(admin, { ...admin, role: 'staff' }, admin.id),
    'LAST_ADMIN',
  )
  const second = auth.saveUser(admin, { ...staffBody, role: 'admin' })
  auth.saveUser(admin, { ...admin, role: 'staff' }, admin.id)
  fails(() => auth.listUsers({ ...admin, role: 'admin' }), 'FORBIDDEN')
  assert.equal(
    auth.listUsers(second).filter((user) => user.role === 'admin').length,
    1,
  )
})

test('desativação e troca de papel revogam sessões e permissões antigas', (t) => {
  const { auth } = fixture(t)
  const { admin, staff } = seed(auth)
  const session = auth.login(staffBody)
  const reader = auth.saveUser(admin, { ...staff, role: 'reader' }, staff.id)
  assert.equal(auth.authenticate(session.token), null)
  const nextSession = auth.login(staffBody)
  auth.saveUser(admin, { ...reader, active: false }, reader.id)
  assert.equal(auth.authenticate(nextSession.token), null)
  fails(() => auth.login(staffBody), 'INVALID_CREDENTIALS')
  fails(
    () =>
      auth.changePassword(reader, {
        currentPassword: staffBody.password,
        newPassword: 'Senha-nova-12345',
      }),
    'AUTH_REQUIRED',
  )
})

test('troca de senha exige senha atual, revoga todas as sessões e gera histórico', (t) => {
  const { db, auth } = fixture(t)
  const { staff } = seed(auth)
  const one = auth.login(staffBody)
  const two = auth.login(staffBody)
  fails(
    () =>
      auth.changePassword(staff, {
        currentPassword: 'errada',
        newPassword: 'Senha-nova-12345',
      }),
    'INVALID_CREDENTIALS',
  )
  assert.ok(auth.authenticate(one.token))
  const updated = auth.changePassword(staff, {
    currentPassword: staffBody.password,
    newPassword: 'Senha-nova-12345',
  })
  assert.equal(updated.version, 2)
  assert.equal(auth.authenticate(one.token), null)
  assert.equal(auth.authenticate(two.token), null)
  fails(() => auth.login(staffBody), 'INVALID_CREDENTIALS')
  assert.ok(auth.login({ ...staffBody, password: 'Senha-nova-12345' }).token)
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM auth_events WHERE type = 'PASSWORD_CHANGED'",
      )
      .get().count,
    1,
  )
})

test('recuperação administrativa troca senha, registra autor e revoga sessões', (t) => {
  const { db, auth } = fixture(t)
  const { admin, staff } = seed(auth)
  const session = auth.login(staffBody)
  const updated = auth.resetPassword(admin, staff.id, {
    password: 'Recuperacao-12345',
  })
  assert.equal(updated.version, 2)
  assert.equal(auth.authenticate(session.token), null)
  fails(() => auth.login(staffBody), 'INVALID_CREDENTIALS')
  assert.ok(auth.login({ ...staffBody, password: 'Recuperacao-12345' }).token)
  const event = db
    .prepare("SELECT * FROM auth_events WHERE type = 'PASSWORD_RESET'")
    .get()
  assert.equal(event.actor_id, admin.id)
  assert.equal(event.entity_id, staff.id)
  assert.ok(!JSON.stringify(event).includes('Recuperacao-12345'))
})

test('revogação administrativa invalida todas as sessões de uma conta', (t) => {
  const { auth } = fixture(t)
  const { admin, staff } = seed(auth)
  const adminSession = auth.login(adminBody)
  const one = auth.login(staffBody)
  const two = auth.login(staffBody)
  auth.revokeUserSessions(admin, staff.id)
  assert.equal(auth.authenticate(one.token), null)
  assert.equal(auth.authenticate(two.token), null)
  assert.ok(auth.authenticate(adminSession.token))
})

test('valida senhas, identidade, papel e duplicidade sem gravar conta inválida', (t) => {
  const { auth } = fixture(t)
  const admin = auth.bootstrap(adminBody)
  for (const password of [
    'curta1',
    'somenteletras',
    '12345678901234',
    'a1'.repeat(65),
    null,
  ]) {
    fails(
      () => auth.saveUser(admin, { ...staffBody, password }),
      'INVALID_PASSWORD',
    )
  }
  for (const body of [
    { ...staffBody, username: 'x' },
    { ...staffBody, name: '' },
    { ...staffBody, role: 'superuser' },
    { ...staffBody, active: 'true' },
  ]) {
    fails(() => auth.saveUser(admin, body), 'INVALID_INPUT')
  }
  auth.saveUser(admin, staffBody)
  fails(
    () =>
      auth.saveUser(admin, {
        ...staffBody,
        username: staffBody.username.toUpperCase(),
      }),
    'CONFLICT',
  )
  assert.equal(auth.listUsers(admin).length, 2)
})

test('senha alterada pela edição administrativa também revoga sessões', (t) => {
  const { auth } = fixture(t)
  const { admin, staff } = seed(auth)
  const session = auth.login(staffBody)
  auth.saveUser(admin, { ...staff, password: 'Nova-edicao-12345' }, staff.id)
  assert.equal(auth.authenticate(session.token), null)
  assert.ok(auth.login({ ...staffBody, password: 'Nova-edicao-12345' }).token)
})

test('histórico de autenticação é imutável e não armazena credenciais', (t) => {
  const { db, auth } = fixture(t)
  const { admin, staff } = seed(auth)
  auth.login(adminBody)
  fails(
    () => auth.login({ ...staffBody, password: 'Segredo-incorreto-123' }),
    'INVALID_CREDENTIALS',
  )
  auth.revokeUserSessions(admin, staff.id)
  assert.throws(
    () => db.prepare("UPDATE auth_events SET type = 'EDITADO'").run(),
    /Histórico imutável/,
  )
  assert.throws(
    () => db.prepare('DELETE FROM auth_events').run(),
    /Histórico imutável/,
  )
  const history = JSON.stringify(db.prepare('SELECT * FROM auth_events').all())
  assert.ok(!history.includes(adminBody.password))
  assert.ok(!history.includes('Segredo-incorreto-123'))
  assert.ok(!history.includes(adminBody.username))
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
})
