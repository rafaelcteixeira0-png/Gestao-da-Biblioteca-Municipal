import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// These credentials exist only in tests/start-server.mjs and its temporary database.
const password = 'SenhaFicticiaE2E123!'
const origin = 'http://127.0.0.1:4173'
type RecordIdentity = { id: string; version: number }
type Session = { csrfToken: string; user: { id: string; role: string } }
type Loan = {
  id: string
  status: string
  items: {
    copyId: string
    dueAt: string
    returnedAt: string | null
    renewalCount: number
  }[]
}

function futureDate(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function mutation<T>(
  page: Page,
  path: string,
  method: string,
  action: () => Promise<unknown>,
) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (result) =>
        new URL(result.url()).pathname === `/api${path}` &&
        result.request().method() === method,
    ),
    action(),
  ])
  const result = await response.json()
  expect(response.status(), JSON.stringify(result)).toBe(200)
  expect(result.error).toBeUndefined()
  return result.data as T
}

async function login(page: Page, username = 'admin-e2e') {
  await page.goto('/#atendimento')
  await page.getByLabel('Usuário', { exact: true }).fill(username)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  const session = await mutation<Session>(page, '/auth/login', 'POST', () =>
    page.getByRole('button', { name: 'Entrar', exact: true }).click(),
  )
  if (session.user.role === 'reader') {
    await expect(page.getByRole('alert')).toContainText(
      'não tem permissão para consultar os registros',
    )
  } else {
    await expect(
      page.getByRole('button', { name: 'Cadastrar leitor', exact: true }),
    ).toBeEnabled()
  }
  return session
}

async function area(page: Page, name: string) {
  const button = page
    .getByRole('navigation', { name: 'Áreas do atendimento' })
    .getByRole('button', { name, exact: true })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(button).toHaveAttribute('aria-current', 'page')
}

function mutationHeaders(session: Session) {
  return { Origin: origin, 'X-CSRF-Token': session.csrfToken }
}

