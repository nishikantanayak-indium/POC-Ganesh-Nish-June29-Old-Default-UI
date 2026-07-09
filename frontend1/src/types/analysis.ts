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
  // Bare element IDs, not enriched nodes — matches GraphBuilder.assess_coverage()
  // (graph/builder.py) exactly. This is the lightweight per-requirement summary
  // used for the overview table; for full text, use TraceabilityChain below
  // (GraphBuilder.get_traceability_chain(), one enriched call per requirement).
  covering_clauses: string[]
  risks: string[]
  mitigations: string[]
  lds: string[]
  source?: string
}

export interface ChainElement extends GraphNode {
  relationship: RelationshipType
  is_inter_document: boolean
}

export interface TraceabilityChain {
  // Matches GraphBuilder.get_traceability_chain()'s actual "requirement" shape —
  // an enriched ChainElement (id/type/text/source/document_id/relationship/
  // is_inter_document), NOT a CoverageResult (which has no "text"/"type" field).
  requirement: ChainElement
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

// --- Contract Draft (see CONTRACT_DRAFT_GENERATION_DESIGN.md) ---

export type DraftTemplate = 'rfp_mirror' | 'services_agreement' | 'rfp_response'

export interface DraftTemplateInfo {
  value: DraftTemplate
  label: string
  sections: string[]
}

export interface DraftCitation {
  requirement_id: string
  aspect: string
  quote: string
  verdict: 'strong' | 'partial' | 'weak'
}

export interface DraftSection {
  heading: string
  body: string
  addressed_requirement_ids: string[]
  citations: DraftCitation[]
  status: 'pending' | 'approved' | 'edited'
}

export interface DraftGap {
  requirement_id: string
  requirement_text: string
  reason: string
}

export interface DraftSummary {
  requirements_total: number
  requirements_covered: number
  requirements_needing_attention: number
  gaps_count: number
}

export interface ContractDraft {
  id: string
  workspace_id: string
  title: string
  template: DraftTemplate
  status: 'draft' | 'in_review' | 'finalized'
  sections: DraftSection[]
  gaps: DraftGap[]
  summary?: DraftSummary
  created_at: string
  updated_at: string
}

// Mirrors backend/api/routes/contract_draft.py's _sse() event shape exactly —
// same convention as GenEvent (Studio) / SSEEvent (pipeline).
export type DraftStage = 'queued' | 'grounding' | 'drafting' | 'citing' | 'persisting' | 'done' | 'error'

export interface DraftEvent {
  stage: DraftStage
  message?: string
  summary?: {
    draft_id: string
    title: string
    sections: number
    gaps: number
    elapsed: number
  }
}

// --- Contradictions & Portfolio ---

export interface Contradiction {
  src_id: string
  src_type: ElementType
  src_text: string
  src_source?: string
  src_doc: string
  conf: number
  ev?: string
  tgt_id: string
  tgt_type: ElementType
  tgt_text: string
  tgt_source?: string
  tgt_doc: string
}

export interface PortfolioEntry {
  workspace_id: string
  name: string
  updated_at: string
  nodes: number
  edges: number
  requirements_total: number
  requirements_covered: number
  requirements_needing_attention: number
  gaps_count: number
  contradictions_count: number
}
