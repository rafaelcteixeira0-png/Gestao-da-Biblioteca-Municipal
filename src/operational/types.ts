export type Role = 'admin' | 'staff' | 'reader'
export type User = {
  id: string
  username: string
  name: string
  role: Role
  active: boolean
  version: number
}
export type Session = { user: User; csrfToken: string }
export type Reader = {
  id: string
  name: string
  active: boolean
  version: number
}
export type Work = {
  id: string
  title: string
  author: string
  category: string
  edition: string
  volume: string
  version: number
}
export type Copy = {
  id: string
  workId: string
  accessionNumber: string | null
  shelf: string
  condition: string
  state: 'active' | 'withdrawn'
  status: 'available' | 'loaned' | 'withdrawn'
  version: number
}
export type LoanItem = {
  id: string
  copyId: string
  title: string
  accessionNumber: string | null
  dueAt: string
  returnedAt: string | null
  renewalCount: number
}
export type Loan = {
  id: string
  readerId: string
  readerName: string
  borrowedAt: string
  status: 'open' | 'partial' | 'returned'
  items: LoanItem[]
}
export type Event = {
  id: string
  occurredAt: string
  actorId: string
  type: string
  entityId: string
  before: unknown
  after: unknown
  metadata?: unknown
}
export type Records = {
  readers: Reader[]
  works: Work[]
  copies: Copy[]
  loans: Loan[]
  events: Event[]
  users: User[]
}

export type OperationalClient = <T>(
  path: string,
  method?: string,
  body?: Record<string, unknown>,
  csrfToken?: string,
) => Promise<T>
