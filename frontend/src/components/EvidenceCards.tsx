/**
 * Shared evidence card components used by both ChatWindow (floating bubble)
 * and ChatPage (full standalone chat).
 */
import { useState } from 'react'
import { ChevronDown, ChevronUp, BookOpen, GitBranch, ArrowRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import type { EvidenceItem, EvidenceConnection, CoverageSummary } from '../types'

// ── Constants ─────────────────────────────────────────────────────────────────

export const TYPE_COLOR: Record<string, string> = {
  Requirement: '#6366f1',
  Clause:      '#10b981',
  Risk:        '#ef4444',
  Mitigation:  '#f59e0b',
  LD:          '#8b5cf6',
  Document:    '#64748b',
}

export const REL_LABEL: Record<string, string> = {
  COVERS:           'covers',
  PARTIALLY_COVERS: 'partially covers',
  INTRODUCES_RISK:  'introduces risk',
  MITIGATED_BY:     'mitigated by',
  LINKED_TO_LD:     'linked to LD',
  CONTRADICTS:      'contradicts',
  CONTAINS:         'contains',
}

// ── Stat cell ─────────────────────────────────────────────────────────────────

function StatCell({ label, value, color = 'text-foreground' }: {
  label: string; value: number; color?: string
}) {
  return (
    <div className="flex flex-col items-center bg-bg rounded-lg px-2 py-1.5 min-w-0">
      <span className={clsx('text-base font-bold font-mono tabular-nums', color)}>{value}</span>
      <span className="text-[9px] text-muted text-center leading-tight mt-0.5">{label}</span>
    </div>
  )
}

// ── Connection row (recursive for 2-hop) ─────────────────────────────────────

export function ConnectionRow({ conn, depth = 0 }: { conn: EvidenceConnection; depth?: number }) {
  const accent   = conn.type ? (TYPE_COLOR[conn.type] ?? '#64748b') : '#64748b'
  const relLabel = REL_LABEL[conn.rel] ?? conn.rel.toLowerCase().replace(/_/g, ' ')
  const arrow    = conn.direction === 'outgoing' ? '→' : '←'
  const shortText = (conn.text ?? '').length > 90
    ? (conn.text ?? '').slice(0, 90) + '…'
    : (conn.text ?? '')

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <div className="flex items-start gap-1.5 py-0.5">
        <span className="shrink-0 text-[10px] text-muted font-mono w-3 text-center mt-0.5">{arrow}</span>
        <span
          className="shrink-0 text-[9px] font-mono px-1 py-0.5 rounded"
          style={{ color: accent, background: `${accent}18` }}
        >
          {relLabel}
        </span>
        {conn.type && (
          <span className="shrink-0 text-[9px] text-slate-500 font-mono">[{conn.type}]</span>
        )}
        <span className="text-[10px] text-slate-400 leading-tight min-w-0">{shortText}</span>
        {conn.page_number != null && (
          <span className="shrink-0 text-[9px] font-mono text-slate-600">p.{conn.page_number}</span>
        )}
      </div>
      {conn.connections?.map((sub, i) => (
        <ConnectionRow key={i} conn={sub} depth={depth + 1} />
      ))}
    </div>
  )
}

// ── Summary card ──────────────────────────────────────────────────────────────