test('administração cadastra, edita, empresta dois exemplares e preserva devolução parcial e renovação', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const suffix = randomUUID()
  const readerName = `Leitora Fictícia ${suffix}`
  const updatedReaderName = `Leitora Revisada ${suffix}`
  const title = `Obra Fictícia ${suffix}`
  const dueAt = futureDate(14)
  const renewedDueAt = futureDate(28)
  const session = await login(page)

  await page.getByLabel('Nome do leitor').fill(readerName)
  const reader = await mutation<RecordIdentity>(page, '/readers', 'POST', () =>
    page.getByRole('button', { name: 'Cadastrar leitor', exact: true }).click(),
  )
  await page.getByLabel('Buscar em leitores').fill(reader.id)
  await expect(
    page.getByRole('row').filter({ hasText: reader.id }),
  ).toContainText(readerName)
  await page
    .getByRole('button', { name: `Editar leitor ${readerName}` })
    .click()
  await page.getByLabel('Nome do leitor').fill(updatedReaderName)
  const editedReader = await mutation<RecordIdentity>(
    page,
    `/readers/${reader.id}`,
    'PATCH',
    () =>
      page.getByRole('button', { name: 'Salvar leitor', exact: true }).click(),
  )
  expect(editedReader.version).toBe(reader.version + 1)
  await expect(
    page.getByRole('row').filter({ hasText: reader.id }),
  ).toContainText(updatedReaderName)

  await area(page, 'Obras')
  await page.getByLabel('Título da obra').fill(title)
  await page.getByLabel('Autor (opcional)').fill('Autora Fictícia')
  const work = await mutation<RecordIdentity>(page, '/works', 'POST', () =>
    page.getByRole('button', { name: 'Cadastrar obra', exact: true }).click(),
  )
  await page.getByLabel('Buscar em obras').fill(work.id)
  await expect(
    page.getByRole('row').filter({ hasText: work.id }),
  ).toContainText(title)
  await page.getByRole('button', { name: `Editar obra ${title}` }).click()
  await page.getByLabel('Edição (opcional)').fill('2ª edição fictícia')
  await mutation<RecordIdentity>(page, `/works/${work.id}`, 'PATCH', () =>
    page.getByRole('button', { name: 'Salvar obra', exact: true }).click(),
  )
  await expect(
    page.getByRole('row').filter({ hasText: work.id }),
  ).toContainText('2ª edição fictícia')

  await area(page, 'Exemplares')
  const copies: RecordIdentity[] = []
  for (let index = 1; index <= 2; index += 1) {
    await page.getByLabel('Obra do exemplar').selectOption(work.id)
    await page.getByLabel('Tombo oficial (opcional)').fill('')
    await page
      .getByLabel('Localização / estante')
      .fill(`Estante fictícia ${index}`)
    copies.push(
      await mutation<RecordIdentity>(page, '/copies', 'POST', () =>
        page
          .getByRole('button', { name: 'Cadastrar exemplar', exact: true })
          .click(),
      ),
    )
    await expect(
      page.getByRole('button', { name: 'Cadastrar exemplar', exact: true }),
    ).toBeEnabled()
  }
  expect(copies[0].id).not.toBe(copies[1].id)
  await page.getByLabel('Buscar em exemplares').fill(title)
  const copiesTable = page.getByRole('region', { name: 'Tabela de exemplares' })
  await expect(copiesTable.getByRole('row')).toHaveCount(3)
  for (const copy of copies) {
    await expect(
      copiesTable.getByRole('row').filter({ hasText: copy.id }),
    ).toContainText('Sem tombo oficial')
  }
  await page
    .getByRole('button', { name: `Editar exemplar ${copies[0].id}` })
    .click()
  await page.getByLabel('Condição física').fill('Revisado para teste fictício')
  await mutation<RecordIdentity>(page, `/copies/${copies[0].id}`, 'PATCH', () =>
    page.getByRole('button', { name: 'Salvar exemplar', exact: true }).click(),
  )
  await expect(
    copiesTable.getByRole('row').filter({ hasText: copies[0].id }),
  ).toContainText('Revisado para teste fictício')

  await area(page, 'Circulação')
  await page.getByLabel('Leitor do empréstimo').selectOption(reader.id)
  await page.getByLabel('Data prevista de devolução').fill(dueAt)
  await page
    .getByLabel(
      'Buscar exemplar disponível por título, código, tombo ou estante',
    )
    .fill(title)
  const checkout = page.getByRole('region', { name: 'Registrar empréstimo' })
  for (const copy of copies) {
    await checkout.getByRole('checkbox', { name: new RegExp(copy.id) }).check()
  }
  await expect(checkout.getByText('2 exemplares selecionados')).toBeVisible()
  const loan = await mutation<Loan>(page, '/loans', 'POST', () =>
    checkout
      .getByRole('button', { name: 'Registrar empréstimo', exact: true })
      .click(),
  )
  expect(loan.items.map((item) => item.copyId).sort()).toEqual(
    copies.map((copy) => copy.id).sort(),
  )
  await page.getByLabel('Buscar em empréstimos').fill(loan.id)
  let loanRow = page.getByRole('row').filter({ hasText: loan.id })
  await expect(loanRow).toContainText('Em aberto')
  await expect(checkout.getByRole('checkbox')).toHaveCount(0)

  const unavailable = await page.request.post('/api/loans', {
    headers: mutationHeaders(session),
    data: {
      requestId: randomUUID(),
      readerId: reader.id,
      copyIds: [copies[0].id],
      dueAt,
    },
  })
  expect(unavailable.status()).toBe(409)
  expect((await unavailable.json()).error.code).toBe('COPY_UNAVAILABLE')

  await loanRow.locator('summary').click()
  await loanRow
    .getByRole('checkbox', { name: new RegExp(copies[0].id) })
    .check()
  const returned = await mutation<Loan>(
    page,
    `/loans/${loan.id}/return`,
    'POST',
    () =>
      loanRow.getByRole('button', { name: 'Devolver selecionados' }).click(),
  )
  expect(returned.status).toBe('partial')
  expect(
    returned.items.find((item) => item.copyId === copies[0].id)?.returnedAt,
  ).toBeTruthy()
  await expect(loanRow).toContainText('Devolução parcial')
  await expect(
    loanRow.getByRole('region', { name: `Exemplar ${copies[0].id}` }),
  ).toContainText('Devolvido em')

  const remaining = loanRow.getByRole('region', {
    name: `Exemplar ${copies[1].id}`,
  })
  await remaining
    .getByLabel(`Novo prazo do exemplar ${copies[1].id}`)
    .fill(renewedDueAt)
  await remaining
    .getByLabel(`Motivo da renovação do exemplar ${copies[1].id}`)
    .fill('Prorrogação fictícia solicitada no teste')
  const renewed = await mutation<Loan>(
    page,
    `/loans/${loan.id}/items/${copies[1].id}/renew`,
    'POST',
    () => remaining.getByRole('button', { name: 'Renovar exemplar' }).click(),
  )
  expect(
    renewed.items.find((item) => item.copyId === copies[1].id)?.dueAt,
  ).toBe(renewedDueAt)
  await expect(remaining).toContainText('Renovações: 1')

  await page.reload()
  await area(page, 'Circulação')
  await page.getByLabel('Buscar em empréstimos').fill(loan.id)
  loanRow = page.getByRole('row').filter({ hasText: loan.id })
  await expect(loanRow).toContainText('Devolução parcial')
  await loanRow.locator('summary').click()
  await expect(
    loanRow.getByRole('region', { name: `Exemplar ${copies[0].id}` }),
  ).toContainText('Devolvido em')
  await expect(
    loanRow.getByRole('region', { name: `Exemplar ${copies[1].id}` }),
  ).toContainText('Renovações: 1')

  await area(page, 'Exemplares')
  await page.getByLabel('Buscar em exemplares').fill(title)
  await expect(
    page.getByRole('row').filter({ hasText: copies[0].id }),
  ).toContainText('Disponível')
  await expect(
    page.getByRole('row').filter({ hasText: copies[1].id }),
  ).toContainText('Emprestado')

  await area(page, 'Histórico')
  await page.getByLabel('Buscar em histórico').fill(loan.id)
  const history = page.getByRole('region', { name: 'Tabela de histórico' })
  for (const event of [
    'Empréstimo registrado',
    'Devolução registrada',
    'Exemplar renovado',
  ]) {
    await expect(history.getByText(event, { exact: true })).toHaveCount(1)
  }
  const renewedEvent = history
    .getByRole('row')
    .filter({ hasText: 'Exemplar renovado' })
  await renewedEvent.locator('summary').click()
  await expect(renewedEvent.locator('pre').nth(0)).toContainText(dueAt)
  await expect(renewedEvent.locator('pre').nth(1)).toContainText(renewedDueAt)
  await page.getByLabel('Buscar em histórico').fill(reader.id)
  await expect(
    history.getByText('Leitor cadastrado', { exact: true }),
  ).toHaveCount(1)
  await expect(
    history.getByText('Leitor alterado', { exact: true }),
  ).toHaveCount(1)
})

