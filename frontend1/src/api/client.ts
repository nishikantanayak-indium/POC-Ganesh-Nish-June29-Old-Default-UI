// Shared fetch wrapper + SSE streaming helper. Vite dev proxy forwards /api -> :8000.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = await res.json()
      message = body.detail || body.message || message
    } catch {
      // ignore — no JSON body
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path)
  return handle<T>(res)
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return handle<T>(res)
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle<T>(res)
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: 'DELETE' })
  return handle<T>(res)
}

export async function apiUpload<T>(path: string, files: File[], fieldName = 'files'): Promise<T> {
  const formData = new FormData()
  for (const file of files) formData.append(fieldName, file)
  const res = await fetch(path, { method: 'POST', body: formData })
  return handle<T>(res)
}

/**
 * Streams an SSE response opened via fetch (not EventSource, since these endpoints
 * are POST with a multipart/JSON body). Parses `data: {json}\n\n` frames and invokes
 * onEvent for each. Resolves when the stream closes.
 */
export async function streamSSE<TEvent>(
  path: string,
  init: RequestInit,
  onEvent: (event: TEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, { ...init, signal })
  if (!res.ok || !res.body) {
    let message = res.statusText
    try {
      const body = await res.json()
      message = body.detail || message
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const jsonStr = line.slice(5).trim()
      if (!jsonStr) continue
      try {
        onEvent(JSON.parse(jsonStr) as TEvent)
      } catch {
        // ignore malformed frame
      }
    }
  }
}

export function uploadSSE<TEvent>(
  path: string,
  files: File[],
  fieldName: string,
  onEvent: (event: TEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const formData = new FormData()
  for (const file of files) formData.append(fieldName, file)
  return streamSSE<TEvent>(path, { method: 'POST', body: formData }, onEvent, signal)
}

export function postSSE<TEvent>(
  path: string,
  body: unknown,
  onEvent: (event: TEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamSSE<TEvent>(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    onEvent,
    signal,
  )
}
