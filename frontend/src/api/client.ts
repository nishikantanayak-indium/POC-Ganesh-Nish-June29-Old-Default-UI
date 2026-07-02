import type {
  AppStatus, CoverageResult, GraphData, TraceabilityChain,
  GraphNode, EvidenceItem, Workspace, CrossDocRelationship, DocumentContent,
  Conversation, ConversationMessage,
  StudioProject, StudioMeta, StudioOverview, StudioVersion, SyntheticRecordT,
  SyntheticRelationshipT, RecordReports, SMESummary, LineageEdge, GenSelection,
  GenKnobs, GenEvent,
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

// ── Synthetic Data Studio ─────────────────────────────────────────────────────

const studio = `${BASE}/api/studio`

export async function fetchStudioMeta(): Promise<StudioMeta> {
  const r = await fetch(`${studio}/meta`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchProjects(): Promise<StudioProject[]> {
  const r = await fetch(`${studio}/projects`)
  if (!r.ok) throw new Error(await r.text())
  return (await r.json()).projects
}

export async function createProject(name: string, description = '', minThreshold?: number): Promise<StudioProject> {
  const r = await fetch(`${studio}/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, min_threshold: minThreshold ?? null }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchProject(id: string): Promise<StudioProject> {
  const r = await fetch(`${studio}/projects/${id}`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function deleteProject(id: string): Promise<void> {
  const r = await fetch(`${studio}/projects/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(await r.text())
}

export async function uploadSeeds(projectId: string, files: File[]): Promise<StudioOverview> {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  const r = await fetch(`${studio}/projects/${projectId}/seeds`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchOverview(projectId: string): Promise<StudioOverview> {
  const r = await fetch(`${studio}/projects/${projectId}/overview`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchVersions(projectId: string): Promise<StudioVersion[]> {
  const r = await fetch(`${studio}/projects/${projectId}/versions`)
  if (!r.ok) throw new Error(await r.text())
  return (await r.json()).versions
}

export async function fetchRecords(versionId: string, status?: string): Promise<SyntheticRecordT[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : ''
  const r = await fetch(`${studio}/versions/${versionId}/records${q}`)
  if (!r.ok) throw new Error(await r.text())
  return (await r.json()).records
}

export async function fetchRelationships(versionId: string): Promise<SyntheticRelationshipT[]> {
  const r = await fetch(`${studio}/versions/${versionId}/relationships`)
  if (!r.ok) throw new Error(await r.text())
  return (await r.json()).relationships
}

export async function fetchReports(versionId: string): Promise<Record<string, RecordReports>> {
  const r = await fetch(`${studio}/versions/${versionId}/reports`)
  if (!r.ok) throw new Error(await r.text())
  return (await r.json()).reports
}

export async function fetchSmeSample(versionId: string): Promise<{ sample: SyntheticRecordT[]; reports: Record<string, RecordReports> }> {
  const r = await fetch(`${studio}/versions/${versionId}/sme/sample`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function submitSmeVerdict(
  versionId: string,
  body: { record_id: string; verdict: string; corrected_label?: string; corrected_text?: string; comment?: string },
): Promise<{ record_id: string; verdict: string }> {
  const r = await fetch(`${studio}/versions/${versionId}/sme/verdict`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchSmeSummary(versionId: string): Promise<SMESummary> {
  const r = await fetch(`${studio}/versions/${versionId}/sme/summary`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function promoteVersion(versionId: string): Promise<{ version_id: string; status: string }> {
  const r = await fetch(`${studio}/versions/${versionId}/promote`, { method: 'POST' })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function publishVersion(versionId: string, workspaceId: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${studio}/versions/${versionId}/publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: workspaceId }),
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchLineage(projectId: string): Promise<LineageEdge[]> {
  const r = await fetch(`${studio}/projects/${projectId}/lineage`)
  if (!r.ok) throw new Error(await r.text())
  return (await r.json()).edges
}

export function streamGenerate(
  projectId: string,
  selections: GenSelection[],
  knobs: GenKnobs,
  onEvent: (e: GenEvent) => void,
  onDone: () => void,
  onError: (err: string) => void,
): () => void {
  const controller = new AbortController()
  ;(async () => {
    try {
      const response = await fetch(`${studio}/projects/${projectId}/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections, knobs }), signal: controller.signal,
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
            try { onEvent(JSON.parse(line.slice(6)) as GenEvent) } catch { /* malformed */ }
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
