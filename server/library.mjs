import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export class LibraryError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'LibraryError'
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const own = (object, key) => Object.hasOwn(object, key)
const fail = (status, code, message, details) => {
  throw new LibraryError(status, code, message, details)
}

function identifier(value, label) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    fail(400, 'INVALID_ID', `${label} deve ser um identificador válido.`)
  }
  return value.toLowerCase()
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(400, 'INVALID_BODY', 'Informe um objeto com os dados da operação.')
  }
  return value
}

function text(value, label, maximum = 200, minimum = 0) {
  if (typeof value !== 'string') {
    fail(400, 'INVALID_FIELD', `${label} deve ser um texto.`)
  }
  const result = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (result.length < minimum || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    fail(400, 'INVALID_FIELD', `${label} deve ter entre ${minimum} e ${maximum} caracteres válidos.`)
  }
  return result
}

function boolean(value, label) {
  if (typeof value !== 'boolean') fail(400, 'INVALID_FIELD', `${label} deve ser verdadeiro ou falso.`)
  return value
}

function assertVersion(value, current) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(400, 'VERSION_REQUIRED', 'Informe a versão atual do registro para editar.')
  }
  if (value !== current) {
    fail(409, 'VERSION_CONFLICT', 'O registro foi alterado. Atualize os dados antes de salvar.')
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function selection(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    fail(400, 'INVALID_SELECTION', 'Selecione entre 1 e 100 exemplares.')
  }
  const ids = value.map((id) => identifier(id, 'Exemplar'))
  if (new Set(ids).size !== ids.length) fail(400, 'DUPLICATE_SELECTION', 'Um exemplar foi informado mais de uma vez.')
  return ids
}

function searchArguments(query) {
  if (typeof query === 'string') return { q: query }
  if (query === undefined || query === null) return { q: '' }
  return { ...object(query), q: query.q ?? query.query ?? '' }
}

const searchable = (value) => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
const matches = (values, query) => {
  const words = searchable(query).trim().split(/\s+/u).filter(Boolean)
  const haystack = searchable(values.join(' '))
  return words.every((word) => haystack.includes(word))
}

