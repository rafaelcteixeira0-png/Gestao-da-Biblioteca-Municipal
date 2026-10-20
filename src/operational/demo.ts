import { ApiError } from './client.ts'
import type {
  Copy,
  Event,
  Loan,
  OperationalClient,
  Reader,
  Session,
  Work,
} from './types'

// Public examples for the browser-only demonstration. They are not server credentials.
export const PUBLIC_DEMO_USERNAME = 'biblioteca.cianorte'
export const PUBLIC_DEMO_PASSWORD = 'BibliotecaTeste2026'

function invalid(message: string, status = 400): never {
  throw new ApiError(message, status)
}

function text(value: unknown, label: string, minimum = 0, maximum = 200) {
  if (typeof value !== 'string') invalid(`${label}: informe um texto válido.`)
  const result = value.normalize('NFC').trim()
  if (
    result.length < minimum ||
    result.length > maximum ||
    Array.from(result).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    invalid(`${label}: informe de ${minimum} a ${maximum} caracteres válidos.`)
  return result
}

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function date(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    invalid('Prazo: informe uma data válida.')
  const parsed = new Date(`${value}T12:00:00.000Z`)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value ||
    value < today()
  )
    invalid('Prazo: informe uma data válida a partir de hoje.')
  return value
}

function identifiers(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 100 ||
    value.some((id) => typeof id !== 'string') ||
    new Set(value).size !== value.length
  )
    invalid('Selecione exemplares diferentes para realizar o teste.')
  return value as string[]
}