export function SummaryCard({ summary, index }: { summary: CoverageSummary; index: number }) {
  const { requirements: r, risks: k } = summary
  return (
    <div className="rounded-lg bg-bg border border-border overflow-hidden"
      style={{ borderLeft: '3px solid #10b981' }}>
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-2.5">
          <span className="shrink-0 w-5 h-5 rounded-full bg-border/30 text-muted text-xs font-mono flex items-center justify-center">
            {index + 1}
          </span>
          <span className="text-xs font-semibold text-emerald-400 font-mono">Coverage Summary</span>
        </div>
        {r && (
          <div className="mb-2">
            <p className="text-[9px] text-muted font-mono uppercase tracking-wide mb-1">Requirements</p>
            <div className="grid grid-cols-4 gap-1">
              <StatCell label="Total"       value={r.total} />
              <StatCell label="Covered"     value={r.covered}           color="text-emerald-400" />
              <StatCell label="Partial"     value={r.partially_covered} color="text-amber-400" />
              <StatCell label="Not Covered" value={r.not_covered}       color="text-red-400" />
            </div>
          </div>
        )}
        {k && (
          <div>
            <p className="text-[9px] text-muted font-mono uppercase tracking-wide mb-1">Risks</p>
            <div className="grid grid-cols-4 gap-1">
              <StatCell label="Total"      value={k.total} />
              <StatCell label="Mitigated"  value={k.mitigated}   color="text-emerald-400" />
              <StatCell label="Unmitigated" value={k.unmitigated} color="text-red-400" />
              <StatCell label="With LD"    value={k.with_ld}     color="text-purple-400" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Cross-doc relationship card ───────────────────────────────────────────────

export function CrossDocCard({ item, index }: { item: EvidenceItem; index: number }) {
  const relLabel = item.cross_doc_relationship
    ? (REL_LABEL[item.cross_doc_relationship] ?? item.cross_doc_relationship.toLowerCase().replace(/_/g, ' '))
    : ''
  return (
    <div className="rounded-lg bg-bg border border-border overflow-hidden"
      style={{ borderLeft: '3px solid #06b6d4' }}>
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="shrink-0 w-5 h-5 rounded-full bg-border/30 text-muted text-xs font-mono flex items-center justify-center">
            {index + 1}
          </span>
          <GitBranch size={10} className="text-cyan-400 shrink-0" />
          <span className="text-[10px] font-mono text-cyan-400">{relLabel}</span>
        </div>
        <div className="space-y-1.5 text-[10px]">
          <div className="rounded bg-surface/60 px-2 py-1.5">
            <p className="text-[9px] text-muted font-mono mb-0.5">FROM</p>
            <p className="text-slate-300 leading-tight">{item.from?.text}</p>
            <p className="text-slate-600 font-mono text-[9px] mt-0.5">{item.from?.source}</p>
          </div>
          <div className="flex justify-center">
            <ArrowRight size={10} className="text-cyan-400/50" />
          </div>
          <div className="rounded bg-surface/60 px-2 py-1.5">
            <p className="text-[9px] text-muted font-mono mb-0.5">TO</p>
            <p className="text-slate-300 leading-tight">{item.to?.text}</p>
            <p className="text-slate-600 font-mono text-[9px] mt-0.5">{item.to?.source}</p>
          </div>
          {item.evidence && (
            <p className="text-slate-600 italic text-[9px] pt-0.5">{item.evidence}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Standard evidence card ────────────────────────────────────────────────────

export function EvidenceCard({ item, index }: { item: EvidenceItem; index: number }) {
  const [expanded, setExpanded] = useState(false)

  const id      = item.id ?? item.risk_id ?? undefined
  const type    = item.type ?? (item.risk_text ? 'Risk' : undefined)
  const text    = item.text ?? item.risk_text ?? item.graphiti_fact ?? ''
  const source  = item.source ?? undefined
  const reqRef  = item.requirement ?? undefined
  const status  = item.status ?? undefined

  const accent       = type ? (TYPE_COLOR[type] ?? '#64748b') : '#64748b'
  const hasConns     = (item.connections?.length ?? 0) > 0
  const shortText    = text.length > 100 ? text.slice(0, 100) + '…' : text
  const isExpandable = text.length > 100 || hasConns

  return (
    <div className="rounded-lg bg-bg border border-border overflow-hidden"
      style={{ borderLeft: `3px solid ${accent}` }}>
      <button
        className={clsx(
          'w-full text-left px-3 py-2.5 flex items-start gap-2 transition-colors',
          isExpandable && 'hover:bg-white/[0.02]',
        )}
        onClick={() => isExpandable && setExpanded(v => !v)}
      >
        <span className="shrink-0 w-5 h-5 rounded-full bg-border/30 text-muted text-xs font-mono flex items-center justify-center mt-0.5">
          {index + 1}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            {type && (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded font-mono"
                style={{ color: accent, background: `${accent}18` }}>
                {type}
              </span>
            )}
            {id && <span className="text-xs font-mono text-slate-400">{id}</span>}
            {status && (
              <span className="text-xs font-mono text-danger bg-danger/10 px-1.5 py-0.5 rounded">{status}</span>
            )}
            {reqRef && <span className="text-xs text-muted font-mono">← {reqRef}</span>}
            {hasConns && !expanded && (
              <span className="text-[9px] font-mono text-slate-600 flex items-center gap-0.5">
                <GitBranch size={8} />
                {item.connections!.length} link{item.connections!.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            {expanded ? text : shortText}
          </p>

          {(source || item.page_number != null) && (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {source && <p className="text-xs text-slate-600 font-mono">{source}</p>}
              {item.page_number != null && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-border/20 text-slate-500">
                  p.{item.page_number}
                </span>
              )}
            </div>
          )}

          {expanded && hasConns && (
            <div className="mt-2 pt-2 border-t border-border/30">
              <p className="text-[9px] text-muted font-mono uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <GitBranch size={8} /> Graph connections
              </p>
              <div className="space-y-0.5">
                {item.connections!.map((conn, i) => (
                  <ConnectionRow key={i} conn={conn} />
                ))}
              </div>
            </div>
          )}
        </div>

        {isExpandable && (
          <span className="shrink-0 text-slate-600 mt-1">
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </span>
        )}
      </button>
    </div>
  )
}

// ── Sources section (collapsible list of cards) ───────────────────────────────

export function SourcesSection({ evidence }: { evidence: EvidenceItem[] }) {
  const [open, setOpen] = useState(false)
  if (evidence.length === 0) return null

  return (
    <div className="mt-2 pt-2 border-t border-border/50">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-slate-300 transition-colors w-full"
      >
        <BookOpen size={11} />
        <span className="font-mono">{evidence.length} source{evidence.length !== 1 ? 's' : ''}</span>
        {open ? <ChevronUp size={11} className="ml-auto" /> : <ChevronDown size={11} className="ml-auto" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-1.5">
              {evidence.map((item, i) => {
                if (item.summary)                return <SummaryCard  key={i} summary={item.summary} index={i} />
                if (item.cross_doc_relationship) return <CrossDocCard key={i} item={item} index={i} />
                return                                  <EvidenceCard key={i} item={item} index={i} />
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
