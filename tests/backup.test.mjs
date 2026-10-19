import assert from 'node:assert/strict'
import { createDecipheriv, createHash, createCipheriv, scryptSync } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createAuth } from '../server/auth.mjs'
import { createBackup, restoreBackup, validateBackup } from '../server/backup.mjs'
import { openLibrary } from '../server/library.mjs'

const PASSPHRASE = 'Senha de backup fictícia 2026!'
const PASSWORD = 'Senha-ficticia-123'
const MAGIC_BYTES = Buffer.byteLength('CIANORTE-BACKUP\n')
const digest = value => createHash('sha256').update(value).digest('hex')

async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'biblioteca-backup-test-'))
  const sourcePath = join(directory, 'source.sqlite')
  const library = openLibrary({ filename: sourcePath, clock: () => '2026-10-18T12:00:00.000Z' })
  context.after(async () => {
    library.close()
    await rm(directory, { recursive: true, force: true })
  })
  const auth = createAuth({ db: library.db })
  const admin = auth.bootstrap({ username: 'admin.ficticio', name: 'Admin Fictício', password: PASSWORD })
  const login = auth.login({ username: admin.username, password: PASSWORD })
  const reader = library.saveReader(admin.id, { name: 'Leitor Fictício' })
  const work = library.saveWork(admin.id, { title: 'Aventura Fictícia', author: 'Autora Fictícia' })
  const copies = [
    library.saveCopy(admin.id, { workId: work.id, accessionNumber: null }),
    library.saveCopy(admin.id, { workId: work.id, accessionNumber: 'FICTICIO-02' }),
  ]
  const loan = library.checkout(admin.id, { readerId: reader.id, copyIds: copies.map(copy => copy.id), dueAt: '2099-12-01', requestId: 'backup-checkout' })
  library.returnItems(admin.id, loan.id, { copyIds: [copies[0].id], requestId: 'backup-partial-return' })
  library.renewItem(admin.id, loan.id, copies[1].id, { dueAt: '2099-12-10', reason: 'Renovação fictícia para teste', requestId: 'backup-renew' })
  return { directory, sourcePath, library, auth, admin, login, reader, work, copies, loan, backupPath: join(directory, 'backup.bcb') }
}

async function archive(f) {
  return createBackup({ db: f.library.db, outputPath: f.backupPath, passphrase: PASSPHRASE })
}

async function rewriteEncryptedDatabase(f, mutate) {
  const original = await readFile(f.backupPath)
  const headerBytes = original.readUInt32BE(MAGIC_BYTES)
  const prefixLength = MAGIC_BYTES + 4 + headerBytes
  const header = JSON.parse(original.subarray(MAGIC_BYTES + 4, prefixLength).toString())
  const key = scryptSync(PASSPHRASE, Buffer.from(header.salt, 'hex'), 32)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'hex'))
  decipher.setAAD(original.subarray(0, prefixLength))
  decipher.setAuthTag(original.subarray(-16))
  const bytes = Buffer.concat([decipher.update(original.subarray(prefixLength, -16)), decipher.final()])
  const editedPath = join(f.directory, 'edited.sqlite')
  await writeFile(editedPath, bytes)
  const db = new DatabaseSync(editedPath)
  try {
    mutate(db)
  } finally {
    db.close()
  }
  const edited = await readFile(editedPath)
  header.snapshotSha256 = digest(edited)
  const prefix = Buffer.concat([original.subarray(0, MAGIC_BYTES + 4), Buffer.from(JSON.stringify(header))])
  const cipher = createCipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'hex'))
  cipher.setAAD(prefix)
  const result = Buffer.concat([prefix, cipher.update(edited), cipher.final(), cipher.getAuthTag()])
  await writeFile(f.backupPath, result)
  key.fill(0)
}

test('backup criptografado inclui snapshot WAL, totais e verificação sem expor registros ou credenciais', async context => {
  const f = await fixture(context)
  const report = await archive(f)
  const bytes = await readFile(f.backupPath)
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.datasetKind, 'fictional-local')
  assert.equal(report.counts.readers, 1)
  assert.equal(report.counts.copies, 2)
  assert.equal(report.counts.loan_items, 2)
  assert.equal(report.counts.requests, 3)
  assert.equal(report.counts.auth_sessions, 1)
  assert.equal(report.sha256, digest(bytes))
  assert.equal(report.verification.integrity, 'ok')
  assert.equal(report.coverage.configuration, 'database-only')
  for (const sensitive of ['Leitor Fictício', f.admin.username, PASSWORD, PASSPHRASE, f.login.token, 'SQLite format 3']) {
    assert.equal(bytes.includes(Buffer.from(sensitive)), false)
    assert.equal(JSON.stringify(report).includes(sensitive), false)
  }
  assert.equal((await stat(f.backupPath)).mode & 0o777, 0o600)
  const validated = await validateBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE })
  assert.deepEqual(validated.counts, report.counts)
  assert.deepEqual(validated.tableDigests, report.tableDigests)
  assert.equal(validated.sha256, report.sha256)
})

