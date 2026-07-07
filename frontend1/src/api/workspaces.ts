import { apiDelete, apiGet, apiPatch, apiPost, uploadSSE } from './client'
import type { AppStatus, PipelineSummary, SSEEvent, Workspace } from '@/types/analysis'

const base = '/api/workspaces'

export const listWorkspaces = () => apiGet<{ workspaces: Workspace[] }>(base)

export const getWorkspace = (id: string) => apiGet<Workspace>(`${base}/${id}`)

export const createWorkspace = (name: string, description?: string) =>
  apiPost<Workspace>(base, { name, description })

export const updateWorkspace = (id: string, name: string, description?: string) =>
  apiPatch<Workspace>(`${base}/${id}`, { name, description })

export const deleteWorkspace = (id: string) => apiDelete<{ deleted: true }>(`${base}/${id}`)

export const getStatus = (workspaceId: string) => apiGet<AppStatus>(`${base}/${workspaceId}/status`)

export const resetWorkspace = (workspaceId: string) =>
  apiPost<{ success: true }>(`${base}/${workspaceId}/reset`)

export const runPipeline = (workspaceId: string, files: File[], onEvent: (e: SSEEvent) => void, signal?: AbortSignal) =>
  uploadSSE<SSEEvent>(`${base}/${workspaceId}/pipeline/run`, files, 'files', onEvent, signal)

export const importSyntheticDocument = (workspaceId: string, storeDocumentId: string) =>
  apiPost<{ workspace_id: string; document_id: string; title: string; elements: number }>(
    `${base}/${workspaceId}/import-synthetic/${storeDocumentId}`,
  )

export type { PipelineSummary }
