import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { promisify } from 'node:util'
import { createAuth } from './auth.mjs'
import { openLibrary } from './library.mjs'

const deriveKey = promisify(scrypt)
const MAGIC = Buffer.from('CIANORTE-BACKUP\n')
const MAX_BACKUP_BYTES = 256 * 1024 * 1024
const MAX_HEADER_BYTES = 4096
const FORMAT_VERSION = 1
const SCHEMA_VERSION = '1'
const DATASET_KIND = 'fictional-local'
const TABLES = [
  'settings',
  'readers',
  'works',
  'copies',
  'loans',
  'loan_items',
  'events',
  'requests',
  'auth_users',
  'auth_sessions',
  'auth_login_attempts',
  'auth_events',
]
let expectedSchema

export class BackupError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'BackupError'
    this.code = code
  }
}

function fail(code, message) {
  throw new BackupError(code, message)
}

function validatePassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 16 || passphrase.length > 1024) {
    fail('INVALID_PASSPHRASE', 'Use uma senha de backup entre 16 e 1.024 caracteres.')
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`
}

function stableRow(row) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))),
    (_, value) => typeof value === 'bigint' ? value.toString() : value,
  )
}

function tableState(db, table) {
  const primaryKey = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().filter(column => column.pk > 0).sort((left, right) => left.pk - right.pk).map(column => quoteIdentifier(column.name))
  const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${primaryKey.join(', ')}`).iterate()
  const digest = createHash('sha256')
  let count = 0
  for (const row of rows) {
    const encoded = stableRow(row)
    digest.update(`${Buffer.byteLength(encoded)}:${encoded}\n`)
    count++
  }
  return { count, sha256: digest.digest('hex') }
}

