import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  PUBLIC_DEMO_PASSWORD,
  PUBLIC_DEMO_USERNAME,
} from '../src/operational/demo'

// Public examples for the browser-only demonstration, never real API accounts.
async function login(page: Page) {
  await page.goto('/#atendimento-teste')
  await expect(
    page.getByRole('heading', { name: 'Atendimento de teste', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Usuário', { exact: true }).fill(PUBLIC_DEMO_USERNAME)
  await page.getByLabel('Senha', { exact: true }).fill(PUBLIC_DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Cadastrar leitor', exact: true }),
  ).toBeEnabled()
}

async function area(page: Page, name: string) {
  const button = page
    .getByRole('navigation', { name: 'Áreas do atendimento' })
    .getByRole('button', { name, exact: true })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(button).toHaveAttribute('aria-current', 'page')
}

async function simulatedSave(page: Page, buttonName: string) {
  await page.getByRole('button', { name: buttonName, exact: true }).click()
  await expect(page.locator('.op-alert.success')).toContainText('Simulação:')
  await expect(
    page.getByRole('navigation', { name: 'Áreas do atendimento' }),
  ).toBeVisible()
}

function futureDate(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function browserStorage(page: Page) {
  return page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookies: document.cookie,
  }))
}

test('acesso público de teste rejeita senha incorreta e funciona sem API ou armazenamento persistente', async ({
  page,
}) => {
  const apiRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/'))
      apiRequests.push(request.url())
  })
  await page.route('**/api/**', (route) => route.abort())
  await page.goto('/#atendimento-teste')
  await expect(page.getByText('Demonstração · Dados temporários')).toBeVisible()
  await expect(
    page.getByText(PUBLIC_DEMO_PASSWORD, { exact: true }),
  ).toBeVisible()
  await page.getByLabel('Usuário', { exact: true }).fill(PUBLIC_DEMO_USERNAME)
  await page.getByLabel('Senha', { exact: true }).fill('ExemploIncorreto123')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(/usuário|senha/i)
  await expect(
    page.getByRole('navigation', { name: 'Áreas do atendimento' }),
  ).toHaveCount(0)

  await page.getByLabel('Senha', { exact: true }).fill(PUBLIC_DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Cadastrar leitor', exact: true }),
  ).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Trocar senha' })).toHaveCount(
    0,
  )
  await expect(
    page
      .getByRole('navigation', { name: 'Áreas do atendimento' })
      .getByRole('button', { name: 'Contas', exact: true }),
  ).toHaveCount(0)
  const readerName = `Leitor Temporário ${randomUUID()}`
  await page.getByLabel('Nome do leitor').fill(readerName)
  await simulatedSave(page, 'Cadastrar leitor')
  await expect(
    page.getByRole('row').filter({ hasText: readerName }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Entrar', exact: true }),
  ).toBeVisible()
  await expect(page.getByText(readerName, { exact: true })).toHaveCount(0)
  expect(await browserStorage(page)).toEqual({
    local: 0,
    session: 0,
    cookies: '',
  })
  expect(apiRequests).toEqual([])
})