test('perfil de leitor recebe negação na interface e no servidor', async ({
  page,
}) => {
  const session = await login(page, 'leitor-e2e')
  await expect(
    page.getByRole('navigation', { name: 'Áreas do atendimento' }),
  ).toHaveCount(0)
  await expect(page.getByLabel('Nome do leitor')).toHaveCount(0)
  for (const path of [
    '/readers',
    '/works',
    '/copies',
    '/loans',
    '/history',
    '/users',
  ]) {
    const response = await page.request.get(`/api${path}`)
    expect(response.status()).toBe(403)
    expect((await response.json()).error.code).toBe('ACCESS_DENIED')
  }
  const response = await page.request.post('/api/readers', {
    headers: mutationHeaders(session),
    data: { name: `Cadastro Negado ${randomUUID()}` },
  })
  expect(response.status()).toBe(403)
  expect((await response.json()).error.code).toBe('ACCESS_DENIED')
})

test('atendente cadastra leitor e não administra contas', async ({ page }) => {
  const session = await login(page, 'equipe-e2e')
  await expect(
    page
      .getByRole('navigation', { name: 'Áreas do atendimento' })
      .getByRole('button', { name: 'Contas', exact: true }),
  ).toHaveCount(0)
  const name = `Leitor Fictício da Equipe ${randomUUID()}`
  await page.getByLabel('Nome do leitor').fill(name)
  const reader = await mutation<RecordIdentity>(page, '/readers', 'POST', () =>
    page.getByRole('button', { name: 'Cadastrar leitor', exact: true }).click(),
  )
  await page.getByLabel('Buscar em leitores').fill(reader.id)
  await expect(
    page.getByRole('row').filter({ hasText: reader.id }),
  ).toContainText(name)
  const listing = await page.request.get('/api/users')
  expect(listing.status()).toBe(403)
  const creating = await page.request.post('/api/users', {
    headers: mutationHeaders(session),
    data: {
      username: `negado-${randomUUID()}`,
      name: 'Conta Fictícia Negada',
      role: 'admin',
      password,
    },
  })
  expect(creating.status()).toBe(403)
  expect((await creating.json()).error.code).toBe('ACCESS_DENIED')
})

