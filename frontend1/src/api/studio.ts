import { apiDelete, apiGet, apiPatch, apiPost, postSSE } from './client'
import type {
  DocGenKnobs,
  DocGenTarget,
  DocReviewQueue,
  DocSMESummary,
  DocTypeOverview,
  GenEvent,
  GenKnobs,
  GenSelection,
  LineageEdge,
  QualityReportT,
  RecordReports,
  StoreDocument,
  StudioMeta,
  StudioOverview,
  StudioProject,
  StudioVersion,
  SMESummary,
  SMEVerdict,
  SyntheticDocumentT,
  SyntheticRecordT,
  SyntheticRelationshipT,
  ValidationReportT,
} from '@/types/studio'

const base = '/api/studio'

// --- Meta & Projects ---

export const getMeta = () => apiGet<StudioMeta>(`${base}/meta`)

export const listProjects = () => apiGet<{ projects: StudioProject[] }>(`${base}/projects`)

export const createProject = (data: { name: string; description?: string; min_threshold?: number; labels?: string[] }) =>
  apiPost<StudioProject>(`${base}/projects`, data)

export const getProject = (projectId: string) => apiGet<StudioProject>(`${base}/projects/${projectId}`)

export const updateProject = (
  projectId: string,
  data: Partial<{ name: string; description: string; min_threshold: number; labels: string[] }>,
) => apiPatch<StudioProject>(`${base}/projects/${projectId}`, data)

export const deleteProject = (projectId: string) => apiDelete<{ deleted: true }>(`${base}/projects/${projectId}`)

// --- Seeds / gap analysis ---

export const uploadSeeds = (projectId: string, files: File[], docTypes?: string[]) =>
  new Promise<StudioOverview>((resolve, reject) => {
    const formData = new FormData()
    for (const file of files) formData.append('files', file)
    if (docTypes && docTypes.length > 0) formData.append('doc_types', JSON.stringify(docTypes))
    fetch(`${base}/projects/${projectId}/seeds`, { method: 'POST', body: formData })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(resolve)
      .catch(reject)
  })

export const getOverview = (projectId: string) => apiGet<StudioOverview>(`${base}/projects/${projectId}/overview`)

export const getDocOverview = (projectId: string) =>
  apiGet<DocTypeOverview>(`${base}/projects/${projectId}/doc-overview`)

export const getProjectDocuments = (projectId: string) =>
  apiGet<{ documents: SyntheticDocumentT[] }>(`${base}/projects/${projectId}/documents`)

// --- Generation (SSE) ---

export const generate = (
  projectId: string,
  selections: GenSelection[],
  knobs: GenKnobs,
  onEvent: (e: GenEvent) => void,
  signal?: AbortSignal,
) => postSSE<GenEvent>(`${base}/projects/${projectId}/generate`, { selections, knobs }, onEvent, signal)

export const generateDocuments = (
  projectId: string,
  docTargets: DocGenTarget[],
  knobs: DocGenKnobs,
  onEvent: (e: GenEvent) => void,
  signal?: AbortSignal,
  validationOverride?: boolean,
) =>
  postSSE<GenEvent>(
    `${base}/projects/${projectId}/generate-documents`,
    { doc_targets: docTargets, knobs, validation_override: validationOverride ?? false },
    onEvent,
    signal,
  )

export const validateGeneration = (
  projectId: string,
  docTargets: DocGenTarget[],
  knobs: DocGenKnobs,
) =>
  apiPost<{ status: 'ok' | 'ui_conflict' | 'system_conflict' | 'domain_conflict' | 'security_conflict'; conflict_field: string; message: string }>(
    `${base}/projects/${projectId}/validate-generation`,
    { doc_targets: docTargets, knobs }
  )

// --- Versions / records / reports ---

export const listVersions = (projectId: string) => apiGet<{ versions: StudioVersion[] }>(`${base}/projects/${projectId}/versions`)

export const getLineage = (projectId: string) => apiGet<{ edges: LineageEdge[] }>(`${base}/projects/${projectId}/lineage`)

export const getVersionRecords = (versionId: string, status?: string) =>
  apiGet<{ records: SyntheticRecordT[] }>(`${base}/versions/${versionId}/records${status ? `?status=${status}` : ''}`)

export const getVersionRelationships = (versionId: string) =>
  apiGet<{ relationships: SyntheticRelationshipT[] }>(`${base}/versions/${versionId}/relationships`)

export const getVersionDocuments = (versionId: string) =>
  apiGet<{ documents: SyntheticDocumentT[] }>(`${base}/versions/${versionId}/documents`)

