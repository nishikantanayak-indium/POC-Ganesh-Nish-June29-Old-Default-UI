import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'

import { fetchChain } from '../api/client'
import type { CoverageResult, CoverageStatus, TraceabilityChain, ChainElement } from '../types'

// ── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<CoverageStatus, { icon: string; color: string; bg: string; label: string }> = {
  'Covered':          { icon: '✓', color: '#10b981', bg: '#064e3b', label: 'Covered' },
  'Partially Covered':{ icon: '~', color: '#f59e0b', bg: '#451a03', label: 'Partial' },
  'Not Covered':      { icon: '✗', color: '#ef4444', bg: '#450a0a', label: 'Not Covered' },
}

// ── Element type accent colors ────────────────────────────────────────────────
const TYPE_ACCENT: Record<string, string> = {
  Clause:     '#10b981',
  Risk:       '#ef4444',
  Mitigation: '#f59e0b',
  LD:         '#8b5cf6',
}
function accentFor(type: string): string {
  return TYPE_ACCENT[type] ?? '#6366f1'
}

// ── ChainElement card ─────────────────────────────────────────────────────────
function ElementCard({ elem }: { elem: ChainElement }) {
  const [expanded, setExpanded] = useState(false)
  const accent = accentFor(elem.type)
  const preview = elem.text.slice(0, 100)
  const hasMore = elem.text.length > 100

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      style={{ borderLeft: `3px solid ${accent}` }}
      className="bg-card rounded-lg p-3 mb-2 border border-border cursor-pointer hover:border-white/20 transition-colors"
      onClick={() => hasMore && setExpanded(v => !v)}
    >
      {/* Row 1: type pill + id + relationship badge + inter/intra */}
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span
          style={{ color: accent, borderColor: `${accent}44`, background: `${accent}18` }}
          className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded border"
        >
          {elem.type}
        </span>
        <span className="font-mono text-[11px] text-white font-semibold">{elem.id}</span>

        <span className="ml-auto flex items-center gap-1.5">
          {/* Relationship badge */}
          <span className="text-[9px] font-mono text-slate-400 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded">
            {elem.relationship.replace(/_/g, ' ')}
          </span>
          {/* Inter/Intra badge */}
          {elem.is_inter_document ? (
            <span className="text-[9px] font-bold text-blue-300 bg-blue-900/40 border border-blue-700/50 px-1.5 py-0.5 rounded tracking-wide">
              ↔ INTER
            </span>
          ) : (
            <span className="text-[9px] font-bold text-slate-400 bg-slate-800/60 border border-slate-700/50 px-1.5 py-0.5 rounded tracking-wide">
              ↕ INTRA
            </span>
          )}
        </span>
      </div>

      {/* Row 2: text preview */}
      <p className="text-[11px] text-slate-300 leading-relaxed">
        {expanded ? elem.text : preview}
        {!expanded && hasMore && <span className="text-slate-500">… <span className="text-primary text-[10px]">show more</span></span>}
      </p>

      {/* Row 3: source */}
      <p className="text-[9px] text-slate-500 font-mono mt-1.5 truncate">{elem.source}</p>
    </motion.div>
  )
}

// ── Column ────────────────────────────────────────────────────────────────────
function Column({
  title,
  color,
  items,
}: {
  title: string
  color: string
  items: ChainElement[]
}) {
  return (
    <div className="flex flex-col min-w-0 flex-1">
      {/* Sticky header */}
      <div
        style={{ borderBottom: `2px solid ${color}55`, background: `${color}12` }}
        className="sticky top-0 z-10 px-3 py-2 flex items-center justify-between"
      >
        <span style={{ color }} className="text-xs font-semibold tracking-wide uppercase">
          {title}
        </span>
        <span
          style={{ color, borderColor: `${color}44`, background: `${color}22` }}
          className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full border"
        >
          {items.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <p className="text-slate-600 text-sm text-center mt-6">—</p>
        ) : (
          items.map(e => <ElementCard key={e.id + e.relationship} elem={e} />)
        )}
      </div>
    </div>
  )
}