test('servidor rejeita cadastro inválido e edição desatualizada sem apagar o histórico', async ({
  page,
}) => {
  const session = await login(page)
  // Raw input passes HTML minlength; trimming still leaves an invalid server value.
  await page.getByLabel('Nome do leitor').fill('  A  ')
  expect(
    await page
      .getByLabel('Nome do leitor')
      .evaluate((input) => (input as HTMLInputElement).checkValidity()),
  ).toBe(true)
  const invalidResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/readers' &&
      response.request().method() === 'POST',
  )
  await page
    .getByRole('button', { name: 'Cadastrar leitor', exact: true })
    .click()
  const invalid = await invalidResponse
  expect(invalid.status()).toBe(400)
  expect((await invalid.json()).error.code).toBe('INVALID_FIELD')
  await expect(page.getByRole('alert')).toContainText('Nome do leitor')
  await expect(
    page.getByText('Leitor cadastrado com sucesso.', { exact: true }),
  ).toHaveCount(0)

  const name = `Leitor Concorrência ${randomUUID()}`
  await page.getByLabel('Nome do leitor').fill(name)
  const reader = await mutation<RecordIdentity>(page, '/readers', 'POST', () =>
    page.getByRole('button', { name: 'Cadastrar leitor', exact: true }).click(),
  )
  await page.getByLabel('Buscar em leitores').fill(reader.id)
  await page.getByRole('button', { name: `Editar leitor ${name}` }).click()
  const updatedName = `${name} Revisado`
  await page.getByLabel('Nome do leitor').fill(updatedName)
  await mutation<RecordIdentity>(page, `/readers/${reader.id}`, 'PATCH', () =>
    page.getByRole('button', { name: 'Salvar leitor', exact: true }).click(),
  )
  await expect(
    page.getByRole('row').filter({ hasText: reader.id }),
  ).toContainText(updatedName)
  const conflict = await page.request.patch(`/api/readers/${reader.id}`, {
    headers: mutationHeaders(session),
    data: { name: 'Alteração Fictícia Desatualizada', version: reader.version },
  })
  expect(conflict.status()).toBe(409)
  expect((await conflict.json()).error.code).toBe('VERSION_CONFLICT')
  await page.reload()
  await page.getByLabel('Buscar em leitores').fill(reader.id)
  await expect(
    page.getByRole('row').filter({ hasText: reader.id }),
  ).toContainText(updatedName)
  await area(page, 'Histórico')
  await page.getByLabel('Buscar em histórico').fill(reader.id)
  const history = page.getByRole('region', { name: 'Tabela de histórico' })
  await expect(
    history.getByText('Leitor cadastrado', { exact: true }),
  ).toHaveCount(1)
  await expect(
    history.getByText('Leitor alterado', { exact: true }),
  ).toHaveCount(1)
})

test('acesso por teclado, formulários e consultas mantêm acessibilidade e largura em 320, 390 e 1440 pixels', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#atendimento')
  await expect(page.getByLabel('Usuário', { exact: true })).toBeVisible()
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `Acesso sem transbordamento em ${width}px`,
    ).toBe(true)
  }
  const loginAccessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(loginAccessibility.violations).toEqual([])
  await page.getByLabel('Usuário', { exact: true }).focus()
  await page.keyboard.type('admin-e2e')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Senha', { exact: true })).toBeFocused()
  await page.keyboard.type(password)
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Entrar', exact: true }),
  ).toBeFocused()
  await mutation<Session>(page, '/auth/login', 'POST', () =>
    page.keyboard.press('Enter'),
  )
  await expect(
    page.getByRole('button', { name: 'Cadastrar leitor', exact: true }),
  ).toBeEnabled()
  for (const name of [
    'Leitores',
    'Obras',
    'Exemplares',
    'Circulação',
    'Histórico',
    'Contas',
  ]) {
    await area(page, name)
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${name} sem transbordamento em ${width}px`,
      ).toBe(true)
      if (
        test.info().project.name === 'desktop' &&
        width !== 320 &&
        ['Leitores', 'Circulação', 'Histórico'].includes(name)
      ) {
        await page.screenshot({
          path: test.info().outputPath(`atendimento-${name}-${width}.png`),
          fullPage: true,
        })
      }
    }
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(accessibility.violations, `Acessibilidade de ${name}`).toEqual([])
  }
  await area(page, 'Leitores')
  await page.getByLabel('Nome do leitor').focus()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('checkbox', { name: 'Leitor ativo' }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Cadastrar leitor', exact: true }),
  ).toBeFocused()
  expect(errors).toEqual([])
})
