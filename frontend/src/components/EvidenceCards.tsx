import { useState } from 'react'
import { ChevronDown, ChevronUp, BookOpen, GitBranch, ArrowRight, ArrowLeft, Link2 } from 'lucide-react'
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

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1 h-1.5 bg-border/40 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-[11px] font-mono tabular-nums text-muted w-7 text-right shrink-0">{pct}%</span>
    </div>
  )
}

// ── Stat row with progress ────────────────────────────────────────────────────

function StatRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-xs font-mono font-bold tabular-nums" style={{ color }}>{value}</span>
      </div>
      <ProgressBar value={value} max={total} color={color} />
    </div>
  )
}

// ── Connection row (recursive, with tree lines) ───────────────────────────────

export function ConnectionRow({ conn, depth = 0 }: { conn: EvidenceConnection; depth?: number }) {
  const accent   = conn.type ? (TYPE_COLOR[conn.type] ?? '#64748b') : '#64748b'
  const relLabel = REL_LABEL[conn.rel] ?? conn.rel.toLowerCase().replace(/_/g, ' ')
  const isOut    = conn.direction === 'outgoing'
  const shortText = (conn.text ?? '').length > 100
    ? (conn.text ?? '').slice(0, 100) + '…'
    : (conn.text ?? '')

  return (
    <div className={clsx('relative', depth > 0 && 'ml-3 pl-3 border-l border-border/40')}>
      <div className="flex items-start gap-2 py-1">
        <span className="shrink-0 mt-[3px] text-muted/50">
          {isOut
            ? <ArrowRight size={10} />
            : <ArrowLeft  size={10} />
          }
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-[11px] font-medium px-1.5 py-0.5 rounded"
              style={{ color: accent, background: `${accent}20` }}
            >
              {relLabel}
            </span>
            {conn.type && (
              <span
                className="text-[10px] font-mono px-1 py-0.5 rounded border"
                style={{ color: `${accent}bb`, borderColor: `${accent}35` }}
              >
                {conn.type}
              </span>
            )}
            {conn.page_number != null && (
              <span className="ml-auto text-[10px] font-mono text-muted/50 shrink-0">p.{conn.page_number}</span>
            )}
          </div>
          {shortText && (
            <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">{shortText}</p>
          )}
        </div>
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
    <div className="rounded-xl bg-bg border border-border overflow-hidden"
      style={{ borderLeft: '3px solid #10b981' }}>

      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-emerald-500/5">
        <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-mono flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <span className="text-xs font-semibold text-emerald-400 tracking-wide">Coverage Summary</span>
      </div>

      <div className="px-4 py-3 space-y-4">
        {r && (
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-semibold text-foreground">Requirements</p>
              <span className="text-[11px] font-mono text-muted bg-border/30 px-2 py-0.5 rounded">{r.total} total</span>
            </div>
            <div className="space-y-2.5">
              <StatRow label="Covered"     value={r.covered}           total={r.total} color="#10b981" />
              <StatRow label="Partial"     value={r.partially_covered} total={r.total} color="#f59e0b" />
              <StatRow label="Not Covered" value={r.not_covered}       total={r.total} color="#ef4444" />
            </div>
          </div>
        )}

        {r && k && <div className="border-t border-border/40" />}

        {k && (
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-semibold text-foreground">Risks</p>
              <span className="text-[11px] font-mono text-muted bg-border/30 px-2 py-0.5 rounded">{k.total} total</span>
            </div>
            <div className="space-y-2.5">
              <StatRow label="Mitigated"   value={k.mitigated}   total={k.total} color="#10b981" />
              <StatRow label="Unmitigated" value={k.unmitigated} total={k.total} color="#ef4444" />
              <StatRow label="With LD"     value={k.with_ld}     total={k.total} color="#8b5cf6" />
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
    <div className="rounded-xl bg-bg border border-border overflow-hidden"
      style={{ borderLeft: '3px solid #06b6d4' }}>

      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-cyan-500/5">
        <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] font-mono flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <Link2 size={11} className="text-cyan-400 shrink-0" />
        <span className="text-xs font-semibold text-cyan-400 capitalize">{relLabel}</span>
        <span className="ml-auto text-[10px] font-mono text-muted/60 bg-border/20 px-1.5 py-0.5 rounded">
          cross-document
        </span>
      </div>

      <div className="px-4 py-3 space-y-1.5">
        <div className="rounded-lg border border-border/50 bg-surface/50 px-3 py-2.5">
          <p className="text-[10px] font-mono text-muted/70 uppercase tracking-wider mb-1">From</p>
          <p className="text-xs text-foreground/90 leading-relaxed">{item.from?.text}</p>
          {item.from?.source && (
            <p className="text-[11px] font-mono text-muted/50 mt-1">{item.from.source}</p>
          )}
        </div>

        <div className="flex items-center justify-center py-0.5 gap-1">
          <div className="h-px w-8 bg-cyan-500/25" />
          <ArrowRight size={10} className="text-cyan-500/50 shrink-0" />
        </div>

        <div className="rounded-lg border border-border/50 bg-surface/50 px-3 py-2.5">
          <p className="text-[10px] font-mono text-muted/70 uppercase tracking-wider mb-1">To</p>
          <p className="text-xs text-foreground/90 leading-relaxed">{item.to?.text}</p>
          {item.to?.source && (
            <p className="text-[11px] font-mono text-muted/50 mt-1">{item.to.source}</p>
          )}
        </div>

        {item.evidence && (
          <p className="text-[11px] text-muted italic pt-0.5">{item.evidence}</p>
        )}
      </div>
    </div>
  )
}

// ── Standard evidence card ────────────────────────────────────────────────────

export function EvidenceCard({ item, index }: { item: EvidenceItem; index: number }) {
  const [expanded, setExpanded] = useState(false)

  const id       = item.id ?? item.risk_id ?? undefined
  const type     = item.type ?? (item.risk_text ? 'Risk' : undefined)
  const text     = item.text ?? item.risk_text ?? item.graphiti_fact ?? ''
  const source   = item.source ?? undefined
  const reqRef   = item.requirement ?? undefined
  const status   = item.status ?? undefined

  const accent       = type ? (TYPE_COLOR[type] ?? '#64748b') : '#64748b'
  const hasConns     = (item.connections?.length ?? 0) > 0
  const isLong       = text.length > 110
  const isExpandable = isLong || hasConns

  return (
    <div className="rounded-xl bg-bg border border-border overflow-hidden"
      style={{ borderLeft: `3px solid ${accent}` }}>

      {/* Card header — always visible */}
      <button
        className={clsx(
          'w-full text-left px-4 py-3 transition-colors',
          isExpandable ? 'hover:bg-white/[0.02] cursor-pointer' : 'cursor-default',
        )}
        onClick={() => isExpandable && setExpanded(v => !v)}
      >
        <div className="flex items-start gap-3">
          {/* Index badge */}
          <span
            className="shrink-0 w-5 h-5 rounded-full text-[10px] font-mono flex items-center justify-center mt-0.5"
            style={{ color: accent, background: `${accent}22` }}
          >
            {index + 1}
          </span>

          <div className="flex-1 min-w-0">
            {/* Badges */}
            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
              {type && (
                <span
                  className="text-[11px] font-semibold font-mono px-1.5 py-0.5 rounded"
                  style={{ color: accent, background: `${accent}20` }}
                >
                  {type}
                </span>
              )}
              {id && <span className="text-[11px] font-mono text-muted/70">{id}</span>}
              {status && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-danger/10 text-danger border border-danger/20">
                  {status}
                </span>
              )}
              {reqRef && <span className="text-[11px] text-muted font-mono">← {reqRef}</span>}

              {hasConns && (
                <span
                  className="ml-auto flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
                  style={{ color: `${accent}99`, background: `${accent}12` }}
                >
                  <GitBranch size={9} />
                  {item.connections!.length}
                </span>
              )}
            </div>

            {/* Text */}
            <p className="text-xs text-foreground/80 leading-relaxed">
              {expanded || !isLong ? text : text.slice(0, 110) + '…'}
            </p>

            {/* Source + page */}
            {(source || item.page_number != null) && (
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {source && <span className="text-[11px] font-mono text-muted/55">{source}</span>}
                {item.page_number != null && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-border/25 text-muted/60">
                    p.{item.page_number}
                  </span>
                )}
              </div>
            )}
          </div>

          {isExpandable && (
            <span className="shrink-0 text-muted/35 mt-0.5">
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </span>
          )}
        </div>
      </button>

      {/* Connections tree */}
      <AnimatePresence>
        {expanded && hasConns && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 border-t border-border/40">
              <p className="flex items-center gap-1.5 text-[10px] font-mono text-muted/50 uppercase tracking-widest py-2">
                <GitBranch size={9} /> Graph connections
              </p>
              <div className="space-y-0">
                {item.connections!.map((conn, i) => (
                  <ConnectionRow key={i} conn={conn} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Sources section ───────────────────────────────────────────────────────────

export function SourcesSection({ evidence }: { evidence: EvidenceItem[] }) {
  const [open, setOpen] = useState(false)
  if (evidence.length === 0) return null

  const dotColors = evidence.slice(0, 6).map(item => {
    if (item.summary)                return '#10b981'
    if (item.cross_doc_relationship) return '#06b6d4'
    const t = item.type ?? (item.risk_text ? 'Risk' : undefined)
    return t ? (TYPE_COLOR[t] ?? '#64748b') : '#64748b'
  })

  return (
    <div className="mt-3 pt-2.5 border-t border-border/40">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full group py-0.5"
      >
        {/* Color dot strip */}
        <div className="flex items-center -space-x-1 shrink-0">
          {dotColors.map((color, i) => (
            <span
              key={i}
              className="w-2.5 h-2.5 rounded-full border border-surface/80"
              style={{ background: color }}
            />
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted group-hover:text-slate-300 transition-colors">
          <BookOpen size={11} />
          <span>{evidence.length} source{evidence.length !== 1 ? 's' : ''}</span>
        </div>

        <span className="ml-auto text-muted/40 group-hover:text-muted transition-colors">
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
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
            <div className="mt-2.5 space-y-2">
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
