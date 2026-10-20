import { createHash, timingSafeEqual } from 'node:crypto'

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}
const csrf = (token) =>
  createHash('sha256').update(`csrf-v1:${token}`).digest('base64url')
const response = (data, extra = {}) =>
  new Response(JSON.stringify({ data }), { headers: { ...headers, ...extra } })
const denied = (status, code, message) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers,
  })
function tokenFrom(request) {
  return (
    (request.headers.get('cookie') || '')
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('biblioteca_session='))
      ?.slice('biblioteca_session='.length) || ''
  )
}
function equal(a, b) {
  const left = Buffer.from(a || '')
  const right = Buffer.from(b || '')
  return left.length === right.length && timingSafeEqual(left, right)
}
async function json(request) {
  if (
    !(request.headers.get('content-type') || '')
      .toLowerCase()
      .startsWith('application/json')
  )
    throw Object.assign(new Error('Envie os dados em JSON.'), {
      status: 415,
      code: 'JSON_REQUIRED',
    })
  const raw = await request.text()
  if (Buffer.byteLength(raw) > 65536)
    throw Object.assign(
      new Error('Os dados enviados excedem o limite permitido.'),
      { status: 413, code: 'BODY_TOO_LARGE' },
    )
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Objeto obrigatório')
    return value
  } catch {
    throw Object.assign(new Error('Informe um objeto JSON válido.'), {
      status: 400,
      code: 'INVALID_JSON',
    })
  }
}

export function createApi({ library, auth, origin, secureCookies = false }) {
  const cookie = (token, age) =>
    `biblioteca_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies ? '; Secure' : ''}`
  return async (request, { remoteAddress = 'local' } = {}) => {
    try {
      const url = new URL(request.url)
      const path = url.pathname
      const method = request.method
      const mutation = !['GET', 'HEAD'].includes(method)
      if (mutation && request.headers.get('origin') !== origin)
        return denied(
          403,
          'ORIGIN_DENIED',
          'A origem da solicitação não é autorizada.',
        )
      if (path === '/api/health' && method === 'GET')
        return response({ status: 'ok', datasetKind: 'fictional-local' })
      if (path === '/api/auth/login' && method === 'POST') {
        const result = auth.login(await json(request), remoteAddress)
        return response(
          { user: result.user, csrfToken: csrf(result.token) },
          { 'set-cookie': cookie(result.token, 28800) },
        )
      }
      const token = tokenFrom(request)
      const user = auth.authenticate(token)
      if (!user)
        return denied(
          401,
          'AUTH_REQUIRED',
          'Entre com uma conta autorizada para continuar.',
        )
      if (mutation && !equal(request.headers.get('x-csrf-token'), csrf(token)))
        return denied(
          403,
          'CSRF_DENIED',
          'A confirmação da sessão não é válida. Entre novamente.',
        )
      if (path === '/api/auth/session' && method === 'GET')
        return response({ user, csrfToken: csrf(token) })
      if (path === '/api/auth/logout' && method === 'POST') {
        auth.logout(token)
        return response({ loggedOut: true }, { 'set-cookie': cookie('', 0) })
      }
      if (path === '/api/auth/password' && method === 'POST') {
        auth.changePassword(user, await json(request))
        return response({ changed: true }, { 'set-cookie': cookie('', 0) })
      }
      if (!['staff', 'admin'].includes(user.role))
        return denied(
          403,
          'ACCESS_DENIED',
          'Esta conta não tem permissão para consultar ou alterar registros de atendimento.',
        )
      const query = url.searchParams.get('query') || ''
      const match = path.match(/^\/api\/(readers|works|copies)(?:\/([^/]+))?$/)
      if (match) {
        const mapping = {
          readers: [library.listReaders, library.saveReader],
          works: [library.listWorks, library.saveWork],
          copies: [library.listCopies, library.saveCopy],
        }
        const [list, save] = mapping[match[1]]
        if (!match[2] && method === 'GET')
          return response(list.call(library, query))
        if (!match[2] && method === 'POST')
          return response(save.call(library, user.id, await json(request)))
        if (match[2] && method === 'PATCH')
          return response(
            save.call(library, user.id, await json(request), match[2]),
          )
      }
      if (path === '/api/summary' && method === 'GET')
        return response(library.getSummary())
      if (path === '/api/history' && method === 'GET')
        return response(library.getHistory(query))
      if (path === '/api/loans' && method === 'GET')
        return response(library.listLoans(query))
      if (path === '/api/loans' && method === 'POST')
        return response(library.checkout(user.id, await json(request)))
      const returning = path.match(/^\/api\/loans\/([^/]+)\/return$/)
      if (returning && method === 'POST')
        return response(
          library.returnItems(user.id, returning[1], await json(request)),
        )
      const renewal = path.match(
        /^\/api\/loans\/([^/]+)\/items\/([^/]+)\/renew$/,
      )
      if (renewal && method === 'POST')
        return response(
          library.renewItem(
            user.id,
            renewal[1],
            renewal[2],
            await json(request),
          ),
        )
      if (path === '/api/users' || path.startsWith('/api/users/')) {
        if (user.role !== 'admin')
          return denied(
            403,
            'ACCESS_DENIED',
            'Somente a administração pode gerenciar contas.',
          )
        if (path === '/api/users' && method === 'GET')
          return response(auth.listUsers(user))
        if (path === '/api/users' && method === 'POST')
          return response(auth.saveUser(user, await json(request)))
        const editing = path.match(/^\/api\/users\/([^/]+)$/)
        if (editing && method === 'PATCH')
          return response(auth.saveUser(user, await json(request), editing[1]))
        const reset = path.match(/^\/api\/users\/([^/]+)\/reset-password$/)
        if (reset && method === 'POST')
          return response(
            auth.resetPassword(user, reset[1], await json(request)),
          )
        const revoke = path.match(/^\/api\/users\/([^/]+)\/revoke$/)
        if (revoke && method === 'POST') {
          auth.revokeUserSessions(user, revoke[1])
          return response({ revoked: true })
        }
      }
      return denied(404, 'NOT_FOUND', 'Operação não encontrada.')
    } catch (error) {
      if (
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status < 500
      )
        return denied(error.status, error.code || 'INVALID_DATA', error.message)
      return denied(
        500,
        'INTERNAL_ERROR',
        'Não foi possível confirmar a operação. Confira os registros antes de repetir.',
      )
    }
  }
}