test('restauração separada preserva cadastros, circulação parcial, renovação, auditoria, papéis e exige novo login', async context => {
  const f = await fixture(context)
  f.auth.saveUser(f.admin, { username: 'atendente.ficticio', name: 'Atendente Fictício', password: PASSWORD, role: 'staff' })
  f.auth.saveUser(f.admin, { username: 'leitor.ficticio', name: 'Conta Fictícia', password: PASSWORD, role: 'reader' })
  const beforeLoans = f.library.listLoans()
  const beforeHistory = f.library.getHistory()
  const report = await archive(f)
  const targetPath = join(f.directory, 'restored.sqlite')
  const restored = await restoreBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE, targetPath })
  assert.equal(restored.verification.sessionsRevoked, 1)
  assert.equal(restored.counts.auth_sessions, 0)
  for (const table of Object.keys(report.counts).filter(name => name !== 'auth_sessions')) {
    assert.equal(restored.counts[table], report.counts[table], table)
    assert.equal(restored.tableDigests[table], report.tableDigests[table], table)
  }
  assert.equal((await stat(targetPath)).mode & 0o777, 0o600)
  const other = openLibrary({ filename: targetPath })
  try {
    const restoredAuth = createAuth({ db: other.db })
    assert.deepEqual(other.listLoans(), beforeLoans)
    assert.equal(other.listLoans()[0].status, 'partial')
    assert.equal(other.listLoans()[0].items[1].renewalCount, 1)
    assert.deepEqual(other.getHistory(), beforeHistory)
    assert.equal(restoredAuth.authenticate(f.login.token), null)
    const login = restoredAuth.login({ username: f.admin.username, password: PASSWORD })
    assert.equal(restoredAuth.authenticate(login.token).id, f.admin.id)
    assert.deepEqual(restoredAuth.listUsers(login.user).map(user => user.role).sort(), ['admin', 'reader', 'staff'])
    assert.throws(() => other.db.exec("UPDATE events SET type='alterado'"), /imutável/)
    assert.throws(() => other.db.exec('DELETE FROM auth_events'), /imutável/)
  } finally {
    other.close()
  }
  assert.deepEqual(f.library.listLoans(), beforeLoans)
  assert.deepEqual(f.library.getHistory(), beforeHistory)
  assert.equal(f.auth.authenticate(f.login.token).id, f.admin.id)
  assert.deepEqual(await readdir(f.directory).then(files => files.filter(file => file.startsWith('snapshot'))), [])
})

test('criptografia gera arquivos diferentes para o mesmo banco sem reutilizar salt ou IV', async context => {
  const f = await fixture(context)
  await archive(f)
  const secondPath = join(f.directory, 'second.bcb')
  await createBackup({ db: f.library.db, outputPath: secondPath, passphrase: PASSPHRASE })
  assert.notDeepEqual(await readFile(f.backupPath), await readFile(secondPath))
})

test('senha errada e conteúdo adulterado não criam banco restaurado', async context => {
  const f = await fixture(context)
  await archive(f)
  const targetPath = join(f.directory, 'restored.sqlite')
  await assert.rejects(restoreBackup({ backupPath: f.backupPath, passphrase: 'Senha incorreta fictícia', targetPath }), { code: 'DECRYPTION_FAILED' })
  const bytes = await readFile(f.backupPath)
  bytes[bytes.length - 17] ^= 1
  await writeFile(f.backupPath, bytes)
  await assert.rejects(validateBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE }), { code: 'DECRYPTION_FAILED' })
  await assert.rejects(stat(targetPath), { code: 'ENOENT' })
})

test('metadados do cabeçalho são autenticados junto com o conteúdo', async context => {
  const f = await fixture(context)
  await archive(f)
  const bytes = await readFile(f.backupPath)
  const headerLength = bytes.readUInt32BE(MAGIC_BYTES)
  const start = MAGIC_BYTES + 4
  const header = JSON.parse(bytes.subarray(start, start + headerLength).toString())
  header.createdAt = `3${header.createdAt.slice(1)}`
  Buffer.from(JSON.stringify(header)).copy(bytes, start)
  await writeFile(f.backupPath, bytes)
  await assert.rejects(validateBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE }), { code: 'DECRYPTION_FAILED' })
})

