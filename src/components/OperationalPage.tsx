import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import '../operational.css'

type Role = 'admin' | 'staff' | 'reader'
type User = {
  id: string
  username: string
  name: string
  role: Role
  active: boolean
  version: number
}
type Session = { user: User; csrfToken: string }
type Reader = { id: string; name: string; active: boolean; version: number }
type Work = {
  id: string
  title: string
  author: string
  category: string
  edition: string
  volume: string
  version: number
}
type Copy = {
  id: string
  workId: string
  accessionNumber: string | null
  shelf: string
  condition: string
  state: 'active' | 'withdrawn'
  status: 'available' | 'loaned' | 'withdrawn'
  version: number
}
type LoanItem = {
  id: string
  copyId: string
  title: string
  accessionNumber: string | null
  dueAt: string
  returnedAt: string | null
  renewalCount: number
}
type Loan = {
  id: string
  readerId: string
  readerName: string
  borrowedAt: string
  status: 'open' | 'partial' | 'returned'
  items: LoanItem[]
}
type Event = {
  id: string
  occurredAt: string
  actorId: string
  type: string
  entityId: string
  before: unknown
  after: unknown
  metadata?: unknown
}
type Records = {
  readers: Reader[]
  works: Work[]
  copies: Copy[]
  loans: Loan[]
  events: Event[]
  users: User[]
}
type Tab = 'readers' | 'works' | 'copies' | 'loans' | 'events' | 'users'
type Notice = { kind: 'error' | 'success'; text: string } | null
type Save = (
  path: string,
  body: Record<string, unknown>,
  message: string,
  method?: string,
  idempotent?: boolean,
) => Promise<boolean>
const emptyRecords: Records = {
  readers: [],
  works: [],
  copies: [],
  loans: [],
  events: [],
  users: [],
}
const tabs: { id: Tab; label: string }[] = [
  { id: 'readers', label: 'Leitores' },
  { id: 'works', label: 'Obras' },
  { id: 'copies', label: 'Exemplares' },
  { id: 'loans', label: 'Circulação' },
  { id: 'events', label: 'Histórico' },
  { id: 'users', label: 'Contas' },
]
const statusLabels: Record<string, string> = {
  available: 'Disponível',
  loaned: 'Emprestado',
  withdrawn: 'Retirado de circulação',
  open: 'Em aberto',
  partial: 'Devolução parcial',
  returned: 'Devolvido',
  admin: 'Administrador',
  staff: 'Atendente',
  reader: 'Leitor',
}
const eventLabels: Record<string, string> = {
  'reader.created': 'Leitor cadastrado',
  'reader.updated': 'Leitor alterado',
  'work.created': 'Obra cadastrada',
  'work.updated': 'Obra alterada',
  'copy.created': 'Exemplar cadastrado',
  'copy.updated': 'Exemplar alterado',
  'loan.created': 'Empréstimo registrado',
  'loan.items_returned': 'Devolução registrada',
  'loan.item_renewed': 'Exemplar renovado',
}
function label(value: string) {
  return Object.hasOwn(statusLabels, value) ? statusLabels[value] : value
}
function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}
function dateTime(value: string | null) {
  if (!value) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-')
    return `${day}/${month}/${year}`
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}
function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
function daysAfter(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
function dueDate(value: FormDataEntryValue | null) {
  return String(value ?? '')
}
function field(data: FormData, key: string) {
  return String(data.get(key) ?? '').trim()
}
class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
async function api<T>(
  path: string,
  method = 'GET',
  body?: Record<string, unknown>,
  csrfToken?: string,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(
      typeof result?.error?.message === 'string'
        ? result.error.message
        : `O servidor respondeu com o código ${response.status}.`,
      response.status,
    )
  }
  if (!result || !Object.hasOwn(result, 'data')) {
    throw new Error('O servidor não retornou uma resposta válida.')
  }
  return result.data as T
}
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Não foi possível concluir a operação. Tente novamente.'
}
function Id({ children }: { children: string }) {
  return <span className="op-id">{children}</span>
}
function Field({
  label: text,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="op-field">
      <span>{text}</span>
      {children}
    </label>
  )
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="op-panel" aria-label={title}>
      <h2 className="op-panel-title">{title}</h2>
      {children}
    </section>
  )
}
function RecordList<T extends { id: string }>({
  records,
  title,
  columns,
  searchText,
  render,
  filters,
}: {
  records: T[]
  title: string
  columns: string[]
  searchText: (record: T) => string
  render: (record: T) => ReactNode
  filters?: { value: string; label: string; accepts: (record: T) => boolean }[]
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [requestedPage, setPage] = useState(1)
  const selected = filters?.find((item) => item.value === filter)
  const filtered = records.filter(
    (record) =>
      normalize(searchText(record)).includes(normalize(query)) &&
      (!selected || selected.accepts(record)),
  )
  const pages = Math.max(1, Math.ceil(filtered.length / 10))
  const page = Math.min(requestedPage, pages)
  return (
    <>
      <div className="op-toolbar">
        <Field label={`Buscar em ${title.toLocaleLowerCase('pt-BR')}`}>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
          />
        </Field>
        {filters && (
          <Field label={`Filtrar ${title.toLocaleLowerCase('pt-BR')}`}>
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value)
                setPage(1)
              }}
            >
              <option value="all">Todos</option>
              {filters.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div
        className="op-table-wrap"
        tabIndex={0}
        role="region"
        aria-label={`Tabela de ${title.toLocaleLowerCase('pt-BR')}`}
      >
        <table className="op-table">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice((page - 1) * 10, page * 10).map((record) => (
              <tr key={record.id}>{render(record)}</tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="op-empty">
                  Nenhum registro encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="op-pagination">
        <span aria-live="polite">
          {filtered.length} registros · Página {page} de {pages}
        </span>
        <div className="op-actions">
          <button
            type="button"
            className="op-button secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <button
            type="button"
            className="op-button secondary"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </>
  )
}
function Catalogue({
  type,
  records,
  save,
  busy,
}: {
  type: 'readers' | 'works' | 'copies'
  records: Records
  save: Save
  busy: boolean
}) {
  const [editing, setEditing] = useState<Reader | Work | Copy | null>(null)
  const [formKey, setFormKey] = useState(0)
  const heading =
    type === 'readers' ? 'leitor' : type === 'works' ? 'obra' : 'exemplar'
  const title =
    type === 'readers' ? 'Leitores' : type === 'works' ? 'Obras' : 'Exemplares'
  const reader = type === 'readers' ? (editing as Reader | null) : null
  const work = type === 'works' ? (editing as Work | null) : null
  const copy = type === 'copies' ? (editing as Copy | null) : null
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const body: Record<string, unknown> =
      type === 'readers'
        ? { name: field(data, 'name'), active: data.has('active') }
        : type === 'works'
          ? {
              title: field(data, 'title'),
              author: field(data, 'author'),
              category: field(data, 'category'),
              edition: field(data, 'edition'),
              volume: field(data, 'volume'),
            }
          : {
              workId: field(data, 'workId'),
              accessionNumber: field(data, 'accessionNumber') || null,
              shelf: field(data, 'shelf'),
              condition: field(data, 'condition'),
              state: field(data, 'state'),
            }
    if (editing) body.version = editing.version
    const success = await save(
      `/${type}${editing ? `/${encodeURIComponent(editing.id)}` : ''}`,
      body,
      `${heading.charAt(0).toUpperCase() + heading.slice(1)} ${editing ? 'alterado' : 'cadastrado'} com sucesso.`,
      editing ? 'PATCH' : 'POST',
    )
    if (success) {
      setEditing(null)
      setFormKey((value) => value + 1)
    }
  }
  function edit(record: Reader | Work | Copy) {
    setEditing(record)
    setFormKey((value) => value + 1)
    requestAnimationFrame(() => {
      document
        .getElementById(`op-form-${type}`)
        ?.scrollIntoView({ block: 'start' })
      document
        .querySelector<HTMLInputElement>(`#op-form-${type} input`)
        ?.focus()
    })
  }
  return (
    <>
      <Panel title={editing ? `Editar ${heading}` : `Cadastrar ${heading}`}>
        {editing && (
          <p className="op-note">
            Identificador: <Id>{editing.id}</Id> · Versão {editing.version}
          </p>
        )}
        <form
          key={`${formKey}-${editing?.id ?? 'new'}`}
          id={`op-form-${type}`}
          className="op-form"
          onSubmit={submit}
        >
          <fieldset disabled={busy}>
            {type === 'readers' && (
              <>
                <Field label="Nome do leitor">
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={200}
                    defaultValue={reader?.name}
                  />
                </Field>
                <label className="op-selection">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={reader?.active ?? true}
                  />
                  <span>Leitor ativo</span>
                </label>
              </>
            )}
            {type === 'works' && (
              <>
                <Field label="Título da obra">
                  <input
                    name="title"
                    required
                    maxLength={300}
                    defaultValue={work?.title}
                  />
                </Field>
                <Field label="Autor (opcional)">
                  <input
                    name="author"
                    maxLength={200}
                    defaultValue={work?.author}
                  />
                </Field>
                <Field label="Categoria (opcional)">
                  <input
                    name="category"
                    maxLength={100}
                    defaultValue={work?.category}
                  />
                </Field>
                <Field label="Edição (opcional)">
                  <input
                    name="edition"
                    maxLength={100}
                    defaultValue={work?.edition}
                  />
                </Field>
                <Field label="Volume (opcional)">
                  <input
                    name="volume"
                    maxLength={100}
                    defaultValue={work?.volume}
                  />
                </Field>
              </>
            )}
            {type === 'copies' && (
              <>
                <Field label="Obra do exemplar">
                  <select
                    name="workId"
                    required
                    defaultValue={copy?.workId ?? ''}
                  >
                    <option value="">Selecione uma obra</option>
                    {records.works.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.title} · {item.id}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Tombo oficial (opcional)">
                  <input
                    name="accessionNumber"
                    maxLength={100}
                    defaultValue={copy?.accessionNumber ?? ''}
                  />
                </Field>
                <Field label="Localização / estante">
                  <input
                    name="shelf"
                    maxLength={160}
                    defaultValue={copy?.shelf}
                  />
                </Field>
                <Field label="Condição física">
                  <input
                    name="condition"
                    maxLength={160}
                    defaultValue={copy?.condition ?? 'Bom'}
                  />
                </Field>
                <Field label="Estado do exemplar">
                  <select name="state" defaultValue={copy?.state ?? 'active'}>
                    <option value="active">Em circulação</option>
                    <option value="withdrawn">Retirado de circulação</option>
                  </select>
                </Field>
                <p className="op-note">
                  O identificador interno é gerado pelo sistema. Preencha o
                  tombo somente quando existir um número oficial definido pela
                  biblioteca.
                </p>
              </>
            )}
            <div className="op-actions">
              <button className="op-button" type="submit">
                {editing ? `Salvar ${heading}` : `Cadastrar ${heading}`}
              </button>
              {editing && (
                <button
                  className="op-button secondary"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  Cancelar edição
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </Panel>
      <Panel title={title}>
        {type === 'readers' && (
          <RecordList
            title="Leitores"
            records={records.readers}
            columns={['Leitor', 'Identificador', 'Situação', 'Ações']}
            searchText={(item) => `${item.name} ${item.id}`}
            filters={[
              {
                value: 'active',
                label: 'Ativos',
                accepts: (item) => item.active,
              },
              {
                value: 'inactive',
                label: 'Inativos',
                accepts: (item) => !item.active,
              },
            ]}
            render={(item) => (
              <>
                <td>{item.name}</td>
                <td>
                  <Id>{item.id}</Id>
                </td>
                <td>{item.active ? 'Ativo' : 'Inativo'}</td>
                <td>
                  <button
                    type="button"
                    className="op-button secondary"
                    disabled={busy}
                    onClick={() => edit(item)}
                    aria-label={`Editar leitor ${item.name}`}
                  >
                    Editar
                  </button>
                </td>
              </>
            )}
          />
        )}
        {type === 'works' && (
          <RecordList
            title="Obras"
            records={records.works}
            columns={[
              'Obra',
              'Autor',
              'Edição / volume',
              'Identificador',
              'Ações',
            ]}
            searchText={(item) =>
              `${item.title} ${item.author} ${item.category} ${item.id}`
            }
            render={(item) => (
              <>
                <td>
                  {item.title}
                  <small>{item.category || 'Sem categoria'}</small>
                </td>
                <td>{item.author || 'Não informado'}</td>
                <td>
                  {item.edition || '—'} / {item.volume || '—'}
                </td>
                <td>
                  <Id>{item.id}</Id>
                </td>
                <td>
                  <button
                    type="button"
                    className="op-button secondary"
                    disabled={busy}
                    onClick={() => edit(item)}
                    aria-label={`Editar obra ${item.title}`}
                  >
                    Editar
                  </button>
                </td>
              </>
            )}
          />
        )}
        {type === 'copies' && (
          <RecordList
            title="Exemplares"
            records={records.copies}
            columns={[
              'Obra',
              'Tombo / identificador',
              'Localização',
              'Condição',
              'Situação',
              'Ações',
            ]}
            searchText={(item) =>
              `${records.works.find((entry) => entry.id === item.workId)?.title ?? ''} ${item.id} ${item.accessionNumber ?? ''} ${item.shelf}`
            }
            filters={['available', 'loaned', 'withdrawn'].map((status) => ({
              value: status,
              label: label(status),
              accepts: (item: Copy) => item.status === status,
            }))}
            render={(item) => (
              <>
                <td>
                  {records.works.find((entry) => entry.id === item.workId)
                    ?.title ?? item.workId}
                </td>
                <td>
                  {item.accessionNumber ?? 'Sem tombo oficial'}
                  <small>
                    <Id>{item.id}</Id>
                  </small>
                </td>
                <td>{item.shelf || 'Não informada'}</td>
                <td>{item.condition || 'Não informada'}</td>
                <td>
                  <span className="op-badge">{label(item.status)}</span>
                </td>
                <td>
                  <button
                    type="button"
                    className="op-button secondary"
                    disabled={busy}
                    onClick={() => edit(item)}
                    aria-label={`Editar exemplar ${item.accessionNumber ?? item.id}`}
                  >
                    Editar
                  </button>
                </td>
              </>
            )}
          />
        )}
      </Panel>
    </>
  )
}
function LoanActions({
  loan,
  save,
  busy,
}: {
  loan: Loan
  save: Save
  busy: boolean
}) {
  const [selected, setSelected] = useState<string[]>([])
  const unreturned = loan.items.filter((item) => !item.returnedAt)
  async function returnItems(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected.length) return
    if (
      await save(
        `/loans/${encodeURIComponent(loan.id)}/return`,
        { copyIds: selected },
        'Devolução registrada com sucesso.',
        'POST',
        true,
      )
    )
      setSelected([])
  }
  return (
    <details className="op-details">
      <summary>
        Itens e atendimento do empréstimo <Id>{loan.id}</Id>
      </summary>
      <form className="op-form" onSubmit={returnItems}>
        <fieldset disabled={busy}>
          <legend>Selecione os exemplares que estão sendo devolvidos</legend>
          {unreturned.map((item) => (
            <label key={item.copyId} className="op-selection">
              <input
                type="checkbox"
                value={item.copyId}
                checked={selected.includes(item.copyId)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, item.copyId]
                      : current.filter((id) => id !== item.copyId),
                  )
                }
              />
              <span>
                {item.title} · {item.accessionNumber ?? 'Sem tombo oficial'}
                <small>
                  <Id>{item.copyId}</Id>
                </small>
              </span>
            </label>
          ))}
          {unreturned.length === 0 && (
            <p>Todos os exemplares foram devolvidos.</p>
          )}
          {unreturned.length > 0 && (
            <button
              className="op-button"
              type="submit"
              disabled={!selected.length}
            >
              Devolver selecionados
            </button>
          )}
        </fieldset>
      </form>
      {loan.items.map((item) => (
        <section
          className="op-card"
          key={item.copyId}
          aria-label={`Exemplar ${item.copyId}`}
        >
          <h3>{item.title}</h3>
          <p>
            Tombo: {item.accessionNumber ?? 'não informado'} ·{' '}
            <Id>{item.copyId}</Id>
          </p>
          <p>
            Prazo: {dateTime(item.dueAt)} · Renovações: {item.renewalCount}
          </p>
          {item.returnedAt ? (
            <p>Devolvido em {dateTime(item.returnedAt)}</p>
          ) : (
            <form
              className="op-form"
              onSubmit={async (event) => {
                event.preventDefault()
                const form = event.currentTarget
                const data = new FormData(form)
                if (
                  await save(
                    `/loans/${encodeURIComponent(loan.id)}/items/${encodeURIComponent(item.copyId)}/renew`,
                    {
                      dueAt: dueDate(data.get('dueAt')),
                      reason: field(data, 'reason'),
                    },
                    'Renovação registrada com sucesso.',
                    'POST',
                    true,
                  )
                )
                  form.reset()
              }}
            >
              <fieldset disabled={busy}>
                <Field
                  label={`Novo prazo do exemplar ${item.accessionNumber ?? item.copyId}`}
                >
                  <input
                    name="dueAt"
                    type="date"
                    required
                    min={
                      todayLocal() > daysAfter(item.dueAt, 1)
                        ? todayLocal()
                        : daysAfter(item.dueAt, 1)
                    }
                  />
                </Field>
                <Field
                  label={`Motivo da renovação do exemplar ${item.accessionNumber ?? item.copyId}`}
                >
                  <input name="reason" required minLength={3} maxLength={500} />
                </Field>
                <button className="op-button secondary" type="submit">
                  Renovar exemplar
                </button>
              </fieldset>
            </form>
          )}
        </section>
      ))}
    </details>
  )
}
function Circulation({
  records,
  save,
  busy,
}: {
  records: Records
  save: Save
  busy: boolean
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [copyPage, setCopyPage] = useState(1)
  const available = records.copies.filter((copy) => copy.status === 'available')
  const filtered = available.filter((copy) =>
    normalize(
      `${copy.id} ${copy.accessionNumber ?? ''} ${copy.shelf} ${records.works.find((work) => work.id === copy.workId)?.title ?? ''}`,
    ).includes(normalize(query)),
  )
  const pages = Math.max(1, Math.ceil(filtered.length / 10))
  const page = Math.min(copyPage, pages)
  const selectedAvailable = selected.filter((id) =>
    available.some((copy) => copy.id === id),
  )
  async function createLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedAvailable.length) return
    const form = event.currentTarget
    const data = new FormData(form)
    if (
      await save(
        '/loans',
        {
          readerId: field(data, 'readerId'),
          copyIds: selectedAvailable,
          dueAt: dueDate(data.get('dueAt')),
        },
        'Empréstimo registrado com sucesso.',
        'POST',
        true,
      )
    ) {
      setSelected([])
      form.reset()
    }
  }
  return (
    <>
      <Panel title="Registrar empréstimo">
        <form className="op-form" onSubmit={createLoan}>
          <fieldset disabled={busy}>
            <Field label="Leitor do empréstimo">
              <select name="readerId" required defaultValue="">
                <option value="">Selecione um leitor ativo</option>
                {records.readers
                  .filter((reader) => reader.active)
                  .map((reader) => (
                    <option key={reader.id} value={reader.id}>
                      {reader.name} · {reader.id}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Data prevista de devolução">
              <input type="date" name="dueAt" required min={todayLocal()} />
            </Field>
            <Field label="Buscar exemplar disponível por título, código, tombo ou estante">
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setCopyPage(1)
                }}
              />
            </Field>
            <div className="op-copy-options">
              {filtered.slice((page - 1) * 10, page * 10).map((copy) => (
                <label className="op-selection" key={copy.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(copy.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, copy.id]
                          : current.filter((id) => id !== copy.id),
                      )
                    }
                  />
                  <span>
                    {records.works.find((work) => work.id === copy.workId)
                      ?.title ?? copy.workId}{' '}
                    · {copy.accessionNumber ?? 'Sem tombo oficial'} ·{' '}
                    {copy.shelf || 'Sem estante'}
                    <small>
                      <Id>{copy.id}</Id>
                    </small>
                  </span>
                </label>
              ))}
              {filtered.length === 0 && (
                <p className="op-empty">
                  Nenhum exemplar disponível encontrado.
                </p>
              )}
            </div>
            <div className="op-pagination">
              <span>
                {filtered.length} disponíveis · Página {page} de {pages}
              </span>
              <div className="op-actions">
                <button
                  type="button"
                  className="op-button secondary"
                  disabled={page <= 1}
                  onClick={() => setCopyPage(page - 1)}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="op-button secondary"
                  disabled={page >= pages}
                  onClick={() => setCopyPage(page + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
            <div className="op-selected" aria-live="polite">
              <strong>
                {selectedAvailable.length} exemplares selecionados
              </strong>
              {selectedAvailable.map((id) => (
                <p key={id}>
                  <Id>{id}</Id>{' '}
                  <button
                    type="button"
                    className="op-button secondary"
                    onClick={() =>
                      setSelected((current) =>
                        current.filter((item) => item !== id),
                      )
                    }
                    aria-label={`Remover exemplar ${id}`}
                  >
                    Remover
                  </button>
                </p>
              ))}
            </div>
            <button
              className="op-button"
              type="submit"
              disabled={!selectedAvailable.length}
            >
              Registrar empréstimo
            </button>
          </fieldset>
        </form>
      </Panel>
      <Panel title="Empréstimos e devoluções">
        <RecordList
          title="Empréstimos"
          records={records.loans}
          columns={[
            'Leitor / identificação',
            'Retirada',
            'Situação',
            'Exemplares e ações',
          ]}
          searchText={(loan) =>
            `${loan.readerName} ${loan.readerId} ${loan.id} ${loan.items.map((item) => `${item.title} ${item.copyId} ${item.accessionNumber ?? ''}`).join(' ')}`
          }
          filters={['open', 'partial', 'returned'].map((status) => ({
            value: status,
            label: label(status),
            accepts: (loan: Loan) => loan.status === status,
          }))}
          render={(loan) => (
            <>
              <td>
                {loan.readerName}
                <small>
                  <Id>{loan.id}</Id>
                </small>
              </td>
              <td>{dateTime(loan.borrowedAt)}</td>
              <td>
                <span className="op-badge">{label(loan.status)}</span>
              </td>
              <td>
                <LoanActions loan={loan} save={save} busy={busy} />
              </td>
            </>
          )}
        />
      </Panel>
    </>
  )
}
function History({ events }: { events: Event[] }) {
  return (
    <Panel title="Histórico de alterações e circulação">
      <p className="op-note">
        Os eventos preservam os valores anteriores, os valores gravados e a
        conta responsável.
      </p>
      <RecordList
        title="Histórico"
        records={events}
        columns={[
          'Data',
          'Movimentação',
          'Responsável',
          'Registro',
          'Detalhes',
        ]}
        searchText={(event) =>
          `${event.id} ${event.type} ${Object.hasOwn(eventLabels, event.type) ? eventLabels[event.type] : ''} ${event.actorId} ${event.entityId} ${JSON.stringify(event.before)} ${JSON.stringify(event.after)} ${JSON.stringify(event.metadata)}`
        }
        render={(event) => (
          <>
            <td>{dateTime(event.occurredAt)}</td>
            <td>
              {Object.hasOwn(eventLabels, event.type)
                ? eventLabels[event.type]
                : event.type}
            </td>
            <td>
              <Id>{event.actorId}</Id>
            </td>
            <td>
              <Id>{event.entityId}</Id>
            </td>
            <td>
              <details className="op-details">
                <summary>
                  Ver evento <Id>{event.id}</Id>
                </summary>
                <h3>Antes</h3>
                <pre className="op-json">
                  {JSON.stringify(event.before, null, 2) ??
                    'Sem valor anterior'}
                </pre>
                <h3>Depois</h3>
                <pre className="op-json">
                  {JSON.stringify(event.after, null, 2) ??
                    'Sem valor posterior'}
                </pre>
                <h3>Dados da movimentação</h3>
                <pre className="op-json">
                  {JSON.stringify(event.metadata, null, 2) ??
                    'Sem dados adicionais'}
                </pre>
              </details>
            </td>
          </>
        )}
      />
    </Panel>
  )
}
function Accounts({
  users,
  save,
  busy,
}: {
  users: User[]
  save: Save
  busy: boolean
}) {
  const [editing, setEditing] = useState<User | null>(null)
  const [formKey, setFormKey] = useState(0)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const body: Record<string, unknown> = {
      username: field(data, 'username'),
      name: field(data, 'name'),
      role: field(data, 'role'),
      active: data.has('active'),
    }
    if (editing) body.version = editing.version
    else body.password = String(data.get('password') ?? '')
    if (
      await save(
        `/users${editing ? `/${encodeURIComponent(editing.id)}` : ''}`,
        body,
        editing ? 'Conta alterada com sucesso.' : 'Conta criada com sucesso.',
        editing ? 'PATCH' : 'POST',
      )
    ) {
      setEditing(null)
      setFormKey((current) => current + 1)
    }
  }
  return (
    <>
      <Panel title={editing ? 'Editar conta' : 'Criar conta'}>
        <form
          className="op-form"
          key={`${formKey}-${editing?.id ?? 'new'}`}
          onSubmit={submit}
        >
          <fieldset disabled={busy}>
            <Field label="Nome da pessoa">
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={editing?.name}
              />
            </Field>
            <Field label="Usuário da conta">
              <input
                name="username"
                required
                minLength={3}
                maxLength={64}
                pattern={'[a-zA-Z0-9][a-zA-Z0-9._\\-]{2,63}'}
                title="Use de 3 a 64 letras, números, ponto, hífen ou sublinhado; comece por letra ou número."
                autoComplete="off"
                autoCapitalize="none"
                defaultValue={editing?.username}
              />
            </Field>
            {!editing && (
              <Field label="Senha inicial">
                <input
                  type="password"
                  name="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </Field>
            )}
            <Field label="Perfil de acesso">
              <select name="role" defaultValue={editing?.role ?? 'staff'}>
                <option value="staff">Atendente</option>
                <option value="admin">Administrador</option>
                <option value="reader">
                  Leitor (sem acesso ao atendimento)
                </option>
              </select>
            </Field>
            <label className="op-selection">
              <input
                type="checkbox"
                name="active"
                defaultChecked={editing?.active ?? true}
              />
              <span>Conta ativa</span>
            </label>
            <div className="op-actions">
              <button className="op-button" type="submit">
                {editing ? 'Salvar conta' : 'Criar conta'}
              </button>
              {editing && (
                <button
                  className="op-button secondary"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  Cancelar edição
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </Panel>
      <Panel title="Contas e sessões">
        <RecordList
          title="Contas"
          records={users}
          columns={[
            'Nome / usuário',
            'Perfil',
            'Situação',
            'Identificador',
            'Administração',
          ]}
          searchText={(user) =>
            `${user.name} ${user.username} ${user.id} ${label(user.role)}`
          }
          render={(user) => (
            <>
              <td>
                {user.name}
                <small>{user.username}</small>
              </td>
              <td>{label(user.role)}</td>
              <td>{user.active ? 'Ativa' : 'Inativa'}</td>
              <td>
                <Id>{user.id}</Id>
              </td>
              <td>
                <div className="op-actions">
                  <button
                    className="op-button secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(user)
                      setFormKey((value) => value + 1)
                      requestAnimationFrame(() =>
                        document
                          .querySelector<HTMLInputElement>('input[name="name"]')
                          ?.focus(),
                      )
                    }}
                    aria-label={`Editar conta ${user.username}`}
                  >
                    Editar
                  </button>
                  <button
                    className="op-button secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void save(
                        `/users/${encodeURIComponent(user.id)}/revoke`,
                        {},
                        'Sessões da conta revogadas com sucesso.',
                      )
                    }}
                    aria-label={`Revogar sessões de ${user.username}`}
                  >
                    Revogar sessões
                  </button>
                </div>
                <details className="op-details">
                  <summary>Redefinir senha de {user.username}</summary>
                  <form
                    className="op-form"
                    onSubmit={async (event) => {
                      event.preventDefault()
                      const form = event.currentTarget
                      const data = new FormData(form)
                      if (
                        await save(
                          `/users/${encodeURIComponent(user.id)}/reset-password`,
                          { password: String(data.get('password') ?? '') },
                          'Senha redefinida e sessões revogadas com sucesso.',
                        )
                      )
                        form.reset()
                    }}
                  >
                    <fieldset disabled={busy}>
                      <Field label={`Nova senha de ${user.username}`}>
                        <input
                          type="password"
                          name="password"
                          required
                          minLength={12}
                          maxLength={128}
                          autoComplete="new-password"
                        />
                      </Field>
                      <button className="op-button danger" type="submit">
                        Redefinir senha
                      </button>
                    </fieldset>
                  </form>
                </details>
              </td>
            </>
          )}
        />
      </Panel>
    </>
  )
}
export function OperationalPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [checkedSession, setCheckedSession] = useState(false)
  const [records, setRecords] = useState<Records>(emptyRecords)
  const [tab, setTab] = useState<Tab>('readers')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [showPassword, setShowPassword] = useState(false)
  const pendingRequests = useRef(new Map<string, string>())
  const sessionEpoch = useRef(0)
  const expire = useCallback(() => {
    sessionEpoch.current += 1
    setSession(null)
    setRecords(emptyRecords)
    setShowPassword(false)
    pendingRequests.current.clear()
  }, [])
  const reload = useCallback(async (current: Session) => {
    if (current.user.role === 'reader') return
    const epoch = sessionEpoch.current
    const [readers, works, copies, loans, events, users] = await Promise.all([
      api<Reader[]>('/readers'),
      api<Work[]>('/works'),
      api<Copy[]>('/copies'),
      api<Loan[]>('/loans'),
      api<Event[]>('/history'),
      current.user.role === 'admin'
        ? api<User[]>('/users')
        : Promise.resolve([]),
    ])
    if (epoch === sessionEpoch.current)
      setRecords({ readers, works, copies, loans, events, users })
  }, [])
  useEffect(() => {
    let alive = true
    void api<Session>('/auth/session')
      .then(async (current) => {
        if (!alive) return
        setSession(current)
        await reload(current)
      })
      .catch((error: unknown) => {
        if (!alive) return
        if (error instanceof ApiError && error.status === 401) expire()
        else setNotice({ kind: 'error', text: errorText(error) })
      })
      .finally(() => {
        if (alive) setCheckedSession(true)
      })
    return () => {
      alive = false
    }
  }, [expire, reload])
  const save: Save = async (
    path,
    body,
    message,
    method = 'POST',
    idempotent = false,
  ) => {
    if (!session || busy) return false
    setBusy(true)
    setNotice(null)
    const fingerprint = `${path}:${JSON.stringify(body)}`
    let requestId: string | undefined
    if (idempotent) {
      requestId =
        pendingRequests.current.get(fingerprint) ?? crypto.randomUUID()
      pendingRequests.current.set(fingerprint, requestId)
    }
    try {
      await api(
        path,
        method,
        requestId ? { ...body, requestId } : body,
        session.csrfToken,
      )
      pendingRequests.current.delete(fingerprint)
      setNotice({ kind: 'success', text: message })
      try {
        await reload(session)
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          expire()
          setNotice({
            kind: 'success',
            text: `${message} Entre novamente para continuar.`,
          })
        } else
          setNotice({
            kind: 'error',
            text: `${message} A atualização da lista falhou: ${errorText(error)} Use Atualizar dados antes de continuar.`,
          })
      }
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire()
      setNotice({
        kind: 'error',
        text: `${errorText(error)}${error instanceof ApiError ? '' : ' A resposta não confirmou a gravação. Em circulação, repetir os mesmos dados preserva o identificador da solicitação.'}`,
      })
      return false
    } finally {
      setBusy(false)
    }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true)
    setNotice(null)
    try {
      const current = await api<Session>('/auth/login', 'POST', {
        username: field(data, 'username'),
        password: String(data.get('password') ?? ''),
      })
      sessionEpoch.current += 1
      setSession(current)
      setTab('readers')
      form.reset()
      await reload(current)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire()
      setNotice({ kind: 'error', text: errorText(error) })
    } finally {
      setBusy(false)
    }
  }
  async function logout() {
    if (!session) return
    setBusy(true)
    setNotice(null)
    try {
      await api('/auth/logout', 'POST', {}, session.csrfToken)
      expire()
      setNotice({ kind: 'success', text: 'Sessão encerrada.' })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire()
      setNotice({ kind: 'error', text: errorText(error) })
    } finally {
      setBusy(false)
    }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session) return
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true)
    setNotice(null)
    try {
      await api(
        '/auth/password',
        'POST',
        {
          currentPassword: String(data.get('currentPassword') ?? ''),
          newPassword: String(data.get('newPassword') ?? ''),
        },
        session.csrfToken,
      )
      form.reset()
      expire()
      setNotice({
        kind: 'success',
        text: 'Senha alterada e sessões encerradas. Entre novamente com a nova senha.',
      })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expire()
      setNotice({ kind: 'error', text: errorText(error) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="operational-page" id="conteudo-principal">
      <header className="op-header">
        <div className="op-heading">
          <p>Biblioteca Pública Municipal de Cianorte</p>
          <h1>Atendimento local</h1>
          <p className="op-environment">
            Dados fictícios persistidos · Ambiente de desenvolvimento
          </p>
        </div>
        <a className="op-button secondary" href="#dashboard">
          Abrir demonstração
        </a>
      </header>
      <p className="op-note">
        Cadastros e operações desta área são gravados no banco local. Utilize
        somente dados fictícios. O ambiente depende do servidor operacional em
        execução.
      </p>
      {notice && (
        <div
          className={`op-alert ${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </div>
      )}
      {!checkedSession && <p role="status">Verificando sessão…</p>}
      {checkedSession && !session && (
        <section className="op-login" aria-label="Acesso ao atendimento">
          <h2>Entrar no atendimento</h2>
          <p>
            Use a conta criada na configuração local. Não existe senha padrão.
          </p>
          <form className="op-form" onSubmit={login}>
            <fieldset disabled={busy}>
              <Field label="Usuário">
                <input
                  name="username"
                  required
                  autoComplete="username"
                  maxLength={80}
                />
              </Field>
              <Field label="Senha">
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  maxLength={128}
                />
              </Field>
              <button className="op-button" type="submit">
                {busy ? 'Entrando…' : 'Entrar'}
              </button>
            </fieldset>
          </form>
        </section>
      )}
      {session && (
        <>
          <div className="op-session">
            <p>
              <strong>{session.user.name}</strong> · {label(session.user.role)}
            </p>
            <div className="op-actions">
              <button
                type="button"
                className="op-button secondary"
                disabled={busy}
                onClick={() => setShowPassword((value) => !value)}
                aria-expanded={showPassword}
              >
                Trocar senha
              </button>
              <button
                type="button"
                className="op-button secondary"
                disabled={busy}
                onClick={() => {
                  void logout()
                }}
              >
                Sair
              </button>
            </div>
          </div>
          {showPassword && (
            <Panel title="Trocar minha senha">
              <form className="op-form" onSubmit={changePassword}>
                <fieldset disabled={busy}>
                  <Field label="Senha atual">
                    <input
                      type="password"
                      name="currentPassword"
                      required
                      autoComplete="current-password"
                    />
                  </Field>
                  <Field label="Nova senha">
                    <input
                      type="password"
                      name="newPassword"
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                    />
                  </Field>
                  <p className="op-note">
                    Use de 12 a 128 caracteres, incluindo letra e número. Após a
                    troca, será necessário entrar novamente.
                  </p>
                  <button className="op-button" type="submit">
                    Alterar senha e encerrar sessões
                  </button>
                </fieldset>
              </form>
            </Panel>
          )}
          {session.user.role === 'reader' ? (
            <div className="op-alert error" role="alert">
              Seu perfil de leitor não tem permissão para consultar os registros
              ou operar o atendimento. Solicite acesso à administração.
            </div>
          ) : (
            <>
              <div className="op-toolbar">
                <nav className="op-tabs" aria-label="Áreas do atendimento">
                  {tabs
                    .filter(
                      (item) =>
                        item.id !== 'users' || session.user.role === 'admin',
                    )
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={tab === item.id ? 'page' : undefined}
                        onClick={() => setTab(item.id)}
                        disabled={busy}
                      >
                        {item.label}
                      </button>
                    ))}
                </nav>
                <button
                  type="button"
                  className="op-button secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    setNotice(null)
                    try {
                      await reload(session)
                      setNotice({ kind: 'success', text: 'Dados atualizados.' })
                    } catch (error) {
                      if (error instanceof ApiError && error.status === 401)
                        expire()
                      setNotice({ kind: 'error', text: errorText(error) })
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Atualizar dados
                </button>
              </div>
              {busy && <p role="status">Processando solicitação…</p>}
              {(tab === 'readers' || tab === 'works' || tab === 'copies') && (
                <Catalogue
                  key={tab}
                  type={tab}
                  records={records}
                  save={save}
                  busy={busy}
                />
              )}
              {tab === 'loans' && (
                <Circulation records={records} save={save} busy={busy} />
              )}
              {tab === 'events' && <History events={records.events} />}
              {tab === 'users' && session.user.role === 'admin' && (
                <Accounts users={records.users} save={save} busy={busy} />
              )}
            </>
          )}
        </>
      )}
    </main>
  )
}
