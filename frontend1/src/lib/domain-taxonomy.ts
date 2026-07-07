// Canonical domain vocabulary: element types, relationship types, coverage statuses,
// and chat query-type intents mapped to the new semantic design tokens + labels.
// Equivalent to the POC's theme/domainColors.ts but restyled to the enterprise palette.

import type { CoverageStatus, ElementType, QueryType, RelationshipType } from '@/types/analysis'
import type { SMEVerdict } from '@/types/studio'

interface Swatch {
  label: string
  badgeClass: string // background + text + border for pill/badge usage
  dotClass: string // solid background for small indicator dots / graph nodes
  textClass: string // text-only color for inline emphasis
}

export const ELEMENT_TYPE_STYLES: Record<ElementType, Swatch> = {
  Document: {
    label: 'Document',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    dotClass: 'bg-slate-400',
    textClass: 'text-slate-600 dark:text-slate-300',
  },
  Requirement: {
    label: 'Requirement',
    badgeClass: 'bg-navy-50 text-navy-700 border-navy-200 dark:bg-navy-900/40 dark:text-navy-200 dark:border-navy-700',
    dotClass: 'bg-navy-600',
    textClass: 'text-navy-700 dark:text-navy-300',
  },
  Clause: {
    label: 'Clause',
    badgeClass: 'bg-accent-50 text-accent-700 border-accent-200 dark:bg-accent-900/30 dark:text-accent-200 dark:border-accent-800',
    dotClass: 'bg-accent-500',
    textClass: 'text-accent-700 dark:text-accent-300',
  },
  Risk: {
    label: 'Risk',
    badgeClass: 'bg-danger-50 text-danger-700 border-danger-100 dark:bg-danger-700/20 dark:text-danger-400 dark:border-danger-700/40',
    dotClass: 'bg-danger-500',
    textClass: 'text-danger-600 dark:text-danger-400',
  },
  Mitigation: {
    label: 'Mitigation',
    badgeClass: 'bg-success-50 text-success-700 border-success-100 dark:bg-success-700/20 dark:text-success-400 dark:border-success-700/40',
    dotClass: 'bg-success-500',
    textClass: 'text-success-600 dark:text-success-400',
  },
  LD: {
    label: 'Liquidated Damages',
    badgeClass: 'bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-700/20 dark:text-warning-400 dark:border-warning-700/40',
    dotClass: 'bg-warning-500',
    textClass: 'text-warning-600 dark:text-warning-400',
  },
}

export const RELATIONSHIP_TYPE_STYLES: Record<RelationshipType, Swatch> = {
  CONTAINS: {
    label: 'Contains',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
    dotClass: 'bg-slate-400',
    textClass: 'text-slate-500',
  },
  COVERS: {
    label: 'Covers',
    badgeClass: 'bg-success-50 text-success-700 border-success-100 dark:bg-success-700/20 dark:text-success-400 dark:border-success-700/40',
    dotClass: 'bg-success-500',
    textClass: 'text-success-600',
  },
  PARTIALLY_COVERS: {
    label: 'Partially Covers',
    badgeClass: 'bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-700/20 dark:text-warning-400 dark:border-warning-700/40',
    dotClass: 'bg-warning-500',
    textClass: 'text-warning-600',
  },
  INTRODUCES_RISK: {
    label: 'Introduces Risk',
    badgeClass: 'bg-danger-50 text-danger-700 border-danger-100 dark:bg-danger-700/20 dark:text-danger-400 dark:border-danger-700/40',
    dotClass: 'bg-danger-500',
    textClass: 'text-danger-600',
  },
  MITIGATED_BY: {
    label: 'Mitigated By',
    badgeClass: 'bg-success-50 text-success-700 border-success-100 dark:bg-success-700/20 dark:text-success-400 dark:border-success-700/40',
    dotClass: 'bg-success-500',
    textClass: 'text-success-600',
  },
  LINKED_TO_LD: {
    label: 'Linked to LD',
    badgeClass: 'bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-700/20 dark:text-warning-400 dark:border-warning-700/40',
    dotClass: 'bg-warning-500',
    textClass: 'text-warning-600',
  },
  CONTRADICTS: {
    label: 'Contradicts',
    badgeClass: 'bg-danger-100 text-danger-700 border-danger-200 dark:bg-danger-700/30 dark:text-danger-300 dark:border-danger-700/50',
    dotClass: 'bg-danger-600',
    textClass: 'text-danger-700',
  },
}

export const COVERAGE_STATUS_STYLES: Record<CoverageStatus, Swatch> = {
  Covered: {
    label: 'Covered',
    badgeClass: 'bg-success-50 text-success-700 border-success-100 dark:bg-success-700/20 dark:text-success-400 dark:border-success-700/40',
    dotClass: 'bg-success-500',
    textClass: 'text-success-600',
  },
  'Partially Covered': {
    label: 'Partially Covered',
    badgeClass: 'bg-warning-50 text-warning-700 border-warning-100 dark:bg-warning-700/20 dark:text-warning-400 dark:border-warning-700/40',
    dotClass: 'bg-warning-500',
    textClass: 'text-warning-600',
  },
  'Not Covered': {
    label: 'Not Covered',
    badgeClass: 'bg-danger-50 text-danger-700 border-danger-100 dark:bg-danger-700/20 dark:text-danger-400 dark:border-danger-700/40',
    dotClass: 'bg-danger-500',
    textClass: 'text-danger-600',
  },
}

export const QUERY_TYPE_LABELS: Record<QueryType, string> = {
  coverage_gap: 'Coverage Gap',
  risk_for_partial: 'Risk for Partial Coverage',
  no_mitigation: 'Unmitigated Risk',
  no_ld: 'Missing Liquidated Damages',
  summary: 'Summary',
  comparison: 'Comparison',
  general: 'General',
}

export const SME_VERDICT_STYLES: Record<SMEVerdict, Swatch> = {
  approve: {
    label: 'Approved',
    badgeClass: 'bg-success-50 text-success-700 border-success-100 dark:bg-success-700/20 dark:text-success-400 dark:border-success-700/40',
    dotClass: 'bg-success-500',
    textClass: 'text-success-600',
  },
  reject: {
    label: 'Rejected',
    badgeClass: 'bg-danger-50 text-danger-700 border-danger-100 dark:bg-danger-700/20 dark:text-danger-400 dark:border-danger-700/40',
    dotClass: 'bg-danger-500',
    textClass: 'text-danger-600',
  },
  edit: {
    label: 'Edited',
    badgeClass: 'bg-info-50 text-info-700 border-info-100 dark:bg-info-700/20 dark:text-info-400 dark:border-info-700/40',
    dotClass: 'bg-info-500',
    textClass: 'text-info-600',
  },
}

export const PUBLISHED_STYLE: Swatch = {
  label: 'Published',
  badgeClass: 'bg-navy-50 text-navy-700 border-navy-200 dark:bg-navy-900/40 dark:text-navy-200 dark:border-navy-700',
  dotClass: 'bg-navy-600',
  textClass: 'text-navy-700 dark:text-navy-300',
}

export function elementStyle(type: ElementType): Swatch {
  return ELEMENT_TYPE_STYLES[type] ?? ELEMENT_TYPE_STYLES.Document
}

export function relationshipStyle(type: RelationshipType): Swatch {
  return RELATIONSHIP_TYPE_STYLES[type] ?? RELATIONSHIP_TYPE_STYLES.CONTAINS
}

export function coverageStyle(status: CoverageStatus): Swatch {
  return COVERAGE_STATUS_STYLES[status] ?? COVERAGE_STATUS_STYLES['Not Covered']
}
