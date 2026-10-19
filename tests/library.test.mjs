import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Worker } from 'node:worker_threads'
import { LibraryError, openLibrary } from '../server/library.mjs'

const actor = '10000000-0000-4000-8000-000000000001'
const otherActor = '10000000-0000-4000-8000-000000000002'
const fixedClock = () => '2030-05-15T15:00:00.000Z'
const dueAt = '2030-05-30'

function fixture(t, count = 3, clock = fixedClock) {
  const library = openLibrary({ filename: ':memory:', clock })
  t.after(() => library.close())
  const reader = library.saveReader(actor, { name: 'Leitor Fictício' })
  const work = library.saveWork(actor, { title: 'Título Fictício', author: 'Autora de Teste' })
  const copies = Array.from({ length: count }, (_, index) => library.saveCopy(actor, {
    workId: work.id, accessionNumber: `TESTE-${index + 1}`, shelf: 'Estante de teste',
  }))
  return { library, reader, work, copies }
}

function rejectsCode(run, code, status = undefined) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof LibraryError)
    assert.equal(error.code, code)
    if (status !== undefined) assert.equal(error.status, status)
    return true
  })
}

function borrow(library, reader, copies, requestId = randomUUID()) {
  return library.checkout(actor, {
    readerId: reader.id, copyIds: copies.map((copy) => copy.id), dueAt, requestId,
  })
}

test('um arquivo reaberto preserva cadastros, circulação, histórico e identificação fictícia', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'biblioteca-persistencia-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, 'fictional.sqlite')
  let library = openLibrary({ filename, clock: fixedClock })
  const reader = library.saveReader(actor, { name: 'Pessoa Fictícia' })
  const work = library.saveWork(actor, { title: 'Obra de Teste' })
  const copy = library.saveCopy(actor, { workId: work.id })
  const loan = borrow(library, reader, [copy])
  const before = library.getHistory()
  library.close()
  library = openLibrary({ filename, clock: fixedClock })
  t.after(() => library.close())
  assert.equal(library.listReaders()[0].id, reader.id)
  assert.equal(library.listCopies()[0].status, 'loaned')
  assert.deepEqual(library.listLoans(), [loan])
  assert.deepEqual(library.getHistory(), before)
  assert.equal(library.getSummary().datasetKind, 'fictional-local')
  assert.equal(library.db.prepare("SELECT value FROM settings WHERE key = 'policy_version'").get().value, 'local-explicit-v1')
})

test('leitores recebem UUID, edição validada por versão e evento com antes/depois', (t) => {
  const { library, reader } = fixture(t, 0)
  assert.match(reader.id, /^[0-9a-f-]{36}$/u)
  const updated = library.saveReader(actor, { name: 'Outro Nome Fictício', active: false, version: reader.version }, reader.id)
  assert.equal(updated.version, 2)
  assert.equal(updated.active, false)
  assert.equal(updated.createdAt, reader.createdAt)
  const [event] = library.getHistory({ entityId: reader.id })
  assert.equal(event.type, 'reader.updated')
  assert.deepEqual(event.before, reader)
  assert.deepEqual(event.after, updated)
  assert.equal(event.actorId, actor)
  assert.equal(event.occurredAt, fixedClock())
})

test('edição desatualizada e edição sem versão não sobrescrevem dados', (t) => {
  const { library, reader } = fixture(t, 0)
  library.saveReader(actor, { name: 'Nome Atual', version: reader.version }, reader.id)
  rejectsCode(() => library.saveReader(actor, { name: 'Nome Antigo', version: reader.version }, reader.id), 'VERSION_CONFLICT', 409)
  rejectsCode(() => library.saveReader(actor, { name: 'Sem Versão' }, reader.id), 'VERSION_REQUIRED', 400)
  assert.equal(library.listReaders()[0].name, 'Nome Atual')
  assert.equal(library.getHistory({ entityId: reader.id }).length, 2)
})

