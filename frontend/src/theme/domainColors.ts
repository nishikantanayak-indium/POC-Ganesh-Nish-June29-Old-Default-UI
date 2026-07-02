/**
 * Single source of truth for element/relationship/status colors used across
 * the Graph, Traceability, Evidence and Chat views. Every color here is a
 * `var(--...)` reference into src/index.css — changing the palette only
 * ever means editing that one file, never these maps.
 */

export const TYPE_COLOR: Record<string, string> = {
  Requirement: 'var(--type-requirement)',
  Clause: 'var(--type-clause)',
  Risk: 'var(--type-risk)',
  Mitigation: 'var(--type-mitigation)',
  LD: 'var(--type-ld)',
  Document: 'var(--type-document)',
}

export const TYPE_LABEL: Record<string, string> = {
  Requirement: 'REQ',
  Clause: 'CLS',
  Risk: 'RSK',
  Mitigation: 'MIT',
  LD: 'LD',
  Document: 'DOC',
}

export function typeColor(type: string | undefined): string {
  return TYPE_COLOR[type ?? ''] ?? TYPE_COLOR.Document
}

/** A tinted background derived from a type's color, blended onto the card surface. */
export function typeTint(type: string | undefined, amount = 45): string {
  return `color-mix(in srgb, ${typeColor(type)} ${amount}%, var(--card))`
}

export const REL_COLOR: Record<string, string> = {
  COVERS: 'var(--rel-covers)',
  PARTIALLY_COVERS: 'var(--rel-partial-covers)',
  INTRODUCES_RISK: 'var(--rel-introduces-risk)',
  MITIGATED_BY: 'var(--rel-mitigated-by)',
  LINKED_TO_LD: 'var(--rel-linked-to-ld)',
  CONTRADICTS: 'var(--rel-contradicts)',
  CONTAINS: 'var(--rel-contains)',
}

export function relColor(rtype: string | undefined): string {
  return REL_COLOR[rtype ?? ''] ?? REL_COLOR.CONTAINS
}

/** Coverage-status colors (Traceability view) — these map 1:1 onto the status palette. */
export const STATUS_COLOR: Record<string, string> = {
  'Covered': 'var(--success)',
  'Partially Covered': 'var(--warning)',
  'Not Covered': 'var(--danger)',
}

export function statusColor(status: string | undefined): string {
  return STATUS_COLOR[status ?? ''] ?? 'var(--muted)'
}

/** Chat query-type badge colors, keyed by the backend's classified intent. */
export const QUERY_TYPE: Record<string, { label: string; color: string }> = {
  coverage_gap: { label: 'Coverage Gap', color: 'var(--danger)' },
  risk_for_partial: { label: 'Risk / Partial', color: 'var(--warning)' },
  no_mitigation: { label: 'No Mitigation', color: 'var(--type-ld)' },
  no_ld: { label: 'No LD', color: 'var(--primary)' },
  summary: { label: 'Summary', color: 'var(--success)' },
  comparison: { label: 'Comparison', color: 'var(--chart-2)' },
  general: { label: 'Semantic Search', color: 'var(--success)' },
}

export function queryType(intent: string | undefined): { label: string; color: string } {
  return QUERY_TYPE[intent ?? ''] ?? { label: intent ?? 'Query', color: 'var(--muted)' }
}

/** A tinted badge background derived from a query-type's color. */
export function queryTypeTint(intent: string | undefined): string {
  return `color-mix(in srgb, ${queryType(intent).color} 15%, transparent)`
}
