import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { configuration, prepareDatabasePath } from '../server/config.mjs'
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

test('preparação aceita banco novo e o SQLite cria arquivo privado', (context) => {
  const filename = join(fixture(context), 'subdiretorio', 'novo.sqlite')
  prepareDatabasePath(filename)
  assert.equal(existsSync(filename), false)
  const library = openLibrary({ filename })
  try {
    assert.equal(statSync(filename).mode & 0o777, 0o600)
    assert.equal(library.getSummary().datasetKind, 'fictional-local')
  } finally {
    library.close()
  }
})

test('preparação preserva arquivo existente e restringe suas permissões', (context) => {
  const filename = join(fixture(context), 'existente.sqlite')
  writeFileSync(filename, 'conteúdo a preservar')
  chmodSync(filename, 0o644)
  prepareDatabasePath(filename)
  assert.equal(readFileSync(filename, 'utf8'), 'conteúdo a preservar')
  assert.equal(statSync(filename).mode & 0o777, 0o600)
})

test('preparação recusa link simbólico para arquivo existente sem alterá-lo', (context) => {
  const directory = fixture(context)
  const target = join(directory, 'origem.sqlite')
  const filename = join(directory, 'link.sqlite')
  writeFileSync(target, 'conteúdo original')
  chmodSync(target, 0o640)
  symlinkSync(target, filename)
  assert.throws(
    () => prepareDatabasePath(filename),
    /arquivo regular sem link simbólico/,
  )
  assert.equal(readFileSync(target, 'utf8'), 'conteúdo original')
  assert.equal(statSync(target).mode & 0o777, 0o640)
})

test('preparação recusa link simbólico pendente sem criar o destino', (context) => {
  const directory = fixture(context)
  const target = join(directory, 'destino-ausente.sqlite')
  const filename = join(directory, 'link-pendente.sqlite')
  symlinkSync(target, filename)
  assert.throws(
    () => prepareDatabasePath(filename),
    /arquivo regular sem link simbólico/,
  )
  assert.equal(existsSync(target), false)
})

test('preparação recusa diretório como arquivo de banco', (context) => {
  const filename = join(fixture(context), 'diretorio.sqlite')
  mkdirSync(filename)
  assert.throws(
    () => prepareDatabasePath(filename),
    /arquivo regular sem link simbólico/,
  )
})

const hostedEnvironment = Object.freeze({
  LIBRARY_MODE: 'hosted',
  LIBRARY_ORIGIN: 'https://biblioteca.example',
  LIBRARY_COOKIE_SECURE: 'true',
  LIBRARY_DB_PATH: '/var/lib/biblioteca/library.sqlite',
})

test('perfil local padrão preserva loopback, HTTP e banco relativo sem usar PORT do provedor', () => {
  assert.deepEqual(configuration({ PORT: '8080' }), {
    filename: resolve('.library-data/library.sqlite'),
    port: 3001,
    host: '127.0.0.1',
    origin: 'http://localhost:3001',
    secureCookies: false,
  })
})

test('perfil local mantém configuração explícita de porta, IPv6 e caminho relativo', () => {
  const config = configuration({
    LIBRARY_MODE: 'local',
    LIBRARY_PORT: '4001',
    LIBRARY_HOST: '::1',
    LIBRARY_ORIGIN: 'http://localhost:5173',
    LIBRARY_DB_PATH: 'dados/ensaio.sqlite',
  })
  assert.equal(config.port, 4001)
  assert.equal(config.host, '::1')
  assert.equal(config.origin, 'http://localhost:5173')
  assert.equal(config.filename, resolve('dados/ensaio.sqlite'))
  assert.equal(config.secureCookies, false)
})

test('modo desconhecido não habilita hospedagem por engano', () => {
  for (const mode of ['', 'production', 'Hosted']) {
    assert.throws(
      () => configuration({ ...hostedEnvironment, LIBRARY_MODE: mode }),
      /LIBRARY_MODE/,
    )
  }
})

test('perfil local não aceita escuta pública mesmo com origem HTTPS e cookies seguros', () => {
  for (const host of ['0.0.0.0', '::', '192.0.2.10', 'localhost']) {
    assert.throws(
      () =>
        configuration({
          ...hostedEnvironment,
          LIBRARY_MODE: 'local',
          LIBRARY_HOST: host,
        }),
      /loopback/,
    )
  }
})