// ── Inter/Intra summary row ───────────────────────────────────────────────────
function InterIntraSummary({ chain }: { chain: TraceabilityChain }) {
  const allItems = [
    ...chain.full_coverage,
    ...chain.partial_coverage,
    ...chain.risks,
    ...chain.mitigations,
    ...chain.lds,
  ]
  const interCount = allItems.filter(e => e.is_inter_document).length
  const intraCount = allItems.length - interCount

  return (
    <div className="shrink-0 flex gap-3 px-4 py-3 border-t border-border bg-surface">
      <div className="flex items-center gap-2 bg-blue-900/30 border border-blue-700/40 rounded-lg px-4 py-2">
        <span className="text-sm font-bold text-blue-300 font-mono">{interCount}</span>
        <span className="text-xs text-blue-400">↔ Inter-document</span>
      </div>
      <div className="flex items-center gap-2 bg-slate-800/50 border border-slate-700/40 rounded-lg px-4 py-2">
        <span className="text-sm font-bold text-slate-300 font-mono">{intraCount}</span>
        <span className="text-xs text-slate-400">↕ Intra-document</span>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TraceabilityView({ coverage }: { coverage: CoverageResult[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [chain, setChain] = useState<TraceabilityChain | null>(null)
  const [loading, setLoading] = useState(false)

  const loadChain = useCallback(async (reqId: string) => {
    setSelected(reqId)
    setLoading(true)
    try {
      const c = await fetchChain(reqId)
      setChain(c)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  if (coverage.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted text-sm">No requirements found — run the pipeline first.</p>
      </div>
    )
  }

  const covered    = coverage.filter(r => r.status === 'Covered').length
  const partial    = coverage.filter(r => r.status === 'Partially Covered').length
  const notCovered = coverage.filter(r => r.status === 'Not Covered').length
  const total      = coverage.length
  const score      = total > 0 ? ((covered + partial * 0.5) / total) * 100 : 0

  return (
    <div className="h-full flex overflow-hidden">
      {/* ── Left panel — requirements list ─────────────────────────────── */}
      <div className="w-[320px] shrink-0 flex flex-col border-r border-border overflow-hidden">
        {/* Summary */}
        <div className="p-4 border-b border-border bg-surface shrink-0">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <MetricCard value={covered}    label="Covered"  color="#10b981" />
            <MetricCard value={partial}    label="Partial"  color="#f59e0b" />
            <MetricCard value={notCovered} label="Gap"      color="#ef4444" />
          </div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted">Coverage score</span>
            <span className="font-mono text-white font-semibold">{score.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-card rounded-full overflow-hidden">
            <div className="h-full bg-success rounded-full transition-all" style={{ width: `${score}%` }} />
          </div>
        </div>

        {/* Requirement list */}
        <div className="flex-1 overflow-y-auto">
          {coverage.map(r => {
            const cfg = STATUS_CONFIG[r.status]
            const isSelected = selected === r.requirement_id
            return (
              <button
                key={r.requirement_id}
                onClick={() => loadChain(r.requirement_id)}
                className={clsx(
                  'w-full text-left px-4 py-3 border-b border-border transition-all flex items-start gap-3',
                  isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-card',
                )}
              >
                <span style={{ color: cfg.color }} className="shrink-0 mt-0.5">{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-white font-semibold">{r.requirement_id}</span>
                    <span className="shrink-0">
                      <ChevronRight size={12} className={clsx('text-muted transition-transform', isSelected && 'rotate-90')} />
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5 line-clamp-2">{r.requirement_text}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span style={{ color: cfg.color, borderColor: `${cfg.color}44` }}
                      className="text-xs font-medium px-2 py-0.5 rounded-full border bg-transparent">
                      {cfg.label}
                    </span>
                    {r.covering_clauses.length > 0 && (
                      <span className="text-xs text-muted">{r.covering_clauses.length} clause{r.covering_clauses.length > 1 ? 's' : ''}</span>
                    )}
                    {r.risks.length > 0 && (
                      <span className="text-xs text-danger">{r.risks.length} risk{r.risks.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Right panel — chain detail ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted text-sm">← Select a requirement to see its lineage</p>
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : chain ? (
          <>
            {/* Header bar */}
            <div className="shrink-0 px-4 py-3 border-b border-border bg-surface flex items-center gap-3 flex-wrap">
              <span className="font-mono text-sm font-bold text-white">{chain.requirement.id}</span>
              <span className="text-xs text-slate-400 truncate max-w-xs">{chain.requirement.text.slice(0, 80)}{chain.requirement.text.length > 80 ? '…' : ''}</span>
              <span className="ml-auto text-[10px] font-mono text-slate-500 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">
                {chain.requirement.source}
              </span>
            </div>

            {/* 4 columns */}
            <div className="flex-1 flex overflow-hidden divide-x divide-border">
              <Column
                title="Clauses"
                color="#10b981"
                items={[...chain.full_coverage, ...chain.partial_coverage]}
              />
              <Column
                title="Risks"
                color="#ef4444"
                items={chain.risks}
              />
              <Column
                title="Mitigations"
                color="#f59e0b"
                items={chain.mitigations}
              />
              <Column
                title="LDs"
                color="#8b5cf6"
                items={chain.lds}
              />
            </div>

            {/* Inter/Intra summary */}
            <InterIntraSummary chain={chain} />

            {/* Gaps alert */}
            {chain.gaps.length > 0 && (
              <div className="shrink-0 mx-4 mb-3 bg-danger/10 border border-danger/30 rounded-xl p-3 flex gap-2">
                <AlertTriangle size={14} className="text-danger shrink-0 mt-0.5" />
                <div>
                  <p className="text-danger text-xs font-semibold mb-1">Gaps identified</p>
                  {chain.gaps.map((g, i) => (
                    <p key={i} className="text-xs text-muted">• {g}</p>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

function MetricCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="text-center p-2 rounded-lg bg-card border border-border">
      <div style={{ color }} className="text-xl font-bold font-mono">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )
}