test('servidor rejeita nomes inválidos, situações inválidas, corpos inválidos e operador inválido', (t) => {
  const { library, reader } = fixture(t, 0)
  for (const name of ['', 'A', null, 123, 'x'.repeat(201)]) {
    rejectsCode(() => library.saveReader(actor, { name }), 'INVALID_FIELD', 400)
  }
  rejectsCode(() => library.saveReader(actor, { name: 'Teste', active: 'true' }), 'INVALID_FIELD', 400)
  rejectsCode(() => library.saveReader(actor, []), 'INVALID_BODY', 400)
  rejectsCode(() => library.saveReader('administrador', { name: 'Teste' }), 'INVALID_ID', 400)
  rejectsCode(() => library.saveReader(actor, { name: null, version: reader.version }, reader.id), 'INVALID_FIELD', 400)
  assert.equal(library.listReaders().length, 1)
})

test('título de uma letra é válido, metadados são opcionais e títulos repetidos permanecem distintos', (t) => {
  const { library } = fixture(t, 0)
  const first = library.saveWork(actor, { title: 'A' })
  const second = library.saveWork(actor, { title: 'A' })
  assert.notEqual(first.id, second.id)
  assert.equal(first.author, '')
  assert.equal(first.category, '')
  assert.equal(first.edition, '')
  assert.equal(first.volume, '')
  const updated = library.saveWork(actor, { title: 'Água', edition: '2', volume: 'I', version: first.version }, first.id)
  assert.equal(updated.version, 2)
  assert.equal(updated.edition, '2')
  rejectsCode(() => library.saveWork(actor, { title: '', version: updated.version }, first.id), 'INVALID_FIELD', 400)
  rejectsCode(() => library.saveWork(actor, { author: null, version: updated.version }, first.id), 'INVALID_FIELD', 400)
})

test('versão de obra e exemplar protege edição concorrente', (t) => {
  const { library, work, copies } = fixture(t, 1)
  library.saveWork(actor, { title: 'Título Atual', version: work.version }, work.id)
  rejectsCode(() => library.saveWork(actor, { title: 'Título Obsoleto', version: work.version }, work.id), 'VERSION_CONFLICT', 409)
  const copy = copies[0]
  library.saveCopy(actor, { shelf: 'Nova Estante', version: copy.version }, copy.id)
  rejectsCode(() => library.saveCopy(actor, { shelf: 'Antiga', version: copy.version }, copy.id), 'VERSION_CONFLICT', 409)
  assert.equal(library.listCopies()[0].shelf, 'Nova Estante')
})

test('tombo é opcional e nunca é fabricado; exemplares sem tombo têm identidades próprias', (t) => {
  const { library, work } = fixture(t, 0)
  const first = library.saveCopy(actor, { workId: work.id })
  const second = library.saveCopy(actor, { workId: work.id, accessionNumber: '' })
  assert.notEqual(first.id, second.id)
  assert.equal(first.accessionNumber, null)
  assert.equal(second.accessionNumber, null)
  assert.equal(first.status, 'available')
})

test('tombo único considera NFKC, espaços e caixa, sem eliminar exemplares', (t) => {
  const { library, work } = fixture(t, 0)
  library.saveCopy(actor, { workId: work.id, accessionNumber: '  ＡＢ   123  ' })
  rejectsCode(() => library.saveCopy(actor, { workId: work.id, accessionNumber: 'ab 123' }), 'ACCESSION_EXISTS', 409)
  assert.equal(library.listCopies().length, 1)
  assert.equal(library.listCopies()[0].accessionNumber, 'AB 123')
  const other = library.saveCopy(actor, { workId: work.id, accessionNumber: 'AB 124' })
  rejectsCode(() => library.saveCopy(actor, { accessionNumber: 'AB 123', version: other.version }, other.id), 'ACCESSION_EXISTS', 409)
  assert.equal(library.listCopies().find((copy) => copy.id === other.id).accessionNumber, 'AB 124')
})

