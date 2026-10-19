import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

const SESSION_MS = 8 * 60 * 60 * 1000
const ATTEMPT_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 5
const ROLES = new Set(['admin', 'staff', 'reader'])
const DUMMY_SALT = randomBytes(32).toString('hex')
const DUMMY_HASH = scryptSync('ficticio-sem-acesso-123', DUMMY_SALT, 64)

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'AuthError'
    this.status = status
    this.code = code
  }
}

const invalid = () => new AuthError(400, 'INVALID_INPUT', 'Confira os campos informados.')
const denied = () => new AuthError(403, 'FORBIDDEN', 'Você não tem permissão para esta operação.')
const credentialsError = () =>
  new AuthError(401, 'INVALID_CREDENTIALS', 'Não foi possível entrar. Confira suas credenciais.')
const conflict = () =>
  new AuthError(409, 'CONFLICT', 'Os dados foram alterados ou já estão em uso. Atualize e tente novamente.')

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function usernameValue(value) {
  if (typeof value !== 'string') throw invalid()
  const username = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) throw invalid()
  return username
}

function nameValue(value) {
  if (typeof value !== 'string') throw invalid()
  const name = value.trim()
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw invalid()
  return name
}

function passwordValue(value) {
  if (
    typeof value !== 'string' ||
    value.length < 12 ||
    value.length > 128 ||
    !/\p{L}/u.test(value) ||
    !/\p{N}/u.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new AuthError(
      400,
      'INVALID_PASSWORD',
      'A senha deve ter de 12 a 128 caracteres, incluindo letras e números.',
    )
  }
  return value
}

function passwordRecord(password) {
  const salt = randomBytes(32).toString('hex')
  return { salt, digest: scryptSync(password, salt, 64).toString('hex') }
}

function matchesPassword(password, row) {
  const candidate =
    typeof password === 'string' && password.length <= 128 ? password : 'credencial-invalida'
  const digest = scryptSync(candidate, row?.password_salt || DUMMY_SALT, 64)
  const expected = row ? Buffer.from(row.password_hash, 'hex') : DUMMY_HASH
  return timingSafeEqual(digest, expected) && Boolean(row)
}

function userDTO(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    active: Boolean(row.active),
    version: row.version,
  }
}