test('cadastros temporários permitem edição, empréstimo de dois itens, devolução parcial, renovação e histórico', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const apiRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/'))
      apiRequests.push(request.url())
  })
  await page.route('**/api/**', (route) => route.abort())
  const suffix = randomUUID()
  const readerName = `Leitor Temporário ${suffix}`
  const editedName = `Leitor Revisado ${suffix}`
  const title = `Obra Temporária ${suffix}`
  await login(page)
  await page.getByLabel('Nome do leitor').fill(readerName)
  await simulatedSave(page, 'Cadastrar leitor')
  let readerRow = page.getByRole('row').filter({ hasText: readerName })
  await expect(readerRow).toBeVisible()
  const readerId = await readerRow.locator('.op-id').innerText()
  await page
    .getByRole('button', { name: `Editar leitor ${readerName}` })
    .click()
  await page.getByLabel('Nome do leitor').fill(editedName)
  await simulatedSave(page, 'Salvar leitor')
  readerRow = page.getByRole('row').filter({ hasText: readerId })
  await expect(readerRow).toContainText(editedName)

  await area(page, 'Obras')
  await page.getByLabel('Título da obra').fill(title)
  await page.getByLabel('Autor (opcional)').fill('Autoria Fictícia de Teste')
  await simulatedSave(page, 'Cadastrar obra')
  const workRow = page.getByRole('row').filter({ hasText: title })
  await expect(workRow).toBeVisible()
  const workId = await workRow.locator('.op-id').innerText()
  await page.getByRole('button', { name: `Editar obra ${title}` }).click()
  await page.getByLabel('Edição (opcional)').fill('2ª edição fictícia')
  await simulatedSave(page, 'Salvar obra')
  await expect(workRow).toContainText('2ª edição fictícia')

  await area(page, 'Exemplares')
  const copies: string[] = []
  for (let index = 1; index <= 2; index += 1) {
    const shelf = `Estante Temporária ${index} ${suffix}`
    await page.getByLabel('Obra do exemplar').selectOption(workId)
    await page.getByLabel('Localização / estante').fill(shelf)
    await simulatedSave(page, 'Cadastrar exemplar')
    const row = page.getByRole('row').filter({ hasText: shelf })
    await expect(row).toContainText('Sem tombo oficial')
    copies.push(await row.locator('.op-id').innerText())
  }
  expect(copies[0]).not.toBe(copies[1])
  await page
    .getByRole('button', { name: `Editar exemplar ${copies[0]}` })
    .click()
  await page.getByLabel('Condição física').fill('Revisado para demonstração')
  await simulatedSave(page, 'Salvar exemplar')
  await expect(
    page.getByRole('row').filter({ hasText: copies[0] }),
  ).toContainText('Revisado para demonstração')

  await area(page, 'Circulação')
  await page.getByLabel('Leitor do empréstimo').selectOption(readerId)
  await page.getByLabel('Data prevista de devolução').fill(futureDate(14))
  await page
    .getByLabel(
      'Buscar exemplar disponível por título, código, tombo ou estante',
    )
    .fill(title)
  const checkout = page.getByRole('region', { name: 'Registrar empréstimo' })
  for (const copyId of copies)
    await checkout.getByRole('checkbox', { name: new RegExp(copyId) }).check()
  await simulatedSave(page, 'Registrar empréstimo')
  const loanRow = page.getByRole('row').filter({ hasText: editedName })
  await expect(loanRow).toContainText('Em aberto')
  const loanId = await loanRow
    .locator('td')
    .first()
    .locator('.op-id')
    .innerText()
  await expect(checkout.getByRole('checkbox')).toHaveCount(0)
  await expect(
    checkout.getByRole('button', { name: 'Registrar empréstimo', exact: true }),
  ).toBeDisabled()

  await loanRow.locator('summary').click()
  await loanRow.getByRole('checkbox', { name: new RegExp(copies[0]) }).check()
  await loanRow.getByRole('button', { name: 'Devolver selecionados' }).click()
  await expect(page.locator('.op-alert.success')).toContainText('Simulação:')
  await expect(loanRow).toContainText('Devolução parcial')
  await expect(
    loanRow.getByRole('region', { name: `Exemplar ${copies[0]}` }),
  ).toContainText('Devolvido em')
  const remaining = loanRow.getByRole('region', {
    name: `Exemplar ${copies[1]}`,
  })
  await remaining
    .getByLabel(`Novo prazo do exemplar ${copies[1]}`)
    .fill(futureDate(28))
  await remaining
    .getByLabel(`Motivo da renovação do exemplar ${copies[1]}`)
    .fill('Prorrogação fictícia de demonstração')
  await remaining.getByRole('button', { name: 'Renovar exemplar' }).click()
  await expect(page.locator('.op-alert.success')).toContainText('Simulação:')
  await expect(remaining).toContainText('Renovações: 1')
  await area(page, 'Exemplares')
  await expect(
    page.getByRole('row').filter({ hasText: copies[0] }),
  ).toContainText('Disponível')
  await expect(
    page.getByRole('row').filter({ hasText: copies[1] }),
  ).toContainText('Emprestado')
  await area(page, 'Histórico')
  await page.getByLabel('Buscar em histórico').fill(loanId)
  const history = page.getByRole('region', { name: 'Tabela de histórico' })
  for (const label of [
    'Empréstimo registrado',
    'Devolução registrada',
    'Exemplar renovado',
  ])
    await expect(history.getByText(label, { exact: true })).toHaveCount(1)
  await page.getByLabel('Buscar em histórico').fill(readerId)
  await expect(
    history.getByText('Leitor cadastrado', { exact: true }),
  ).toHaveCount(1)
  await expect(
    history.getByText('Leitor alterado', { exact: true }),
  ).toHaveCount(1)
  expect(apiRequests).toEqual([])
  expect(await browserStorage(page)).toEqual({
    local: 0,
    session: 0,
    cookies: '',
  })
})

test('dados e acesso de teste são isolados entre abas e descartados ao recarregar ou sair da área', async ({
  page,
  context,
}) => {
  const name = `Leitor Efêmero ${randomUUID()}`
  await login(page)
  await page.getByLabel('Nome do leitor').fill(name)
  await simulatedSave(page, 'Cadastrar leitor')
  const secondPage = await context.newPage()
  await login(secondPage)
  await secondPage.getByLabel('Buscar em leitores').fill(name)
  await expect(
    secondPage.getByText('Nenhum registro encontrado.'),
  ).toBeVisible()
  await secondPage.close()
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible()

  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Entrar', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Senha', { exact: true }).fill(PUBLIC_DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByLabel('Buscar em leitores').fill(name)
  await expect(page.getByText('Nenhum registro encontrado.')).toBeVisible()
  await page.getByLabel('Buscar em leitores').fill('')
  await page.getByLabel('Nome do leitor').fill(name)
  await simulatedSave(page, 'Cadastrar leitor')
  await page.goto('/#dashboard')
  await expect(
    page.getByRole('heading', { name: 'Dashboard', exact: true }),
  ).toBeVisible()
  await page.goto('/#atendimento-teste')
  await expect(
    page.getByRole('button', { name: 'Entrar', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Senha', { exact: true }).fill(PUBLIC_DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByLabel('Buscar em leitores').fill(name)
  await expect(page.getByText('Nenhum registro encontrado.')).toBeVisible()
})

test('acesso de exemplo e formulários temporários mantêm acessibilidade e largura em 320, 390 e 1440 pixels', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#atendimento-teste')
  const access = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(access.violations).toEqual([])
  await page.getByLabel('Usuário', { exact: true }).focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(PUBLIC_DEMO_USERNAME)
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Senha', { exact: true })).toBeFocused()
  await page.keyboard.type(PUBLIC_DEMO_PASSWORD)
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Entrar', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('button', { name: 'Cadastrar leitor', exact: true }),
  ).toBeEnabled()
  for (const name of [
    'Leitores',
    'Obras',
    'Exemplares',
    'Circulação',
    'Histórico',
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
        name === 'Leitores' &&
        width !== 320
      ) {
        await page.screenshot({
          path: test.info().outputPath(`teste-atendimento-${width}.png`),
          fullPage: true,
        })
      }
    }
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(result.violations, `Acessibilidade de ${name}`).toEqual([])
  }
  expect(errors).toEqual([])
})
