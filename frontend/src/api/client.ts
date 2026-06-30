import type {
  AppStatus, CoverageResult, GraphData, TraceabilityChain,
  GraphNode, EvidenceItem, Workspace, CrossDocRelationship, DocumentContent,
  Conversation, ConversationMessage,
} from '../types'

const BASE = ''  // vite proxy forwards /api → localhost:8000

// ── Workspace API ─────────────────────────────────────────────────────────────

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const r = await fetch(`${BASE}/api/workspaces`)
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json()
  return data.workspaces
}

export async function createWorkspace(name: string, description = ''): Promise<Workspace> {
  const r = await fetch(`${BASE}/api/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function updateWorkspace(
  id: string, name: string, description: string,
): Promise<Workspace> {
  const r = await fetch(`${BASE}/api/workspaces/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchWorkspace(id: string): Promise<Workspace> {
  const r = await fetch(`${BASE}/api/workspaces/${id}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function deleteWorkspace(id: string): Promise<void> {
  const r = await fetch(`${BASE}/api/workspaces/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(await r.text())
}

// ── Workspace-scoped endpoints ────────────────────────────────────────────────

function ws(workspaceId: string) {
  return `${BASE}/api/workspaces/${workspaceId}`
}

export async function fetchStatus(workspaceId: string): Promise<AppStatus> {
  const r = await fetch(`${ws(workspaceId)}/status`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchGraphData(workspaceId: string, showContains = false): Promise<GraphData> {
  const r = await fetch(`${ws(workspaceId)}/graph/data?show_contains=${showContains}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchSubgraph(workspaceId: string, nodeId: string): Promise<GraphData> {
  const r = await fetch(`${ws(workspaceId)}/graph/subgraph/${encodeURIComponent(nodeId)}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchElements(workspaceId: string): Promise<GraphNode[]> {
  const r = await fetch(`${ws(workspaceId)}/elements`)
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json()
  return data.elements
}

export async function fetchCoverage(workspaceId: string): Promise<CoverageResult[]> {
  const r = await fetch(`${ws(workspaceId)}/traceability/coverage`)
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json()
  return data.results
}

export async function fetchChain(workspaceId: string, reqId: string): Promise<TraceabilityChain> {
  const r = await fetch(`${ws(workspaceId)}/traceability/chain/${encodeURIComponent(reqId)}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function askQuestion(
  workspaceId: string,
  question: string,
): Promise<{ answer: string; evidence: EvidenceItem[]; query_type: string }> {
  const r = await fetch(`${ws(workspaceId)}/chat/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchCrossDocRelationships(workspaceId: string): Promise<CrossDocRelationship[]> {
  const r = await fetch(`${ws(workspaceId)}/graph/cross-doc-relationships`)
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json()
  return data.relationships
}

export async function fetchDocuments(workspaceId: string): Promise<DocumentContent[]> {
  const r = await fetch(`${ws(workspaceId)}/documents`)
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json()
  return data.documents
}

// ── Chat conversations ────────────────────────────────────────────────────────

export async function fetchConversations(workspaceId: string): Promise<Conversation[]> {
  const r = await fetch(`${ws(workspaceId)}/chat/conversations`)
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json()
  return data.conversations
}

export async function createConversation(workspaceId: string, title = 'New conversation'): Promise<Conversation> {
  const r = await fetch(`${ws(workspaceId)}/chat/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function renameConversation(workspaceId: string, convId: string, title: string): Promise<Conversation> {
  const r = await fetch(`${ws(workspaceId)}/chat/conversations/${convId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function deleteConversation(workspaceId: string, convId: string): Promise<void> {
  const r = await fetch(`${ws(workspaceId)}/chat/conversations/${convId}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(await r.text())
}

export async function fetchMessages(workspaceId: string, convId: string): Promise<ConversationMessage[]> {
  const r = await fetch(`${ws(workspaceId)}/chat/conversations/${convId}/messages`)
  if (!r.ok) throw new Error(await r.text())
  const data = await r.json()
  return data.messages
}

export async function askInConversation(
  workspaceId: string,
  convId: string,
  question: string,
): Promise<{ answer: string; evidence: EvidenceItem[]; query_type: string }> {
  const r = await fetch(`${ws(workspaceId)}/chat/conversations/${convId}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function resetGraph(workspaceId: string): Promise<void> {
  const r = await fetch(`${ws(workspaceId)}/reset`, { method: 'POST' })
  if (!r.ok) throw new Error(await r.text())
}

export function streamPipeline(
  workspaceId: string,
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
      const response = await fetch(`${ws(workspaceId)}/pipeline/run`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })
      if (!response.ok) { onError(await response.text()); return }

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
            try { onEvent(JSON.parse(line.slice(6))) } catch { /* malformed */ }
          }
        }
      }
      onDone()
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') onError(err.message)
    }
  })()

  return () => controller.abort()
}