export function createAuth({ db, clock = () => Date.now(), secureCookies = false }) {
  if (!db || typeof clock !== 'function' || typeof secureCookies !== 'boolean') throw invalid()
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'reader')),
      active INTEGER NOT NULL CHECK (active IN (0, 1)),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_users(id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
    CREATE TABLE IF NOT EXISTS auth_login_attempts (
      id TEXT PRIMARY KEY,
      username_hash TEXT NOT NULL,
      fingerprint_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_attempts_username
      ON auth_login_attempts(username_hash, created_at);
    CREATE INDEX IF NOT EXISTS auth_attempts_fingerprint
      ON auth_login_attempts(fingerprint_hash, created_at);
    CREATE TABLE IF NOT EXISTS auth_events (
      id TEXT PRIMARY KEY,
      actor_id TEXT REFERENCES auth_users(id),
      type TEXT NOT NULL,
      entity_id TEXT REFERENCES auth_users(id),
      created_at INTEGER NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS auth_events_no_update
      BEFORE UPDATE ON auth_events BEGIN SELECT RAISE(ABORT, 'Histórico imutável'); END;
    CREATE TRIGGER IF NOT EXISTS auth_events_no_delete
      BEFORE DELETE ON auth_events BEGIN SELECT RAISE(ABORT, 'Histórico imutável'); END;
  `)

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function event(actorId, type, entityId) {
    db.prepare(
      'INSERT INTO auth_events (id, actor_id, type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(randomUUID(), actorId, type, entityId, clock())
  }

  function currentActor(actor, adminOnly = false) {
    const row =
      typeof actor?.id === 'string'
        ? db.prepare('SELECT * FROM auth_users WHERE id = ?').get(actor.id)
        : null
    if (!row?.active) {
      throw new AuthError(401, 'AUTH_REQUIRED', 'Entre novamente para continuar.')
    }
    if (adminOnly && row.role !== 'admin') throw denied()
    return row
  }

  function createUser(body, role, actorId) {
    const username = usernameValue(body?.username)
    const name = nameValue(body?.name)
    const password = passwordRecord(passwordValue(body?.password))
    const id = randomUUID()
    const now = clock()
    try {
      db.prepare(
        `INSERT INTO auth_users
         (id, username, name, role, active, version, password_hash, password_salt, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
      ).run(id, username, name, role, password.digest, password.salt, now, now)
    } catch (error) {
      if (error.errcode === 2067) throw conflict()
      throw error
    }
    event(actorId || id, actorId ? 'USER_CREATED' : 'BOOTSTRAP', id)
    return userDTO(db.prepare('SELECT * FROM auth_users WHERE id = ?').get(id))
  }

  function bootstrap(body) {
    return transaction(() => {
      if (db.prepare('SELECT COUNT(*) AS count FROM auth_users').get().count !== 0) {
        throw new AuthError(409, 'ALREADY_INITIALIZED', 'A conta inicial já foi configurada.')
      }
      return createUser(body, 'admin', null)
    })
  }

  function login(body, fingerprint = 'local') {
    const suppliedUsername =
      typeof body?.username === 'string' ? body.username.trim().toLowerCase().slice(0, 256) : ''
    const usernameHash = hash(suppliedUsername)
    const fingerprintHash = hash(String(fingerprint).slice(0, 1024))
    // A falha precisa ser confirmada na transação antes de retornar erro ao chamador.
    const result = transaction(() => {
      const now = clock()
      db.prepare('DELETE FROM auth_login_attempts WHERE created_at <= ?').run(now - ATTEMPT_MS)
      const attempts = db
        .prepare(
          `SELECT COUNT(*) AS count FROM auth_login_attempts
           WHERE created_at > ? AND (username_hash = ? OR fingerprint_hash = ?)`,
        )
        .get(now - ATTEMPT_MS, usernameHash, fingerprintHash).count
      if (attempts >= MAX_ATTEMPTS) return { limited: true }
      const row = db.prepare('SELECT * FROM auth_users WHERE username = ?').get(suppliedUsername)
      if (!matchesPassword(body?.password, row) || !row.active) {
        db.prepare(
          `INSERT INTO auth_login_attempts
           (id, username_hash, fingerprint_hash, created_at) VALUES (?, ?, ?, ?)`,
        ).run(randomUUID(), usernameHash, fingerprintHash, now)
        event(null, 'LOGIN_FAILED', null)
        return { failed: true }
      }
      const token = randomBytes(32).toString('base64url')
      const expiresAt = now + SESSION_MS
      db.prepare(
        'INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      ).run(hash(token), row.id, now, expiresAt)
      db.prepare(
        'DELETE FROM auth_login_attempts WHERE username_hash = ? AND fingerprint_hash = ?',
      ).run(usernameHash, fingerprintHash)
      event(row.id, 'LOGIN', row.id)
      return { token, user: userDTO(row), expiresAt: new Date(expiresAt).toISOString() }
    })
    if (result.limited) {
      throw new AuthError(
        429,
        'RATE_LIMITED',
        'Não foi possível entrar. Aguarde 15 minutos e tente novamente.',
      )
    }
    if (result.failed) throw credentialsError()
    return result
  }

  function authenticate(token) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 256) return null
    const row = db
      .prepare(
        `SELECT u.* FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      )
      .get(hash(token), clock())
    return row ? userDTO(row) : null
  }

  function logout(token) {
    if (typeof token !== 'string' || token.length > 256) return
    transaction(() => {
      const tokenHash = hash(token)
      const row = db.prepare('SELECT user_id FROM auth_sessions WHERE token_hash = ?').get(tokenHash)
      if (!row) return
      db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash)
      event(row.user_id, 'LOGOUT', row.user_id)
    })
  }

  function listUsers(actor) {
    currentActor(actor, true)
    return db.prepare('SELECT * FROM auth_users ORDER BY name, id').all().map(userDTO)
  }

  function saveUser(actor, body, id) {
    return transaction(() => {
      const administrator = currentActor(actor, true)
      const role = body?.role ?? 'reader'
      if (!ROLES.has(role) || (body?.active !== undefined && typeof body.active !== 'boolean')) {
        throw invalid()
      }
      if (id === undefined) {
        if (body?.active === false) throw invalid()
        return createUser(body, role, administrator.id)
      }
      if (typeof id !== 'string') throw invalid()
      const row = db.prepare('SELECT * FROM auth_users WHERE id = ?').get(id)
      if (!row || !Number.isSafeInteger(body?.version) || row.version !== body.version) throw conflict()
      const username = usernameValue(body.username)
      const name = nameValue(body.name)
      const active = body.active ?? Boolean(row.active)
      if (row.active && row.role === 'admin' && (!active || role !== 'admin')) {
        const admins = db
          .prepare("SELECT COUNT(*) AS count FROM auth_users WHERE active = 1 AND role = 'admin'")
          .get().count
        if (admins <= 1) {
          throw new AuthError(409, 'LAST_ADMIN', 'Mantenha ao menos uma conta administrativa ativa.')
        }
      }
      const password =
        body.password === undefined ? null : passwordRecord(passwordValue(body.password))
      try {
        db.prepare(
          `UPDATE auth_users SET username = ?, name = ?, role = ?, active = ?,
           version = version + 1, password_hash = ?, password_salt = ?, updated_at = ?
           WHERE id = ? AND version = ?`,
        ).run(
          username,
          name,
          role,
          active ? 1 : 0,
          password?.digest ?? row.password_hash,
          password?.salt ?? row.password_salt,
          clock(),
          id,
          body.version,
        )
      } catch (error) {
        if (error.errcode === 2067) throw conflict()
        throw error
      }
      if (password || row.role !== role || !active || row.username !== username) {
        db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id)
      }
      event(administrator.id, 'USER_UPDATED', id)
      return userDTO(db.prepare('SELECT * FROM auth_users WHERE id = ?').get(id))
    })
  }

  function setPassword(actorId, targetId, password, type) {
    const record = passwordRecord(passwordValue(password))
    db.prepare(
      `UPDATE auth_users SET password_hash = ?, password_salt = ?,
       version = version + 1, updated_at = ? WHERE id = ?`,
    ).run(record.digest, record.salt, clock(), targetId)
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(targetId)
    event(actorId, type, targetId)
  }

  function changePassword(actor, body) {
    return transaction(() => {
      const row = currentActor(actor)
      if (!matchesPassword(body?.currentPassword, row)) throw credentialsError()
      if (body.currentPassword === body.newPassword) throw invalid()
      setPassword(row.id, row.id, body?.newPassword, 'PASSWORD_CHANGED')
      return userDTO(db.prepare('SELECT * FROM auth_users WHERE id = ?').get(row.id))
    })
  }

  function resetPassword(actor, userId, body) {
    return transaction(() => {
      const administrator = currentActor(actor, true)
      if (typeof userId !== 'string') throw invalid()
      const target = db.prepare('SELECT * FROM auth_users WHERE id = ?').get(userId)
      if (!target) throw new AuthError(404, 'NOT_FOUND', 'Conta não encontrada.')
      setPassword(administrator.id, userId, body?.password, 'PASSWORD_RESET')
      return userDTO(db.prepare('SELECT * FROM auth_users WHERE id = ?').get(userId))
    })
  }

  function revokeUserSessions(actor, userId) {
    return transaction(() => {
      const administrator = currentActor(actor, true)
      if (typeof userId !== 'string') throw invalid()
      if (!db.prepare('SELECT id FROM auth_users WHERE id = ?').get(userId)) {
        throw new AuthError(404, 'NOT_FOUND', 'Conta não encontrada.')
      }
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId)
      event(administrator.id, 'SESSIONS_REVOKED', userId)
    })
  }

  return {
    bootstrap,
    login,
    authenticate,
    logout,
    listUsers,
    saveUser,
    changePassword,
    resetPassword,
    revokeUserSessions,
  }
}
