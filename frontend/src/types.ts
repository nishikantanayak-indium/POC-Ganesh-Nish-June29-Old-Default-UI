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

export interface EvidenceItem {
  id?: string
  type?: string
  text?: string
  source?: string
  status?: string
  requirement?: string
  risk_id?: string
  risk_text?: string
  graphiti_fact?: string
  uuid?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  queryType?: string
  evidence?: EvidenceItem[]
  timestamp: number
}

export interface AppStatus {
  has_data: boolean
  nodes: number
  edges: number
  type_counts: Record<string, number>
}