/** Each instance is an isolated, disposable browser session. It never calls the API. */
export function createDemoClient(): OperationalClient {
  const user = {
    id: crypto.randomUUID(),
    username: PUBLIC_DEMO_USERNAME,
    name: 'Equipe da biblioteca · Teste',
    role: 'staff' as const,
    active: true,
    version: 1,
  }
  let session: Session | null = null
  const readers: Reader[] = [
    {
      id: crypto.randomUUID(),
      name: 'Leitora de Exemplo',
      active: true,
      version: 1,
    },
  ]
  const works: Work[] = [
    {
      id: crypto.randomUUID(),
      title: 'A viagem das palavras · Exemplo',
      author: 'Autoria de exemplo',
      category: 'Literatura de exemplo',
      edition: '1ª edição fictícia',
      volume: '',
      version: 1,
    },
  ]
  const copies: Copy[] = [0, 1].map((index) => ({
    id: crypto.randomUUID(),
    workId: works[0].id,
    accessionNumber: null,
    shelf: `Estante de teste ${index + 1}`,
    condition: 'Bom',
    state: 'active',
    status: 'available',
    version: 1,
  }))
  const loans: Loan[] = []
  const events: Event[] = []
  const requests = new Map<string, { fingerprint: string; result: unknown }>()

  function find<T extends { id: string }>(
    items: T[],
    id: string,
    label: string,
  ) {
    const item = items.find((entry) => entry.id === id)
    if (!item) invalid(`${label} não encontrado neste teste.`, 404)
    return item
  }

  function version(item: { version: number }, body: Record<string, unknown>) {
    if (!Number.isInteger(body.version) || body.version !== item.version)
      invalid(
        'O registro mudou. Atualize os dados antes de editar novamente.',
        409,
      )
  }

  function append(
    type: string,
    entityId: string,
    before: unknown,
    after: unknown,
    metadata?: unknown,
  ) {
    events.unshift({
      id: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      actorId: user.id,
      type,
      entityId,
      before: structuredClone(before),
      after: structuredClone(after),
      ...(metadata === undefined
        ? {}
        : { metadata: structuredClone(metadata) }),
    })
  }

  function copyIsLoaned(id: string) {
    return loans.some((loan) =>
      loan.items.some((item) => item.copyId === id && !item.returnedAt),
    )
  }

  function copyStatus(copy: Copy): Copy['status'] {
    return copy.state === 'withdrawn'
      ? 'withdrawn'
      : copyIsLoaned(copy.id)
        ? 'loaned'
        : 'available'
  }

  function saveReader(id: string | undefined, body: Record<string, unknown>) {
    const previous = id ? find(readers, id, 'Leitor') : undefined
    if (previous) version(previous, body)
    const name = text(body.name ?? previous?.name, 'Nome do leitor', 2, 120)
    const active = body.active ?? previous?.active ?? true
    if (typeof active !== 'boolean') invalid('Situação do leitor inválida.')
    const saved: Reader = {
      id: previous?.id ?? crypto.randomUUID(),
      name,
      active,
      version: (previous?.version ?? 0) + 1,
    }
    const before = previous ? structuredClone(previous) : null
    if (previous) Object.assign(previous, saved)
    else readers.push(saved)
    append(
      previous ? 'reader.updated' : 'reader.created',
      saved.id,
      before,
      saved,
    )
    return saved
  }

  function saveWork(id: string | undefined, body: Record<string, unknown>) {
    const previous = id ? find(works, id, 'Obra') : undefined
    if (previous) version(previous, body)
    const saved: Work = {
      id: previous?.id ?? crypto.randomUUID(),
      title: text(body.title ?? previous?.title, 'Título', 1, 240),
      author: text(body.author ?? previous?.author ?? '', 'Autor', 0, 160),
      category: text(
        body.category ?? previous?.category ?? '',
        'Categoria',
        0,
        100,
      ),
      edition: text(body.edition ?? previous?.edition ?? '', 'Edição', 0, 80),
      volume: text(body.volume ?? previous?.volume ?? '', 'Volume', 0, 80),
      version: (previous?.version ?? 0) + 1,
    }
    const before = previous ? structuredClone(previous) : null
    if (previous) Object.assign(previous, saved)
    else works.push(saved)
    append(previous ? 'work.updated' : 'work.created', saved.id, before, saved)
    return saved
  }

  function saveCopy(id: string | undefined, body: Record<string, unknown>) {
    const previous = id ? find(copies, id, 'Exemplar') : undefined
    if (previous) version(previous, body)
    const workId = text(body.workId ?? previous?.workId, 'Obra', 1, 80)
    find(works, workId, 'Obra')
    if (
      previous &&
      previous.workId !== workId &&
      loans.some((loan) =>
        loan.items.some((item) => item.copyId === previous.id),
      )
    )
      invalid('Um exemplar com histórico não pode mudar de obra.', 409)
    const rawAccession = Object.hasOwn(body, 'accessionNumber')
      ? body.accessionNumber
      : previous?.accessionNumber
    const accessionNumber =
      rawAccession === null || rawAccession === undefined || rawAccession === ''
        ? null
        : text(rawAccession, 'Tombo', 1, 80)
            .normalize('NFKC')
            .toLocaleUpperCase('pt-BR')
    if (
      accessionNumber &&
      copies.some(
        (copy) => copy.id !== id && copy.accessionNumber === accessionNumber,
      )
    )
      invalid('Este tombo já foi usado em outro exemplar do teste.', 409)
    const state = body.state ?? previous?.state ?? 'active'
    if (state !== 'active' && state !== 'withdrawn')
      invalid('Situação do exemplar inválida.')
    if (previous && state === 'withdrawn' && copyIsLoaned(previous.id))
      invalid('Devolva o exemplar antes de retirá-lo de circulação.', 409)
    const saved: Copy = {
      id: previous?.id ?? crypto.randomUUID(),
      workId,
      accessionNumber,
      shelf: text(body.shelf ?? previous?.shelf ?? '', 'Localização', 0, 120),
      condition: text(
        body.condition ?? previous?.condition ?? '',
        'Conservação',
        0,
        120,
      ),
      state,
      status: 'available',
      version: (previous?.version ?? 0) + 1,
    }
    saved.status = copyStatus(saved)
    const before = previous ? structuredClone(previous) : null
    if (previous) Object.assign(previous, saved)
    else copies.push(saved)
    append(previous ? 'copy.updated' : 'copy.created', saved.id, before, saved)
    return saved
  }

  function idempotent(
    path: string,
    body: Record<string, unknown>,
    run: () => unknown,
  ) {
    const requestId = body.requestId
    if (
      typeof requestId !== 'string' ||
      !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/iu.test(requestId)
    )
      invalid('A identificação da operação de teste é inválida.')
    const fingerprint = JSON.stringify([path, body])
    const old = requests.get(requestId)
    if (old) {
      if (old.fingerprint !== fingerprint)
        invalid(
          'Esta identificação já corresponde a outra operação de teste.',
          409,
        )
      return structuredClone(old.result)
    }
    const result = run()
    requests.set(requestId, { fingerprint, result: structuredClone(result) })
    return result
  }

  function checkout(body: Record<string, unknown>) {
    const reader = find(readers, text(body.readerId, 'Leitor', 1, 80), 'Leitor')
    if (!reader.active) invalid('Selecione um leitor ativo para o teste.')
    const selected = identifiers(body.copyIds).map((id) =>
      find(copies, id, 'Exemplar'),
    )
    const dueAt = date(body.dueAt)
    for (const copy of selected)
      if (copyStatus(copy) !== 'available')
        invalid('Um dos exemplares selecionados está indisponível.', 409)
    const saved: Loan = {
      id: crypto.randomUUID(),
      readerId: reader.id,
      readerName: reader.name,
      borrowedAt: new Date().toISOString(),
      status: 'open',
      items: selected.map((copy) => ({
        id: crypto.randomUUID(),
        copyId: copy.id,
        title: find(works, copy.workId, 'Obra').title,
        accessionNumber: copy.accessionNumber,
        dueAt,
        returnedAt: null,
        renewalCount: 0,
      })),
    }
    loans.unshift(saved)
    for (const copy of selected) {
      copy.status = 'loaned'
      copy.version += 1
    }
    append('loan.created', saved.id, null, saved)
    return saved
  }

  function returnItems(loanId: string, body: Record<string, unknown>) {
    const loan = find(loans, loanId, 'Empréstimo')
    const ids = identifiers(body.copyIds)
    const selected = ids.map((id) => {
      const item = loan.items.find((entry) => entry.copyId === id)
      if (!item || item.returnedAt)
        invalid(
          'Selecione apenas itens ainda emprestados neste empréstimo.',
          409,
        )
      return item
    })
    const before = structuredClone(loan)
    const returnedAt = new Date().toISOString()
    for (const item of selected) {
      item.returnedAt = returnedAt
      const copy = find(copies, item.copyId, 'Exemplar')
      copy.version += 1
      copy.status = copyStatus(copy)
    }
    loan.status = loan.items.every((item) => item.returnedAt)
      ? 'returned'
      : 'partial'
    append('loan.items_returned', loan.id, before, loan, { copyIds: ids })
    return loan
  }

  function renew(
    loanId: string,
    copyId: string,
    body: Record<string, unknown>,
  ) {
    const loan = find(loans, loanId, 'Empréstimo')
    const item = loan.items.find((entry) => entry.copyId === copyId)
    if (!item || item.returnedAt)
      invalid('Este exemplar não está emprestado neste empréstimo.', 409)
    const dueAt = date(body.dueAt)
    const reason = text(body.reason, 'Motivo da renovação', 3, 500)
    if (dueAt <= item.dueAt)
      invalid('O novo prazo precisa ser posterior ao prazo atual.')
    const before = structuredClone(loan)
    item.dueAt = dueAt
    item.renewalCount += 1
    append('loan.item_renewed', loan.id, before, loan, { copyId, reason })
    return loan
  }

  function route(
    path: string,
    method: string,
    body: Record<string, unknown>,
    csrfToken?: string,
  ): unknown {
    if (path === '/auth/login' && method === 'POST') {
      if (
        typeof body.username !== 'string' ||
        body.username.trim().toLocaleLowerCase('pt-BR') !==
          PUBLIC_DEMO_USERNAME ||
        body.password !== PUBLIC_DEMO_PASSWORD
      )
        invalid('Usuário ou senha de exemplo incorretos.', 401)
      session = { user: { ...user }, csrfToken: crypto.randomUUID() }
      return session
    }
    if (!session)
      invalid('Entre com o acesso de exemplo para iniciar o teste.', 401)
    if (path === '/auth/session' && method === 'GET') return session
    if (method !== 'GET' && csrfToken !== session.csrfToken)
      invalid('O acesso de teste mudou. Entre novamente.', 401)
    if (path === '/auth/logout' && method === 'POST') {
      session = null
      return { loggedOut: true }
    }
    if (method === 'GET') {
      if (path === '/readers') return readers
      if (path === '/works') return works
      if (path === '/copies')
        return copies.map((copy) => ({ ...copy, status: copyStatus(copy) }))
      if (path === '/loans') return loans
      if (path === '/history') return events
    }
    const catalogue = path.match(/^\/(readers|works|copies)(?:\/([^/]+))?$/u)
    if (
      catalogue &&
      ((!catalogue[2] && method === 'POST') ||
        (catalogue[2] && method === 'PATCH'))
    ) {
      const [, type, id] = catalogue
      if (type === 'readers') return saveReader(id, body)
      if (type === 'works') return saveWork(id, body)
      return saveCopy(id, body)
    }
    if (path === '/loans' && method === 'POST')
      return idempotent(path, body, () => checkout(body))
    const returning = path.match(/^\/loans\/([^/]+)\/return$/u)
    if (returning && method === 'POST')
      return idempotent(path, body, () => returnItems(returning[1], body))
    const renewing = path.match(/^\/loans\/([^/]+)\/items\/([^/]+)\/renew$/u)
    if (renewing && method === 'POST')
      return idempotent(path, body, () => renew(renewing[1], renewing[2], body))
    invalid('Esta ação não está disponível na demonstração temporária.', 404)
  }

  return async <T>(
    path: string,
    method = 'GET',
    body: Record<string, unknown> = {},
    csrfToken?: string,
  ): Promise<T> => structuredClone(route(path, method, body, csrfToken)) as T
}
