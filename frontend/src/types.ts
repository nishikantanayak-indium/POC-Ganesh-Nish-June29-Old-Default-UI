export interface Workspace {
  id: string
  name: string
  description: string
  created_at: string
  updated_at: string
}

export type ElementType = 'Requirement' | 'Clause' | 'Risk' | 'Mitigation' | 'LD' | 'Document'
export type RelationshipType = 'COVERS' | 'PARTIALLY_COVERS' | 'INTRODUCES_RISK' | 'MITIGATED_BY' | 'LINKED_TO_LD' | 'CONTRADICTS' | 'CONTAINS'
export type CoverageStatus = 'Covered' | 'Partially Covered' | 'Not Covered'

export interface GraphNode {
  id: string
  type: ElementType
  text: string
  source: string
  document_id: string
  confidence?: number
  page_number?: number
}

export interface GraphEdge {
  src: string
  tgt: string
  rtype: RelationshipType
  conf: number
  ev: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface CrossDocRelationship {
  src_id: string; src_type: string; src_text: string; src_source: string; src_doc: string
  rtype: string; conf: number; ev: string
  tgt_id: string; tgt_type: string; tgt_text: string; tgt_source: string; tgt_doc: string
}

export interface CoverageResult {
  requirement_id: string
  requirement_text: string
  status: CoverageStatus
  covering_clauses: string[]
  risks: string[]
  mitigations: string[]
  lds: string[]
  source: string
}

export interface ChainElement {
  id: string
  type: string
  text: string
  source: string
  document_id: string
  relationship: string
  is_inter_document: boolean
}

export interface TraceabilityChain {
  requirement: ChainElement
  full_coverage: ChainElement[]
  partial_coverage: ChainElement[]
  risks: ChainElement[]
  mitigations: ChainElement[]
  lds: ChainElement[]
  gaps: string[]
}

export type StepStatus = 'idle' | 'running' | 'coordinating' | 'complete' | 'error' | 'skipped'

export interface PipelineStep {
  id: string
  label: string
  icon: string
  status: StepStatus
  count?: number
  elapsed?: number
  message?: string
  progress?: { current: number; total: number }
}

export type SSEEvent =
  | { type: 'step_start'; step: string; label: string; total: number }
  | { type: 'step_progress'; step: string; message: string; current: number; total: number }
  | { type: 'step_complete'; step: string; count: number; elapsed: number }
  | { type: 'pipeline_complete'; workspace_id: string; summary: PipelineSummary }
  | { type: 'error'; step: string; message: string }

export interface LogLine {
  ts: number
  level: 'info' | 'success' | 'error' | 'warn'
  msg: string
}

export interface PipelineJob {
  id: string
  runNumber: number
  files: string[]
  status: 'running' | 'complete' | 'error'
  startedAt: number
  finishedAt?: number
  steps: PipelineStep[]
  logs: LogLine[]
  summary?: PipelineSummary
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

// ── Document explorer types ───────────────────────────────────────────────────

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

export interface EvidenceConnection {
  id?: string
  type?: string
  text?: string
  source?: string
  page_number?: number
  rel: string
  direction: string
  connections?: EvidenceConnection[]   // 2nd hop
}

export interface CoverageSummary {
  requirements: { total: number; covered: number; partially_covered: number; not_covered: number }
  risks: { total: number; mitigated: number; unmitigated: number; with_ld: number; without_ld: number }
}

export interface EvidenceItem {
  id?: string
  type?: string
  text?: string
  source?: string
  page_number?: number
  status?: string
  requirement?: string
  risk_id?: string
  risk_text?: string
  graphiti_fact?: string
  uuid?: string
  document_id?: string
  connections?: EvidenceConnection[]
  // summary intent
  summary?: CoverageSummary
  // comparison intent — explicit cross-doc edge
  cross_doc_relationship?: string
  from?: { id: string; text: string; source: string; doc: string }
  to?: { id: string; text: string; source: string; doc: string }
  evidence?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  queryType?: string
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
  query_type?: string
  evidence?: EvidenceItem[]
  created_at: string
}

export interface AppStatus {
  has_data: boolean
  nodes: number
  edges: number
  type_counts: Record<string, number>
}

// ── Synthetic Data Studio ─────────────────────────────────────────────────────

export interface StudioProject {
  id: string
  name: string
  description: string
  min_threshold: number
  labels?: string[]
  seed_summary?: { counts?: Record<string, number>; documents?: unknown[] } | null
  created_at: string
  updated_at: string
}

export interface MatrixCellInfo {
  cell: string
  element_type: string
  label: string
  seed_count: number
  generated_count: number
  total: number
  deficit: number
  sufficient: boolean
  recommended: boolean
}

export interface SeedDocument {
  id?: string
  name: string
  type?: string
  elements: number
  error?: string
  cells?: Record<string, number>
  sections?: { heading: string; cells: Record<string, number> }[]
}

export interface StudioOverview {
  project_id: string
  min_threshold: number
  labels?: string[]
  suggested_labels?: string[]
  cells: MatrixCellInfo[]
  under_threshold: string[]
  seed_documents: SeedDocument[]
}

export interface StudioMeta {
  element_types: string[]
  labels: string[]
  doc_types: string[]
  industries: string[]
  languages: string[]
  all_cells: { element_type: string; label: string; key: string }[]
  recommended_cells: string[]
  min_threshold: number
  label_descriptions: Record<string, string>
  record_schema: unknown
  relationship_schema: unknown
}

// A generation target: a fixed cell (Balance mode) or an element type whose
// label the model assigns (Describe mode).
export interface GenSelection { cell?: string; element_type?: string; count: number }

export interface GenKnobs {
  industries?: string[]
  languages?: string[]
  doc_types?: string[]
  generate_relationships?: boolean
  assemble_documents?: boolean
  note?: string
  brief?: string
  mirror_document_id?: string
  split_by_doc_type?: boolean
}

export interface SyntheticRecordT {
  id: string
  project_id: string
  version_id: string | null
  element_type: string
  label: string
  cell: string
  text: string
  rationale: string
  industry: string
  doc_type: string
  language: string
  risk_category: string | null
  clause_structure: string | null
  status: string
  attributes: Record<string, unknown>
  provenance: Record<string, unknown>
  created_at: string | null
}

export interface SyntheticRelationshipT {
  id: string
  source_record_id: string
  target_record_id: string
  rel_type: string
  coverage_label: string | null
  is_positive: boolean
  rationale: string
  status: string
}

export interface ValidationReportT {
  record_id: string
  schema_ok: boolean
  label_ok: boolean
  rules_ok: boolean
  reasons: string[]
}

export interface QualityReportT {
  record_id: string
  realism: number
  is_duplicate: boolean
  duplicate_of: string | null
  near_dup_score: number
  realism_notes: string
}

export interface RecordReports {
  validation?: ValidationReportT
  quality?: QualityReportT
}

export interface DistributionStats {
  total: number
  diversity_score: number
  balance_score: number
  by_cell: Record<string, number>
  by_label: Record<string, number>
  by_element_type: Record<string, number>
  by_doc_type: Record<string, number>
  by_industry: Record<string, number>
  by_language: Record<string, number>
  under_represented: string[]
  over_represented: string[]
  relationships?: { by_type?: Record<string, number>; positive?: number; negative?: number }
}

export interface Publication {
  workspace_id: string
  elements: number
  relationships: number
  at: string
}

export interface VersionStats {
  requested?: number
  generated?: number
  staged: number
  rejected?: number
  duplicates?: number
  relationships: number
  documents: number
  distribution: DistributionStats
  published_to?: Publication[]
  published_to_store?: { count: number; at: string }[]
  cloned_from?: string
  cloned_from_version_no?: number
}

export interface SyntheticDocumentT {
  id: string
  project_id: string
  version_id: string | null
  doc_type: string
  title: string
  member_record_ids: string[]
  // `body` = document-first direct generation (real prose per section);
  // `record_ids` = legacy, parked element-assembled documents.
  sections: { heading: string; body?: string; record_ids?: string[] }[]
  artifact_uri: string
  status: string
  provenance?: Record<string, unknown>
}

// ── Document-first generation (pivot) ───────────────────────────────────────

export interface DocTypeInfo {
  doc_type: string
  seed_count: number
  generated_count: number
  total: number
  threshold: number
  deficit: number
}

export interface DocTypeOverview {
  project_id: string
  min_threshold: number
  doc_types: DocTypeInfo[]
}

// One generation target — how many more of this document type, with an
// optional per-type brief describing what those documents should contain.
export interface DocGenTarget {
  doc_type: string
  count: number
  brief?: string
}

export interface DocGenKnobs {
  industries?: string[]
  languages?: string[]
  note?: string
}

export interface DocSMESummary {
  version_id: string
  reviewable: number
  reviewed: number
  by_verdict: Record<string, number>
  approval_rate: number
  feedback: { document_id: string; verdict: string; comment: string }[]
  complete: boolean
}

export interface DocReviewQueue {
  documents: SyntheticDocumentT[]
  summary: DocSMESummary
}

export interface StoreDocument {
  id: string
  source_project_id: string
  source_version_id: string
  source_document_id: string
  doc_type: string
  title: string
  industry: string
  language: string
  tag: string
  imported_into: { workspace_id: string; at: string }[]
  published_at: string
}

export interface StudioVersion {
  id: string
  dataset_id: string
  project_id: string
  version_no: number
  status: 'staging' | 'main'
  note: string
  artifact_uri: string
  stats: VersionStats | null
  status_counts?: Record<string, number>
  created_at: string
}

export interface SMESummary {
  version_id: string
  reviewable: number
  reviewed: number
  by_verdict: Record<string, number>
  approval_rate: number
  feedback: { record_id: string; verdict: string; comment: string }[]
  complete: boolean
}

export type GenStage =
  | 'queued' | 'start' | 'generate' | 'validate' | 'quality'
  | 'relate' | 'assemble' | 'persist' | 'complete' | 'done' | 'error'

export interface GenEvent {
  stage: GenStage
  message?: string
  current?: number
  total?: number
  cell?: string
  version_id?: string
  summary?: VersionStats & { version_id: string; version_no: number }
}

export interface LineageEdge { from: string; to: string; type: string; created_at: string }
