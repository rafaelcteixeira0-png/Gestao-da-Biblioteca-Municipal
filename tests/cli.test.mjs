import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { openLibrary } from '../server/library.mjs'
import { createAuth } from '../server/auth.mjs'
import { validateBackup } from '../server/backup.mjs'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'biblioteca-cli-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, 'fictional.sqlite')
  const password = 'SenhaFicticiaApenasCli123!'
  const passphrase = 'Frase ficticia apenas CLI backup 123!'
  const env = {
    ...process.env,
    LIBRARY_DB_PATH: filename,
    LIBRARY_ADMIN_USERNAME: 'admin-cli',
    LIBRARY_ADMIN_NAME: 'Administração Fictícia CLI',
    LIBRARY_ADMIN_PASSWORD: password,
    LIBRARY_BACKUP_PASSPHRASE: passphrase,
  }
  const run = (args, changes = {}) =>
    spawnSync(process.execPath, ['server/cli.mjs', ...args], {
      env: { ...env, ...changes },
      encoding: 'utf8',
    })
  return { directory, filename, password, passphrase, env, run }
}

test('CLI inicializa sem credencial padrão e recupera a senha com revogação', (t) => {
  const f = fixture(t)
  assert.equal(f.run(['init']).status, 0)
  assert.equal(existsSync(f.filename), true)
  assert.equal(f.run(['init']).status, 1)
  const newPassword = 'NovaSenhaFicticiaCli456!'
  assert.equal(
    f.run(['recover-admin'], { LIBRARY_ADMIN_PASSWORD: newPassword }).status,
    0,
  )
  const library = openLibrary({ filename: f.filename })
  try {
    const auth = createAuth({ db: library.db })
    assert.throws(() =>
      auth.login({
        username: f.env.LIBRARY_ADMIN_USERNAME,
        password: f.password,
      }),
    )
    assert.equal(
      auth.login({
        username: f.env.LIBRARY_ADMIN_USERNAME,
        password: newPassword,
      }).user.role,
      'admin',
    )
    assert.ok(
      library.db.prepare('SELECT count(*) AS count FROM auth_events').get()
        .count >= 2,
    )
  } finally {
    library.close()
  }
  assert.equal(
    f.run(['init'], {
      LIBRARY_DB_PATH: join(f.directory, 'no-password.sqlite'),
      LIBRARY_ADMIN_PASSWORD: '',
    }).status,
    1,
  )
})

test('CLI cria backup verificável e restaura isoladamente sem sobrescrever a origem', async (t) => {
  const f = fixture(t)
  const filename = join(f.directory, 'fictional.backup')
  const targetPath = join(f.directory, 'recovered.sqlite')
  assert.equal(f.run(['init']).status, 0)
  const result = f.run(['backup', filename])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(filename), true)
  assert.equal(
    (await validateBackup({ backupPath: filename, passphrase: f.passphrase }))
      .datasetKind,
    'fictional-local',
  )
  // Some managed execution environments suppress captured child stdout.
  if (result.stdout) {
    assert.equal(JSON.parse(result.stdout).datasetKind, 'fictional-local')
    assert.equal(result.stdout.includes(f.password), false)
    assert.equal(result.stdout.includes(f.passphrase), false)
  } else
    t.diagnostic(
      'stdout de subprocesso indisponível; arquivo e banco conferidos diretamente.',
    )
  assert.equal(f.run(['verify-backup', filename]).status, 0)
  assert.equal(f.run(['restore', filename, f.filename]).status, 1)
  assert.equal(f.run(['restore', filename, targetPath]).status, 0)
  const restored = openLibrary({ filename: targetPath })
  try {
    const auth = createAuth({ db: restored.db })
    assert.equal(
      auth.login({
        username: f.env.LIBRARY_ADMIN_USERNAME,
        password: f.password,
      }).user.role,
      'admin',
    )
  } finally {
    restored.close()
  }
})

test('CLI backup recusa banco vazio sem inicializar ou alterar sua origem', (t) => {
  const f = fixture(t)
  const targetPath = join(f.directory, 'invalid.backup')
  writeFileSync(f.filename, '')
  const result = f.run(['backup', targetPath])
  assert.equal(result.status, 1)
  assert.equal(readFileSync(f.filename).length, 0)
  assert.equal(existsSync(targetPath), false)
})

test('CLI backup não repara silenciosamente proteções ausentes na origem', (t) => {
  const f = fixture(t)
  assert.equal(f.run(['init']).status, 0)
  const library = openLibrary({ filename: f.filename })
  library.db.exec('DROP TRIGGER events_no_update')
  library.close()
  const before = readFileSync(f.filename)
  const targetPath = join(f.directory, 'invalid.backup')
  assert.equal(f.run(['backup', targetPath]).status, 1)
  assert.deepEqual(readFileSync(f.filename), before)
  assert.equal(existsSync(targetPath), false)
})
