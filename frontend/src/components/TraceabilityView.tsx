import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'

import { fetchChain } from '../api/client'
import type { CoverageResult, CoverageStatus, TraceabilityChain, ChainElement } from '../types'
import { statusColor, typeColor } from '../theme/domainColors'

// ── Status config ────────────────────────────────────────────────────────────
const STATUS_ICON: Record<CoverageStatus, string> = {
  'Covered': '✓', 'Partially Covered': '~', 'Not Covered': '✗',
}
const STATUS_LABEL: Record<CoverageStatus, string> = {
  'Covered': 'Covered', 'Partially Covered': 'Partial', 'Not Covered': 'Not Covered',
}
const STATUS_CONFIG: Record<CoverageStatus, { icon: string; color: string; label: string }> = {
  'Covered':           { icon: STATUS_ICON.Covered, color: statusColor('Covered'), label: STATUS_LABEL.Covered },
  'Partially Covered': { icon: STATUS_ICON['Partially Covered'], color: statusColor('Partially Covered'), label: STATUS_LABEL['Partially Covered'] },
  'Not Covered':       { icon: STATUS_ICON['Not Covered'], color: statusColor('Not Covered'), label: STATUS_LABEL['Not Covered'] },
}

// ── Element type accent colors ────────────────────────────────────────────────
function accentFor(type: string): string {
  return typeColor(type)
}

// ── ChainElement card ─────────────────────────────────────────────────────────
function ElementCard({ elem }: { elem: ChainElement }) {
  const [expanded, setExpanded] = useState(false)
  const accent = accentFor(elem.type)
  const PREVIEW = 160
  const hasMore = elem.text.length > PREVIEW

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      style={{ borderLeft: `3px solid ${accent}` }}
      className="bg-card rounded-lg p-3 mb-2 border border-border transition-colors"
    >
      {/* Row 1: type pill + id */}
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span
          style={{
            color: accent,
            borderColor: `color-mix(in srgb, ${accent} 27%, transparent)`,
            background: `color-mix(in srgb, ${accent} 9%, transparent)`,
          }}
          className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded border"
        >
          {elem.type}
        </span>
        <span className="font-mono text-[11px] text-foreground font-semibold">{elem.id}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="text-[9px] font-mono text-muted bg-card border border-border px-1.5 py-0.5 rounded">
            {elem.relationship.replace(/_/g, ' ')}
          </span>
          {elem.is_inter_document ? (
            <span className="text-[9px] font-bold text-primary bg-primary/15 border border-primary/30 px-1.5 py-0.5 rounded tracking-wide">
              ↔ INTER
            </span>
          ) : (
            <span className="text-[9px] font-bold text-muted bg-card border border-border px-1.5 py-0.5 rounded tracking-wide">
              ↕ INTRA
            </span>
          )}
        </span>
      </div>

      {/* Row 2: full / preview text */}
      <p className="text-[11px] text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
        {expanded || !hasMore ? elem.text : elem.text.slice(0, PREVIEW) + '…'}
      </p>
      {hasMore && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-[10px] text-primary hover:underline font-medium"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {/* Row 3: source */}
      <p className="text-[9px] text-muted font-mono mt-1.5 break-all opacity-80">{elem.source}</p>
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
        style={{
          borderBottom: `2px solid color-mix(in srgb, ${color} 33%, transparent)`,
          background: `color-mix(in srgb, ${color} 7%, transparent)`,
        }}
        className="sticky top-0 z-10 px-3 py-2 flex items-center justify-between"
      >
        <span style={{ color }} className="text-xs font-semibold tracking-wide uppercase">
          {title}
        </span>
        <span
          style={{
            color,
            borderColor: `color-mix(in srgb, ${color} 27%, transparent)`,
            background: `color-mix(in srgb, ${color} 13%, transparent)`,
          }}
          className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full border"
        >
          {items.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <p className="text-muted text-sm text-center mt-6">—</p>
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
      <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-4 py-2">
        <span className="text-sm font-bold text-primary font-mono">{interCount}</span>
        <span className="text-xs text-primary/80">↔ Inter-document</span>
      </div>
      <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-4 py-2">
        <span className="text-sm font-bold text-foreground font-mono">{intraCount}</span>
        <span className="text-xs text-muted">↕ Intra-document</span>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TraceabilityView({ workspaceId, coverage }: { workspaceId: string; coverage: CoverageResult[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [chain, setChain] = useState<TraceabilityChain | null>(null)
  const [loading, setLoading] = useState(false)

  const loadChain = useCallback(async (reqId: string) => {
    setSelected(reqId)
    setLoading(true)
    try {
      const c = await fetchChain(workspaceId, reqId)
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
            <MetricCard value={covered}    label="Covered"  color={statusColor('Covered')} />
            <MetricCard value={partial}    label="Partial"  color={statusColor('Partially Covered')} />
            <MetricCard value={notCovered} label="Gap"      color={statusColor('Not Covered')} />
          </div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted">Coverage score</span>
            <span className="font-mono text-foreground font-semibold">{score.toFixed(0)}%</span>
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
                    <span className="font-mono text-xs text-foreground font-semibold">{r.requirement_id}</span>
                    <span className="shrink-0">
                      <ChevronRight size={12} className={clsx('text-muted transition-transform', isSelected && 'rotate-90')} />
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5 leading-relaxed">{r.requirement_text}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span style={{ color: cfg.color, borderColor: `color-mix(in srgb, ${cfg.color} 27%, transparent)` }}
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
            <div className="shrink-0 px-4 py-3 border-b border-border bg-surface">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-sm font-bold text-foreground">{chain.requirement.id}</span>
                <span className="ml-auto text-[10px] font-mono text-muted bg-card border border-border px-2 py-0.5 rounded shrink-0">
                  {chain.requirement.source}
                </span>
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
                {chain.requirement.text}
              </p>
            </div>

            {/* 4 columns */}
            <div className="flex-1 flex overflow-hidden divide-x divide-border">
              <Column
                title="Clauses"
                color={typeColor('Clause')}
                items={[...chain.full_coverage, ...chain.partial_coverage]}
              />
              <Column
                title="Risks"
                color={typeColor('Risk')}
                items={chain.risks}
              />
              <Column
                title="Mitigations"
                color={typeColor('Mitigation')}
                items={chain.mitigations}
              />
              <Column
                title="LDs"
                color={typeColor('LD')}
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