test('exemplar exige obra existente e SQLite mantém chaves estrangeiras ativas', (t) => {
  const { library, copies, work } = fixture(t, 1)
  rejectsCode(() => library.saveCopy(actor, { workId: randomUUID() }), 'NOT_FOUND', 404)
  rejectsCode(() => library.saveCopy(actor, { workId: 'obra-1' }), 'INVALID_ID', 400)
  assert.equal(library.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  assert.throws(() => library.db.prepare('UPDATE copies SET work_id = ? WHERE id = ?').run(randomUUID(), copies[0].id), /FOREIGN KEY/u)
  assert.throws(() => library.db.prepare('DELETE FROM works WHERE id = ?').run(work.id), /FOREIGN KEY/u)
  assert.deepEqual(library.db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('busca sem acentos encontra leitores, obras e exemplares; consultas retornam arrays', (t) => {
  const { library, reader, work } = fixture(t, 1)
  assert.equal(library.listReaders('ficticio')[0].id, reader.id)
  assert.equal(library.listWorks('titulo teste')[0].id, work.id)
  assert.equal(library.listCopies('teste-1').length, 1)
  assert.equal(library.listReaders('inexistente').length, 0)
  assert.equal(library.getHistory('Titulo Ficticio').length, 1)
})

test('empréstimo com três itens vincula UUIDs, usa prazo explícito e torna todos indisponíveis', (t) => {
  const { library, reader, copies } = fixture(t)
  const loan = borrow(library, reader, copies)
  assert.equal(loan.readerId, reader.id)
  assert.equal(loan.status, 'open')
  assert.equal(loan.items.length, 3)
  assert.equal(loan.borrowedAt, fixedClock())
  for (const item of loan.items) {
    assert.ok(copies.some((copy) => copy.id === item.copyId))
    assert.equal(item.dueAt, dueAt)
    assert.equal(item.returnedAt, null)
    assert.equal(item.renewalCount, 0)
  }
  assert.equal(library.listCopies({ status: 'loaned' }).length, 3)
  assert.equal(library.getSummary().openLoans, 1)
  assert.equal(library.getHistory({ entityId: loan.id })[0].type, 'loan.created')
})

test('empréstimo rejeita leitor inativo sem gravar circulação', (t) => {
  const { library, reader, copies } = fixture(t)
  library.saveReader(actor, { active: false, version: reader.version }, reader.id)
  rejectsCode(() => borrow(library, reader, copies), 'READER_INACTIVE', 409)
  assert.equal(library.listLoans().length, 0)
  assert.equal(library.listCopies({ status: 'available' }).length, 3)
})

test('exemplar emprestado ou retirado de circulação bloqueia o conjunto inteiro', (t) => {
  const { library, reader, copies } = fixture(t)
  borrow(library, reader, [copies[0]])
  rejectsCode(() => borrow(library, reader, [copies[1], copies[0]]), 'COPY_UNAVAILABLE', 409)
  assert.equal(library.listLoans().length, 1)
  assert.equal(library.listCopies().find((copy) => copy.id === copies[1].id).status, 'available')
  library.saveCopy(actor, { state: 'withdrawn', version: copies[2].version }, copies[2].id)
  rejectsCode(() => borrow(library, reader, [copies[2]]), 'COPY_UNAVAILABLE', 409)
})

test('índice parcial do banco impede segundo vínculo ativo mesmo contornando o serviço', (t) => {
  const { library, reader, copies } = fixture(t, 1)
  const loan = borrow(library, reader, copies)
  const secondLoanId = randomUUID()
  library.db.prepare('INSERT INTO loans(id, reader_id, reader_name_snapshot, borrowed_at) VALUES (?, ?, ?, ?)')
    .run(secondLoanId, reader.id, reader.name, fixedClock())
  const item = loan.items[0]
  assert.throws(() => library.db.prepare('INSERT INTO loan_items(id, loan_id, copy_id, work_id, title_snapshot, due_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), secondLoanId, item.copyId, item.workId, item.title, dueAt), /UNIQUE/u)
})

test('seleção inválida, exemplar desconhecido, data ausente e identificador de operação ausente não gravam', (t) => {
  const { library, reader, copies } = fixture(t, 1)
  const input = { readerId: reader.id, copyIds: [copies[0].id], dueAt, requestId: 'pedido-valido' }
  rejectsCode(() => library.checkout(actor, { ...input, copyIds: [] }), 'INVALID_SELECTION', 400)
  rejectsCode(() => library.checkout(actor, { ...input, copyIds: [copies[0].id, copies[0].id] }), 'DUPLICATE_SELECTION', 400)
  rejectsCode(() => library.checkout(actor, { ...input, copyIds: [randomUUID()] }), 'NOT_FOUND', 404)
  rejectsCode(() => library.checkout(actor, { ...input, dueAt: undefined }), 'INVALID_DUE_DATE', 400)
  rejectsCode(() => library.checkout(actor, { ...input, requestId: undefined }), 'INVALID_FIELD', 400)
  assert.equal(library.listLoans().length, 0)
  assert.equal(library.db.prepare('SELECT count(*) AS count FROM requests').get().count, 0)
})

test('datas impossíveis, passadas e timestamps não são aceitos como previsão por dia', (t) => {
  const { library, reader, copies } = fixture(t, 1)
  for (const date of ['2030-02-30', '2030-05-14', '2030-13-01', '30/05/2030', '2030-05-30T23:59:59Z']) {
    rejectsCode(() => library.checkout(actor, {
      readerId: reader.id, copyIds: [copies[0].id], dueAt: date, requestId: randomUUID(),
    }), 'INVALID_DUE_DATE', 400)
  }
  assert.equal(library.listLoans().length, 0)
})

test('hoje respeita o calendário de São Paulo antes da meia-noite local', (t) => {
  const { library, reader, copies } = fixture(t, 1, () => '2030-01-01T01:00:00.000Z')
  const loan = library.checkout(actor, {
    readerId: reader.id, copyIds: [copies[0].id], dueAt: '2029-12-31', requestId: 'virada-local',
  })
  assert.equal(loan.items[0].dueAt, '2029-12-31')
  assert.equal(library.getSummary().overdueItems, 0)
})

test('falha no terceiro item após escritas reverte empréstimo, itens, versões, eventos e idempotência', (t) => {
  const { library, reader, copies } = fixture(t)
  const eventsBefore = library.getHistory().length
  library.db.exec(`CREATE TRIGGER test_abort_third_item BEFORE INSERT ON loan_items
    WHEN NEW.copy_id = '${copies[2].id}' BEGIN SELECT RAISE(ABORT, 'falha de gravação de teste'); END;`)
  assert.throws(() => borrow(library, reader, copies, 'rollback-3-itens'), /falha de gravação de teste/u)
  assert.equal(library.listLoans().length, 0)
  assert.equal(library.db.prepare('SELECT count(*) AS count FROM loan_items').get().count, 0)
  assert.equal(library.db.prepare('SELECT count(*) AS count FROM requests').get().count, 0)
  assert.equal(library.getHistory().length, eventsBefore)
  assert.deepEqual(library.listCopies().map((copy) => [copy.status, copy.version]), [
    ['available', 1], ['available', 1], ['available', 1],
  ])
  library.db.exec('DROP TRIGGER test_abort_third_item')
  assert.equal(borrow(library, reader, copies, 'rollback-3-itens').items.length, 3)
})

test('reenvio idêntico de empréstimo retorna resultado original sem duplicar evento ou movimentação', (t) => {
  const { library, reader, copies } = fixture(t, 1)
  const first = borrow(library, reader, copies, 'pedido-repetido')
  const repeated = borrow(library, reader, copies, 'pedido-repetido')
  assert.deepEqual(repeated, first)
  assert.equal(library.listLoans().length, 1)
  assert.equal(library.getHistory({ entityId: first.id }).length, 1)
})

test('idempotência reconhece reenvio depois de o prazo ter passado', (t) => {
  let instant = '2030-05-15T15:00:00.000Z'
  const { library, reader, copies } = fixture(t, 1, () => instant)
  const first = borrow(library, reader, copies, 'pedido-ontem')
  instant = '2030-06-15T15:00:00.000Z'
  assert.deepEqual(borrow(library, reader, copies, 'pedido-ontem'), first)
  assert.equal(library.getSummary().overdueItems, 1)
})

test('mesmo identificador com payload ou operação diferente resulta em conflito', (t) => {
  const { library, reader, copies } = fixture(t, 2)
  const loan = borrow(library, reader, [copies[0]], 'pedido-conflitante')
  rejectsCode(() => borrow(library, reader, [copies[1]], 'pedido-conflitante'), 'IDEMPOTENCY_CONFLICT', 409)
  rejectsCode(() => library.returnItems(actor, loan.id, {
    copyIds: [copies[0].id], requestId: 'pedido-conflitante',
  }), 'IDEMPOTENCY_CONFLICT', 409)
  assert.equal(library.listCopies().find((copy) => copy.id === copies[1].id).status, 'available')
})

test('idempotência é isolada por operador autenticado', (t) => {
  const { library, reader, copies } = fixture(t, 2)
  const first = borrow(library, reader, [copies[0]], 'mesmo-pedido')
  const second = library.checkout(otherActor, {
    readerId: reader.id, copyIds: [copies[1].id], dueAt, requestId: 'mesmo-pedido',
  })
  assert.notEqual(first.id, second.id)
  assert.equal(library.db.prepare('SELECT count(*) AS count FROM requests').get().count, 2)
})

test('devolução parcial libera somente o item selecionado e preserva empréstimo e histórico', (t) => {
  const { library, reader, copies } = fixture(t)
  const loan = borrow(library, reader, copies)
  const returned = library.returnItems(actor, loan.id, { copyIds: [copies[0].id], requestId: 'devolucao-parcial' })
  assert.equal(returned.status, 'partial')
  assert.equal(returned.items[0].returnedAt, fixedClock())
  assert.equal(returned.items[1].returnedAt, null)
  assert.equal(returned.items[2].returnedAt, null)
  assert.equal(library.getSummary().availableCopies, 1)
  assert.equal(library.getSummary().loanedCopies, 2)
  const history = library.getHistory({ entityId: loan.id })
  assert.equal(history.length, 2)
  assert.equal(history[0].type, 'loan.items_returned')
  assert.deepEqual(history[0].before, loan)
  assert.deepEqual(history[0].after, returned)
  assert.deepEqual(library.returnItems(actor, loan.id, { copyIds: [copies[0].id], requestId: 'devolucao-parcial' }), returned)
  assert.equal(library.getHistory({ entityId: loan.id }).length, 2)
})

test('devolução total encerra o empréstimo e permite novo empréstimo sem apagar o anterior', (t) => {
  const { library, reader, copies } = fixture(t, 2)
  const first = borrow(library, reader, copies)
  const returned = library.returnItems(actor, first.id, { copyIds: copies.map((copy) => copy.id), requestId: 'devolver-todos' })
  assert.equal(returned.status, 'returned')
  const second = borrow(library, reader, [copies[0]])
  assert.notEqual(second.id, first.id)
  assert.equal(library.listLoans().length, 2)
  assert.equal(library.listLoans().find((loan) => loan.id === first.id).status, 'returned')
  assert.equal(library.db.prepare('SELECT count(*) AS count FROM loan_items WHERE copy_id = ?').get(copies[0].id).count, 2)
})

test('devolução inválida não altera outros itens da seleção', (t) => {
  const { library, reader, copies } = fixture(t, 3)
  const loan = borrow(library, reader, copies.slice(0, 2))
  rejectsCode(() => library.returnItems(actor, loan.id, {
    copyIds: [copies[0].id, copies[2].id], requestId: 'devolucao-invalida',
  }), 'ITEM_NOT_IN_LOAN', 400)
  assert.equal(library.listLoans()[0].status, 'open')
  library.returnItems(actor, loan.id, { copyIds: [copies[0].id], requestId: 'primeira-devolucao' })
  rejectsCode(() => library.returnItems(actor, loan.id, {
    copyIds: [copies[1].id, copies[0].id], requestId: 'repeticao-nova',
  }), 'ITEM_ALREADY_RETURNED', 409)
  assert.equal(library.listLoans()[0].items[1].returnedAt, null)
})

test('renovação individual altera apenas o prazo escolhido e registra motivo, ator e versões completas', (t) => {
  const { library, reader, copies } = fixture(t, 2)
  const loan = borrow(library, reader, copies)
  const renewed = library.renewItem(actor, loan.id, copies[0].id, {
    dueAt: '2030-06-10', reason: 'Solicitação do leitor fictício', requestId: 'renovacao-individual',
  })
  assert.equal(renewed.items[0].dueAt, '2030-06-10')
  assert.equal(renewed.items[0].renewalCount, 1)
  assert.equal(renewed.items[1].dueAt, dueAt)
  assert.equal(renewed.items[1].renewalCount, 0)
  const [event] = library.getHistory({ entityId: loan.id })
  assert.equal(event.type, 'loan.item_renewed')
  assert.equal(event.metadata.reason, 'Solicitação do leitor fictício')
  assert.equal(event.metadata.copyId, copies[0].id)
  assert.equal(event.actorId, actor)
  assert.deepEqual(event.before, loan)
  assert.deepEqual(event.after, renewed)
  assert.deepEqual(library.renewItem(actor, loan.id, copies[0].id, {
    dueAt: '2030-06-10', reason: 'Solicitação do leitor fictício', requestId: 'renovacao-individual',
  }), renewed)
  assert.equal(library.getHistory({ entityId: loan.id }).length, 2)
})

test('renovação exige motivo e data posterior; item devolvido ou alheio é rejeitado', (t) => {
  const { library, reader, copies } = fixture(t, 3)
  const loan = borrow(library, reader, copies.slice(0, 2))
  const input = { dueAt: '2030-06-10', reason: 'Motivo de teste', requestId: 'renovar-invalido' }
  rejectsCode(() => library.renewItem(actor, loan.id, copies[0].id, { ...input, reason: '' }), 'INVALID_FIELD', 400)
  rejectsCode(() => library.renewItem(actor, loan.id, copies[0].id, { ...input, dueAt }), 'RENEWAL_DATE_NOT_LATER', 400)
  rejectsCode(() => library.renewItem(actor, loan.id, copies[2].id, input), 'ITEM_NOT_IN_LOAN', 400)
  library.returnItems(actor, loan.id, { copyIds: [copies[0].id], requestId: 'devolver-antes-renovacao' })
  rejectsCode(() => library.renewItem(actor, loan.id, copies[0].id, input), 'ITEM_ALREADY_RETURNED', 409)
  assert.equal(library.listLoans()[0].items[1].renewalCount, 0)
})

test('exemplar emprestado não pode ser retirado e versão anterior à circulação fica obsoleta', (t) => {
  const { library, reader, copies } = fixture(t, 1)
  borrow(library, reader, copies)
  rejectsCode(() => library.saveCopy(actor, { state: 'withdrawn', version: copies[0].version }, copies[0].id), 'VERSION_CONFLICT', 409)
  const copy = library.listCopies()[0]
  rejectsCode(() => library.saveCopy(actor, { state: 'withdrawn', version: copy.version }, copy.id), 'COPY_LOANED', 409)
  assert.equal(library.listCopies()[0].status, 'loaned')
})

test('histórico de circulação conserva título e leitor originais após edições e veda troca da obra do exemplar', (t) => {
  const { library, reader, work, copies } = fixture(t, 1)
  const loan = borrow(library, reader, copies)
  library.saveReader(actor, { name: 'Nome Atual Fictício', version: reader.version }, reader.id)
  library.saveWork(actor, { title: 'Título Atual', version: work.version }, work.id)
  const otherWork = library.saveWork(actor, { title: 'Outra Obra' })
  const copy = library.listCopies()[0]
  rejectsCode(() => library.saveCopy(actor, { workId: otherWork.id, version: copy.version }, copy.id), 'COPY_HISTORY_EXISTS', 409)
  assert.equal(library.listLoans()[0].readerName, 'Leitor Fictício')
  assert.equal(library.listLoans()[0].items[0].title, 'Título Fictício')
  assert.deepEqual(library.getHistory({ entityId: loan.id })[0].after, loan)
})

test('gatilhos impedem atualização e exclusão de eventos no próprio banco', (t) => {
  const { library } = fixture(t, 0)
  const before = library.getHistory()
  assert.throws(() => library.db.prepare('UPDATE events SET type = ? WHERE id = ?').run('falso', before[0].id), /imutável/u)
  assert.throws(() => library.db.prepare('DELETE FROM events WHERE id = ?').run(before[0].id), /imutável/u)
  assert.deepEqual(library.getHistory(), before)
})

test('duas conexões em workers disputam o mesmo exemplar: só uma confirma a transação', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'biblioteca-concorrencia-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const filename = join(directory, 'concurrent.sqlite')
  const library = openLibrary({ filename, clock: fixedClock })
  t.after(() => library.close())
  const reader = library.saveReader(actor, { name: 'Leitor Fictício Concorrente' })
  const work = library.saveWork(actor, { title: 'Livro Fictício Concorrente' })
  const copy = library.saveCopy(actor, { workId: work.id })
  const barrier = new SharedArrayBuffer(4)
  const moduleURL = new URL('../server/library.mjs', import.meta.url).href
  const source = `
    import { parentPort, workerData } from 'node:worker_threads'
    const { openLibrary } = await import(workerData.moduleURL)
    const library = openLibrary({filename: workerData.filename, clock: () => '2030-05-15T15:00:00.000Z'})
    parentPort.postMessage({ready: true})
    Atomics.wait(new Int32Array(workerData.barrier), 0, 0)
    try {
      const result = library.checkout(workerData.actor, {
        readerId: workerData.readerId, copyIds: [workerData.copyId], dueAt: '2030-05-30', requestId: workerData.requestId
      })
      parentPort.postMessage({success: true, loanId: result.id})
    } catch (error) {
      parentPort.postMessage({success: false, code: error.code, status: error.status})
    } finally { library.close() }
  `
  let readyCount = 0
  const results = await Promise.all([0, 1].map((index) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), {
      workerData: { moduleURL, filename, actor, readerId: reader.id, copyId: copy.id, requestId: `concorrente-${index}`, barrier },
    })
    t.after(() => worker.terminate())
    worker.on('error', reject)
    worker.on('message', (message) => {
      if (message.ready) {
        readyCount++
        if (readyCount === 2) {
          Atomics.store(new Int32Array(barrier), 0, 1)
          Atomics.notify(new Int32Array(barrier), 0, 2)
        }
      } else resolve(message)
    })
  })))
  assert.equal(results.filter((result) => result.success).length, 1)
  const failure = results.find((result) => !result.success)
  assert.equal(failure.code, 'COPY_UNAVAILABLE')
  assert.equal(failure.status, 409)
  assert.equal(library.listLoans().length, 1)
  assert.equal(library.getHistory({ entityType: 'loan' }).length, 1)
  assert.equal(library.db.prepare('SELECT count(*) AS count FROM requests').get().count, 1)
})
