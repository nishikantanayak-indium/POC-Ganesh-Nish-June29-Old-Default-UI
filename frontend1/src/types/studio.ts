// Synthetic Data Studio domain types — mirrors backend/synthetic/models.py and
// api/routes/synthetic.py.

import type { ElementType, RelationshipType, CoverageStatus } from './analysis'

export type TaxonomyLabel =
  | 'Legal'
  | 'Financial'
  | 'Technical'
  | 'KPI'
  | 'Risk'
  | 'Compliance'
  | 'Liquidated Damages'

export type RecordStatus =
  | 'candidate'
  | 'rejected'
  | 'duplicate'
  | 'staged'
  | 'sme_approved'
  | 'sme_rejected'
  | 'published'

export type SMEVerdict = 'approve' | 'reject' | 'edit'
export type DatasetStatus = 'staging' | 'main'

export interface MatrixCellInfo {
  element_type: ElementType
  label: TaxonomyLabel
  key: string
  seed_count: number
  target_count?: number
  gap: number
}

export interface StudioProject {
  id: string
  name: string
  description?: string
  min_threshold: number
  labels: TaxonomyLabel[]
  created_at: string
  updated_at: string
}

export interface StudioMeta {
  element_types: ElementType[]
  labels: TaxonomyLabel[]
  doc_types: string[]
  industries: string[]
  languages: string[]
  matrix_cells: MatrixCellInfo[]
  thresholds: Record<string, number>
}

export interface SeedDocument {
  id: string
  name: string
  doc_type: string
  element_count: number
}

export interface StudioOverview {
  project_id: string
  cells: MatrixCellInfo[]
  seed_documents: SeedDocument[]
}

export interface DocTypeInfo {
  doc_type: string
  seed_count: number
  target_count?: number
  gap: number
}

export interface DocTypeOverview {
  project_id: string
  doc_types: DocTypeInfo[]
}

export interface GenSelection {
  cell: string
  count: number
}

export interface GenKnobs {
  industries?: string[]
  languages?: string[]
  note?: string
}

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

export type GenStage = 'queued' | 'running' | 'validating' | 'scoring' | 'done' | 'error'

export interface GenEvent {
  stage: GenStage
  message?: string
  progress?: number
  summary?: {
    version_id: string
    generated: number
    approved: number
    rejected: number
  }
  error?: string
}

export interface SyntheticRecordT {
  id: string
  project_id: string
  element_type: ElementType
  label: TaxonomyLabel
  text: string
  rationale?: string
  industry?: string
  doc_type: string
  language: string
  status: RecordStatus
  version_id: string
  created_at: string
}

export interface SyntheticRelationshipT {
  id: string
  project_id: string
  source_record_id: string
  target_record_id: string
  rel_type: RelationshipType
  coverage_label?: CoverageStatus
  is_positive: boolean
  status: RecordStatus
  version_id: string
}

export interface ValidationReportT {
  record_id: string
  schema_ok: boolean
  label_ok: boolean
  rules_ok: boolean
  reasons: string[]
  passed: boolean
}

export interface QualityReportT {
  record_id: string
  realism: number
  is_duplicate: boolean
  duplicate_of?: string
  near_dup_score?: number
  realism_notes?: string
  passed: boolean
}

export interface RecordReports {
  validation?: ValidationReportT
  quality?: QualityReportT
}

export interface DistributionStats {
  by_element_type: Record<string, number>
  by_label: Record<string, number>
  by_doc_type: Record<string, number>
}

export interface Publication {
  workspace_id: string
  published_at: string
  count: number
}

export interface VersionStats {
  records: number
  approved: number
  rejected: number
  documents: number
}

export interface StudioVersion {
  id: string
  project_id: string
  status: DatasetStatus
  stats: VersionStats
  created_at: string
}

export interface SyntheticDocSection {
  heading: string
  record_ids: string[]
  body: string
}

export interface SyntheticDocumentT {
  id: string
  project_id: string
  version_id: string
  doc_type: string
  title: string
  member_record_ids: string[]
  sections: SyntheticDocSection[]
  status: RecordStatus
  created_at: string
}

export interface DocSMESummary {
  total: number
  approved: number
  rejected: number
  edited: number
  pending: number
}

export interface DocReviewQueue {
  documents: SyntheticDocumentT[]
  summary: DocSMESummary
}

export interface SMESummary {
  total: number
  approved: number
  rejected: number
  edited: number
  pending: number
}

export interface StoreDocument {
  id: string
  source_project_id: string
  source_version_id: string
  source_document_id: string
  doc_type: string
  title: string
  industry?: string
  language?: string
  tag?: string
  imported_into: string[]
  published_at: string
}

export interface LineageEdge {
  source_id: string
  target_id: string
  relation: string
}
