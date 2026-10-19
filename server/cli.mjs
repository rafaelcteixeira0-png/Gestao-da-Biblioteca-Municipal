import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { resolve } from 'node:path'
import { existsSync, lstatSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { configuration, prepareDatabasePath } from './config.mjs'
import { openLibrary } from './library.mjs'
import { createAuth } from './auth.mjs'
import { createBackup, validateBackup, restoreBackup } from './backup.mjs'

async function input(label, value, secret = false) {
  if (value) return value
  if (!process.stdin.isTTY) throw new Error(`${label}: é necessário terminal interativo ou a variável de ambiente documentada.`)
  let muted = false
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done() } })
  const terminal = createInterface({ input: process.stdin, output, terminal: true })
  try {
    process.stdout.write(`${label}: `)
    muted = secret
    return await terminal.question('')
  } finally { terminal.close(); if (secret) process.stdout.write('\n') }
}
async function main() {
  const [command, first, second] = process.argv.slice(2)
  if (['verify-backup', 'restore'].includes(command)) {
    if (!first || (command === 'restore' && !second)) throw new Error('Informe o backup e, para restaurar, um novo arquivo de destino.')
    const passphrase = await input('Frase do backup', process.env.LIBRARY_BACKUP_PASSPHRASE, true)
    const result = command === 'restore'
      ? await restoreBackup({ backupPath: resolve(first), targetPath: resolve(second), passphrase })
      : await validateBackup({ backupPath: resolve(first), passphrase })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (!['init', 'recover-admin', 'backup'].includes(command)) throw new Error('Comandos: init | recover-admin | backup <arquivo> | verify-backup <arquivo> | restore <arquivo> <novo-banco>.')
  const config = configuration()
  if (command !== 'init' && !existsSync(config.filename)) throw new Error('O banco configurado não existe.')
  if (command === 'backup') {
    if (!first) throw new Error('Informe um novo arquivo de backup.')
    const info = lstatSync(config.filename)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('O banco precisa ser um arquivo regular sem link simbólico.')
    const passphrase = await input('Frase de proteção do backup (mínimo 16 caracteres)', process.env.LIBRARY_BACKUP_PASSPHRASE, true)
    // Backup must never initialize or repair the source database.
    const db = new DatabaseSync(config.filename, { readOnly: true })
    try {
      console.log(JSON.stringify(await createBackup({ db, outputPath: resolve(first), passphrase }), null, 2))
    } finally { db.close() }
    return
  }
  prepareDatabasePath(config.filename)
  const library = openLibrary({ filename: config.filename })
  try {
    const auth = createAuth({ db: library.db })
    if (command === 'init') {
      const username = await input('Usuário da administração', process.env.LIBRARY_ADMIN_USERNAME)
      const name = await input('Nome fictício da pessoa responsável', process.env.LIBRARY_ADMIN_NAME)
      const password = await input('Senha exclusiva (12 a 128 caracteres, letras e números)', process.env.LIBRARY_ADMIN_PASSWORD, true)
      auth.bootstrap({ username, name, password })
      console.log('Administração criada no banco fictício. Nenhum leitor ou exemplar foi importado.')
    } else if (command === 'recover-admin') {
      const username = await input('Usuário da administração', process.env.LIBRARY_ADMIN_USERNAME)
      const administrator = library.db.prepare("SELECT id FROM auth_users WHERE username = ? COLLATE NOCASE AND role = 'admin' AND active = 1").get(username.normalize('NFKC').trim())
      if (!administrator) throw new Error('Administração ativa não encontrada.')
      const password = await input('Nova senha exclusiva', process.env.LIBRARY_ADMIN_PASSWORD, true)
      // The local OS account and database-file access authorize technical recovery.
      auth.resetPassword(administrator, administrator.id, { password })
      console.log('Senha redefinida, sessões encerradas e recuperação auditada.')
    }
  } finally { library.close() }
}
try { await main() } catch (error) { console.error(error.code ? `${error.code}: ${error.message}` : error.message); process.exitCode = 1 }