function verifySchema(db) {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*'").all().map(row => row.name).sort()
  const expected = [...TABLES].sort()
  if (JSON.stringify(tables) !== JSON.stringify(expected)) {
    fail('INVALID_SCHEMA', 'O arquivo não contém exatamente as tabelas da biblioteca nesta versão.')
  }
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value]))
  if (String(settings.schema_version) !== SCHEMA_VERSION || settings.dataset_kind !== DATASET_KIND) {
    fail('UNSUPPORTED_SCHEMA', 'Versão ou origem dos dados incompatível; somente dados fictícios locais são aceitos.')
  }
  const schemaRows = connection => connection.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name").all().map(row => stableRow({ ...row, sql: row.sql?.replace(/\s+/g, ' ').trim() ?? null }))
  if (!expectedSchema) {
    const reference = openLibrary({ filename: ':memory:' })
    try {
      createAuth({ db: reference.db })
      expectedSchema = schemaRows(reference.db)
    } finally {
      reference.close()
    }
  }
  if (JSON.stringify(schemaRows(db)) !== JSON.stringify(expectedSchema)) {
    fail('INVALID_SCHEMA', 'A estrutura, as restrições ou as proteções do histórico diferem desta versão da aplicação.')
  }
  const indexes = db.prepare("PRAGMA index_list('loan_items')").all()
  const exclusiveCopyIndex = indexes.some(index => {
    if (index.unique !== 1 || index.partial !== 1) return false
    const columns = db.prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`).all()
    const sql = db.prepare('SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?').get('index', index.name)?.sql || ''
    return columns.length === 1 && columns[0].name === 'copy_id' && /\bwhere\s+returned_at\s+is\s+null\s*$/i.test(sql)
  })
  if (!exclusiveCopyIndex) {
    fail('INVALID_SCHEMA', 'Falta a proteção transacional contra empréstimos simultâneos do mesmo exemplar.')
  }
  return settings
}

function inspectDatabase(path) {
  let db
  try {
    // Writable connection + query_only is deliberate: Node 24 readOnly connections
    // can omit CHECK failures from integrity_check for an untrusted snapshot.
    db = new DatabaseSync(path)
    db.exec('PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON; PRAGMA ignore_check_constraints = OFF; PRAGMA query_only = ON')
    const integrity = db.prepare('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') {
      fail('INVALID_DATABASE', 'A verificação de integridade do banco de dados falhou.')
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length !== 0) {
      fail('INVALID_DATABASE', 'O banco contém relacionamentos inválidos.')
    }
    const settings = verifySchema(db)
    const tables = Object.fromEntries(TABLES.map(table => [table, tableState(db, table)]))
    return { schemaVersion: Number(settings.schema_version), datasetKind: settings.dataset_kind, tables }
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('INVALID_DATABASE', 'Não foi possível validar a estrutura do banco de dados.', { cause: error })
  } finally {
    db?.close()
  }
}

async function temporaryDirectory(operation) {
  const path = await mkdtemp(join(tmpdir(), 'biblioteca-backup-'))
  try {
    await chmod(path, 0o700)
    return await operation(path)
  } finally {
    await rm(path, { recursive: true, force: true })
  }
}

async function ensureAbsent(path) {
  if (typeof path !== 'string' || path.trim() === '') {
    fail('INVALID_PATH', 'Informe um caminho de arquivo válido.')
  }
  try {
    await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return resolve(path)
    throw new BackupError('INVALID_PATH', 'Não foi possível verificar o caminho informado.', { cause: error })
  }
  fail('FILE_EXISTS', 'O destino já existe. Escolha outro arquivo; nenhum arquivo foi sobrescrito.')
}

async function writeExclusive(destination, bytes, code, message) {
  let handle
  try {
    handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    await handle.chmod(0o600)
    await handle.writeFile(bytes)
    await handle.sync()
  } catch (error) {
    if (error.code === 'EEXIST') fail('FILE_EXISTS', 'O destino já existe. Nenhum arquivo foi sobrescrito.')
    if (handle) await rm(destination, { force: true })
    throw new BackupError(code, message, { cause: error })
  } finally {
    await handle?.close()
  }
}

async function readArchive(path) {
  if (typeof path !== 'string' || path.trim() === '') fail('INVALID_PATH', 'Informe o arquivo de backup.')
  let handle
  try {
    const initialStat = await lstat(path)
    if (!initialStat.isFile() || initialStat.isSymbolicLink() || initialStat.size === 0 || initialStat.size > MAX_BACKUP_BYTES) {
      fail('INVALID_BACKUP', 'O backup deve ser um arquivo regular, sem link simbólico e com até 256 MiB.')
    }
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BACKUP_BYTES || stat.ino !== initialStat.ino || stat.dev !== initialStat.dev) {
      fail('INVALID_BACKUP', 'O backup deve ser um arquivo regular com até 256 MiB.')
    }
    const data = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const finalStat = await handle.stat()
    if (offset !== stat.size || finalStat.size !== stat.size || finalStat.mtimeMs !== stat.mtimeMs || finalStat.ctimeMs !== stat.ctimeMs) {
      fail('INVALID_BACKUP', 'O arquivo de backup mudou durante a leitura ou excede o limite.')
    }
    return data
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('INVALID_BACKUP', 'Não foi possível ler um arquivo de backup regular; links simbólicos não são aceitos.', { cause: error })
  } finally {
    await handle?.close()
  }
}

function prepareEnvelope(snapshot, createdAt) {
  const salt = randomBytes(32)
  const iv = randomBytes(12)
  const header = Buffer.from(JSON.stringify({ version: FORMAT_VERSION, algorithm: 'aes-256-gcm', kdf: 'scrypt', salt: salt.toString('hex'), iv: iv.toString('hex'), createdAt, snapshotSha256: sha256(snapshot) }))
  const headerLength = Buffer.alloc(4)
  headerLength.writeUInt32BE(header.length)
  return { salt, iv, header, prefix: Buffer.concat([MAGIC, headerLength, header]) }
}

async function decryptArchive(archive, passphrase) {
  const prefixBytes = MAGIC.length + 4
  if (archive.length < prefixBytes + 16 || !archive.subarray(0, MAGIC.length).equals(MAGIC)) {
    fail('INVALID_BACKUP', 'Formato de backup inválido.')
  }
  const headerLength = archive.readUInt32BE(MAGIC.length)
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES || archive.length <= prefixBytes + headerLength + 16) {
    fail('INVALID_BACKUP', 'Cabeçalho de backup inválido.')
  }
  let header
  try {
    header = JSON.parse(archive.subarray(prefixBytes, prefixBytes + headerLength).toString('utf8'))
  } catch {
    fail('INVALID_BACKUP', 'Cabeçalho de backup inválido.')
  }
  if (!header || typeof header !== 'object' || Array.isArray(header) || header.version !== FORMAT_VERSION || header.algorithm !== 'aes-256-gcm' || header.kdf !== 'scrypt' || !/^[a-f\d]{64}$/.test(header.salt) || !/^[a-f\d]{24}$/.test(header.iv) || !/^[a-f\d]{64}$/.test(header.snapshotSha256) || typeof header.createdAt !== 'string' || !Number.isFinite(Date.parse(header.createdAt))) {
    fail('INVALID_BACKUP', 'Versão ou parâmetros de criptografia inválidos.')
  }
  const prefix = archive.subarray(0, prefixBytes + headerLength)
  const key = await deriveKey(passphrase, Buffer.from(header.salt, 'hex'), 32)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'hex'))
    decipher.setAAD(prefix)
    decipher.setAuthTag(archive.subarray(-16))
    const snapshot = Buffer.concat([decipher.update(archive.subarray(prefix.length, -16)), decipher.final()])
    if (sha256(snapshot) !== header.snapshotSha256) fail('INVALID_BACKUP', 'O conteúdo do backup não corresponde à assinatura registrada.')
    return { snapshot, header }
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('DECRYPTION_FAILED', 'Senha incorreta ou backup adulterado; nenhum dado foi restaurado.', { cause: error })
  } finally {
    key.fill(0)
  }
}

function result(manifest, metadata, started) {
  return {
    schemaVersion: manifest.schemaVersion,
    datasetKind: manifest.datasetKind,
    createdAt: metadata.createdAt,
    sha256: metadata.sha256,
    counts: Object.fromEntries(Object.entries(manifest.tables).map(([table, state]) => [table, state.count])),
    tableDigests: Object.fromEntries(Object.entries(manifest.tables).map(([table, state]) => [table, state.sha256])),
    durationMs: Math.round(performance.now() - started),
    coverage: { records: 'all-database-tables', configuration: 'database-only', externalConfigurationIncluded: false },
    verification: { integrity: 'ok', foreignKeys: 'ok', schema: 'ok', records: 'ok' },
  }
}

export async function createBackup({ db, outputPath, passphrase }) {
  const started = performance.now()
  validatePassphrase(passphrase)
  const destination = await ensureAbsent(outputPath)
  return temporaryDirectory(async directory => {
    const snapshotPath = join(directory, 'snapshot.sqlite')
    try {
      await backup(db, snapshotPath)
      await chmod(snapshotPath, 0o600)
    } catch (error) {
      throw new BackupError('SNAPSHOT_FAILED', 'Não foi possível criar uma cópia consistente do banco.', { cause: error })
    }
    if ((await lstat(snapshotPath)).size > MAX_BACKUP_BYTES - MAX_HEADER_BYTES - 64) fail('BACKUP_TOO_LARGE', 'O banco excede o limite de 256 MiB por backup.')
    const manifest = inspectDatabase(snapshotPath)
    const snapshot = await readFile(snapshotPath)
    const createdAt = new Date().toISOString()
    const envelope = prepareEnvelope(snapshot, createdAt)
    const key = await deriveKey(passphrase, envelope.salt, 32)
    let archive
    try {
      const cipher = createCipheriv('aes-256-gcm', key, envelope.iv)
      cipher.setAAD(envelope.prefix)
      archive = Buffer.concat([envelope.prefix, cipher.update(snapshot), cipher.final(), cipher.getAuthTag()])
    } finally {
      key.fill(0)
      snapshot.fill(0)
    }
    await writeExclusive(destination, archive, 'BACKUP_WRITE_FAILED', 'Não foi possível gravar o backup.')
    return result(manifest, { createdAt, sha256: sha256(archive) }, started)
  })
}

export async function validateBackup({ backupPath, passphrase }) {
  const started = performance.now()
  validatePassphrase(passphrase)
  const archive = await readArchive(backupPath)
  const { snapshot, header } = await decryptArchive(archive, passphrase)
  try {
    return await temporaryDirectory(async directory => {
      const snapshotPath = join(directory, 'snapshot.sqlite')
      await writeFile(snapshotPath, snapshot, { flag: 'wx', mode: 0o600 })
      return result(inspectDatabase(snapshotPath), { createdAt: header.createdAt, sha256: sha256(archive) }, started)
    })
  } finally {
    snapshot.fill(0)
  }
}

export async function restoreBackup({ backupPath, passphrase, targetPath }) {
  const started = performance.now()
  validatePassphrase(passphrase)
  const destination = await ensureAbsent(targetPath)
  const archive = await readArchive(backupPath)
  const { snapshot, header } = await decryptArchive(archive, passphrase)
  try {
    return await temporaryDirectory(async directory => {
      const snapshotPath = join(directory, 'restored.sqlite')
      await writeFile(snapshotPath, snapshot, { flag: 'wx', mode: 0o600 })
      const before = inspectDatabase(snapshotPath)
      const db = new DatabaseSync(snapshotPath)
      try {
        db.exec('PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON; BEGIN IMMEDIATE; DELETE FROM auth_sessions; COMMIT; PRAGMA wal_checkpoint(TRUNCATE)')
      } finally {
        db.close()
      }
      const after = inspectDatabase(snapshotPath)
      for (const table of TABLES) {
        if (table === 'auth_sessions') continue
        if (before.tables[table].count !== after.tables[table].count || before.tables[table].sha256 !== after.tables[table].sha256) {
          fail('RESTORE_MISMATCH', 'A restauração alterou registros; o destino não foi criado.')
        }
      }
      if (after.tables.auth_sessions.count !== 0) fail('RESTORE_MISMATCH', 'Não foi possível revogar as sessões restauradas.')
      const restored = await readFile(snapshotPath)
      try {
        await writeExclusive(destination, restored, 'RESTORE_WRITE_FAILED', 'Não foi possível gravar o banco restaurado.')
        return {
          ...result(after, { createdAt: header.createdAt, sha256: sha256(restored) }, started),
          backupSha256: sha256(archive),
          verification: { integrity: 'ok', foreignKeys: 'ok', schema: 'ok', records: 'ok', sessionsRevoked: before.tables.auth_sessions.count },
        }
      } finally {
        restored.fill(0)
      }
    })
  } finally {
    snapshot.fill(0)
  }
}