test('hospedagem explícita permite escuta pública com HTTPS, cookies seguros e banco absoluto', () => {
  for (const host of ['127.0.0.1', '::1', '0.0.0.0']) {
    const config = configuration({ ...hostedEnvironment, LIBRARY_HOST: host })
    assert.equal(config.host, host)
    assert.equal(config.origin, 'https://biblioteca.example')
    assert.equal(config.secureCookies, true)
    assert.equal(config.filename, '/var/lib/biblioteca/library.sqlite')
    assert.equal(config.port, 3001)
  }
  assert.equal(configuration(hostedEnvironment).host, '127.0.0.1')
  assert.equal(
    configuration({
      ...hostedEnvironment,
      LIBRARY_ORIGIN: 'https://biblioteca.example/',
    }).origin,
    'https://biblioteca.example',
  )
})

test('hospedagem aceita PORT do provedor e prioriza LIBRARY_PORT quando informada', () => {
  assert.equal(configuration({ ...hostedEnvironment, PORT: '8080' }).port, 8080)
  assert.equal(
    configuration({ ...hostedEnvironment, LIBRARY_PORT: '4001', PORT: '8080' })
      .port,
    4001,
  )
})

test('portas explícitas vazias, não decimais ou fora dos limites são recusadas nos dois perfis', () => {
  for (const port of [
    '',
    ' ',
    '0',
    '-1',
    '65536',
    '12.5',
    'abc',
    '0x1f90',
    '1e3',
  ]) {
    for (const mode of ['local', 'hosted']) {
      assert.throws(
        () =>
          configuration({
            ...hostedEnvironment,
            LIBRARY_MODE: mode,
            LIBRARY_PORT: port,
          }),
        /Porta inválida/,
      )
    }
    assert.throws(
      () => configuration({ ...hostedEnvironment, PORT: port }),
      /Porta inválida/,
    )
  }
})

test('hospedagem exige origem explícita em vez de usar localhost automaticamente', () => {
  for (const origin of [undefined, '']) {
    assert.throws(
      () => configuration({ ...hostedEnvironment, LIBRARY_ORIGIN: origin }),
      /LIBRARY_ORIGIN/,
    )
  }
})

test('hospedagem recusa HTTP, credenciais, caminhos, consultas e fragmentos na origem', () => {
  for (const origin of [
    'http://biblioteca.example',
    'ftp://biblioteca.example',
    'https://usuario:segredo@biblioteca.example',
    'https://@biblioteca.example',
    'https://biblioteca.example/atendimento',
    'https://biblioteca.example/a/..',
    'https://biblioteca.example?consulta=1',
    'https://biblioteca.example?',
    'https://biblioteca.example/#fragmento',
    'https://biblioteca.example/#',
    'https://biblioteca.example\\atendimento',
    'origem-invalida',
  ]) {
    assert.throws(
      () => configuration({ ...hostedEnvironment, LIBRARY_ORIGIN: origin }),
      /[Oo]rigem/,
    )
  }
})

test('hospedagem exige ativação explícita dos cookies seguros', () => {
  for (const secure of [undefined, '', 'false', 'TRUE', '1']) {
    assert.throws(
      () =>
        configuration({ ...hostedEnvironment, LIBRARY_COOKIE_SECURE: secure }),
      /LIBRARY_COOKIE_SECURE=true/,
    )
  }
})

test('hospedagem exige banco absoluto explícito e recusa memória ou caminhos relativos', () => {
  for (const databasePath of [
    undefined,
    '',
    ' ',
    ':memory:',
    'library.sqlite',
    './dados/library.sqlite',
  ]) {
    assert.throws(
      () =>
        configuration({ ...hostedEnvironment, LIBRARY_DB_PATH: databasePath }),
      /LIBRARY_DB_PATH/,
    )
  }
})

test('hospedagem não aceita endereços de escuta fora dos explicitamente preparados', () => {
  for (const host of ['::', '192.0.2.10', 'localhost']) {
    assert.throws(
      () => configuration({ ...hostedEnvironment, LIBRARY_HOST: host }),
      /Endereço de hospedagem inválido/,
    )
  }
})
