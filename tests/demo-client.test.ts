import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDemoClient,
  PUBLIC_DEMO_PASSWORD,
  PUBLIC_DEMO_USERNAME,
} from '../src/operational/demo.ts'
import type {
  Copy,
  Event,
  Loan,
  OperationalClient,
  Reader,
  Session,
  Work,
} from '../src/operational/types.ts'

function login(client: OperationalClient) {
  return client<Session>('/auth/login', 'POST', {
    username: PUBLIC_DEMO_USERNAME,
    password: PUBLIC_DEMO_PASSWORD,
  })
}

function futureDate(days: number) {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

test('acesso público de teste rejeita dados incorretos, encerra sessão e isola cada demonstração', async () => {
  const client = createDemoClient()
  await assert.rejects(client('/auth/session'), { status: 401 })
  await assert.rejects(
    client('/auth/login', 'POST', {
      username: PUBLIC_DEMO_USERNAME,
      password: 'exemplo-incorreto',
    }),
    { status: 401 },
  )
  await assert.rejects(client('/readers'), { status: 401 })
  const session = await login(client)
  assert.equal(session.user.username, PUBLIC_DEMO_USERNAME)
  assert.equal(session.user.role, 'staff')
  assert.equal(
    (await client<Session>('/auth/session')).csrfToken,
    session.csrfToken,
  )
  await assert.rejects(
    client('/readers', 'POST', { name: 'Leitor Fictício Não Autorizado' }),
    { status: 401 },
  )
  const created = await client<Reader>(
    '/readers',
    'POST',
    { name: 'Leitora Fictícia desta Sessão' },
    session.csrfToken,
  )

  const independent = createDemoClient()
  await assert.rejects(independent('/auth/session'), { status: 401 })
  const otherSession = await login(independent)
  assert.notEqual(otherSession.csrfToken, session.csrfToken)
  assert.equal(
    (await independent<Reader[]>('/readers')).some(
      (reader) => reader.id === created.id,
    ),
    false,
  )
  assert.deepEqual(await independent<Loan[]>('/loans'), [])
  assert.deepEqual(await independent<Event[]>('/history'), [])

  await client('/auth/logout', 'POST', {}, session.csrfToken)
  await assert.rejects(client('/auth/session'), { status: 401 })
  await assert.rejects(client('/readers'), { status: 401 })
  assert.equal(
    (await independent<Session>('/auth/session')).user.id,
    otherSession.user.id,
  )
})

test('cadastros temporários validam informações, recusam edição obsoleta e devolvem cópias com histórico preservado', async () => {
  const client = createDemoClient()
  const session = await login(client)
  const token = session.csrfToken
  const initial = await client<Reader[]>('/readers')
  await assert.rejects(client('/readers', 'POST', { name: ' A ' }, token), {
    status: 400,
  })
  assert.deepEqual(await client<Reader[]>('/readers'), initial)
  assert.deepEqual(await client<Event[]>('/history'), [])

  const reader = await client<Reader>(
    '/readers',
    'POST',
    { name: 'Leitora Fictícia Original', active: true },
    token,
  )
  const readerId = reader.id
  reader.name = 'Alteração apenas na resposta recebida'
  assert.equal(
    (await client<Reader[]>('/readers')).find((item) => item.id === readerId)
      ?.name,
    'Leitora Fictícia Original',
  )
  const updated = await client<Reader>(
    `/readers/${readerId}`,
    'PATCH',
    { name: 'Leitora Fictícia Revisada', version: reader.version },
    token,
  )
  assert.equal(updated.version, reader.version + 1)
  await assert.rejects(
    client(
      `/readers/${readerId}`,
      'PATCH',
      { name: 'Edição Fictícia Obsoleta', version: reader.version },
      token,
    ),
    { status: 409 },
  )
  assert.deepEqual(
    (await client<Reader[]>('/readers')).find((item) => item.id === readerId),
    updated,
  )

  const work = await client<Work>(
    '/works',
    'POST',
    {
      title: 'Obra Fictícia',
      edition: '2ª edição',
    },
    token,
  )
  assert.equal(work.edition, '2ª edição')
  assert.equal(work.author, '')
  const revisedWork = await client<Work>(
    `/works/${work.id}`,
    'PATCH',
    { title: 'Obra Fictícia Revisada', version: work.version },
    token,
  )
  assert.equal(revisedWork.author, work.author)
  const copy = await client<Copy>(
    '/copies',
    'POST',
    {
      workId: work.id,
      accessionNumber: 'TESTE-UNICIDADE',
      shelf: 'Local Fictício',
    },
    token,
  )
  const revisedCopy = await client<Copy>(
    `/copies/${copy.id}`,
    'PATCH',
    { condition: 'Revisão Fictícia', version: copy.version },
    token,
  )
  assert.equal(revisedCopy.version, copy.version + 1)
  await assert.rejects(
    client(
      '/copies',
      'POST',
      { workId: work.id, accessionNumber: 'teste-unicidade' },
      token,
    ),
    { status: 409 },
  )

  const history = (await client<Event[]>('/history')).filter(
    (event) => event.entityId === readerId,
  )
  assert.deepEqual(
    history.map((event) => event.type),
    ['reader.updated', 'reader.created'],
  )
  assert.deepEqual(history[0].before, {
    id: readerId,
    name: 'Leitora Fictícia Original',
    active: true,
    version: 1,
  })
  assert.deepEqual(history[0].after, updated)
  history[0].after = { name: 'Alteração externa no histórico recebido' }
  assert.deepEqual(
    (await client<Event[]>('/history')).find(
      (event) => event.id === history[0].id,
    )?.after,
    updated,
  )
})

test('circulação temporária preserva exclusividade, idempotência, devolução parcial, renovação e snapshots sem efeitos em falhas', async () => {
  const client = createDemoClient()
  const session = await login(client)
  const token = session.csrfToken
  const [reader] = await client<Reader[]>('/readers')
  const copies = await client<Copy[]>('/copies')
  const dueAt = futureDate(14)
  const checkout = {
    requestId: crypto.randomUUID(),
    readerId: reader.id,
    copyIds: copies.map((copy) => copy.id),
    dueAt,
  }
  const loan = await client<Loan>('/loans', 'POST', checkout, token)
  assert.equal(loan.items.length, 2)
  assert.deepEqual(await client<Loan>('/loans', 'POST', checkout, token), loan)
  await assert.rejects(
    client(
      '/loans',
      'POST',
      { ...checkout, requestId: crypto.randomUUID() },
      token,
    ),
    { status: 409 },
  )
  assert.equal((await client<Loan[]>('/loans')).length, 1)
  assert.equal((await client<Event[]>('/history')).length, 1)

  const loansBeforeFailure = await client<Loan[]>('/loans')
  const copiesBeforeFailure = await client<Copy[]>('/copies')
  await assert.rejects(
    client(
      `/loans/${loan.id}/return`,
      'POST',
      {
        requestId: crypto.randomUUID(),
        copyIds: [copies[0].id, crypto.randomUUID()],
      },
      token,
    ),
    { status: 409 },
  )
  assert.deepEqual(await client<Loan[]>('/loans'), loansBeforeFailure)
  assert.deepEqual(await client<Copy[]>('/copies'), copiesBeforeFailure)
  assert.equal((await client<Event[]>('/history')).length, 1)

  const returned = await client<Loan>(
    `/loans/${loan.id}/return`,
    'POST',
    { requestId: crypto.randomUUID(), copyIds: [copies[0].id] },
    token,
  )
  assert.equal(returned.status, 'partial')
  assert.ok(returned.items[0].returnedAt)
  assert.equal(returned.items[1].returnedAt, null)
  assert.deepEqual(
    (await client<Copy[]>('/copies')).map((copy) => copy.status),
    ['available', 'loaned'],
  )
  await assert.rejects(
    client(
      `/loans/${loan.id}/items/${copies[0].id}/renew`,
      'POST',
      {
        requestId: crypto.randomUUID(),
        dueAt: futureDate(28),
        reason: 'Teste Fictício',
      },
      token,
    ),
    { status: 409 },
  )
  await assert.rejects(
    client(
      `/loans/${loan.id}/items/${copies[1].id}/renew`,
      'POST',
      { requestId: crypto.randomUUID(), dueAt, reason: 'Teste Fictício' },
      token,
    ),
    { status: 400 },
  )
  assert.deepEqual((await client<Loan[]>('/loans'))[0], returned)
  assert.equal((await client<Event[]>('/history')).length, 2)

  const newDueAt = futureDate(28)
  const renewed = await client<Loan>(
    `/loans/${loan.id}/items/${copies[1].id}/renew`,
    'POST',
    {
      requestId: crypto.randomUUID(),
      dueAt: newDueAt,
      reason: 'Renovação Fictícia',
    },
    token,
  )
  assert.equal(renewed.items[1].renewalCount, 1)
  assert.equal(renewed.items[1].dueAt, newDueAt)
  assert.deepEqual(renewed.items[0], returned.items[0])
  assert.equal(renewed.readerName, loan.readerName)
  const history = await client<Event[]>('/history')
  assert.deepEqual(
    history.map((event) => event.type),
    ['loan.item_renewed', 'loan.items_returned', 'loan.created'],
  )
  assert.deepEqual(history[0].before, returned)
  assert.deepEqual(history[0].after, renewed)
  assert.deepEqual(history[0].metadata, {
    copyId: copies[1].id,
    reason: 'Renovação Fictícia',
  })
  assert.deepEqual(history[2].after, loan)
})
