import type { AppStatus, CoverageResult, GraphData, TraceabilityChain, GraphNode, EvidenceItem } from '../types'

const BASE = ''  // vite proxy forwards /api → localhost:8000

export async function fetchStatus(): Promise<AppStatus> {
  const r = await fetch(`${BASE}/api/status`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchGraphData(showContains = false): Promise<GraphData> {
  const r = await fetch(`${BASE}/api/graph/data?show_contains=${showContains}`)
  if (!r.ok) throw new Error(await r.text())
  const raw = await r.json()
  // Backend returns {nodes: [...], edges: [...]} but edges use src/tgt keys
  return raw
}

export async function fetchSubgraph(nodeId: string): Promise<GraphData> {
  const r = await fetch(`${BASE}/api/graph/subgraph/${encodeURIComponent(nodeId)}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchElements(): Promise<GraphNode[]> {
  const r = await fetch(`${BASE}/api/elements`)
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json()
  return data.elements
}

export async function fetchCoverage(): Promise<CoverageResult[]> {
  const r = await fetch(`${BASE}/api/traceability/coverage`)
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json()
  return data.results
}

export async function fetchChain(reqId: string): Promise<TraceabilityChain> {
  const r = await fetch(`${BASE}/api/traceability/chain/${encodeURIComponent(reqId)}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function askQuestion(question: string): Promise<{ answer: string; evidence: EvidenceItem[]; query_type: string }> {
  const r = await fetch(`${BASE}/api/chat/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function resetGraph(): Promise<void> {
  const r = await fetch(`${BASE}/api/reset`, { method: 'POST' })
  if (!r.ok) throw new Error(await r.text())
}

/**
 * Stream SSE pipeline events. Returns a cleanup function.
 */
export function streamPipeline(
  files: File[],
  onEvent: (event: unknown) => void,
  onDone: () => void,
  onError: (err: string) => void,
): () => void {
  const controller = new AbortController()
  const formData = new FormData()
  files.forEach(f => formData.append('files', f))

  ;(async () => {
    try {
      const response = await fetch(`${BASE}/api/pipeline/run`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })
      if (!response.ok) {
        onError(await response.text())
        return
      }
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6))
              onEvent(parsed)
            } catch { /* malformed line */ }
          }
        }
      }
      onDone()
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        onError(err.message)
      }
    }
  })()

  return () => controller.abort()
}
