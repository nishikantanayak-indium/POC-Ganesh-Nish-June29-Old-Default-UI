import { apiGet, apiPatch, postSSE } from './client'
import type { ContractDraft, DraftEvent, DraftTemplate } from '@/types/analysis'

const base = '/api/workspaces'

export const generateDraft = (
  workspaceId: string,
  template: DraftTemplate,
  onEvent: (e: DraftEvent) => void,
  signal?: AbortSignal,
) => postSSE<DraftEvent>(`${base}/${workspaceId}/draft/generate`, { template }, onEvent, signal)

export const listDrafts = (workspaceId: string) =>
  apiGet<{ drafts: ContractDraft[] }>(`${base}/${workspaceId}/drafts`)

export const getDraft = (workspaceId: string, draftId: string) =>
  apiGet<ContractDraft>(`${base}/${workspaceId}/draft/${draftId}`)

export const updateDraft = (
  workspaceId: string,
  draftId: string,
  patch: { status?: ContractDraft['status']; sections?: ContractDraft['sections'] },
) => apiPatch<ContractDraft>(`${base}/${workspaceId}/draft/${draftId}`, patch)

export const exportDraftMarkdownUrl = (workspaceId: string, draftId: string) =>
  `${base}/${workspaceId}/draft/${draftId}/export.md`

export const exportDraftDocxUrl = (workspaceId: string, draftId: string) =>
  `${base}/${workspaceId}/draft/${draftId}/export.docx`