export const librarySchemaSql = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  INSERT OR IGNORE INTO settings(key, value) VALUES
    ('dataset_kind', 'fictional-local'),
    ('schema_version', '1'),
    ('policy_version', 'local-explicit-v1');
  CREATE TABLE IF NOT EXISTS readers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 200),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS works (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),
    author TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    edition TEXT NOT NULL DEFAULT '',
    volume TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS copies (
    id TEXT PRIMARY KEY,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
    accession_number TEXT,
    accession_key TEXT UNIQUE,
    shelf TEXT NOT NULL DEFAULT '',
    condition TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'withdrawn')),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK((accession_number IS NULL AND accession_key IS NULL) OR
          (accession_number IS NOT NULL AND accession_key IS NOT NULL))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS copies_work ON copies(work_id);
  CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    reader_id TEXT NOT NULL REFERENCES readers(id) ON DELETE RESTRICT,
    reader_name_snapshot TEXT NOT NULL,
    borrowed_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS loan_items (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
    copy_id TEXT NOT NULL REFERENCES copies(id) ON DELETE RESTRICT,
    work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
    title_snapshot TEXT NOT NULL,
    accession_snapshot TEXT,
    due_at TEXT NOT NULL,
    returned_at TEXT,
    renewal_count INTEGER NOT NULL DEFAULT 0 CHECK(renewal_count >= 0),
    UNIQUE(loan_id, copy_id)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_loan_per_copy
    ON loan_items(copy_id) WHERE returned_at IS NULL;
  CREATE INDEX IF NOT EXISTS loan_items_loan ON loan_items(loan_id);
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    occurred_at TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
    after_json TEXT NOT NULL CHECK(json_valid(after_json)),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS events_entity ON events(entity_type, entity_id);
  CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
    BEGIN SELECT RAISE(ABORT, 'O histórico é imutável.'); END;
  CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
    BEGIN SELECT RAISE(ABORT, 'O histórico é imutável.'); END;
  CREATE TABLE IF NOT EXISTS requests (
    actor_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    result_json TEXT NOT NULL CHECK(json_valid(result_json)),
    created_at TEXT NOT NULL,
    PRIMARY KEY(actor_id, request_id)
  ) STRICT;
`

export function openLibrary({ filename, clock = () => new Date().toISOString() }) {
  if (typeof filename !== 'string' || !filename) throw new TypeError('Informe filename para abrir o banco.')
  const db = new DatabaseSync(filename)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;')
    if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
    const existingVersion = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get()
    if (existingVersion) {
      const version = db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get()?.value
      if (version && version !== '1') fail(500, 'SCHEMA_UNSUPPORTED', 'A versão deste banco não é compatível com a aplicação.')
    }
    db.exec(librarySchemaSql)
  } catch (error) {
    db.close()
    throw error
  }

  const now = () => {
    const raw = clock()
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) fail(500, 'CLOCK_INVALID', 'O relógio do servidor retornou uma data inválida.')
    return date.toISOString()
  }
  const localDay = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now()))

  const dueDate = (value, requireCurrent = true) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      fail(400, 'INVALID_DUE_DATE', 'Informe a data prevista no formato AAAA-MM-DD.')
    }
    const parsed = new Date(`${value}T12:00:00.000Z`)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || (requireCurrent && value < localDay())) {
      fail(400, 'INVALID_DUE_DATE', 'A data prevista deve ser uma data válida de hoje em diante (horário de Brasília).')
    }
    return value
  }

  const transaction = (run) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = run()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      if (error instanceof LibraryError) throw error
      if (String(error.message).includes('UNIQUE constraint failed: copies.accession_key')) {
        fail(409, 'ACCESSION_EXISTS', 'Já existe um exemplar com esse tombo. Confira o cadastro.')
      }
      if (String(error.message).includes('UNIQUE constraint failed: loan_items.copy_id')) {
        fail(409, 'COPY_UNAVAILABLE', 'Um dos exemplares já está emprestado.')
      }
      throw error
    }
  }

  const readerDTO = (row) => row && ({
    id: row.id, name: row.name, active: Boolean(row.active), version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at,
  })
  const workDTO = (row) => row && ({
    id: row.id, title: row.title, author: row.author, category: row.category,
    edition: row.edition, volume: row.volume, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at,
  })
  const copyDTO = (row) => row && ({
    id: row.id, workId: row.work_id, accessionNumber: row.accession_number,
    shelf: row.shelf, condition: row.condition, state: row.state,
    status: row.state === 'withdrawn' ? 'withdrawn' : row.has_active_loan ? 'loaned' : 'available',
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  })
  const copySelect = `SELECT c.*, EXISTS(SELECT 1 FROM loan_items i WHERE i.copy_id = c.id AND i.returned_at IS NULL) AS has_active_loan FROM copies c`
  const findReader = (id) => readerDTO(db.prepare('SELECT * FROM readers WHERE id = ?').get(id))
  const findWork = (id) => workDTO(db.prepare('SELECT * FROM works WHERE id = ?').get(id))
  const findCopy = (id) => copyDTO(db.prepare(`${copySelect} WHERE c.id = ?`).get(id))

  const findLoan = (id) => {
    const row = db.prepare('SELECT * FROM loans WHERE id = ?').get(id)
    if (!row) return undefined
    const items = db.prepare('SELECT * FROM loan_items WHERE loan_id = ? ORDER BY rowid').all(id).map((item) => ({
      id: item.id, copyId: item.copy_id, workId: item.work_id, title: item.title_snapshot,
      accessionNumber: item.accession_snapshot, dueAt: item.due_at,
      returnedAt: item.returned_at, renewalCount: item.renewal_count,
    }))
    const returnedCount = items.filter((item) => item.returnedAt).length
    return {
      id: row.id, readerId: row.reader_id, readerName: row.reader_name_snapshot,
      borrowedAt: row.borrowed_at, version: row.version,
      status: returnedCount === items.length ? 'returned' : returnedCount ? 'partial' : 'open',
      items,
    }
  }

  const required = (value, label) => {
    if (!value) fail(404, 'NOT_FOUND', `${label} não encontrado.`)
    return value
  }
  const event = (actorId, type, entityType, entityId, before, after, metadata = {}) => {
    db.prepare(`INSERT INTO events(id, occurred_at, actor_id, type, entity_type, entity_id, before_json, after_json, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), now(), actorId, type, entityType, entityId,
      before === null ? null : JSON.stringify(before), JSON.stringify(after), JSON.stringify(metadata),
    )
  }

  function listReaders(query = '') {
    const args = searchArguments(query)
    return db.prepare('SELECT * FROM readers ORDER BY name COLLATE NOCASE, id').all().map(readerDTO)
      .filter((row) => matches([row.name, row.id], args.q) && (args.active === undefined || row.active === args.active))
  }

  function saveReader(actor, body, id) {
    const actorId = identifier(actor, 'Operador')
    object(body)
    const readerId = id ? identifier(id, 'Leitor') : randomUUID()
    return transaction(() => {
      const before = id ? required(findReader(readerId), 'Leitor') : null
      if (before) assertVersion(body.version, before.version)
      const name = text(own(body, 'name') ? body.name : before?.name, 'Nome do leitor', 200, 2)
      const active = own(body, 'active') ? boolean(body.active, 'Situação do leitor') : before?.active ?? true
      const timestamp = now()
      if (before) {
        db.prepare('UPDATE readers SET name = ?, active = ?, version = version + 1, updated_at = ? WHERE id = ?')
          .run(name, Number(active), timestamp, readerId)
      } else {
        db.prepare('INSERT INTO readers(id, name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(readerId, name, Number(active), timestamp, timestamp)
      }
      const after = findReader(readerId)
      event(actorId, before ? 'reader.updated' : 'reader.created', 'reader', readerId, before, after)
      return after
    })
  }

  function listWorks(query = '') {
    const args = searchArguments(query)
    return db.prepare('SELECT * FROM works ORDER BY title COLLATE NOCASE, id').all().map(workDTO)
      .filter((row) => matches([row.title, row.author, row.category, row.edition, row.volume, row.id], args.q))
  }

  function saveWork(actor, body, id) {
    const actorId = identifier(actor, 'Operador')
    object(body)
    const workId = id ? identifier(id, 'Obra') : randomUUID()
    return transaction(() => {
      const before = id ? required(findWork(workId), 'Obra') : null
      if (before) assertVersion(body.version, before.version)
      const title = text(own(body, 'title') ? body.title : before?.title, 'Título', 300, 1)
      const metadata = ['author', 'category', 'edition', 'volume'].map((field) => text(own(body, field) ? body[field] : before?.[field] ?? '', {
        author: 'Autor', category: 'Categoria', edition: 'Edição', volume: 'Volume',
      }[field], 200))
      const timestamp = now()
      if (before) {
        db.prepare('UPDATE works SET title = ?, author = ?, category = ?, edition = ?, volume = ?, version = version + 1, updated_at = ? WHERE id = ?')
          .run(title, ...metadata, timestamp, workId)
      } else {
        db.prepare('INSERT INTO works(id, title, author, category, edition, volume, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(workId, title, ...metadata, timestamp, timestamp)
      }
      const after = findWork(workId)
      event(actorId, before ? 'work.updated' : 'work.created', 'work', workId, before, after)
      return after
    })
  }

  function listCopies(query = '') {
    const args = searchArguments(query)
    const works = new Map(listWorks().map((work) => [work.id, work]))
    return db.prepare(`${copySelect} ORDER BY c.created_at, c.rowid`).all().map(copyDTO).filter((row) => {
      const work = works.get(row.workId)
      return matches([row.id, row.accessionNumber, row.shelf, row.condition, work?.title, work?.author], args.q)
        && (args.workId === undefined || args.workId === row.workId)
        && (args.status === undefined || args.status === row.status)
    })
  }

  function saveCopy(actor, body, id) {
    const actorId = identifier(actor, 'Operador')
    object(body)
    const copyId = id ? identifier(id, 'Exemplar') : randomUUID()
    return transaction(() => {
      const before = id ? required(findCopy(copyId), 'Exemplar') : null
      if (before) assertVersion(body.version, before.version)
      const workId = identifier(own(body, 'workId') ? body.workId : before?.workId, 'Obra')
      required(findWork(workId), 'Obra')
      if (before && workId !== before.workId && db.prepare('SELECT 1 FROM loan_items WHERE copy_id = ? LIMIT 1').get(copyId)) {
        fail(409, 'COPY_HISTORY_EXISTS', 'Este exemplar já possui circulação registrada e deve permanecer vinculado à obra original.')
      }
      const accessionInput = own(body, 'accessionNumber') ? body.accessionNumber : before?.accessionNumber ?? null
      const accessionNumber = accessionInput === null ? null : text(accessionInput, 'Tombo', 100) || null
      const accessionKey = accessionNumber?.toLocaleUpperCase('pt-BR') ?? null
      const shelf = text(own(body, 'shelf') ? body.shelf : before?.shelf ?? '', 'Localização', 200)
      const condition = text(own(body, 'condition') ? body.condition : before?.condition ?? '', 'Conservação', 200)
      const state = own(body, 'state') ? body.state : before?.state ?? 'active'
      if (!['active', 'withdrawn'].includes(state)) fail(400, 'INVALID_STATE', 'Situação do exemplar inválida.')
      if (state === 'withdrawn' && before?.status === 'loaned') {
        fail(409, 'COPY_LOANED', 'Registre a devolução antes de retirar o exemplar de circulação.')
      }
      const timestamp = now()
      if (before) {
        db.prepare('UPDATE copies SET work_id = ?, accession_number = ?, accession_key = ?, shelf = ?, condition = ?, state = ?, version = version + 1, updated_at = ? WHERE id = ?')
          .run(workId, accessionNumber, accessionKey, shelf, condition, state, timestamp, copyId)
      } else {
        db.prepare('INSERT INTO copies(id, work_id, accession_number, accession_key, shelf, condition, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(copyId, workId, accessionNumber, accessionKey, shelf, condition, state, timestamp, timestamp)
      }
      const after = findCopy(copyId)
      event(actorId, before ? 'copy.updated' : 'copy.created', 'copy', copyId, before, after)
      return after
    })
  }

  function listLoans(query = '') {
    const args = searchArguments(query)
    return db.prepare('SELECT id FROM loans ORDER BY borrowed_at DESC, rowid DESC').all().map(({ id }) => findLoan(id))
      .filter((row) => matches([row.id, row.readerName, ...row.items.flatMap((item) => [item.title, item.accessionNumber, item.copyId])], args.q)
        && (args.readerId === undefined || args.readerId === row.readerId)
        && (args.status === undefined || args.status === row.status))
  }

  function command(actor, operation, body, payload, run) {
    const actorId = identifier(actor, 'Operador')
    const requestId = text(body.requestId, 'Identificador da operação', 128, 1)
    const payloadJSON = JSON.stringify(canonical(payload))
    return transaction(() => {
      const previous = db.prepare('SELECT * FROM requests WHERE actor_id = ? AND request_id = ?').get(actorId, requestId)
      if (previous) {
        if (previous.operation !== operation || previous.payload_json !== payloadJSON) {
          fail(409, 'IDEMPOTENCY_CONFLICT', 'O identificador da operação já foi utilizado com outros dados. Atualize a página e tente novamente.')
        }
        return JSON.parse(previous.result_json)
      }
      const result = run(actorId)
      db.prepare('INSERT INTO requests(actor_id, request_id, operation, payload_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(actorId, requestId, operation, payloadJSON, JSON.stringify(result), now())
      return result
    })
  }

  function checkout(actor, body) {
    object(body)
    const readerId = identifier(body.readerId, 'Leitor')
    const copyIds = selection(body.copyIds)
    const dueAt = dueDate(body.dueAt, false)
    return command(actor, 'checkout', body, { readerId, copyIds, dueAt }, (actorId) => {
      dueDate(dueAt)
      const reader = required(findReader(readerId), 'Leitor')
      if (!reader.active) fail(409, 'READER_INACTIVE', 'O leitor está inativo e não pode retirar exemplares.')
      const copies = copyIds.map((id) => required(findCopy(id), 'Exemplar'))
      for (const copy of copies) {
        if (copy.status !== 'available') fail(409, 'COPY_UNAVAILABLE', 'Um dos exemplares está emprestado ou fora de circulação.', { copyId: copy.id })
      }
      const loanId = randomUUID()
      const timestamp = now()
      db.prepare('INSERT INTO loans(id, reader_id, reader_name_snapshot, borrowed_at) VALUES (?, ?, ?, ?)')
        .run(loanId, readerId, reader.name, timestamp)
      const insert = db.prepare('INSERT INTO loan_items(id, loan_id, copy_id, work_id, title_snapshot, accession_snapshot, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (const copy of copies) {
        const work = required(findWork(copy.workId), 'Obra')
        insert.run(randomUUID(), loanId, copy.id, work.id, work.title, copy.accessionNumber, dueAt)
        db.prepare('UPDATE copies SET version = version + 1, updated_at = ? WHERE id = ?').run(timestamp, copy.id)
      }
      const after = findLoan(loanId)
      event(actorId, 'loan.created', 'loan', loanId, null, after, { requestId: body.requestId })
      return after
    })
  }

  function returnItems(actor, id, body) {
    object(body)
    const loanId = identifier(id, 'Empréstimo')
    const copyIds = selection(body.copyIds)
    return command(actor, 'return', body, { loanId, copyIds }, (actorId) => {
      const before = required(findLoan(loanId), 'Empréstimo')
      for (const copyId of copyIds) {
        const item = before.items.find((entry) => entry.copyId === copyId)
        if (!item) fail(400, 'ITEM_NOT_IN_LOAN', 'Um dos exemplares não pertence a este empréstimo.')
        if (item.returnedAt) fail(409, 'ITEM_ALREADY_RETURNED', 'Um dos exemplares já foi devolvido.')
      }
      const timestamp = now()
      for (const copyId of copyIds) {
        db.prepare('UPDATE loan_items SET returned_at = ? WHERE loan_id = ? AND copy_id = ? AND returned_at IS NULL')
          .run(timestamp, loanId, copyId)
        db.prepare('UPDATE copies SET version = version + 1, updated_at = ? WHERE id = ?').run(timestamp, copyId)
      }
      db.prepare('UPDATE loans SET version = version + 1 WHERE id = ?').run(loanId)
      const after = findLoan(loanId)
      event(actorId, 'loan.items_returned', 'loan', loanId, before, after, { copyIds, requestId: body.requestId })
      return after
    })
  }

  function renewItem(actor, id, copy, body) {
    object(body)
    const loanId = identifier(id, 'Empréstimo')
    const copyId = identifier(copy, 'Exemplar')
    const dueAt = dueDate(body.dueAt, false)
    const reason = text(body.reason, 'Motivo da renovação', 500, 3)
    return command(actor, 'renew', body, { loanId, copyId, dueAt, reason }, (actorId) => {
      dueDate(dueAt)
      const before = required(findLoan(loanId), 'Empréstimo')
      const item = before.items.find((entry) => entry.copyId === copyId)
      if (!item) fail(400, 'ITEM_NOT_IN_LOAN', 'O exemplar não pertence a este empréstimo.')
      if (item.returnedAt) fail(409, 'ITEM_ALREADY_RETURNED', 'Não é possível renovar um exemplar já devolvido.')
      if (dueAt <= item.dueAt) fail(400, 'RENEWAL_DATE_NOT_LATER', 'A renovação deve ter uma data posterior à previsão atual.')
      db.prepare('UPDATE loan_items SET due_at = ?, renewal_count = renewal_count + 1 WHERE loan_id = ? AND copy_id = ?')
        .run(dueAt, loanId, copyId)
      db.prepare('UPDATE loans SET version = version + 1 WHERE id = ?').run(loanId)
      const after = findLoan(loanId)
      event(actorId, 'loan.item_renewed', 'loan', loanId, before, after, { copyId, reason, requestId: body.requestId })
      return after
    })
  }

  function getHistory(query = '') {
    const args = searchArguments(query)
    return db.prepare('SELECT * FROM events ORDER BY occurred_at DESC, rowid DESC').all().map((row) => ({
      id: row.id, occurredAt: row.occurred_at, actorId: row.actor_id, type: row.type,
      entityType: row.entity_type, entityId: row.entity_id,
      before: row.before_json === null ? null : JSON.parse(row.before_json),
      after: JSON.parse(row.after_json), metadata: JSON.parse(row.metadata_json),
    })).filter((row) => (args.entityType === undefined || args.entityType === row.entityType)
      && (args.entityId === undefined || args.entityId === row.entityId)
      && matches([row.type, row.entityId, row.actorId, JSON.stringify(row.after)], args.q))
  }

  function getSummary() {
    const copies = listCopies()
    const loans = listLoans()
    const today = localDay()
    return {
      datasetKind: db.prepare("SELECT value FROM settings WHERE key = 'dataset_kind'").get().value,
      readers: db.prepare('SELECT count(*) AS count FROM readers').get().count,
      works: db.prepare('SELECT count(*) AS count FROM works').get().count,
      copies: copies.length,
      availableCopies: copies.filter((copy) => copy.status === 'available').length,
      loanedCopies: copies.filter((copy) => copy.status === 'loaned').length,
      withdrawnCopies: copies.filter((copy) => copy.status === 'withdrawn').length,
      openLoans: loans.filter((loan) => loan.status !== 'returned').length,
      overdueItems: loans.flatMap((loan) => loan.items).filter((item) => !item.returnedAt && item.dueAt < today).length,
    }
  }

  return {
    db, close: () => db.close(), listReaders, saveReader, listWorks, saveWork,
    listCopies, saveCopy, listLoans, checkout, returnItems, renewItem, getHistory, getSummary,
  }
}