test('senha curta é recusada antes de criar qualquer arquivo', async context => {
  const f = await fixture(context)
  await assert.rejects(createBackup({ db: f.library.db, outputPath: f.backupPath, passphrase: 'curta' }), { code: 'INVALID_PASSPHRASE' })
  await assert.rejects(stat(f.backupPath), { code: 'ENOENT' })
})

test('backup e restauração recusam arquivos existentes e preservam a origem', async context => {
  const f = await fixture(context)
  await archive(f)
  const original = await readFile(f.backupPath)
  await assert.rejects(archive(f), { code: 'FILE_EXISTS' })
  assert.deepEqual(await readFile(f.backupPath), original)
  const targetPath = join(f.directory, 'existing.sqlite')
  await writeFile(targetPath, 'arquivo a preservar')
  await assert.rejects(restoreBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE, targetPath }), { code: 'FILE_EXISTS' })
  assert.equal(await readFile(targetPath, 'utf8'), 'arquivo a preservar')
  await assert.rejects(restoreBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE, targetPath: f.sourcePath }), { code: 'FILE_EXISTS' })
  assert.equal(f.library.listReaders()[0].name, 'Leitor Fictício')
})

test('criação e recuperação não alteram arquivos de dados da origem', async context => {
  const f = await fixture(context)
  const beforeDatabase = await readFile(f.sourcePath)
  const beforeWal = await readFile(`${f.sourcePath}-wal`)
  await archive(f)
  await restoreBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE, targetPath: join(f.directory, 'restored.sqlite') })
  assert.deepEqual(await readFile(f.sourcePath), beforeDatabase)
  assert.deepEqual(await readFile(`${f.sourcePath}-wal`), beforeWal)
})

test('links simbólicos de entrada e destino são recusados', async context => {
  const f = await fixture(context)
  await archive(f)
  const link = join(f.directory, 'link.bcb')
  await symlink(f.backupPath, link)
  await assert.rejects(validateBackup({ backupPath: link, passphrase: PASSPHRASE }), { code: 'INVALID_BACKUP' })
  await assert.rejects(createBackup({ db: f.library.db, outputPath: link, passphrase: PASSPHRASE }), { code: 'FILE_EXISTS' })
  const targetPath = join(f.directory, 'target-link.sqlite')
  await symlink(join(f.directory, 'inexistent.sqlite'), targetPath)
  await assert.rejects(restoreBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE, targetPath }), { code: 'FILE_EXISTS' })
  await assert.rejects(stat(join(f.directory, 'inexistent.sqlite')), { code: 'ENOENT' })
})

test('arquivo maior que 256 MiB, diretório e cabeçalho inválido são recusados sem leitura desmedida', async context => {
  const f = await fixture(context)
  await writeFile(f.backupPath, '')
  await truncate(f.backupPath, 256 * 1024 * 1024 + 1)
  await assert.rejects(validateBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE }), { code: 'INVALID_BACKUP' })
  await assert.rejects(validateBackup({ backupPath: f.directory, passphrase: PASSPHRASE }), { code: 'INVALID_BACKUP' })
  await writeFile(f.backupPath, 'arquivo que não é um backup')
  await assert.rejects(validateBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE }), { code: 'INVALID_BACKUP' })
})

test('cabeçalho JSON nulo retorna erro controlado em português', async context => {
  const f = await fixture(context)
  const header = Buffer.from('null')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(header.length)
  await writeFile(f.backupPath, Buffer.concat([Buffer.from('CIANORTE-BACKUP\n'), length, header, Buffer.alloc(32)]))
  await assert.rejects(validateBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE }), { code: 'INVALID_BACKUP', message: 'Versão ou parâmetros de criptografia inválidos.' })
})

test('backup recusa proteção de exclusividade ausente', async context => {
  const f = await fixture(context)
  f.library.db.exec('DROP INDEX one_active_loan_per_copy')
  await assert.rejects(archive(f), { code: 'INVALID_SCHEMA' })
  await assert.rejects(stat(f.backupPath), { code: 'ENOENT' })
})

