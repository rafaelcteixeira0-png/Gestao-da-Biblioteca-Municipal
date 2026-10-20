export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
export async function persistedApi<T>(
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
