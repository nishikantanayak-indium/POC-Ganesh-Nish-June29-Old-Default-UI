import React, { useEffect, useMemo, useState } from 'react'
import { BarChart3, Copy, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { fetchRecords, fetchReports } from '../../api/client'
import type { StudioVersion, SyntheticRecordT, RecordReports, DistributionStats } from '../../types'

interface Props { version: StudioVersion | null }

function Gauge({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const pct = Math.round(value * 100)
  const tone = value >= 0.75 ? 'var(--success)' : value >= 0.5 ? 'var(--warning)' : 'var(--danger)'
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className="text-lg font-mono font-semibold" style={{ color: tone }}>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-card overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tone }} />
      </div>
      {hint && <p className="text-[10px] text-muted/60 mt-1.5">{hint}</p>}
    </div>
  )
}

// Fixed categorical order — each chart keeps its own hue across the whole
// dashboard so "by label" is always blue, "by industry" always violet, etc.
// (identity by chart, not by bar — every bar within a chart shares that hue).
const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']

// A matrix cell key comes across the wire as "ElementType|Label" — render it
// as a two-part chip (type, then label) instead of a raw pipe-delimited string.
function CellChip({ cellKey, tone }: { cellKey: string; tone: string }) {
  const [type, label] = cellKey.split('|')
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-md border"
      style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`, background: `color-mix(in srgb, ${tone} 12%, transparent)` }}
    >
      {type}{label && <><span className="opacity-40">/</span>{label}</>}
    </span>
  )
}

function BarChart({ title, data, color }: { title: string; data: Record<string, number>; color: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...entries.map(e => e[1]))
  if (!entries.length) return null
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[10px] font-semibold text-muted/70 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        {title}
      </p>
      <div className="space-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 group" title={`${k}: ${v}`}>
            <span className="text-[11px] font-mono text-muted w-28 truncate shrink-0">{k}</span>
            <div className="flex-1 h-4 bg-bg rounded overflow-hidden">
              <div
                className="h-full rounded transition-all group-hover:brightness-125"
                style={{ width: `${Math.max((v / max) * 100, 3)}%`, background: color }}
              />
            </div>
            <span className="text-[11px] font-mono text-foreground w-6 text-right shrink-0">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function QualityTab({ version }: Props) {
  const [records, setRecords] = useState<SyntheticRecordT[]>([])
  const [reports, setReports] = useState<Record<string, RecordReports>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!version) return
    setLoading(true)
    Promise.all([fetchRecords(version.id), fetchReports(version.id)])
      .then(([recs, reps]) => { setRecords(recs); setReports(reps) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [version])

  const recById = useMemo(() => Object.fromEntries(records.map(r => [r.id, r])), [records])
  const dist: DistributionStats | undefined = version?.stats?.distribution

  const duplicates = useMemo(
    () => Object.values(reports).filter(r => r.quality?.is_duplicate),
    [reports],
  )
  const lowRealism = useMemo(
    () => Object.values(reports).filter(r => r.quality && !r.quality.is_duplicate && r.quality.realism < 0.6),
    [reports],
  )
  const avgRealism = useMemo(() => {
    const vals = Object.values(reports).map(r => r.quality?.realism).filter((x): x is number => x !== undefined)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }, [reports])

  if (!version) return <div className="h-full flex items-center justify-center"><p className="text-sm text-muted">Generate a version to assess quality.</p></div>

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Quality — v{version.version_no}</h3>
          <span className="text-xs text-muted">realism · duplication · diversity · balance</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Gauge label="Diversity" value={dist?.diversity_score ?? 0} hint="normalised entropy over cells" />
          <Gauge label="Balance" value={dist?.balance_score ?? 0} hint="evenness across cells" />
          <Gauge label="Avg realism" value={avgRealism} hint="rule + LLM-as-judge" />
          <div className="rounded-xl border border-border bg-surface p-4 flex flex-col justify-center">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Duplicates</span>
              <span className="font-mono text-warning">{duplicates.length}</span>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-muted">Low realism</span>
              <span className="font-mono text-danger">{lowRealism.length}</span>
            </div>
          </div>
        </div>

        {dist && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <BarChart title="By label" data={dist.by_label} color={CHART_COLORS[0]} />
            <BarChart title="By element type" data={dist.by_element_type} color={CHART_COLORS[1]} />
            <BarChart title="By document type" data={dist.by_doc_type} color={CHART_COLORS[2]} />
            <BarChart title="By industry" data={dist.by_industry} color={CHART_COLORS[3]} />
          </div>
        )}

        {dist && (dist.under_represented.length > 0 || dist.over_represented.length > 0) && (
          <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
            {dist.under_represented.length > 0 && (
              <div className="flex items-start gap-2">
                <AlertTriangle size={13} className="text-warning mt-1 shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs text-foreground font-medium">Under-represented cells</p>
                  <p className="text-[11px] text-muted/70">Fewer generated records than this project's minimum threshold — generate more here.</p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {dist.under_represented.map(c => <CellChip key={c} cellKey={c} tone="var(--warning)" />)}
                  </div>
                </div>
              </div>
            )}
            {dist.over_represented.length > 0 && (
              <div className="flex items-start gap-2">
                <AlertTriangle size={13} className="mt-1 shrink-0" style={{ color: 'var(--chart-4)' }} />
                <div className="space-y-1">
                  <p className="text-xs text-foreground font-medium">Over-represented cells</p>
                  <p className="text-[11px] text-muted/70">More than double the average count for a cell — the dataset is skewed toward these.</p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {dist.over_represented.map(c => <CellChip key={c} cellKey={c} tone="var(--chart-4)" />)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {duplicates.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[10px] font-semibold text-muted/70 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Copy size={11} /> Duplicate clusters</p>
            <p className="text-[11px] text-muted/70 mb-3">Records flagged as near-duplicates of another record already in this dataset (similarity score ≥ 0.90) and excluded from the staged set.</p>
            <div className="space-y-2">
              {duplicates.map(d => {
                const q = d.quality!
                const other = q.duplicate_of ? recById[q.duplicate_of] : undefined
                return (
                  <div key={q.record_id} className="rounded-lg border border-border bg-bg p-2.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-warning/15 text-warning shrink-0">
                        {(q.near_dup_score * 100).toFixed(0)}% similar
                      </span>
                      <span className="text-[10px] text-muted/60">flagged record vs. its closest match</span>
                    </div>
                    <p className="text-[11px] text-foreground leading-snug line-clamp-2">{recById[q.record_id]?.text ?? q.record_id}</p>
                    <div className="flex items-start gap-1.5 pl-2 border-l-2 border-border">
                      <span className="text-[10px] text-muted/60 shrink-0 mt-0.5">matches</span>
                      <p className="text-[11px] text-muted leading-snug line-clamp-2">{other?.text ?? q.duplicate_of}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {loading && <p className="text-xs text-muted text-center py-2">Loading…</p>}
      </div>
    </div>
  )
}
