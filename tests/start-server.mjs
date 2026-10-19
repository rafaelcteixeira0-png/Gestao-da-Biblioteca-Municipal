// Fictional browser-test fixture. Normal startup never creates these accounts.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLibrary } from '../server/library.mjs'
import { createAuth } from '../server/auth.mjs'
import { startServer } from '../server/start.mjs'

process.umask(0o077)
const temporary = mkdtempSync(join(tmpdir(), 'biblioteca-browser-test-'))
const filename = join(temporary, 'fictional.sqlite')
const library = openLibrary({ filename })
const auth = createAuth({ db: library.db })
const password = 'SenhaFicticiaE2E123!'
const admin = auth.bootstrap({ username: 'admin-e2e', name: 'Administração Fictícia E2E', password })
auth.saveUser(admin, { username: 'equipe-e2e', name: 'Equipe Fictícia E2E', role: 'staff', active: true, password })
auth.saveUser(admin, { username: 'leitor-e2e', name: 'Leitor Fictício E2E', role: 'reader', active: true, password })
library.close()
const { server } = startServer({ filename, port: 4173, host: '127.0.0.1', origin: 'http://127.0.0.1:4173', secureCookies: false })
server.once('listening', () => console.log('Servidor de testes pronto em banco temporário fictício.'))
server.once('error', () => { console.error('Não foi possível iniciar o servidor de testes.'); process.exitCode = 1 })
server.once('close', () => rmSync(temporary, { recursive: true, force: true }))
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close())