export const getVersionReports = (versionId: string) =>
  apiGet<{ reports: Record<string, RecordReports> }>(`${base}/versions/${versionId}/reports`)

export const getVersionDistribution = (versionId: string) =>
  apiGet<{ by_element_type: Record<string, number>; by_label: Record<string, number>; by_doc_type: Record<string, number> }>(
    `${base}/versions/${versionId}/distribution`,
  )

// --- SME review (record-level, legacy) ---

export const getSmeSample = (versionId: string) =>
  apiGet<{ records: SyntheticRecordT[] }>(`${base}/versions/${versionId}/sme/sample`)

export const submitSmeVerdict = (
  versionId: string,
  data: { record_id: string; verdict: SMEVerdict; corrected_label?: string; corrected_text?: string; comment?: string },
) => apiPost<{ ok: true }>(`${base}/versions/${versionId}/sme/verdict`, data)

export const getSmeSummary = (versionId: string) => apiGet<SMESummary>(`${base}/versions/${versionId}/sme/summary`)

export const getSmeQueue = (versionId: string) =>
  apiGet<{ records: SyntheticRecordT[] }>(`${base}/versions/${versionId}/sme/queue`)

// --- SME review (document-level) ---

export const getSmeDocumentsQueue = (versionId: string) =>
  apiGet<DocReviewQueue>(`${base}/versions/${versionId}/sme/documents/queue`)

export const submitSmeDocumentVerdict = (
  versionId: string,
  data: { document_id: string; verdict: SMEVerdict; corrected_markdown?: string; corrected_title?: string; comment?: string },
) => apiPost<{ ok: true }>(`${base}/versions/${versionId}/sme/documents/verdict`, data)

export const submitDocumentVerdict = (
  documentId: string,
  data: { verdict: SMEVerdict; corrected_markdown?: string; corrected_title?: string; comment?: string },
) => apiPost<{ ok: true }>(`${base}/documents/${documentId}/verdict`, data)

export const getSmeDocumentsSummary = (versionId: string) =>
  apiGet<DocSMESummary>(`${base}/versions/${versionId}/sme/documents/summary`)

// --- Promote / publish / lineage ---

export const promoteVersion = (versionId: string) => apiPost<StudioVersion>(`${base}/versions/${versionId}/promote`)

export const cloneVersion = (versionId: string) => apiPost<StudioVersion>(`${base}/versions/${versionId}/clone`)

export const deleteVersion = (versionId: string) => apiDelete<{ deleted: true }>(`${base}/versions/${versionId}`)

export const publishVersion = (versionId: string, workspaceId: string) =>
  apiPost<{ published: number }>(`${base}/versions/${versionId}/publish`, { workspace_id: workspaceId })

export const publishVersionToStore = (versionId: string) =>
  apiPost<{ version_id: string; published: number }>(`${base}/versions/${versionId}/publish-to-store`)

export const publishDocuments = (documentIds: string[]) =>
  apiPost<{ published: number }>(`${base}/documents/publish`, { document_ids: documentIds })

export const recallDocument = (documentId: string) => apiPost<SyntheticDocumentT>(`${base}/documents/${documentId}/recall`)

export const getStoreDocuments = (docType?: string) =>
  apiGet<{ documents: StoreDocument[] }>(`${base}/store/documents${docType ? `?doc_type=${docType}` : ''}`)

// --- Export URLs (download-only, used as href) ---

export const exportRecordsUrl = (versionId: string) => `${base}/versions/${versionId}/export/records.jsonl`
export const exportRelationshipsUrl = (versionId: string) => `${base}/versions/${versionId}/export/relationships.jsonl`
export const exportBundleUrl = (versionId: string) => `${base}/versions/${versionId}/export/bundle.zip`
export const exportDocumentsZipUrl = (versionId: string, docIds?: string[], format: 'md' | 'docx' = 'md') => {
  const params = new URLSearchParams({ format })
  if (docIds && docIds.length > 0) params.set('doc_ids', docIds.join(','))
  return `${base}/versions/${versionId}/export/documents.zip?${params.toString()}`
}
export const exportDocMarkdownUrl = (versionId: string, docId: string) =>
  `${base}/versions/${versionId}/documents/${docId}/export.md`
export const exportDocDocxUrl = (versionId: string, docId: string) =>
  `${base}/versions/${versionId}/documents/${docId}/export.docx`

export const fetchDocMarkdown = (versionId: string, docId: string) =>
  fetch(exportDocMarkdownUrl(versionId, docId)).then((r) => r.text())

export type { ValidationReportT, QualityReportT }