test('índice com condição incorreta não substitui a proteção contra empréstimos simultâneos', async context => {
  const f = await fixture(context)
  f.library.db.exec('DROP INDEX one_active_loan_per_copy; CREATE UNIQUE INDEX one_active_loan_per_copy ON loan_items(copy_id) WHERE returned_at IS NOT NULL')
  await assert.rejects(archive(f), { code: 'INVALID_SCHEMA' })
})

test('backup recusa relacionamento inválido mesmo que inserido com foreign_keys desligado', async context => {
  const f = await fixture(context)
  f.library.db.exec('PRAGMA foreign_keys = OFF')
  f.library.db.prepare('UPDATE copies SET work_id = ?').run('obra-inexistente')
  await assert.rejects(archive(f), { code: 'INVALID_DATABASE' })
})

test('backup recusa violação de CHECK inserida com validação desativada', async context => {
  const f = await fixture(context)
  f.library.db.exec('PRAGMA ignore_check_constraints = ON; UPDATE readers SET active = 7')
  await assert.rejects(archive(f), { code: 'INVALID_DATABASE' })
})

test('backup recusa papéis inválidos no banco de autenticação', async context => {
  const f = await fixture(context)
  f.library.db.exec("PRAGMA ignore_check_constraints = ON; UPDATE auth_users SET role = 'superpoder'")
  await assert.rejects(archive(f), { code: 'INVALID_DATABASE' })
})

for (const [key, value] of [['schema_version', '999'], ['dataset_kind', 'production']]) {
  test(`backup recusa ${key} incompatível com a entrega fictícia`, async context => {
    const f = await fixture(context)
    f.library.db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key)
    await assert.rejects(archive(f), { code: 'UNSUPPORTED_SCHEMA' })
  })
}

test('backup recusa tabela extra não coberta pelo contrato de recuperação', async context => {
  const f = await fixture(context)
  f.library.db.exec('CREATE TABLE tabela_desconhecida (id TEXT PRIMARY KEY)')
  await assert.rejects(archive(f), { code: 'INVALID_SCHEMA' })
})

test('validação e restauração recusam schema adulterado mesmo com criptografia válida', async context => {
  const f = await fixture(context)
  await archive(f)
  await rewriteEncryptedDatabase(f, db => db.exec('DROP TRIGGER events_no_update'))
  await assert.rejects(validateBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE }), { code: 'INVALID_SCHEMA' })
  const targetPath = join(f.directory, 'restored.sqlite')
  await assert.rejects(restoreBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE, targetPath }), { code: 'INVALID_SCHEMA' })
  await assert.rejects(stat(targetPath), { code: 'ENOENT' })
  assert.equal(f.library.db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name = 'events_no_update'").get().count, 1)
})

test('restauração detecta CHECK inválido em arquivo criptografado autenticado', async context => {
  const f = await fixture(context)
  await archive(f)
  await rewriteEncryptedDatabase(f, db => db.exec('PRAGMA ignore_check_constraints = ON; UPDATE readers SET active = 8'))
  await assert.rejects(validateBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE }), { code: 'INVALID_DATABASE' })
})

test('restauração detecta relacionamento inválido em arquivo criptografado autenticado', async context => {
  const f = await fixture(context)
  await archive(f)
  await rewriteEncryptedDatabase(f, db => db.exec("PRAGMA foreign_keys = OFF; UPDATE auth_sessions SET user_id = 'conta-inexistente'"))
  await assert.rejects(restoreBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE, targetPath: join(f.directory, 'restored.sqlite') }), { code: 'INVALID_DATABASE' })
})

test('falta do diretório de destino retorna erro e não registra falso sucesso', async context => {
  const f = await fixture(context)
  await assert.rejects(createBackup({ db: f.library.db, outputPath: join(f.directory, 'ausente', 'backup.bcb'), passphrase: PASSPHRASE }), { code: 'BACKUP_WRITE_FAILED' })
  await archive(f)
  await assert.rejects(restoreBackup({ backupPath: f.backupPath, passphrase: PASSPHRASE, targetPath: join(f.directory, 'ausente', 'restored.sqlite') }), { code: 'RESTORE_WRITE_FAILED' })
})

test('backup sem tabelas de autenticação é recusado para evitar recuperação incompleta', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'biblioteca-backup-test-'))
  const library = openLibrary({ filename: join(directory, 'incomplete.sqlite') })
  context.after(async () => {
    library.close()
    await rm(directory, { recursive: true, force: true })
  })
  await assert.rejects(createBackup({ db: library.db, outputPath: join(directory, 'incomplete.bcb'), passphrase: PASSPHRASE }), { code: 'INVALID_SCHEMA' })
})
