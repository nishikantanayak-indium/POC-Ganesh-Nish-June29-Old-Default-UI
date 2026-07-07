// Core domain types for the Analysis area — mirrors backend/core/models.py and the
// workspace/graph/chat/traceability/documents API contracts.

export type ElementType = 'Requirement' | 'Clause' | 'Risk' | 'Mitigation' | 'LD' | 'Document'

export type RelationshipType =
  | 'COVERS'
  | 'PARTIALLY_COVERS'
  | 'INTRODUCES_RISK'
  | 'MITIGATED_BY'
  | 'LINKED_TO_LD'
  | 'CONTRADICTS'
  | 'CONTAINS'

export type CoverageStatus = 'Covered' | 'Partially Covered' | 'Not Covered'

export interface Workspace {
  id: string
  name: string
  description?: string
  created_at: string
  updated_at: string
}

export interface AppStatus {
  has_data: boolean
  nodes: number
  edges: number
  type_counts: Record<string, number>
}

export interface GraphNode {
  id: string
  type: ElementType
  text: string
  source?: string
  document_id?: string
  confidence?: number
  page_number?: number
}

export interface GraphEdge {
  src: string
  tgt: string
  rtype: RelationshipType
  conf: number
  ev?: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface CrossDocRelationship {
  src_id: string
  src_type: ElementType
  src_text: string
  src_source?: string
  src_doc: string
  rtype: RelationshipType
  conf: number
  ev?: string
  tgt_id: string
  tgt_type: ElementType
  tgt_text: string
  tgt_source?: string
  tgt_doc: string
}

export interface CoverageResult {
  requirement_id: string
  requirement_text: string
  status: CoverageStatus
  covering_clauses: GraphNode[]
  risks: GraphNode[]
  mitigations: GraphNode[]
  lds: GraphNode[]
  source?: string
}

export interface ChainElement extends GraphNode {
  relationship: RelationshipType
  is_inter_document: boolean
}

export interface TraceabilityChain {
  requirement: CoverageResult
  full_coverage: ChainElement[]
  partial_coverage: ChainElement[]
  risks: ChainElement[]
  mitigations: ChainElement[]
  lds: ChainElement[]
  gaps: string[]
}

// --- Document explorer ---

export interface ExtractedTable {
  page: number
  headers: string[]
  rows: string[][]
}

export interface PageContent {
  page_num: number
  native_text: string
  ocr_text: string
  tables: ExtractedTable[]
}

export interface DocumentContent {
  id: string
  name: string
  type: string
  total_pages: number
  page_contents: PageContent[]
}

// --- Pipeline (SSE ingestion) ---

export type StepId = 'parse' | 'extract' | 'graph' | 'vector' | 'coverage'
export type StepStatus = 'pending' | 'running' | 'done' | 'error'

export interface PipelineStep {
  id: StepId
  label: string
  status: StepStatus
  count?: number
  elapsed?: number
  message?: string
  progress?: number
}

export interface PipelineSummary {
  documents: number
  skipped: number
  elements: number
  nodes: number
  edges: number
  coverage_items: number
  elapsed: number
}

export interface LogLine {
  time: string
  text: string
  level?: 'info' | 'warn' | 'error'
}

export type SSEEvent =
  | { type: 'step_start'; step: StepId; message?: string }
  | { type: 'step_progress'; step: StepId; message?: string; progress?: number; count?: number }
  | { type: 'step_complete'; step: StepId; message?: string; count?: number; elapsed?: number }
  | { type: 'pipeline_complete'; summary: PipelineSummary }
  | { type: 'error'; message: string; step?: StepId }

export interface PipelineJob {
  id: string
  runNumber: number
  workspaceId: string
  fileNames: string[]
  steps: PipelineStep[]
  logs: LogLine[]
  status: 'running' | 'done' | 'error'
  summary?: PipelineSummary
  startedAt: number
  finishedAt?: number
}

// --- Chat ---

export type QueryType =
  | 'coverage_gap'
  | 'risk_for_partial'
  | 'no_mitigation'
  | 'no_ld'
  | 'summary'
  | 'comparison'
  | 'general'

// Backend flattens neighbor fields directly onto the connection object
// (services/qa_service.py::_expand_neighbors), not nested under `node`.
export interface EvidenceConnection {
  id: string
  type: ElementType
  text: string
  source?: string
  rel: RelationshipType
  direction: 'in' | 'out'
  page_number?: number
  connections?: EvidenceConnection[]
}

// Most evidence gatherers (coverage_gap, no_mitigation, no_ld, general, comparison
// seeds) emit this shape. `type` is present for general/comparison seeds but
// omitted for coverage_gap/no_mitigation/no_ld, where the intent implies it.
export interface ElementEvidenceItem {
  id: string
  type?: ElementType
  text: string
  source?: string
  status?: CoverageStatus
  document_id?: string
  page_number?: number
  connections?: EvidenceConnection[]
}

// risk_for_partial intent uses risk_id/risk_text instead of id/text, plus the
// linked requirement id (services/qa_service.py::_gather_risk_for_partial_evidence).
export interface RiskPartialEvidenceItem {
  requirement: string
  risk_id: string
  risk_text: string
  source?: string
  page_number?: number
  connections?: EvidenceConnection[]
}

export interface CoverageSummary {
  requirements: { total: number; covered: number; partially_covered: number; not_covered: number }
  risks: { total: number; mitigated: number; unmitigated: number; with_ld: number; without_ld: number }
}

export interface SummaryEvidenceItem {
  summary: CoverageSummary
}

// comparison intent's explicit cross-document edges (services/qa_service.py::
// _gather_comparison_evidence) — distinct shape from the /graph/cross-doc-relationships
// endpoint's CrossDocRelationship.
export interface CrossDocEvidenceItem {
  cross_doc_relationship: RelationshipType
  from: { id: string; text: string; source?: string; doc: string }
  to: { id: string; text: string; source?: string; doc: string }
  evidence?: string
}

export type EvidenceItem =
  | SummaryEvidenceItem
  | CrossDocEvidenceItem
  | RiskPartialEvidenceItem
  | ElementEvidenceItem

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  queryType?: QueryType
  evidence?: EvidenceItem[]
  timestamp: number
}

export interface Conversation {
  id: string
  workspace_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface ConversationMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  query_type?: QueryType
  evidence?: EvidenceItem[]
  created_at: string
}

export interface AskResponse {
  answer: string
  evidence: EvidenceItem[]
  query_type: QueryType
}
