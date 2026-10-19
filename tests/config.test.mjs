import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareDatabasePath } from '../server/config.mjs'
import { openLibrary } from '../server/library.mjs'

function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), 'biblioteca-config-test-'))
  const previousUmask = process.umask()
  context.after(() => {
    process.umask(previousUmask)
    rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

test('preparação aceita banco novo e o SQLite cria arquivo privado', context => {
  const filename = join(fixture(context), 'subdiretorio', 'novo.sqlite')
  prepareDatabasePath(filename)
  assert.equal(existsSync(filename), false)
  const library = openLibrary({ filename })
  try {
    assert.equal(statSync(filename).mode & 0o777, 0o600)
    assert.equal(library.getSummary().datasetKind, 'fictional-local')
  } finally { library.close() }
})

test('preparação preserva arquivo existente e restringe suas permissões', context => {
  const filename = join(fixture(context), 'existente.sqlite')
  writeFileSync(filename, 'conteúdo a preservar')
  chmodSync(filename, 0o644)
  prepareDatabasePath(filename)
  assert.equal(readFileSync(filename, 'utf8'), 'conteúdo a preservar')
  assert.equal(statSync(filename).mode & 0o777, 0o600)
})

test('preparação recusa link simbólico para arquivo existente sem alterá-lo', context => {
  const directory = fixture(context)
  const target = join(directory, 'origem.sqlite')
  const filename = join(directory, 'link.sqlite')
  writeFileSync(target, 'conteúdo original')
  chmodSync(target, 0o640)
  symlinkSync(target, filename)
  assert.throws(() => prepareDatabasePath(filename), /arquivo regular sem link simbólico/)
  assert.equal(readFileSync(target, 'utf8'), 'conteúdo original')
  assert.equal(statSync(target).mode & 0o777, 0o640)
})

test('preparação recusa link simbólico pendente sem criar o destino', context => {
  const directory = fixture(context)
  const target = join(directory, 'destino-ausente.sqlite')
  const filename = join(directory, 'link-pendente.sqlite')
  symlinkSync(target, filename)
  assert.throws(() => prepareDatabasePath(filename), /arquivo regular sem link simbólico/)
  assert.equal(existsSync(target), false)
})

test('preparação recusa diretório como arquivo de banco', context => {
  const filename = join(fixture(context), 'diretorio.sqlite')
  mkdirSync(filename)
  assert.throws(() => prepareDatabasePath(filename), /arquivo regular sem link simbólico/)
})
